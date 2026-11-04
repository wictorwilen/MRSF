//! Authoritative sidecar discovery (§3). Configured roots never fall back to
//! co-location, even when the configured sidecar does not exist yet.
use crate::{Error, MrsfConfig, Result, CONFIG_SCHEMA};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

pub const SIDECAR_SUFFIX: &str = ".review.yaml";
pub const SIDECAR_SUFFIX_JSON: &str = ".review.json";
pub const CONFIG_FILENAME: &str = ".mrsf.yaml";

/// Reject both Windows and POSIX rooted/traversing forms on every platform.
/// This matters when a Linux application reads a sidecar authored on Windows.
pub fn safe_relative_path(path: &str) -> Result<PathBuf> {
    if path.is_empty()
        || path.starts_with(['/', '\\'])
        || path.as_bytes().get(1) == Some(&b':')
        || path.split(['/', '\\']).any(|p| p == "..")
    {
        return Err(Error::Path(path.into()));
    }
    let normalized = path.replace(['\\', '/'], std::path::MAIN_SEPARATOR_STR);
    let result = PathBuf::from(normalized);
    if result.components().any(|c| {
        matches!(
            c,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(Error::Path(path.into()));
    }
    Ok(result)
}

fn absolute(path: &Path) -> Result<PathBuf> {
    if path.is_absolute() {
        Ok(path.into())
    } else {
        Ok(std::env::current_dir()?.join(path))
    }
}

pub fn find_workspace_root(start: impl AsRef<Path>) -> Result<PathBuf> {
    let start = absolute(start.as_ref())?;
    for dir in start.ancestors() {
        if dir.join(CONFIG_FILENAME).exists() || dir.join(".git").exists() {
            return Ok(dir.into());
        }
    }
    Ok(start)
}

pub fn load_config(workspace_root: impl AsRef<Path>) -> Result<Option<MrsfConfig>> {
    load_config_file(workspace_root.as_ref().join(CONFIG_FILENAME))
}

pub fn load_config_file(path: impl AsRef<Path>) -> Result<Option<MrsfConfig>> {
    let source = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let value = crate::parse_value(&source, crate::Format::Yaml)?;
    let schema =
        jsonschema::validator_for(&serde_json::from_str::<serde_json::Value>(CONFIG_SCHEMA)?)
            .map_err(|e| Error::Invalid(e.to_string()))?;
    if let Some(error) = schema.iter_errors(&value).next() {
        return Err(Error::Invalid(error.to_string()));
    }
    let config: MrsfConfig = serde_json::from_value(value)?;
    if let Some(root) = &config.sidecar_root {
        safe_relative_path(root)?;
    }
    Ok(Some(config))
}

/// Resolve a document from a workspace root, ensuring that an existing symlink
/// does not lead outside it. The document need not already exist.
pub fn resolve_document_path(workspace_root: impl AsRef<Path>, document: &str) -> Result<PathBuf> {
    let root = absolute(workspace_root.as_ref())?;
    let path = root.join(safe_relative_path(document)?);
    // Check the deepest existing ancestor, covering missing files beneath a
    // symlink as well as symlinked document files.
    if let Some(existing) = path.ancestors().find(|p| p.exists()) {
        let real_root = fs::canonicalize(&root)?;
        if !fs::canonicalize(existing)?.starts_with(real_root) {
            return Err(Error::Path(document.into()));
        }
    }
    Ok(path)
}

pub fn discover_sidecar(document: impl AsRef<Path>, cwd: impl AsRef<Path>) -> Result<PathBuf> {
    let root = find_workspace_root(cwd)?;
    let document = document.as_ref();
    let relative = if document.is_absolute() {
        document
            .strip_prefix(&root)
            .map_err(|_| Error::Path(document.display().to_string()))?
    } else {
        document
    };
    let relative = safe_relative_path(&relative.to_string_lossy())?;
    resolve_document_path(&root, &relative.to_string_lossy())?;
    let config = load_config(&root)?;
    let base = match config.and_then(|c| c.sidecar_root) {
        Some(path) => root.join(safe_relative_path(&path)?),
        None => root.clone(),
    };
    let path = base.join(format!("{}{}", relative.to_string_lossy(), SIDECAR_SUFFIX));
    // Resolve against the workspace, not the sidecar root, to reject a symlink
    // escaping the workspace while allowing a legitimate in-workspace link.
    let rel = path
        .strip_prefix(&root)
        .map_err(|_| Error::Path(path.display().to_string()))?;
    resolve_document_path(&root, &rel.to_string_lossy())
}

/// Strip either standard sidecar suffix. For redirected sidecars, resolve the
/// parsed document's `document` field against the workspace instead.
pub fn sidecar_to_document(path: impl AsRef<Path>) -> PathBuf {
    let text = path.as_ref().to_string_lossy();
    PathBuf::from(
        text.strip_suffix(SIDECAR_SUFFIX)
            .or_else(|| text.strip_suffix(SIDECAR_SUFFIX_JSON))
            .unwrap_or(&text),
    )
}

/// Recursively enumerate sidecars without following directory symlinks.
pub fn discover_all_sidecars(directory: impl AsRef<Path>) -> Result<Vec<PathBuf>> {
    fn walk(path: &Path, out: &mut Vec<PathBuf>) -> Result<()> {
        if path.is_file() {
            let name = path.to_string_lossy();
            if name.ends_with(SIDECAR_SUFFIX) || name.ends_with(SIDECAR_SUFFIX_JSON) {
                out.push(path.into());
            }
        } else {
            for entry in fs::read_dir(path)? {
                let entry = entry?;
                if entry.file_type()?.is_symlink() {
                    continue;
                }
                if [".git", "node_modules", ".venv", "__pycache__", "target"]
                    .contains(&entry.file_name().to_string_lossy().as_ref())
                {
                    continue;
                }
                walk(&entry.path(), out)?;
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    walk(directory.as_ref(), &mut out)?;
    out.sort();
    Ok(out)
}
