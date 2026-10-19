// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * VS Code Extension Collaborative Presence & Symbol Collision Manager.
 *
 * Renders remote peer cursor/selection decorations and displays live status bar
 * indicators when multiple engineers concurrently edit the same class or component.
 */

import * as vscode from "vscode";

export interface IdePeerPresence {
  peerId: string;
  displayName: string;
  color: string;
  documentUri: string;
  cursorOffset: number;
  selectionEndOffset: number;
  activeSymbolName?: string | undefined;
}

export interface IdeSymbolCollision {
  symbolName: string;
  symbolKind: string;
  startOffset: number;
  endOffset: number;
  peers: { peerId: string; displayName: string; color: string }[];
  message: string;
}

export class CollaborationPresenceController implements vscode.Disposable {
  private decorationTypes = new Map<string, vscode.TextEditorDecorationType>();
  private collisionDecorationType: vscode.TextEditorDecorationType;
  private statusBarItem: vscode.StatusBarItem;
  private peersByUri = new Map<string, IdePeerPresence[]>();
  private collisionsByUri = new Map<string, IdeSymbolCollision[]>();
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.collisionDecorationType = vscode.window.createTextEditorDecorationType({
      borderWidth: "0 0 2px 0",
      borderStyle: "dashed",
      borderColor: "#f59e0b",
      overviewRulerColor: "#f59e0b",
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 95);
    this.statusBarItem.name = "ModelScript Live Collaboration";
    this.updateStatusBar(vscode.window.activeTextEditor);

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.renderDecorations(editor);
        this.updateStatusBar(editor);
      }),
    );
  }

  /**
   * Updates remote peer presence and symbol collision state for a document URI.
   */
  updateDocumentState(documentUri: string, peers: IdePeerPresence[], collisions: IdeSymbolCollision[] = []): void {
    this.peersByUri.set(documentUri, peers);
    this.collisionsByUri.set(documentUri, collisions);

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.uri.toString() === documentUri) {
      this.renderDecorations(activeEditor);
      this.updateStatusBar(activeEditor);
    }
  }

  private getOrCreatePeerDecorationType(peer: IdePeerPresence): vscode.TextEditorDecorationType {
    const key = `${peer.peerId}:${peer.color}`;
    let dec = this.decorationTypes.get(key);
    if (!dec) {
      dec = vscode.window.createTextEditorDecorationType({
        backgroundColor: `${peer.color}33`,
        border: `1px solid ${peer.color}`,
        after: {
          contentText: ` ${peer.displayName} `,
          backgroundColor: peer.color,
          color: "#0f172a",
          margin: "0 0 0 4px",
        },
      });
      this.decorationTypes.set(key, dec);
    }
    return dec;
  }

  private renderDecorations(editor: vscode.TextEditor | undefined): void {
    if (!editor) return;
    const uri = editor.document.uri.toString();
    const peers = this.peersByUri.get(uri) || [];
    const collisions = this.collisionsByUri.get(uri) || [];

    for (const peer of peers) {
      const decType = this.getOrCreatePeerDecorationType(peer);
      const startPos = editor.document.positionAt(peer.cursorOffset);
      const endPos = editor.document.positionAt(peer.selectionEndOffset);
      const range = new vscode.Range(startPos, endPos);
      editor.setDecorations(decType, [
        {
          range,
          hoverMessage: new vscode.MarkdownString(
            `**${peer.displayName}**${peer.activeSymbolName ? ` editing \`${peer.activeSymbolName}\`` : ""}`,
          ),
        },
      ]);
    }

    const collisionRanges: vscode.DecorationOptions[] = collisions.map((col) => {
      const startPos = editor.document.positionAt(col.startOffset);
      const endPos = editor.document.positionAt(col.endOffset);
      return {
        range: new vscode.Range(startPos, endPos),
        hoverMessage: new vscode.MarkdownString(`⚠️ **Concurrent Edit Warning:** ${col.message}`),
      };
    });
    editor.setDecorations(this.collisionDecorationType, collisionRanges);
  }

  private updateStatusBar(editor: vscode.TextEditor | undefined): void {
    if (!editor) {
      this.statusBarItem.hide();
      return;
    }
    const uri = editor.document.uri.toString();
    const peers = this.peersByUri.get(uri) || [];
    const collisions = this.collisionsByUri.get(uri) || [];

    if (peers.length === 0 && collisions.length === 0) {
      this.statusBarItem.hide();
      return;
    }

    if (collisions.length > 0) {
      this.statusBarItem.text = `$(warning) ${peers.length} Peer(s) · ${collisions.length} Symbol Collision(s)`;
      this.statusBarItem.tooltip = collisions.map((c) => c.message).join("\n");
    } else {
      this.statusBarItem.text = `$(organization) ${peers.length} Peer(s) Online`;
      this.statusBarItem.tooltip = peers.map((p) => p.displayName).join(", ");
    }
    this.statusBarItem.show();
  }

  dispose(): void {
    for (const dec of this.decorationTypes.values()) {
      dec.dispose();
    }
    this.decorationTypes.clear();
    this.collisionDecorationType.dispose();
    this.statusBarItem.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

export function registerCollaborationPresence(context: vscode.ExtensionContext): CollaborationPresenceController {
  const controller = new CollaborationPresenceController();
  context.subscriptions.push(controller);
  return controller;
}
