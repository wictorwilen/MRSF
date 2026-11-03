const author = "UI テスター 👩‍💻";
const variants = [
  { id: "emoji-prefix", text: "😀 日本語とカタカナのレビュー", selected_text: "日本語", start_column: 3, end_column: 6 },
  { id: "zwj", text: "Before 👩‍💻 after: 開発者", selected_text: "👩‍💻", start_column: 7, end_column: 12 },
  { id: "flag", text: "Flag 🇯🇵 and 🇺🇸: 国旗", selected_text: "🇯🇵", start_column: 5, end_column: 9 },
  { id: "non-bmp-cjk", text: "A 𠮷野家 and 日本語", selected_text: "𠮷野家", start_column: 2, end_column: 6 },
  { id: "combining", text: "Cafe\u0301, café, and コーヒー", selected_text: "Cafe\u0301", start_column: 0, end_column: 5 },
  { id: "hiragana", text: "こんにちは、世界。カタカナも確認。", selected_text: "こんにちは", start_column: 0, end_column: 5 },
  { id: "skin-tone", text: "OK 👍🏽 done: 承認", selected_text: "👍🏽", start_column: 3, end_column: 7 },
];
const lines = [
  "# UTF-16 review: 日本語 😀",
  "",
  "A longer document with Unicode selections and threaded review comments.",
  "",
  ...Array.from({ length: 20 }, (_, index) => [
    `## Background ${index + 1}`,
    "",
    `Paragraph ${index + 1}: English, 日本語, カタカナ, and emoji 😀 appear together.`,
    "",
  ]).flat(),
];
const comments = variants.map((variant) => {
  lines.push(`## Selection: ${variant.id}`, "");
  const line = lines.length + 1;
  lines.push(variant.text, "", "Follow-up context: 確認してください 👩‍💻 🇯🇵.", "");
  return {
    id: variant.id,
    author,
    text: `${variant.id}: 日本語のコメント 😀 👩‍💻 🇯🇵 𠮷 Cafe\u0301 👍🏽 <確認> & "review"`,
    timestamp: "2026-09-17T00:00:00Z",
    line,
    selected_text: variant.selected_text,
    start_column: variant.start_column,
    end_column: variant.end_column,
  };
});
comments.push({
  id: "unicode-existing-reply",
  reply_to: "emoji-prefix",
  author: "レビュアー 🇯🇵",
  text: "既存の返信: 😀 👩‍💻 𠮷野家 Cafe\u0301",
  timestamp: "2026-09-17T00:01:00Z",
});
lines.push("## Appendix", "", ...Array.from({ length: 30 }, (_, index) => `- Appendix ${index + 1}: 日本語 😀`), "");

module.exports = {
  author,
  content: lines.join("\n"),
  review: { mrsf_version: "1.0", document: "unicode.md", comments },
};
