use serde_json::{json, Value};

#[test]
fn lossless_cst_spike() {
    let input = "# review\r\nmrsf_version: \"1.0\"\r\ndocument: 'guide.md'\r\nx_nested: {a: [1, \"two\"]} # extension\r\ncomments:\r\n  # first\r\n  - id: c1\r\n    text: |\r\n      A block.\r\n      Second line.\r\n    resolved: false # status\r\n  - id: c2\r\n    text: >-\r\n      folded text\r\n    resolved: false\r\n";
    let mut doc = oneyaml::Document::parse(input).unwrap();
    assert_eq!(doc.to_string(), input);
    doc.set_path("comments[0].resolved", true).unwrap();
    assert_eq!(
        doc.to_string(),
        input.replace("false # status", "true # status")
    );
    doc.set_path("comments[0].text", "Changed.\nSecond line.\n")
        .unwrap();
    assert!(doc.to_string().contains("text: |"));
    doc.get_mut("comments")
        .unwrap()
        .push(json!({"id":"c3","text":"Added","resolved":false}))
        .unwrap();
    let _ = doc.get_mut("comments").unwrap().remove_at(1).unwrap();
    let value: Value = oneyaml::from_str(&doc.to_string()).unwrap();
    assert_eq!(value["comments"][1]["id"], "c3");
    assert!(doc.to_string().contains("# review\r\n"));
    assert!(doc.to_string().contains("# extension\r\n"));
    assert!(doc.to_string().contains("# first\r\n"));
    assert!(doc.to_string().contains("document: 'guide.md'"));
    assert!(doc.to_string().contains("x_nested: {a: [1, \"two\"]}"));
}
