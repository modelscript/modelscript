// SPDX-License-Identifier: AGPL-3.0-or-later

import { URI, Utils } from "vscode-uri";

export const Uri = Object.assign(URI, {
  joinPath: (base: any, ...pathSegments: string[]) => Utils.joinPath(base, ...pathSegments),
});

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}

  isEqual(other: Position): boolean {
    return this.line === other.line && this.character === other.character;
  }
}

export class Range {
  public readonly start: Position;
  public readonly end: Position;

  constructor(start: Position, end: Position);
  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
  constructor(
    startOrStartLine: Position | number,
    endOrStartCharacter: Position | number,
    endLine?: number,
    endCharacter?: number,
  ) {
    if (typeof startOrStartLine === "number") {
      this.start = new Position(startOrStartLine, endOrStartCharacter as number);
      this.end = new Position(endLine!, endCharacter!);
    } else {
      this.start = startOrStartLine;
      this.end = endOrStartCharacter as Position;
    }
  }

  isEqual(other: Range): boolean {
    return this.start.isEqual(other.start) && this.end.isEqual(other.end);
  }
}

export class Disposable {
  constructor(private readonly callOnDispose: () => void = () => {}) {}
  dispose(): void {
    this.callOnDispose?.();
  }
}

export class EventEmitter<T = any> {
  private readonly listeners: ((e: T) => void)[] = [];

  event = (listener: (e: T) => void): Disposable => {
    this.listeners.push(listener);
    return new Disposable(() => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    });
  };

  fire(data: T): void {
    for (const listener of [...this.listeners]) {
      listener(data);
    }
  }

  dispose(): void {
    this.listeners.length = 0;
  }
}

export class WorkspaceEdit {
  private readonly _edits: any[] = [];

  replace(uri: any, range: Range, newText: string): void {
    this._edits.push({ uri, range, newText });
  }

  delete(uri: any, range: Range): void {
    this._edits.push({ uri, range, newText: "" });
  }

  insert(uri: any, position: Position, newText: string): void {
    this._edits.push({ uri, range: new Range(position, position), newText });
  }

  get entries(): any[] {
    return this._edits;
  }
}

export class CodeLens {
  constructor(
    public range: Range,
    public command?: { title: string; command: string; arguments?: any[] },
  ) {}
}

export class CancellationTokenSource {
  public token = { isCancellationRequested: false, onCancellationRequested: () => new Disposable() };
  cancel(): void {
    this.token.isCancellationRequested = true;
  }
  dispose(): void {}
}

export class TreeItem {
  constructor(
    public label: string,
    public collapsibleState?: number,
  ) {}
}

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

export const ViewColumn = {
  Active: -1,
  Beside: -2,
  One: 1,
  Two: 2,
  Three: 3,
};

export const workspace = {
  textDocuments: [] as any[],
  applyEdit: async (_edit: any) => true,
  onDidChangeTextDocument: (_listener: any) => new Disposable(),
  onDidSaveTextDocument: (_listener: any) => new Disposable(),
  onDidOpenTextDocument: (_listener: any) => new Disposable(),
  onDidCloseTextDocument: (_listener: any) => new Disposable(),
  openTextDocument: async (uriOrPath: any) => ({
    uri: typeof uriOrPath === "string" ? Uri.file(uriOrPath) : uriOrPath,
    getText: () => "",
    positionAt: (offset: number) => new Position(0, offset),
  }),
  fs: {
    readFile: async (_uri: any) => new Uint8Array(),
    writeFile: async (_uri: any, _content: Uint8Array) => {},
  },
};

export const window = {
  activeTextEditor: undefined as any,
  onDidChangeActiveTextEditor: (_listener: any) => new Disposable(),
  createWebviewPanel: (_viewType: string, _title: string, _showOptions: any, _options?: any) => ({
    webview: {
      asWebviewUri: (u: any) => u,
      postMessage: async (_message: any) => true,
      onDidReceiveMessage: (_listener: any) => new Disposable(),
      html: "",
    },
    onDidDispose: (_listener: any) => new Disposable(),
    reveal: () => {},
    dispose: () => {},
  }),
  showInformationMessage: async (_message: string, ..._items: any[]) => undefined,
  showErrorMessage: async (_message: string, ..._items: any[]) => undefined,
  showWarningMessage: async (_message: string, ..._items: any[]) => undefined,
  showQuickPick: async (items: any[], _options?: any) => (Array.isArray(items) ? items[0] : undefined),
  createOutputChannel: (_name: string) => ({
    appendLine: (_val: string) => {},
    append: (_val: string) => {},
    show: () => {},
    dispose: () => {},
  }),
};

export const commands = {
  registerCommand: (_id: string, _handler: any) => new Disposable(),
  executeCommand: async (_id: string, ..._args: any[]) => undefined,
};
