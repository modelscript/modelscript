// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";

export interface VerificationMarker {
  line: number;
  status: "proven" | "unproven" | "defect";
  label: string;
}

export interface VerificationStatusPayload {
  uri: string;
  provenCount: number;
  unprovenCount: number;
  defectCount: number;
  unboundedVariables: number;
  markers: VerificationMarker[];
}

function makeShieldSvgUri(fill: string, glyph: string): vscode.Uri {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="${fill}" d="M8 1L2 3.5v4.2c0 3.7 2.6 6.8 6 7.8 3.4-1 6-4.1 6-7.8V3.5L8 1z"/><text x="8" y="11" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="bold" fill="#ffffff">${glyph}</text></svg>`;
  return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

/**
 * Renders ambient formal verification feedback in VS Code:
 * - A per-file Status Bar pill (`$(shield) 2/3 Proven · 1 Defect`) opening the V&V Dashboard on click.
 * - Non-intrusive gutter proof shield icons on verified, unproven, and defective declarations.
 */
export class VerificationStatusDecorator implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly provenDecoration: vscode.TextEditorDecorationType;
  private readonly unprovenDecoration: vscode.TextEditorDecorationType;
  private readonly defectDecoration: vscode.TextEditorDecorationType;
  private readonly statusByUri = new Map<string, VerificationStatusPayload>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 95);
    this.statusBarItem.command = "modelscript.openVerificationDashboard";
    this.statusBarItem.name = "ModelScript Formal Verification Status";

    this.provenDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: makeShieldSvgUri("#2e7d32", "✓"),
      gutterIconSize: "contain",
    });
    this.unprovenDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: makeShieldSvgUri("#d97706", "!"),
      gutterIconSize: "contain",
    });
    this.defectDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: makeShieldSvgUri("#c62828", "✗"),
      gutterIconSize: "contain",
    });

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.applyToEditor(editor);
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.statusByUri.delete(doc.uri.toString());
      }),
    );
  }

  public updateStatus(payload: VerificationStatusPayload): void {
    if (!payload?.uri) return;
    const total = payload.provenCount + payload.unprovenCount + payload.defectCount;
    if (total === 0 && payload.markers.length === 0) {
      this.statusByUri.delete(payload.uri);
    } else {
      this.statusByUri.set(payload.uri, payload);
    }
    const active = vscode.window.activeTextEditor;
    if (active && active.document.uri.toString() === payload.uri) {
      this.applyToEditor(active);
    }
  }

  private applyToEditor(editor: vscode.TextEditor | undefined): void {
    if (!editor) {
      this.statusBarItem.hide();
      return;
    }
    const uri = editor.document.uri.toString();
    const status = this.statusByUri.get(uri);
    if (!status) {
      editor.setDecorations(this.provenDecoration, []);
      editor.setDecorations(this.unprovenDecoration, []);
      editor.setDecorations(this.defectDecoration, []);
      this.statusBarItem.hide();
      return;
    }

    const total = status.provenCount + status.unprovenCount + status.defectCount;
    const parts: string[] = [`${status.provenCount}/${total} Proven`];
    if (status.defectCount > 0) parts.push(`${status.defectCount} Defect${status.defectCount === 1 ? "" : "s"}`);
    if (status.unprovenCount > 0) parts.push(`${status.unprovenCount} Unproven`);

    this.statusBarItem.text = `$(shield) ${parts.join(" · ")}`;
    this.statusBarItem.tooltip =
      status.unboundedVariables > 0
        ? `Formal Verification: ${parts.join(", ")} (${status.unboundedVariables} unbounded variable(s)). Click to open V&V Dashboard.`
        : `Formal Verification: ${parts.join(", ")}. Click to open V&V Dashboard.`;
    this.statusBarItem.backgroundColor =
      status.defectCount > 0
        ? new vscode.ThemeColor("statusBarItem.errorBackground")
        : status.unprovenCount > 0
          ? new vscode.ThemeColor("statusBarItem.warningBackground")
          : undefined;
    this.statusBarItem.show();

    const provenOpts: vscode.DecorationOptions[] = [];
    const unprovenOpts: vscode.DecorationOptions[] = [];
    const defectOpts: vscode.DecorationOptions[] = [];
    const maxLine = Math.max(0, editor.document.lineCount - 1);

    for (const m of status.markers) {
      const line = Math.max(0, Math.min(m.line, maxLine));
      const opt: vscode.DecorationOptions = {
        range: new vscode.Range(line, 0, line, 0),
        hoverMessage: new vscode.MarkdownString(`**Formal Verification:** ${m.label}`),
      };
      if (m.status === "defect") defectOpts.push(opt);
      else if (m.status === "unproven") unprovenOpts.push(opt);
      else provenOpts.push(opt);
    }

    editor.setDecorations(this.provenDecoration, provenOpts);
    editor.setDecorations(this.unprovenDecoration, unprovenOpts);
    editor.setDecorations(this.defectDecoration, defectOpts);
  }

  public dispose(): void {
    this.statusBarItem.dispose();
    this.provenDecoration.dispose();
    this.unprovenDecoration.dispose();
    this.defectDecoration.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
