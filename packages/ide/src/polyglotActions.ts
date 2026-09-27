// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { PolyglotVisualizerPanel } from "./polyglotVisualizerPanel.js";

export interface TargetDomainQuickPickItem extends vscode.QuickPickItem {
  targetLang: "sysml2" | "modelica" | "owl2" | "step" | "csv" | "scad";
  defaultExtension: string;
}

export const TARGET_DOMAIN_OPTIONS: TargetDomainQuickPickItem[] = [
  {
    label: "$(symbol-structure) SysML v2",
    description: "Systems Architecture, Requirements & KerML Constraints",
    targetLang: "sysml2",
    defaultExtension: ".sysml",
  },
  {
    label: "$(pulse) Modelica",
    description: "Continuous Physics & Differential Algebraic Equations",
    targetLang: "modelica",
    defaultExtension: ".mo",
  },
  {
    label: "$(organization) OWL 2",
    description: "Formal Ontological Knowledge Graph & Taxonomy",
    targetLang: "owl2",
    defaultExtension: ".owl",
  },
  {
    label: "$(package) STEP CAD",
    description: "ISO 10303 Kinematics, Solid Assemblies & Geometry",
    targetLang: "step",
    defaultExtension: ".step",
  },
  {
    label: "$(table) CSV",
    description: "Tabular Telemetry, Parameter Specs & Pin Lists",
    targetLang: "csv",
    defaultExtension: ".csv",
  },
  {
    label: "$(symbol-ruler) OpenSCAD",
    description: "Parametric Constructive Solid Geometry (CSG)",
    targetLang: "scad",
    defaultExtension: ".scad",
  },
];

export interface ModelPairRecord {
  sourceUri: string;
  targetUri: string;
  sourceLang: string;
  targetLang: string;
}

/**
 * Manages live bidirectional synchronization between paired side-by-side polyglot model editors
 * and the 3D Polyglot Visualizer panel.
 */
export class PolyglotLiveSyncManager implements vscode.Disposable {
  private static _instance?: PolyglotLiveSyncManager;

  private readonly _pairs = new Map<string, ModelPairRecord>();
  private readonly _reversePairs = new Map<string, ModelPairRecord>();
  private readonly _syncingUris = new Set<string>();
  private readonly _debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly _disposables: vscode.Disposable[] = [];
  private _enabled: boolean = true;

  public static getInstance(client?: LanguageClient): PolyglotLiveSyncManager {
    if (!PolyglotLiveSyncManager._instance) {
      PolyglotLiveSyncManager._instance = new PolyglotLiveSyncManager(client);
    }
    return PolyglotLiveSyncManager._instance;
  }

  public constructor(private readonly client?: LanguageClient) {
    this._disposables.push(vscode.workspace.onDidChangeTextDocument((e) => this.onDocumentChange(e)));
  }

  public registerPair(sourceUri: string, targetUri: string, sourceLang: string, targetLang: string): void {
    const record: ModelPairRecord = { sourceUri, targetUri, sourceLang, targetLang };
    this._pairs.set(sourceUri, record);
    this._reversePairs.set(targetUri, record);
  }

  public unregisterPair(sourceUri: string): void {
    const record = this._pairs.get(sourceUri);
    if (record) {
      this._pairs.delete(sourceUri);
      this._reversePairs.delete(record.targetUri);
    }
  }

  public clearPairs(): void {
    this._pairs.clear();
    this._reversePairs.clear();
  }

  public getActivePairs(): ModelPairRecord[] {
    return Array.from(this._pairs.values());
  }

  public toggleSync(forced?: boolean): boolean {
    this._enabled = forced !== undefined ? forced : !this._enabled;
    return this._enabled;
  }

  public isSyncEnabled(): boolean {
    return this._enabled;
  }

  public async onDocumentChange(event: vscode.TextDocumentChangeEvent): Promise<void> {
    if (!this._enabled) return;

    const doc = event.document;
    const uri = doc.uri.toString();

    // 1. Notify Polyglot Visualizer panel if it is observing this document
    if (PolyglotVisualizerPanel.currentPanel && PolyglotVisualizerPanel.currentPanel.isLiveSync) {
      if (PolyglotVisualizerPanel.currentPanel.sourceUri === uri) {
        PolyglotVisualizerPanel.currentPanel.refresh();
      }
    }

    // 2. Avoid recursive loop if this document is actively receiving a sync edit
    if (this._syncingUris.has(uri)) return;

    // 3. Forward pair sync (source -> target)
    const forwardRecord = this._pairs.get(uri);
    if (forwardRecord) {
      this.scheduleSync(uri, forwardRecord.targetUri, forwardRecord.targetLang);
      return;
    }

    // 4. Reverse pair sync (target -> source)
    const reverseRecord = this._reversePairs.get(uri);
    if (reverseRecord) {
      this.scheduleSync(uri, reverseRecord.sourceUri, reverseRecord.sourceLang);
      return;
    }
  }

  private scheduleSync(fromUri: string, toUri: string, targetLang: string): void {
    const existingTimer = this._debounceTimers.get(fromUri);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      this._debounceTimers.delete(fromUri);
      await this.performSync(fromUri, toUri, targetLang);
    }, 350);

    this._debounceTimers.set(fromUri, timer);
  }

  public async performSync(fromUri: string, toUri: string, targetLang: string): Promise<void> {
    const sourceDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === fromUri);
    const targetDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === toUri);

    if (!sourceDoc || !targetDoc) return;

    this._syncingUris.add(toUri);

    try {
      let targetSource: string | undefined;

      if (this.client) {
        try {
          const resp: any = await this.client.sendRequest("modelscript/projectModel", {
            uri: fromUri,
            targetLang,
            options: { strict: false, includeInferredFeatures: true },
          });
          if (resp?.success && resp.targetSource) {
            targetSource = resp.targetSource;
          }
        } catch (e) {
          console.warn("[PolyglotLiveSync] LSP projection request failed, falling back to local transform:", e);
        }
      }

      if (!targetSource) {
        const { PolyglotTransformer } = await import("@modelscript/runtime");
        const transformer = new PolyglotTransformer();
        const baseName =
          sourceDoc.fileName
            .replace(/\.[^.]+$/, "")
            .split("/")
            .pop() || "Model";
        targetSource = transformer.transform({ name: baseName }, targetLang);
      }

      if (targetSource && targetSource !== targetDoc.getText()) {
        const edit = new vscode.WorkspaceEdit();
        const entireRange = new vscode.Range(targetDoc.positionAt(0), targetDoc.positionAt(targetDoc.getText().length));
        edit.replace(targetDoc.uri, entireRange, targetSource);
        await vscode.workspace.applyEdit(edit);
      }
    } catch (err) {
      console.warn("[PolyglotLiveSync] Error during live sync execution:", err);
    } finally {
      // Release sync lock after small delay to let event loop settle
      setTimeout(() => {
        this._syncingUris.delete(toUri);
      }, 100);
    }
  }

  public dispose(): void {
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
    for (const timer of this._debounceTimers.values()) {
      clearTimeout(timer);
    }
    this._debounceTimers.clear();
    this._syncingUris.clear();
    this._pairs.clear();
    this._reversePairs.clear();
  }
}

/**
 * Helper to deduce language id from document extension or name.
 */
function inferLanguageId(fileName: string): string {
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".mo":
    case ".mos":
      return "modelica";
    case ".sysml":
    case ".sysml2":
      return "sysml2";
    case ".scad":
      return "scad";
    case ".step":
    case ".stp":
    case ".p21":
      return "step";
    case ".owl":
    case ".ttl":
    case ".ofn":
      return "owl2";
    case ".csv":
      return "csv";
    default:
      return "modelica";
  }
}

/**
 * Registers polyglot projection commands and live sync actions into VS Code / Web IDE.
 */
export function registerPolyglotActions(context: vscode.ExtensionContext, client?: LanguageClient): vscode.Disposable {
  const syncManager = PolyglotLiveSyncManager.getInstance(client);
  const disposables: vscode.Disposable[] = [syncManager];

  // 1. Command: modelscript.projectModel
  disposables.push(
    vscode.commands.registerCommand("modelscript.projectModel", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active model file to project.");
        return;
      }

      const document = editor.document;
      const uri = document.uri.toString();
      const sourceLang = inferLanguageId(document.fileName);

      // Interactive quick-pick menu displaying available domains
      const selected = await vscode.window.showQuickPick(TARGET_DOMAIN_OPTIONS, {
        placeHolder: "Select target engineering domain for live multi-way projection...",
        matchOnDescription: true,
      });

      if (!selected) return;

      try {
        let targetSource: string | undefined;

        if (client) {
          // Send LSP JSON-RPC request to language server
          const response: any = await client.sendRequest("modelscript/projectModel", {
            uri,
            targetLang: selected.targetLang,
            options: { strict: true, includeInferredFeatures: true },
          });

          if (!response || !response.success || !response.targetSource) {
            throw new Error(response?.error || "Projection failed on language server");
          }
          targetSource = response.targetSource;
        } else {
          // Fallback: direct in-memory transformation if language client not connected
          const { PolyglotTransformer } = await import("@modelscript/runtime");
          const transformer = new PolyglotTransformer();
          const baseName =
            document.fileName
              .replace(/\.[^.]+$/, "")
              .split("/")
              .pop() || "Model";
          targetSource = transformer.transform({ name: baseName }, selected.targetLang);
        }

        // Open side-by-side editor pane with synthesized target model
        const targetDoc = await vscode.workspace.openTextDocument({
          content: targetSource,
          language: selected.targetLang === "sysml2" ? "sysml" : selected.targetLang,
        });

        await vscode.window.showTextDocument(targetDoc, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: false,
        });

        // Register live sync pair for continuous synchronization
        syncManager.registerPair(uri, targetDoc.uri.toString(), sourceLang, selected.targetLang);

        vscode.window.showInformationMessage(
          `Projected '${document.fileName}' to ${selected.label} (${targetSource?.length ?? 0} bytes) with Live Sync active.`,
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Projection failed: ${err.message || err}`);
      }
    }),
  );

  // 2. Command: modelscript.openPolyglotVisualizer
  disposables.push(
    vscode.commands.registerCommand("modelscript.openPolyglotVisualizer", (argUri?: string | vscode.Uri) => {
      const targetUri = typeof argUri === "string" ? argUri : argUri?.toString();
      PolyglotVisualizerPanel.createOrShow(context.extensionUri, client, targetUri);
    }),
  );

  // 3. Command: modelscript.togglePolyglotSync
  disposables.push(
    vscode.commands.registerCommand("modelscript.togglePolyglotSync", () => {
      const active = syncManager.toggleSync();
      if (PolyglotVisualizerPanel.currentPanel) {
        PolyglotVisualizerPanel.currentPanel.isLiveSync = active;
      }
      vscode.window.showInformationMessage(
        `Polyglot Live Model Sync is now ${active ? "ENABLED (Automatic)" : "PAUSED"}.`,
      );
    }),
  );

  return new vscode.Disposable(() => {
    while (disposables.length) {
      const d = disposables.pop();
      if (d) d.dispose();
    }
  });
}
