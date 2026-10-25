// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import { Uri, workspace } from "vscode";
import type { LibraryTreeProvider } from "../library-tree-provider.js";
import { mountArtifactToMemFs } from "../templates/catalog.js";
import type { MemoryFileSystemProvider } from "./virtual-fs-service.js";

export class HostBridgeService implements vscode.Disposable {
  private _disposables: vscode.Disposable[] = [];

  constructor(
    _context: vscode.ExtensionContext,
    private readonly memFs: MemoryFileSystemProvider,
    private readonly memfsRootUri: vscode.Uri | undefined,
    private readonly getTreeProvider: () => LibraryTreeProvider | undefined,
  ) {
    this.register();
  }

  public async handleMountArtifact(payload: {
    artifactId: string | number;
    title?: string | undefined;
    viewType?: string | undefined;
    viewConfig?: any;
  }): Promise<void> {
    if (!payload?.artifactId) return;
    const targetUri =
      this.memfsRootUri || vscode.Uri.from({ scheme: "memfs", path: `/artifact-${payload.artifactId}` });
    try {
      this.memFs.createDirectory(targetUri);
    } catch {
      // directory may already exist
    }

    const { primaryFile } = mountArtifactToMemFs(this.memFs, targetUri, {
      artifactId: payload.artifactId,
      title: payload.title,
      viewType: payload.viewType,
      viewConfig: payload.viewConfig,
    });

    try {
      const fileUri = Uri.joinPath(targetUri, primaryFile);
      if (primaryFile.endsWith(".monb")) {
        await vscode.commands.executeCommand("vscode.openWith", fileUri, "modelscript-notebook");
      } else {
        const doc = await workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc);
        const tp = this.getTreeProvider();
        if (tp) {
          tp.setDocumentUri(fileUri.toString());
          tp.refresh();
        }
      }
      vscode.window.showInformationMessage(`Mounted artifact #${payload.artifactId}: ${payload.title || primaryFile}`);
    } catch (err) {
      console.warn("[artifact-mount] Auto-focus primary file failed:", err);
    }
  }

  public async sendShareToFeed(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    let snippet = "";
    let title = "Model";

    if (editor) {
      const doc = editor.document;
      title = doc.uri.path.split("/").pop() || "Model";
      const selection = editor.selection;
      if (!selection.isEmpty) {
        snippet = doc.getText(selection);
      } else {
        snippet = doc.getText();
      }
      if (snippet.length > 2000) {
        snippet = snippet.slice(0, 2000) + "\n// ... (truncated)";
      }
    }

    const ext = title.slice(title.lastIndexOf(".")).toLowerCase();
    let dialect = "modelica";
    let viewType = "modelica-code";
    let langTag = "modelica";

    if (ext === ".sysml" || ext === ".sysml2") {
      dialect = "sysml2";
      viewType = "sysml";
      langTag = "sysml";
    } else if (ext === ".pscx" || ext === ".pslx") {
      dialect = "pscad";
      viewType = "pscad";
      langTag = "xml";
    } else if (ext === ".raw") {
      dialect = "psse";
      viewType = "psse";
      langTag = "text";
    } else if (ext === ".opi" || ext === ".key") {
      dialect = "olga";
      viewType = "olga";
      langTag = "text";
    } else if (ext === ".ez5" || ext === ".ezm") {
      dialect = "easy5";
      viewType = "easy5";
      langTag = "text";
    } else if (ext === ".roc" || ext === ".deck") {
      dialect = "rocets";
      viewType = "rocets";
      langTag = "text";
    } else if (ext === ".sima" || ext === ".sys") {
      dialect = "sima";
      viewType = "sima";
      langTag = "text";
    } else if (ext === ".gtm" || ext === ".gtd") {
      dialect = "gtsuite";
      viewType = "gtsuite";
      langTag = "text";
    } else if (ext === ".lps" || ext === ".tgx") {
      dialect = "lps";
      viewType = "lps";
      langTag = "text";
    } else if (ext === ".inp" || ext === ".inpt") {
      dialect = "fea";
      viewType = "fea-deck";
      langTag = "text";
    } else if (ext === ".cfg" || ext === ".cfgt") {
      dialect = "cfd";
      viewType = "cfd-config";
      langTag = "text";
    } else if (ext === ".owl" || ext === ".ttl" || ext === ".ofn") {
      dialect = "owl2";
      viewType = "owl2";
      langTag = "text";
    }

    const payload = {
      title: `Shared model: ${title}`,
      content: `Sharing model \`${title}\` from ModelScript IDE workbench:\n\n\`\`\`${langTag}\n${snippet}\n\`\`\``,
      codeSnippet: snippet,
      viewType,
      morselPayload: {
        title: title.replace(/\.[^/.]+$/, ""),
        code: snippet,
        dialect,
      },
    };

    try {
      if (typeof window !== "undefined" && window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "MODELSCRIPT_SHARE_TO_FEED", payload }, window.location.origin);
      }
      const channel = new BroadcastChannel("modelscript:host-bridge");
      channel.postMessage({
        type: "MODELSCRIPT_SHARE_TO_FEED",
        payload,
      });
      channel.close();
      vscode.window.showInformationMessage(`Opened share composer in ModelScript Hub for ${title}`);
    } catch {
      await vscode.env.clipboard.writeText(snippet);
      vscode.window.showInformationMessage(`Copied snippet for ${title} to clipboard.`);
    }
  }

  private register(): void {
    try {
      const bridge = new BroadcastChannel("modelscript:host-bridge");
      bridge.onmessage = (ev) => {
        if (ev.data?.type === "MODELSCRIPT_MOUNT_ARTIFACT" && ev.data?.artifactId) {
          this.handleMountArtifact(ev.data).catch((e) => console.warn("[host-bridge] Mount artifact error:", e));
        } else if (ev.data?.type === "MODELSCRIPT_REQUEST_ACTIVE_FILE") {
          this.sendShareToFeed();
        } else if (ev.data?.type === "MODELSCRIPT_RESTART_LSP") {
          vscode.commands.executeCommand("modelscript.restartLsp");
        }
      };
      this._disposables.push({ dispose: () => bridge.close() });
    } catch {
      // BroadcastChannel unsupported in environment
    }

    if (typeof window !== "undefined") {
      const windowMsgHandler = (ev: MessageEvent) => {
        if (ev.data?.type === "MODELSCRIPT_MOUNT_ARTIFACT" && ev.data?.artifactId) {
          this.handleMountArtifact(ev.data).catch((e) => console.warn("[window-message] Mount artifact error:", e));
        } else if (ev.data?.type === "MODELSCRIPT_REQUEST_ACTIVE_FILE") {
          this.sendShareToFeed();
        } else if (ev.data?.type === "MODELSCRIPT_RESTART_LSP") {
          vscode.commands.executeCommand("modelscript.restartLsp");
        }
      };
      window.addEventListener("message", windowMsgHandler);
      this._disposables.push({ dispose: () => window.removeEventListener("message", windowMsgHandler) });
    }
  }

  public dispose(): void {
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }
}
