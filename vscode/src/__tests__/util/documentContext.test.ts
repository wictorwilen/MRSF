import { beforeEach, describe, expect, it } from "vitest";
import { __mock, TabInputCustom, TabInputText, TabInputWebview, Uri, workspace } from "vscode";
import { MARKDOWN_PREVIEW, resolveDocumentUri } from "../../util/documentContext.js";

beforeEach(() => __mock.reset());

describe("supported Markdown document context", () => {
  it("uses the preview tab URI rather than an unrelated source editor", () => {
    const preview = Uri.file("/workspace/preview.md");
    __mock.emitActiveTextEditor({ document: { uri: Uri.file("/workspace/source.md"), languageId: "markdown" } } as never);
    __mock.emitActiveTab(new TabInputCustom(preview, MARKDOWN_PREVIEW));
    expect(resolveDocumentUri()).toEqual(preview);
  });

  it("does not target another file while Markdown Editor is active", () => {
    const uri = Uri.file("/workspace/doc.md");
    workspace.textDocuments = [{ uri, languageId: "markdown" }];
    __mock.emitActiveTab(new TabInputCustom(uri, "vscode.markdown.editor"));
    expect(resolveDocumentUri(uri)).toBeUndefined();
  });

  it("uses the selected Markdown text tab", () => {
    const uri = Uri.file("/workspace/doc.md");
    workspace.textDocuments = [{ uri, languageId: "markdown" }];
    __mock.emitActiveTab(new TabInputText(uri));
    expect(resolveDocumentUri()).toEqual(uri);
  });

  it("does not guess between documents behind a legacy preview", () => {
    workspace.textDocuments = ["one", "two"].map((name) => ({ uri: Uri.file(`/workspace/${name}.md`), languageId: "markdown" }));
    __mock.emitActiveTab(new TabInputWebview());
    expect(resolveDocumentUri()).toBeUndefined();
  });

  it("recognizes the real legacy webview type with one unambiguous document", () => {
    const uri = Uri.file("/workspace/doc.md");
    workspace.textDocuments = [{ uri, languageId: "markdown" }];
    __mock.emitActiveTab(new TabInputWebview("mainThreadWebview-markdown.preview"));
    expect(resolveDocumentUri()).toEqual(uri);
  });
});