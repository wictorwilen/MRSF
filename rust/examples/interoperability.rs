//! Small cross-language test hook built entirely on the public library API.
//! This is an example target, not an installed CLI or a crate binary.
use mrsf::*;
use serde_json::json;
use std::{env, fs, path::Path};

fn run() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("create") if args.len() == 3 => {
            if !matches!(args[1].as_str(), "yaml" | "json") { return Err("format must be yaml or json".into()); }
            let mut doc = MrsfDocument::new("guide.md");
            doc.extra.insert("x_workspace".into(), json!({"name":"日本語 workspace","tags":["😀",1,true,null]}));
            let mut extensions = Extensions::new();
            extensions.insert("x_shared".into(), json!({"nested":{"unicode":"😀 日本語","values":[1,true,null]}}));
            add_comment(&mut doc, AddCommentOptions {
                id: Some("interop".into()), author: "Interop".into(), text: "Review this".into(),
                timestamp: Some("2026-01-01T00:00:00Z".into()), selected_text: Some("😀 日本語".into()),
                extensions, ..Default::default()
            })?;
            // Explicit serialization follows the requested format even if the
            // output filename is unconventional.
            let source = if args[1] == "json" { to_json(&doc)? } else { to_yaml(&doc)? };
            if let Some(parent) = Path::new(&args[2]).parent().filter(|p| !p.as_os_str().is_empty()) { fs::create_dir_all(parent)?; }
            fs::write(&args[2], source)?;
        }
        Some("validate") if args.len() == 2 => {
            let doc = parse_sidecar(&args[1])?;
            let report = validate(&doc);
            if !report.valid { return Err(Error::Validation(report).into()); }
        }
        Some("update") if args.len() == 3 => {
            let mut doc = parse_sidecar(&args[1])?;
            let root = doc.comments.iter().find(|c| c.reply_to.is_none()).ok_or("no root comment")?.id.clone();
            resolve_comment(&mut doc, &root);
            doc.comments.iter_mut().find(|c| c.id == root).expect("root exists").extra.insert("x_rust".into(),
                json!({"nested":{"native":true,"unicode":"😀 日本語"},"values":[1,null]}));
            if args[1] != args[2] {
                if let Some(parent) = Path::new(&args[2]).parent().filter(|p| !p.as_os_str().is_empty()) { fs::create_dir_all(parent)?; }
                fs::copy(&args[1], &args[2])?;
            }
            write_sidecar(&args[2], &doc)?;
        }
        _ => return Err("usage: interoperability create yaml|json OUTPUT | validate INPUT | update INPUT OUTPUT".into()),
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
