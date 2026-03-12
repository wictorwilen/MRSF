type Listener<T> = (event: T) => unknown;

class Disposable {
  constructor(private readonly callback: () => void = () => {}) {}

  dispose(): void {
    this.callback();
  }
}

export class EventEmitter<T> {
  private listeners: Listener<T>[] = [];

  readonly event = (listener: Listener<T>): Disposable => {
    this.listeners.push(listener);
    return new Disposable(() => {
      this.listeners = this.listeners.filter((entry) => entry !== listener);
    });
  };

  fire(event: T): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  dispose(): void {
    this.listeners = [];
  }
}

export class Uri {
  constructor(
    public readonly fsPath: string,
    public readonly scheme: string = "file",
    public readonly query: string = "",
  ) {}

  static file(fsPath: string): Uri {
    return new Uri(fsPath, "file");
  }

  static joinPath(base: Uri, ...paths: string[]): Uri {
    const cleaned = [base.fsPath, ...paths]
      .filter(Boolean)
      .join("/")
      .replace(/\/+/g, "/");
    return new Uri(cleaned, base.scheme);
  }

  static parse(value: string): Uri {
    if (value.startsWith("file://")) {
      const withoutScheme = value.replace(/^file:\/\//, "");
      const [pathname, query = ""] = withoutScheme.split("?");
      return new Uri(decodeURIComponent(pathname), "file", query);
    }

    const [rawPath, query = ""] = value.split("?");
    return new Uri(rawPath, rawPath.includes("://") ? rawPath.split("://")[0] : "file", query);
  }

  get path(): string {
    return this.fsPath;
  }

  toString(): string {
    return this.scheme === "file"
      ? `file://${encodeURI(this.fsPath)}`
      : this.fsPath;
  }
}

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}

export class Range {
  readonly start: Position;
  readonly end: Position;

  constructor(start: Position, end: Position);
  constructor(startLine: number, startChar: number, endLine: number, endChar: number);
  constructor(
    startOrLine: Position | number,
    startOrChar: Position | number,
    endLine?: number,
    endChar?: number,
  ) {
    if (startOrLine instanceof Position && startOrChar instanceof Position) {
      this.start = startOrLine;
      this.end = startOrChar;
      return;
    }

    this.start = new Position(startOrLine as number, startOrChar as number);
    this.end = new Position(endLine as number, endChar as number);
  }

  contains(position: Position): boolean {
    const startsBefore = position.line > this.start.line
      || (position.line === this.start.line && position.character >= this.start.character);
    const endsAfter = position.line < this.end.line
      || (position.line === this.end.line && position.character <= this.end.character);
    return startsBefore && endsAfter;
  }
}

export class Selection extends Range {
  readonly anchor: Position;
  readonly active: Position;

  constructor(anchor: Position, active: Position) {
    super(anchor, active);
    this.anchor = anchor;
    this.active = active;
  }

  get isEmpty(): boolean {
    return this.anchor.line === this.active.line
      && this.anchor.character === this.active.character;
  }
}

export class ThemeColor {
  constructor(public readonly id: string) {}
}

export class MarkdownString {
  value: string;
  isTrusted?: boolean;
  supportHtml?: boolean;

  constructor(value: string) {
    this.value = value;
  }

  appendMarkdown(markdown: string): void {
    this.value += markdown;
  }
}

export class Hover {
  constructor(public readonly contents: MarkdownString) {}
}

export class CodeLens {
  constructor(
    public readonly range: Range,
    public command?: {
      title: string;
      tooltip?: string;
      command: string;
      arguments?: unknown[];
    },
  ) {}
}

type StatusBarItem = {
  text: string;
  tooltip?: string;
  command?: string;
  backgroundColor?: ThemeColor;
  show: () => void;
  dispose: () => void;
  hide: () => void;
};

type DecorationType = {
  options: Record<string, unknown>;
  dispose: () => void;
};

type TextEditor = {
  document: {
    uri: Uri;
    languageId: string;
    lineCount: number;
    lineAt: (line: number) => { text: string };
  };
  selection: Selection;
  setDecorations: (decoration: DecorationType, ranges: unknown[]) => void;
  revealRange: (range: Range, revealType?: number) => void;
};

type CommandRegistration = {
  id: string;
  callback: (...args: unknown[]) => unknown;
};

type WebviewRegistration = {
  viewType: string;
  provider: unknown;
};

type UriHandlerRegistration = {
  handler: { handleUri: (uri: Uri) => unknown };
};

type HoverRegistration = {
  selector: unknown;
  provider: unknown;
};

type CodeLensRegistration = {
  selector: unknown;
  provider: unknown;
};

type FileWatcher = {
  pattern: string;
  onDidChange: (listener: (uri: Uri) => void) => Disposable;
  onDidCreate: (listener: (uri: Uri) => void) => Disposable;
  onDidDelete: (listener: (uri: Uri) => void) => Disposable;
  fireChange: (uri: Uri) => void;
  fireCreate: (uri: Uri) => void;
  fireDelete: (uri: Uri) => void;
  dispose: () => void;
};

function createFileSystemWatcher(pattern: string): FileWatcher {
  const onDidChangeEmitter = new EventEmitter<Uri>();
  const onDidCreateEmitter = new EventEmitter<Uri>();
  const onDidDeleteEmitter = new EventEmitter<Uri>();

  const watcher: FileWatcher = {
    pattern,
    onDidChange: onDidChangeEmitter.event,
    onDidCreate: onDidCreateEmitter.event,
    onDidDelete: onDidDeleteEmitter.event,
    fireChange: (uri) => onDidChangeEmitter.fire(uri),
    fireCreate: (uri) => onDidCreateEmitter.fire(uri),
    fireDelete: (uri) => onDidDeleteEmitter.fire(uri),
    dispose: () => {
      onDidChangeEmitter.dispose();
      onDidCreateEmitter.dispose();
      onDidDeleteEmitter.dispose();
    },
  };

  __mock.fileWatchers.push(watcher);
  return watcher;
}

function createStatusBarItem(): StatusBarItem {
  const item: StatusBarItem = {
    text: "",
    tooltip: undefined,
    command: undefined,
    backgroundColor: undefined,
    show: () => {},
    dispose: () => {},
    hide: () => {},
  };

  __mock.statusBarItems.push(item);
  return item;
}

function createTextEditorDecorationType(options: Record<string, unknown>): DecorationType {
  const decoration = {
    options,
    dispose: () => {},
  };

  __mock.decorations.push(decoration);
  return decoration;
}

const onDidChangeTextDocumentEmitter = new EventEmitter<unknown>();
const onDidSaveTextDocumentEmitter = new EventEmitter<unknown>();
const onDidChangeConfigurationEmitter = new EventEmitter<{ affectsConfiguration: (section: string) => boolean }>();
const onDidChangeActiveTextEditorEmitter = new EventEmitter<TextEditor | undefined>();
const onDidChangeVisibleTextEditorsEmitter = new EventEmitter<TextEditor[]>();
const onDidChangeTextEditorSelectionEmitter = new EventEmitter<unknown>();

function getConfiguration(section?: string) {
  return {
    get: <T>(key: string, fallback: T): T => {
      const compositeKey = section ? `${section}.${key}` : key;
      return (__mock.configuration.get(compositeKey) as T | undefined) ?? fallback;
    },
    update: async (key: string, value: unknown): Promise<void> => {
      const compositeKey = section ? `${section}.${key}` : key;
      __mock.configuration.set(compositeKey, value);
    },
  };
}

export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
} as const;

export const TextEditorRevealType = {
  InCenter: 0,
} as const;

export const ProgressLocation = {
  Notification: 1,
} as const;

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
} as const;

export class TabInputWebview {}

export const workspace = {
  workspaceFolders: [] as Array<{ uri: Uri }>,
  textDocuments: [] as Array<{ uri: Uri; languageId: string; lineCount?: number; lineAt?: (line: number) => { text: string } }>,
  createFileSystemWatcher,
  getConfiguration,
  onDidChangeConfiguration: onDidChangeConfigurationEmitter.event,
  onDidChangeTextDocument: onDidChangeTextDocumentEmitter.event,
  onDidSaveTextDocument: onDidSaveTextDocumentEmitter.event,
  openTextDocument: async (uri: Uri) => {
    const found = workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
    return found ?? {
      uri,
      languageId: "markdown",
      lineCount: 1,
      lineAt: () => ({ text: "" }),
    };
  },
};

export const window = {
  activeTextEditor: undefined as undefined | TextEditor,
  visibleTextEditors: [] as TextEditor[],
  tabGroups: {
    all: [] as Array<{ tabs: Array<{ isActive: boolean; input: unknown }> }>,
  },
  createStatusBarItem,
  createTextEditorDecorationType,
  showWarningMessage: async (message: string, ...items: unknown[]) => {
    __mock.warningMessages.push(message);
    __mock.warningMessageCalls.push({ message, items });
    return __mock.warningMessageResult;
  },
  showInformationMessage: async (message: string) => {
    __mock.informationMessages.push(message);
    return undefined;
  },
  showErrorMessage: async (message: string) => {
    __mock.errorMessages.push(message);
    return undefined;
  },
  showQuickPick: async <T>(items: readonly T[]) => {
    __mock.quickPickCalls.push(items);
    if (__mock.quickPickResults.length > 0) {
      return __mock.quickPickResults.shift() as T | undefined;
    }
    return __mock.quickPickResult as T | undefined;
  },
  showInputBox: async () => {
    if (__mock.inputBoxResults.length > 0) {
      return __mock.inputBoxResults.shift();
    }
    return __mock.inputBoxResult;
  },
  withProgress: async <T>(_options: unknown, task: () => Promise<T>) => task(),
  showTextDocument: async (
    documentOrUri: { uri?: Uri; languageId?: string; lineCount?: number; lineAt?: (line: number) => { text: string } } | Uri,
    options?: unknown,
  ) => {
    const document = documentOrUri instanceof Uri
      ? await workspace.openTextDocument(documentOrUri)
      : documentOrUri;

    const editor: TextEditor = {
      document: {
        uri: document.uri ?? Uri.file("/tmp/doc.md"),
        languageId: document.languageId ?? "markdown",
        lineCount: document.lineCount ?? 1,
        lineAt: document.lineAt ?? (() => ({ text: "" })),
      },
      selection: new Selection(new Position(0, 0), new Position(0, 0)),
      setDecorations: (decoration, ranges) => {
        __mock.decorationCalls.push({ decoration, ranges });
      },
      revealRange: (range, revealType) => {
        __mock.revealCalls.push({ range, revealType });
      },
    };

    __mock.lastShownEditor = editor;
    __mock.showTextDocumentCalls.push({ documentOrUri, options });
    return editor;
  },
  registerWebviewViewProvider: (viewType: string, provider: unknown) => {
    __mock.webviewRegistrations.push({ viewType, provider });
    return new Disposable();
  },
  registerUriHandler: (handler: { handleUri: (uri: Uri) => unknown }) => {
    __mock.uriHandlerRegistrations.push({ handler });
    return new Disposable();
  },
  onDidChangeActiveTextEditor: onDidChangeActiveTextEditorEmitter.event,
  onDidChangeVisibleTextEditors: onDidChangeVisibleTextEditorsEmitter.event,
  onDidChangeTextEditorSelection: onDidChangeTextEditorSelectionEmitter.event,
};

export const commands = {
  registerCommand: (id: string, callback: (...args: unknown[]) => unknown) => {
    __mock.commandRegistrations.push({ id, callback });
    return new Disposable();
  },
  executeCommand: async (id: string, ...args: unknown[]) => {
    __mock.executedCommands.push({ id, args });
    const registered = __mock.commandRegistrations.find((entry) => entry.id === id);
    if (registered) {
      return registered.callback(...args);
    }
    return undefined;
  },
};

export const languages = {
  registerHoverProvider: (selector: unknown, provider: unknown) => {
    __mock.hoverRegistrations.push({ selector, provider });
    return new Disposable();
  },
  registerCodeLensProvider: (selector: unknown, provider: unknown) => {
    __mock.codeLensRegistrations.push({ selector, provider });
    return new Disposable();
  },
};

export const __mock = {
  statusBarItems: [] as StatusBarItem[],
  fileWatchers: [] as FileWatcher[],
  decorations: [] as DecorationType[],
  decorationCalls: [] as Array<{ decoration: DecorationType; ranges: unknown[] }>,
  revealCalls: [] as Array<{ range: Range; revealType?: number }>,
  commandRegistrations: [] as CommandRegistration[],
  executedCommands: [] as Array<{ id: string; args: unknown[] }>,
  webviewRegistrations: [] as WebviewRegistration[],
  uriHandlerRegistrations: [] as UriHandlerRegistration[],
  hoverRegistrations: [] as HoverRegistration[],
  codeLensRegistrations: [] as CodeLensRegistration[],
  warningMessages: [] as string[],
  warningMessageCalls: [] as Array<{ message: string; items: unknown[] }>,
  warningMessageResult: undefined as string | undefined,
  informationMessages: [] as string[],
  errorMessages: [] as string[],
  quickPickCalls: [] as unknown[],
  quickPickResult: undefined as unknown,
  quickPickResults: [] as unknown[],
  inputBoxResult: undefined as string | undefined,
  inputBoxResults: [] as Array<string | undefined>,
  configuration: new Map<string, unknown>(),
  lastShownEditor: undefined as TextEditor | undefined,
  showTextDocumentCalls: [] as Array<{ documentOrUri: unknown; options?: unknown }>,
  reset(): void {
    this.statusBarItems.length = 0;
    this.fileWatchers.length = 0;
    this.decorations.length = 0;
    this.decorationCalls.length = 0;
    this.revealCalls.length = 0;
    this.commandRegistrations.length = 0;
    this.executedCommands.length = 0;
    this.webviewRegistrations.length = 0;
    this.uriHandlerRegistrations.length = 0;
    this.hoverRegistrations.length = 0;
    this.codeLensRegistrations.length = 0;
    this.warningMessages.length = 0;
    this.warningMessageCalls.length = 0;
    this.warningMessageResult = undefined;
    this.informationMessages.length = 0;
    this.errorMessages.length = 0;
    this.quickPickCalls.length = 0;
    this.quickPickResult = undefined;
    this.quickPickResults.length = 0;
    this.inputBoxResult = undefined;
    this.inputBoxResults.length = 0;
    this.configuration.clear();
    this.lastShownEditor = undefined;
    this.showTextDocumentCalls.length = 0;
    workspace.workspaceFolders = [];
    workspace.textDocuments = [];
    window.activeTextEditor = undefined;
    window.visibleTextEditors = [];
    window.tabGroups.all = [];
  },
  emitActiveTextEditor(editor?: TextEditor): void {
    window.activeTextEditor = editor;
    onDidChangeActiveTextEditorEmitter.fire(editor);
  },
  emitVisibleTextEditors(editors: TextEditor[]): void {
    window.visibleTextEditors = editors;
    onDidChangeVisibleTextEditorsEmitter.fire(editors);
  },
  emitTextEditorSelectionChange(event: unknown): void {
    onDidChangeTextEditorSelectionEmitter.fire(event);
  },
  emitDidChangeTextDocument(event: unknown): void {
    onDidChangeTextDocumentEmitter.fire(event);
  },
  emitDidSaveTextDocument(event: unknown): void {
    onDidSaveTextDocumentEmitter.fire(event);
  },
  emitDidChangeConfiguration(section: string): void {
    onDidChangeConfigurationEmitter.fire({
      affectsConfiguration: (candidate: string) => candidate === section || section.startsWith(`${candidate}.`),
    });
  },
};

export { Disposable };