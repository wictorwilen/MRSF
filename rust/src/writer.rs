//! Serialization for new documents and CST transactions for existing YAML.
//! Every existing-file edit is built in memory, semantically verified, and only
//! then persisted through a sibling file and atomic rename. Failure never
//! falls back to dumping/reformatting the original YAML.
use crate::{parse_value, validation::ensure_valid, Error, Format, MrsfDocument, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs, io::Write, path::Path};

/// Canonical lowercase SHA-256 digest of the string's UTF-8 bytes (§6.2).
pub fn compute_hash(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

/// Serialize a new YAML document. Existing files should use `write_sidecar`.
pub fn to_yaml(doc: &MrsfDocument) -> Result<String> {
    ensure_valid(doc)?;
    oneyaml::to_string(doc).map_err(|e| Error::Yaml(e.to_string()))
}

/// Validate and serialize new, pretty-printed JSON with a final newline.
pub fn to_json(doc: &MrsfDocument) -> Result<String> {
    ensure_valid(doc)?;
    Ok(format!("{}\n", serde_json::to_string_pretty(doc)?))
}

fn preservation(e: impl std::fmt::Display) -> Error {
    Error::Preservation(e.to_string())
}

fn key_path(path: &str, key: &str) -> String {
    let key = serde_json::to_string(key).expect("string serializes");
    if path == "." {
        key
    } else {
        format!("{path}.{key}")
    }
}

fn remove_keep_comments(doc: &mut oneyaml::Document, path: &str) -> Result<()> {
    let id = doc
        .get_path(path)
        .ok_or_else(|| preservation("missing CST node"))?
        .id();
    let _ = doc.remove_keep_comments(id).map_err(preservation)?;
    Ok(())
}

fn comment_view(raw: &str) -> &str {
    let text = raw.strip_prefix('#').unwrap_or(raw);
    text.strip_prefix(' ').unwrap_or(text)
}

fn patch(doc: &mut oneyaml::Document, path: &str, old: &Value, new: &Value) -> Result<()> {
    if old == new {
        return Ok(());
    }
    match (old, new) {
        (Value::Object(a), Value::Object(b)) => {
            for key in a.keys().filter(|k| !b.contains_key(*k)) {
                remove_keep_comments(doc, &key_path(path, key))?;
            }
            for (key, value) in b {
                let p = key_path(path, key);
                if let Some(previous) = a.get(key) {
                    patch(doc, &p, previous, value)?;
                } else {
                    doc.set_path(&p, value).map_err(preservation)?;
                }
            }
        }
        (Value::Array(a), Value::Array(b)) if path == "\"comments\"" => {
            let old_ids: Vec<_> = a.iter().map(|v| v["id"].as_str()).collect();
            let new_ids: Vec<_> = b.iter().map(|v| v["id"].as_str()).collect();
            let common_old: Vec<_> = old_ids.iter().filter(|id| new_ids.contains(id)).collect();
            let common_new: Vec<_> = new_ids.iter().filter(|id| old_ids.contains(id)).collect();
            if common_old != common_new {
                return Err(preservation(
                    "reordering existing comments is not supported",
                ));
            }
            for i in (0..a.len()).rev() {
                if !new_ids.contains(&old_ids[i]) {
                    remove_keep_comments(doc, &format!("{path}[{i}]"))?;
                }
            }
            let mut retained: Vec<&Value> = a
                .iter()
                .filter(|v| new_ids.contains(&v["id"].as_str()))
                .collect();
            for (i, value) in b.iter().enumerate() {
                if retained.get(i).is_some_and(|v| v["id"] == value["id"]) {
                    patch(doc, &format!("{path}[{i}]"), retained[i], value)?;
                } else {
                    doc.get_path_mut(path)
                        .map_err(preservation)?
                        .insert_at(i, value)
                        .map_err(preservation)?;
                    retained.insert(i, value);
                }
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            for i in 0..a.len().min(b.len()) {
                patch(doc, &format!("{path}[{i}]"), &a[i], &b[i])?;
            }
            for i in (b.len()..a.len()).rev() {
                remove_keep_comments(doc, &format!("{path}[{i}]"))?;
            }
            for value in b.iter().skip(a.len()) {
                doc.get_path_mut(path)
                    .map_err(preservation)?
                    .push(value)
                    .map_err(preservation)?;
            }
        }
        _ => {
            doc.set_path(path, new).map_err(preservation)?;
        }
    }
    Ok(())
}

/// Produce an edit transaction using the maintained oneyaml CST. No regex or
/// whole-document dump fallback is used. Failed edits leave the source untouched.
pub fn update_yaml(original: &str, doc: &MrsfDocument) -> Result<String> {
    ensure_valid(doc)?;
    let old = parse_value(original, Format::Yaml)?;
    let new = serde_json::to_value(doc)?;
    if old == new {
        return Ok(original.into());
    }
    let mut cst = oneyaml::Document::parse(original).map_err(preservation)?;
    let original_comments: Vec<_> = cst
        .explain_comments()
        .map_err(preservation)?
        .into_iter()
        .map(|comment| comment_view(comment.text()).to_owned())
        .collect();
    patch(&mut cst, ".", &old, &new)?;
    // Deleted descendants no longer have an owning node. The dependency
    // preserves entry-level comments but not these descendants; explicitly move
    // their text to the document footer. This bounded policy changes placement
    // only for otherwise-deleted annotations. Any existing footer is byte-checked
    // after the CST operation. Discovery comes from the CST, never '#' scanning.
    let mut remaining: HashMap<String, usize> = HashMap::new();
    for comment in cst.explain_comments().map_err(preservation)? {
        *remaining
            .entry(comment_view(comment.text()).to_owned())
            .or_default() += 1;
    }
    let mut displaced = Vec::new();
    for comment in &original_comments {
        let count = remaining.entry(comment.clone()).or_default();
        if *count > 0 {
            *count -= 1;
        } else {
            displaced.push(comment.clone());
        }
    }
    if !displaced.is_empty() {
        let footer = cst.footer().map_err(preservation)?;
        let before = cst.to_string();
        let footer_count = footer.len();
        // Include whitespace before/between existing footer comments. Retaining
        // only comment text would miss blank-line normalization by the setter.
        let footer_fragment = footer.first().zip(footer.last()).map(|(first, last)| {
            let start = before[..first.span().start]
                .trim_end_matches(char::is_whitespace)
                .len();
            before[start..last.span().end].to_owned()
        });
        // The setter accepts comment contents, not raw "# ..." tokens. Reject
        // unusual existing footer spelling rather than normalizing untouched
        // human text as an incidental side effect of a deletion.
        if footer.iter().any(|c| c.raw() != format!("# {}", c.text())) {
            return Err(preservation(
                "cannot append displaced comments to a noncanonical document footer",
            ));
        }
        let mut contents: Vec<_> = footer.iter().map(|c| c.text().to_owned()).collect();
        contents.extend(displaced);
        cst.set_footer(contents).map_err(preservation)?;
        if let Some(fragment) = footer_fragment {
            let after = cst.to_string();
            let footer = cst.footer().map_err(preservation)?;
            let first = footer
                .first()
                .ok_or_else(|| preservation("existing footer disappeared"))?;
            let last = footer
                .get(footer_count - 1)
                .ok_or_else(|| preservation("existing footer disappeared"))?;
            let start = after[..first.span().start]
                .trim_end_matches(char::is_whitespace)
                .len();
            if after[start..last.span().end] != fragment {
                return Err(preservation(
                    "appending displaced annotations would change existing footer layout",
                ));
            }
        }
    }
    let output = cst.to_string();
    // Defense in depth for structural replacements unsupported by the CST:
    // reject the transaction if even one comment disappeared. A multiset (not
    // a set) preserves repeated identical human annotations independently.
    let mut after: HashMap<String, usize> = HashMap::new();
    for comment in cst.explain_comments().map_err(preservation)? {
        *after
            .entry(comment_view(comment.text()).to_owned())
            .or_default() += 1;
    }
    for comment in original_comments {
        let count = after.entry(comment).or_default();
        if *count == 0 {
            return Err(preservation("CST edit would lose a YAML comment"));
        }
        *count -= 1;
    }
    if parse_value(&output, Format::Yaml)? != new {
        return Err(preservation(
            "CST edit changed unintended values (possibly aliases or merge keys)",
        ));
    }
    Ok(output)
}

/// Atomically replace a sidecar, preserving existing YAML formatting. Existing
/// invalid files are not overwritten. New parent directories are created.
pub fn write_sidecar(path: impl AsRef<Path>, doc: &MrsfDocument) -> Result<()> {
    let path = path.as_ref();
    ensure_valid(doc)?;
    let old = match fs::read_to_string(path) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    let output = match (Format::from_path(path), &old) {
        (Format::Yaml, Some(text)) => {
            crate::parse_sidecar_content(text, Format::Yaml)?;
            update_yaml(text, doc)?
        }
        (Format::Yaml, None) => to_yaml(doc)?,
        (Format::Json, Some(text)) => {
            let parsed = crate::parse_sidecar_content(text, Format::Json)?;
            if parsed == *doc {
                text.clone()
            } else {
                to_json(doc)?
            }
        }
        (Format::Json, None) => to_json(doc)?,
    };
    if old.as_deref() == Some(&output) {
        return Ok(());
    }
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent)?;
    let scratch = parent.join(format!(".mrsf-{}.write", uuid::Uuid::new_v4()));
    let result = (|| -> Result<()> {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&scratch)?;
        file.write_all(output.as_bytes())?;
        if let Ok(metadata) = fs::metadata(path) {
            file.set_permissions(metadata.permissions())?;
        }
        file.sync_all()?;
        drop(file);
        fs::rename(&scratch, path)?;
        Ok(())
    })();
    if result.is_err() {
        // Windows cannot remove a read-only scratch file. Clear only its own
        // copied attribute, never the destination's permissions, before cleanup.
        #[cfg(windows)]
        #[allow(
            clippy::permissions_set_readonly_false,
            reason = "Windows-only DOS attribute; this block is never compiled on Unix"
        )]
        if let Ok(metadata) = fs::metadata(&scratch) {
            let mut permissions = metadata.permissions();
            if permissions.readonly() {
                permissions.set_readonly(false);
                let _ = fs::set_permissions(&scratch, permissions);
            }
        }
        let _ = fs::remove_file(scratch);
    }
    result
}
