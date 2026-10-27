// SPDX-License-Identifier: AGPL-3.0-or-later

import { extractSysML2ContractHierarchy } from "@modelscript/sysml2";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";
import { BaseWebviewPanel } from "./webview/base-panel.js";

export interface ContractNode {
  name: string;
  symbolName?: string | undefined;
  role?: string | undefined;
  doc?: string | undefined;
  isFocused?: boolean | undefined;
  assumptions: string[];
  guarantees: string[];
  isRefined?: boolean | undefined;
  violations?: string[] | undefined;
  children?: ContractNode[] | undefined;
}

export interface EventTraceStep {
  step: number;
  actor: string;
  event: string;
  targetActor?: string | undefined;
  message?: string | undefined;
  sourceSymbol?: string | undefined;
  isDeadlock?: boolean | undefined;
}

export class ContractHierarchyPanel extends BaseWebviewPanel {
  public static currentPanel: ContractHierarchyPanel | undefined;
  public static readonly viewType = "modelscript.contractExplorer";

  private readonly _client?: LanguageClient | undefined;
  private _currentHierarchy:
    | {
        system?: ContractNode | undefined;
        components?: ContractNode[] | undefined;
        states?: string[] | undefined;
        transitions?: { name: string; from: string; to: string; guard?: string | undefined }[] | undefined;
      }
    | null
    | undefined = undefined;
  private _targetUri?: string | undefined;
  private _targetContractName?: string | undefined;
  private _refreshTimer?: ReturnType<typeof setTimeout> | undefined;

  public static createOrShow(
    extensionUri: vscode.Uri,
    client?: LanguageClient,
    uriOrContractName?: string,
    targetContractName?: string,
  ): void {
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    let resolvedUri: string | undefined;
    let resolvedTargetName: string | undefined;
    if (
      uriOrContractName &&
      (uriOrContractName.includes("://") ||
        uriOrContractName.startsWith("/") ||
        /\.(?:sysml|sysml2|kerml|mo)$/i.test(uriOrContractName))
    ) {
      resolvedUri = uriOrContractName;
      resolvedTargetName = targetContractName;
    } else {
      resolvedUri = vscode.window.activeTextEditor?.document.uri.toString();
      resolvedTargetName = uriOrContractName ?? targetContractName;
    }

    if (ContractHierarchyPanel.currentPanel) {
      if (resolvedUri) {
        ContractHierarchyPanel.currentPanel._targetUri = resolvedUri;
      }
      ContractHierarchyPanel.currentPanel._targetContractName = resolvedTargetName;
      ContractHierarchyPanel.currentPanel._panel.reveal(column);
      void ContractHierarchyPanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ContractHierarchyPanel.viewType,
      "Contract Hierarchy & Event Traces",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    ContractHierarchyPanel.currentPanel = new ContractHierarchyPanel(
      panel,
      extensionUri,
      client,
      resolvedUri,
      resolvedTargetName,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    client?: LanguageClient,
    targetUri?: string,
    targetContractName?: string,
  ) {
    super(panel, extensionUri);
    this._client = client;
    this._targetUri = targetUri;
    this._targetContractName = targetContractName;

    this._panel.webview.html = this.getHtmlShell({
      scriptName: "contract-hierarchy-webview.js",
      title: "Contract Hierarchy & Event Trace Explorer",
    });

    vscode.window.onDidChangeActiveTextEditor(
      (editor) => {
        const uriStr = editor?.document.uri.toString();
        if (uriStr && /\.(?:sysml|sysml2|kerml)$/i.test(uriStr)) {
          if (this._targetUri !== uriStr) {
            this._targetUri = uriStr;
            this._targetContractName = undefined;
            void this.refresh();
          }
        }
      },
      null,
      this._disposables,
    );

    vscode.workspace.onDidChangeTextDocument(
      (e) => {
        const uriStr = e.document.uri.toString();
        if (uriStr === this._targetUri || /\.(?:sysml|sysml2|kerml)$/i.test(uriStr)) {
          if (!this._targetUri) this._targetUri = uriStr;
          if (this._refreshTimer) clearTimeout(this._refreshTimer);
          this._refreshTimer = setTimeout(() => {
            void this.refresh();
          }, 250);
        }
      },
      null,
      this._disposables,
    );

    this._panel.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.type) {
          case "ready":
          case "refresh":
            await this.refresh();
            break;

          case "exportNuXmv": {
            const smv = this._generateNuXmv();
            const doc = await vscode.workspace.openTextDocument({
              content: smv,
              language: "smv",
            });
            vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
            vscode.window.showInformationMessage("Exported nuXmv SMV formal transition module.");
            break;
          }

          case "goToSource": {
            if (msg.name) {
              const navigated = await this._navigateToSymbolInDocument(String(msg.name));
              if (!navigated) {
                const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                  "vscode.executeWorkspaceSymbolProvider",
                  msg.name,
                );
                const match = symbols?.find((s) => s.name === msg.name) ?? symbols?.[0];
                if (match?.location) {
                  const doc = await vscode.workspace.openTextDocument(match.location.uri);
                  const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
                  editor.selection = new vscode.Selection(match.location.range.start, match.location.range.end);
                  editor.revealRange(match.location.range, vscode.TextEditorRevealType.InCenter);
                } else {
                  vscode.window.showInformationMessage(`Navigating to contract: ${msg.name}`);
                }
              }
            }
            break;
          }
        }
      },
      null,
      this._disposables,
    );
  }

  private _resolveTargetDocument(): vscode.TextDocument | undefined {
    const docs = vscode.workspace.textDocuments ?? [];
    if (this._targetUri) {
      const exact = docs.find((d) => d.uri.toString() === this._targetUri);
      if (exact) return exact;
      const targetBase = this._targetUri.split("/").pop();
      if (targetBase) {
        const byBase = docs.find((d) => d.uri.path.endsWith("/" + targetBase) || d.uri.path === targetBase);
        if (byBase) return byBase;
      }
    }
    const activeDoc = vscode.window.activeTextEditor?.document;
    if (activeDoc && /\.(?:sysml|sysml2|kerml)$/i.test(activeDoc.uri.path)) {
      return activeDoc;
    }
    return docs.find((d) => /\.(?:sysml|sysml2|kerml)$/i.test(d.uri.path));
  }

  private async _navigateToSymbolInDocument(rawName: string): Promise<boolean> {
    const doc = this._resolveTargetDocument();
    if (!doc) return false;

    const cleanName = rawName.includes(".") ? rawName.split(".").pop()! : rawName.replace(/\s*\(.*\)$/, "").trim();
    const escaped = cleanName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const text = doc.getText();
    const lines = text.split(/\r?\n/);

    const patterns = [
      new RegExp(
        `\\b(?:part|requirement|action|state|use\\s+case|port|constraint|analysis|verification|calc|package)\\s+def\\s+(${escaped})\\b`,
      ),
      new RegExp(`\\b(?:transition|part|port|action|state|constraint|satisfy|verify)\\s+(${escaped})\\b`),
      new RegExp(`\\b(${escaped})\\b`),
    ];

    for (const pat of patterns) {
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx]!;
        const m = pat.exec(line);
        if (m) {
          const symText = m[1] ?? m[0];
          const col = line.indexOf(symText, m.index);
          const range = new vscode.Range(lineIdx, Math.max(0, col), lineIdx, Math.max(0, col) + symText.length);
          const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
          editor.selection = new vscode.Selection(range.start, range.end);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
          return true;
        }
      }
    }
    return false;
  }

  public async refresh(): Promise<void> {
    const doc = this._resolveTargetDocument();
    const resolvedUri = doc?.uri.toString() ?? this._targetUri;
    const sourceText = doc?.getText();

    if (this._client) {
      try {
        const result = await this._client.sendRequest<{
          success?: boolean | undefined;
          hierarchy?: NonNullable<ContractHierarchyPanel["_currentHierarchy"]> | undefined;
        }>("modelscript/getContractHierarchy", {
          uri: resolvedUri,
          sourceText,
          systemContractName: this._targetContractName,
        });

        if (result?.success && result.hierarchy) {
          this._currentHierarchy = result.hierarchy;
          this._panel.webview.postMessage({
            type: "loadHierarchy",
            hierarchy: result.hierarchy,
            isSampleData: false,
          });
          return;
        }
      } catch {
        // Fall through to local SysML v2 extraction
      }
    }

    if (sourceText) {
      const localExtracted = extractSysML2ContractHierarchy(sourceText, {
        targetName: this._targetContractName,
      });
      if (localExtracted) {
        this._currentHierarchy = localExtracted;
        this._panel.webview.postMessage({
          type: "loadHierarchy",
          hierarchy: this._currentHierarchy,
          isSampleData: false,
        });
        return;
      }
    }

    this._currentHierarchy = null;
    this._panel.webview.postMessage({
      type: "loadHierarchy",
      hierarchy: null,
      isSampleData: false,
    });
  }

  private _generateNuXmv(): string {
    const h = this._currentHierarchy;
    if (!h || !h.system) {
      return "-- No formal contracts available for nuXmv SMV export.\n";
    }
    const sys = h.system;
    const comps: ContractNode[] = Array.isArray(h.components) ? h.components : [];
    const allClauses: string[] = [
      ...(sys.assumptions ?? []),
      ...(sys.guarantees ?? []),
      ...comps.flatMap((c) => [...(c.assumptions ?? []), ...(c.guarantees ?? [])]),
    ];

    const varSet = new Set<string>();
    const identRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
    const reserved = new Set(["true", "false", "TRUE", "FALSE", "and", "or", "not", "next", "state"]);
    for (const clause of allClauses) {
      let m: RegExpExecArray | null;
      while ((m = identRegex.exec(clause)) !== null) {
        const id = m[1]!;
        if (!reserved.has(id)) varSet.add(id);
      }
    }
    if (varSet.size === 0) {
      for (const v of ["voltage", "current", "temp", "torque"]) varSet.add(v);
    }

    const toSmvExpr = (exprs: string[]): string =>
      exprs.length > 0 ? exprs.map((e) => `(${e.replace(/&&/g, "&").replace(/\|\|/g, "|")})`).join(" & ") : "TRUE";

    const varDecls = Array.from(varSet)
      .map((v) => `  ${v} : real;`)
      .join("\n");
    const initAssumptions = toSmvExpr(sys.assumptions ?? []);
    const sysGuarantees = toSmvExpr(sys.guarantees ?? []);
    const compSpecs = comps
      .map(
        (c) =>
          `-- Component Contract: ${c.name}\nINVARSPEC ${toSmvExpr(c.assumptions ?? [])} -> ${toSmvExpr(c.guarantees ?? [])};`,
      )
      .join("\n");

    const modelStates: string[] =
      Array.isArray(h.states) && h.states.length > 0 ? h.states : ["START", "DRIVE", "BRAKE", "TRIP"];
    const initState = modelStates[0]!;
    const activeState = modelStates[1] ?? modelStates[0]!;
    const modelTransitions: { name: string; from: string; to: string; guard?: string | undefined }[] = Array.isArray(
      h.transitions,
    )
      ? h.transitions
      : [];

    const transCases =
      modelTransitions.length > 0
        ? modelTransitions
            .map((t) => {
              const g = t.guard ? ` & (${toSmvExpr([t.guard])})` : ` & ${initAssumptions}`;
              return `    state = ${t.from}${g} : next(state) = ${t.to};`;
            })
            .join("\n")
        : `    state = ${initState} & ${initAssumptions} : next(state) = ${activeState};\n    state = ${activeState} & ${sysGuarantees} : next(state) = ${activeState};`;

    return `-- nuXmv Formal Transition Module (${sys.name})
-- Automatically generated by ModelScript Contract Explorer
MODULE main
VAR
${varDecls}
  state : { ${modelStates.join(", ")} };

INIT
  state = ${initState} & ${initAssumptions};

TRANS
  case
${transCases}
    TRUE : next(state) = state;
  esac;

-- System Assume-Guarantee Safety Invariant (${sys.name})
INVARSPEC ${initAssumptions} -> ${sysGuarantees};
${compSpecs ? compSpecs + "\n" : ""}LTLSPEC G (state = ${initState} -> F state = ${activeState});
`;
  }

  public override dispose(): void {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    ContractHierarchyPanel.currentPanel = undefined;
    super.dispose();
  }
}
