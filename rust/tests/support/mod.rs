//! Tests keep scratch data inside the crate's target directory, not global
//! temporary storage. Unique directories avoid collisions between parallel tests.
use mrsf::{Comment, MrsfDocument};
use std::{fs, path::PathBuf};

pub struct TestDir(pub PathBuf);

impl TestDir {
    pub fn new() -> Self {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("test-work")
            .join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    pub fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub fn comment(id: &str) -> Comment {
    Comment {
        id: id.into(),
        author: "Reviewer".into(),
        timestamp: "2026-01-01T00:00:00Z".into(),
        text: "Review this".into(),
        resolved: false,
        ..Default::default()
    }
}

pub fn document() -> MrsfDocument {
    MrsfDocument {
        document: "guide.md".into(),
        comments: vec![comment("root")],
        ..Default::default()
    }
}
