import * as vscode from "vscode";

export class SelectionCommentCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly registration: vscode.Disposable;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

  constructor() {
    this.registration = vscode.languages.registerCodeLensProvider(
      { language: "markdown" },
      this,
    );

    this.disposables.push(
      this.registration,
      this.onDidChangeCodeLensesEmitter,
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor.document.languageId === "markdown") {
          this.onDidChangeCodeLensesEmitter.fire();
        }
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!editor || editor.document.languageId === "markdown") {
          this.onDidChangeCodeLensesEmitter.fire();
        }
      }),
    );
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return [];
    if (editor.document.languageId !== "markdown") return [];
    if (editor.document.uri.toString() !== document.uri.toString()) return [];
    if (editor.selection.isEmpty) return [];

    const pos = editor.selection.start;
    return [
      new vscode.CodeLens(
        new vscode.Range(pos, pos),
        {
          title: "$(comment-discussion) Add comment",
          tooltip: "Add an inline MRSF comment to the current selection",
          command: "mrsf.addInlineComment",
          arguments: [document.uri],
        },
      ),
    ];
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}