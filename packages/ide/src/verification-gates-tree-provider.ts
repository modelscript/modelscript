// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { VerificationStatusPayload } from "./services/verification-status-decorator.js";

export type VerificationGateId = "syntax" | "types" | "dae" | "abstractInterp" | "requirements" | "digitalThread";

interface GateDefinition {
  id: VerificationGateId;
  label: string;
}

const GATES: readonly GateDefinition[] = [
  { id: "syntax", label: "Gate 1: Syntax & Grammar" },
  { id: "types", label: "Gate 2: Types, Symbols & Units" },
  { id: "dae", label: "Gate 3: DAE Structural & Reachability" },
  { id: "abstractInterp", label: "Gate 4: Algorithm Abstract Interpretation" },
  { id: "requirements", label: "Gate 5: Requirements & Contracts" },
  { id: "digitalThread", label: "Gate 6: Cross-Domain & Digital Thread" },
];

export interface VerificationGateNode {
  kind: "gate" | "finding";
  gateId: VerificationGateId;
  label: string;
  description?: string | undefined;
  severity?: "pass" | "warn" | "error" | undefined;
  uri?: vscode.Uri | undefined;
  range?: vscode.Range | undefined;
}

function classifyDiagnosticGate(d: vscode.Diagnostic): VerificationGateId {
  const src = (d.source || "").toLowerCase();
  const code = String(typeof d.code === "object" && d.code !== null ? d.code.value : (d.code ?? "")).toUpperCase();

  if (src === "modelscript-dae-verifier" || code === "M5103" || code === "DIV_BY_ZERO") return "dae";
  if (
    src === "modelscript-prover" ||
    code === "M5101" ||
    code === "DIVISION_BY_ZERO" ||
    code === "MATH_DOMAIN" ||
    code === "ARRAY_OUT_OF_BOUNDS"
  ) {
    return "abstractInterp";
  }
  if (src === "sysml2-verifier" || code === "M5102" || code === "S5020" || code === "S5021") return "requirements";
  if (
    src === "modelscript-digital-thread" ||
    src === "modelscript-drift-checker" ||
    src.endsWith("-reasoner") ||
    code === "M5104" ||
    code.startsWith("X7") ||
    code.startsWith("THREAD_") ||
    code === "POLYGLOT_TWIN_DRIFT"
  ) {
    return "digitalThread";
  }
  if (/^(M?1\d{3}|XML-)/.test(code) || d.message.toLowerCase().includes("syntax error")) return "syntax";
  return "types";
}

/**
 * VS Code Sidebar TreeDataProvider grouping active document diagnostics and formal proof
 * results into 6 progressive verification gates with click-to-navigate findings.
 */
export class VerificationGatesTreeProvider implements vscode.TreeDataProvider<VerificationGateNode>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<VerificationGateNode | undefined>();
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly statusByUri = new Map<string, VerificationStatusPayload>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      vscode.languages.onDidChangeDiagnostics(() => this.refresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.statusByUri.delete(doc.uri.toString());
        this.refresh();
      }),
    );
  }

  public updateVerificationStatus(payload: VerificationStatusPayload): void {
    if (!payload?.uri) return;
    this.statusByUri.set(payload.uri, payload);
    this.refresh();
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  public getTreeItem(element: VerificationGateNode): vscode.TreeItem {
    if (element.kind === "gate") {
      const item = new vscode.TreeItem(
        element.label,
        element.severity === "pass"
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.Expanded,
      );
      if (element.description !== undefined) item.description = element.description;
      item.iconPath =
        element.severity === "error"
          ? new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconFailed"))
          : element.severity === "warn"
            ? new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground"))
            : new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed"));
      return item;
    }

    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    if (element.description !== undefined) item.description = element.description;
    item.iconPath =
      element.severity === "error"
        ? new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("testing.iconFailed"))
        : element.severity === "warn"
          ? new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("problemsWarningIcon.foreground"))
          : new vscode.ThemeIcon("check", new vscode.ThemeColor("testing.iconPassed"));
    if (element.uri && element.range) {
      item.command = {
        command: "vscode.open",
        title: "Reveal Finding",
        arguments: [element.uri, { selection: element.range }],
      };
    }
    return item;
  }

  public getChildren(element?: VerificationGateNode): VerificationGateNode[] {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return [];
    const uri = editor.document.uri;
    const diags = vscode.languages.getDiagnostics(uri);
    const status = this.statusByUri.get(uri.toString());

    const byGate = new Map<VerificationGateId, vscode.Diagnostic[]>();
    for (const g of GATES) byGate.set(g.id, []);
    for (const d of diags) {
      byGate.get(classifyDiagnosticGate(d))!.push(d);
    }

    if (!element) {
      return GATES.map((g) => {
        const list = byGate.get(g.id) ?? [];
        const errCount = list.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;
        const warnCount = list.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning).length;
        const severity: "pass" | "warn" | "error" = errCount > 0 ? "error" : warnCount > 0 ? "warn" : "pass";
        let description = "✓ Pass";
        if (errCount > 0 || warnCount > 0) {
          const parts: string[] = [];
          if (errCount > 0) parts.push(`${errCount} error${errCount === 1 ? "" : "s"}`);
          if (warnCount > 0) parts.push(`${warnCount} warning${warnCount === 1 ? "" : "s"}`);
          description = parts.join(", ");
        } else if (g.id === "dae" && status && status.unboundedVariables > 0) {
          description = `${status.unboundedVariables} unbounded`;
        }
        return { kind: "gate", gateId: g.id, label: g.label, description, severity };
      });
    }

    const list = byGate.get(element.gateId) ?? [];
    if (list.length === 0) {
      return [
        {
          kind: "finding",
          gateId: element.gateId,
          label: "No issues reported",
          severity: "pass",
        },
      ];
    }

    return list.map((d) => ({
      kind: "finding",
      gateId: element.gateId,
      label: d.message,
      description: `Ln ${d.range.start.line + 1}, Col ${d.range.start.character + 1}`,
      severity:
        d.severity === vscode.DiagnosticSeverity.Error
          ? "error"
          : d.severity === vscode.DiagnosticSeverity.Warning
            ? "warn"
            : "pass",
      uri,
      range: d.range,
    }));
  }

  public dispose(): void {
    this._onDidChangeTreeData.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
