const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");
const fixture = require("./fixtures.cjs");

module.exports = async function verifyEditorModes(page, artifacts, { eventually, findFrame }) {
  const root = vscode.workspace.workspaceFolders[0].uri;
  const target = vscode.Uri.joinPath(root, "source-editing.md");
  const sidecarPath = `${target.fsPath}.review.json`;
  await vscode.commands.executeCommand("vscode.openWith", target, "default");
  const document = await vscode.workspace.openTextDocument(target);
  let editor = await vscode.window.showTextDocument(document);
  assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab.input instanceof vscode.TabInputText,
    "Plain Markdown must open in the native Text Editor");
  await vscode.commands.executeCommand("mrsf.commentsView.focus");
  await findFrame(page, '[data-id="emoji-prefix"]', "Text Editor must load Unicode threads");
  editor = await vscode.window.showTextDocument(document);
  const anchors = fixture.review.comments.filter((comment) => comment.line != null);

  async function hasCommentHover(comment, line, column) {
    const hovers = await vscode.commands.executeCommand("vscode.executeHoverProvider",
      target, new vscode.Position(line, column));
    return hovers.some((hover) => hover.contents.some((content) => content.value?.includes(`${comment.id}:`)));
  }

  async function checkAnchor(comment, start, end, selectedText) {
    const line = comment.line - 1;
    await eventually(() => hasCommentHover(comment, line, start), `${comment.id} hover must track the live anchor`);
    if (start > 0) {
      assert.equal(await hasCommentHover(comment, line, start - 1), false, `${comment.id}: hover must not extend before the anchor`);
    }
    assert.equal(await hasCommentHover(comment, line, end), true, `${comment.id}: hover must reach the end boundary`);
    assert.equal(await hasCommentHover(comment, line, end + 1), false, `${comment.id}: hover must not extend after the anchor`);
    assert.equal(document.getText(new vscode.Range(line, start, line, end)), selectedText);
  }

  for (const comment of anchors) {
    const line = comment.line - 1;
    editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenter);
    await checkAnchor(comment, comment.start_column, comment.end_column, comment.selected_text);
    const before = "前🇯🇵 ";
    const after = " 後👍🏽";
    const inside = "内😀";
    const insideOffset = Array.from(comment.selected_text)[0].length;
    let start = comment.start_column;
    let end = comment.end_column;
    // At column zero this is a boundary insertion, which grows the shared anchor.
    const boundaryPrefix = start === 0 ? before : "";
    const prefixedSelection = boundaryPrefix + comment.selected_text;

    assert.equal(await editor.edit((edit) => edit.insert(new vscode.Position(line, 0), before)), true);
    if (start > 0) start += before.length;
    end += before.length;
    await checkAnchor(comment, start, end, prefixedSelection);
    assert.equal(await editor.edit((edit) => edit.insert(document.lineAt(line).range.end, after)), true);
    await checkAnchor(comment, start, end, prefixedSelection);
    assert.equal(await editor.edit((edit) => edit.insert(new vscode.Position(line, start + boundaryPrefix.length + insideOffset), inside)), true);
    const expandedText = boundaryPrefix + comment.selected_text.slice(0, insideOffset) + inside + comment.selected_text.slice(insideOffset);
    await checkAnchor(comment, start, end + inside.length, expandedText);

    await vscode.commands.executeCommand("undo");
    await checkAnchor(comment, start, end, prefixedSelection);
    await vscode.commands.executeCommand("undo");
    await checkAnchor(comment, start, end, prefixedSelection);
    await vscode.commands.executeCommand("undo");
    await checkAnchor(comment, comment.start_column, comment.end_column, comment.selected_text);
    assert.equal(document.getText(), fixture.content, `${comment.id}: undo must restore the exact Unicode source`);
  }
  await page.screenshot({ path: path.join(artifacts, "text-editor-unicode.png"), animations: "disabled" });

  const selected = anchors[1];
  const line = selected.line - 1;
  editor.selection = new vscode.Selection(line, selected.start_column, line, selected.end_column);
  editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenter);
  const newComment = "ソースからのコメント 👩‍💻 🇯🇵 𠮷 Cafe\u0301";
  const adding = vscode.commands.executeCommand("mrsf.addInlineComment");
  const input = page.getByPlaceholder("Enter your comment...", { exact: true });
  await input.fill(newComment);
  await input.press("Enter");
  for (const placeholder of ["Select comment type (optional)", "Select severity (optional)"]) {
    const pick = page.getByPlaceholder(placeholder, { exact: true });
    await pick.fill("(none)");
    await pick.press("Enter");
  }
  await adding;
  const saved = JSON.parse(await fs.readFile(sidecarPath, "utf8"));
  const added = saved.comments.find((comment) => comment.text === newComment);
  assert.ok(added, "Text Editor selection command must persist the Unicode comment");
  assert.deepEqual({
    author: added.author, line: added.line, start_column: added.start_column,
    end_column: added.end_column, selected_text: added.selected_text,
  }, {
    author: fixture.author, line: selected.line, start_column: selected.start_column,
    end_column: selected.end_column, selected_text: selected.selected_text,
  }, "Text Editor selection command must persist exact UTF-16 columns and selected text");

  const prefix = "New paragraph 👩‍💻 日本語\n";
  assert.equal(await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), prefix)), true);
  assert.equal(await document.save(), true);
  await eventually(async () => {
    const saved = JSON.parse(await fs.readFile(sidecarPath, "utf8"));
    return anchors.every((original) => {
      const current = saved.comments.find((comment) => comment.id === original.id);
      return current?.line === original.line + 1 && current.start_column === original.start_column
        && current.end_column === original.end_column && current.selected_text === original.selected_text;
    });
  }, "Save-time reanchoring must persist all shifted Unicode anchors");
  assert.equal(await fs.readFile(target.fsPath, "utf8"), prefix + fixture.content);
  const savedSidecar = await fs.readFile(sidecarPath, "utf8");

  await vscode.commands.executeCommand("vscode.openWith", target, "vscode.markdown.editor");
  const hybrid = vscode.window.tabGroups.activeTabGroup.activeTab.input;
  assert.ok(hybrid instanceof vscode.TabInputCustom);
  assert.equal(hybrid.viewType, "vscode.markdown.editor");
  const hybridFrame = await findFrame(page, ".md-theme-vscode-default",
    "Hybrid Markdown Editor must finish loading the edited document",
    async (frame) => (await frame.locator(".md-theme-vscode-default").textContent()).includes("New paragraph"));
  assert.equal(await hybridFrame.locator(".mrsf-badge, .mrsf-inline-highlight").count(), 0);
  const unsupported = await findFrame(page, ".empty-state",
    "Hybrid Markdown Editor must report its unsupported status, not retain stale threads",
    async (frame) => (await frame.locator(".empty-state").textContent()).includes("not supported in Markdown Editor"));
  assert.equal(await unsupported.locator(".thread, [data-id], textarea").count(), 0);
  await page.screenshot({ path: path.join(artifacts, "hybrid-editor-unsupported.png"), animations: "disabled" });
  assert.equal(await fs.readFile(sidecarPath, "utf8"), savedSidecar, "Unsupported mode must not mutate review comments");
  assert.equal(await fs.readFile(target.fsPath, "utf8"), prefix + fixture.content);

  await vscode.commands.executeCommand("vscode.openWith", target, "default");
  await findFrame(page, '[data-id="emoji-prefix"]', "Returning to Text Editor must restore its threads");
  editor = await vscode.window.showTextDocument(target);
  await eventually(() => hasCommentHover(anchors[0], anchors[0].line, anchors[0].start_column),
    "Returning to Text Editor must restore hovers at the saved anchor");
  console.log("Editor modes passed: native Text Editor, seven Unicode before/after/inside edits and undo, selection comment, save reanchoring, unsupported hybrid mode and return");
};
