// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import { Uri, workspace } from "vscode";
import type { LibraryTreeProvider } from "../library-tree-provider.js";
import { mountArtifactToMemFs } from "../templates/catalog.js";
import type { MemoryFileSystemProvider } from "./virtual-fs-service.js";

const EXT_METADATA: Record<string, { dialect: string; viewType: string; langTag: string }> = {
  ".mo": { dialect: "modelica", viewType: "modelica-code", langTag: "modelica" },
  ".mos": { dialect: "modelica", viewType: "modelica-code", langTag: "modelica" },
  ".sysml": { dialect: "sysml2", viewType: "sysml", langTag: "sysml" },
  ".sysml2": { dialect: "sysml2", viewType: "sysml", langTag: "sysml" },
  ".kerml": { dialect: "sysml2", viewType: "sysml", langTag: "sysml" },
  ".scad": { dialect: "scad", viewType: "cad-step", langTag: "scad" },
  ".step": { dialect: "step", viewType: "cad-step", langTag: "step" },
  ".stp": { dialect: "step", viewType: "cad-step", langTag: "step" },
  ".owl": { dialect: "owl2", viewType: "owl2", langTag: "owl" },
  ".owl2": { dialect: "owl2", viewType: "owl2", langTag: "owl" },
  ".ofn": { dialect: "owl2", viewType: "owl2", langTag: "owl" },
  ".ttl": { dialect: "owl2", viewType: "owl2", langTag: "turtle" },
  ".csv": { dialect: "csv", viewType: "csv", langTag: "csv" },
  ".cfg": { dialect: "cfd", viewType: "cfd-config", langTag: "ini" },
  ".cfgt": { dialect: "cfd", viewType: "cfd-config", langTag: "ini" },
  ".su2": { dialect: "cfd", viewType: "cfd-config", langTag: "ini" },
  ".inp": { dialect: "fea", viewType: "fea-deck", langTag: "text" },
  ".inpt": { dialect: "fea", viewType: "fea-deck", langTag: "text" },
  ".bdf": { dialect: "fea", viewType: "fea-deck", langTag: "text" },
  ".ssp": { dialect: "ssp", viewType: "ssp", langTag: "xml" },
  ".ssd": { dialect: "ssp", viewType: "ssp", langTag: "xml" },
  ".pscx": { dialect: "pscad", viewType: "pscad", langTag: "xml" },
  ".pslx": { dialect: "pscad", viewType: "pscad", langTag: "xml" },
  ".raw": { dialect: "psse", viewType: "psse", langTag: "text" },
  ".tsimf": { dialect: "gensys", viewType: "gensys", langTag: "text" },
  ".gpf": { dialect: "gensys", viewType: "gensys", langTag: "text" },
  ".calc": { dialect: "gensys", viewType: "gensys", langTag: "text" },
  ".spck": { dialect: "simpack", viewType: "simpack", langTag: "text" },
  ".sim": { dialect: "simpack", viewType: "simpack", langTag: "text" },
  ".mbs": { dialect: "simpack", viewType: "simpack", langTag: "text" },
  ".msx": { dialect: "modelscript", viewType: "modelica-code", langTag: "modelscript" },
  ".sp": { dialect: "spice", viewType: "modelica-code", langTag: "spice" },
  ".cir": { dialect: "spice", viewType: "modelica-code", langTag: "spice" },
  ".va": { dialect: "verilog-a", viewType: "modelica-code", langTag: "verilog" },
  ".c": { dialect: "c", viewType: "modelica-code", langTag: "c" },
  ".h": { dialect: "c", viewType: "modelica-code", langTag: "c" },
  ".f90": { dialect: "fortran", viewType: "modelica-code", langTag: "fortran" },
  ".f": { dialect: "fortran", viewType: "modelica-code", langTag: "fortran" },
  ".st": { dialect: "plcopen", viewType: "modelica-code", langTag: "iecst" },
  ".arxml": { dialect: "autosar", viewType: "modelica-code", langTag: "xml" },
  ".mdl": { dialect: "simulink", viewType: "modelica-code", langTag: "text" },
  ".reqif": { dialect: "reqif", viewType: "modelica-code", langTag: "xml" },
  ".oem": { dialect: "ccsds", viewType: "modelica-code", langTag: "text" },
  ".xodr": { dialect: "opendrive", viewType: "modelica-code", langTag: "xml" },
  ".xosc": { dialect: "openscenario", viewType: "openscenario", langTag: "xml" },
  ".urdf": { dialect: "urdf", viewType: "modelica-code", langTag: "xml" },
  ".adm": { dialect: "adams", viewType: "modelica-code", langTag: "text" },
  ".acf": { dialect: "adams", viewType: "modelica-code", langTag: "text" },
  ".sima": { dialect: "sima", viewType: "sima", langTag: "text" },
  ".sys": { dialect: "sima", viewType: "sima", langTag: "text" },
  ".opi": { dialect: "olga", viewType: "olga", langTag: "text" },
  ".key": { dialect: "olga", viewType: "olga", langTag: "text" },
  ".lps": { dialect: "lps", viewType: "lps", langTag: "text" },
  ".tgx": { dialect: "lps", viewType: "lps", langTag: "text" },
  ".swmm": { dialect: "swmm", viewType: "swmm", langTag: "text" },
  ".gtm": { dialect: "gtsuite", viewType: "gtsuite", langTag: "text" },
  ".gtd": { dialect: "gtsuite", viewType: "gtsuite", langTag: "text" },
  ".ez5": { dialect: "easy5", viewType: "easy5", langTag: "text" },
  ".ezm": { dialect: "easy5", viewType: "easy5", langTag: "text" },
  ".roc": { dialect: "rocets", viewType: "rocets", langTag: "text" },
  ".deck": { dialect: "rocets", viewType: "rocets", langTag: "text" },
  ".r5": { dialect: "relap5", viewType: "relap5", langTag: "text" },
  ".relap5": { dialect: "relap5", viewType: "relap5", langTag: "text" },
  ".idf": { dialect: "energyplus", viewType: "modelica-code", langTag: "text" },
  ".aspen": { dialect: "aspen", viewType: "aspen", langTag: "text" },
  ".data": { dialect: "eclipse", viewType: "eclipse", langTag: "text" },
  ".sbml": { dialect: "sbml", viewType: "sbml", langTag: "xml" },
  ".jsbsim": { dialect: "jsbsim", viewType: "jsbsim", langTag: "xml" },
  ".s2p": { dialect: "touchstone", viewType: "touchstone", langTag: "text" },
  ".s1p": { dialect: "touchstone", viewType: "touchstone", langTag: "text" },
  ".ibs": { dialect: "ibis", viewType: "ibis", langTag: "text" },
  ".dss": { dialect: "opendss", viewType: "opendss", langTag: "text" },
};

export interface WorkspaceSnapshotPayload {
  title: string;
  content: string;
  codeSnippet: string;
  viewType: string;
  isMultiFile: boolean;
  files: Record<string, string>;
  primaryFile: string;
  dialect: string;
  forkedFromArtifactId?: number | string | null;
  morselPayload: {
    title: string;
    code: string;
    dialect: string;
    isMultiFile: boolean;
    files: Record<string, string>;
    primaryFile: string;
    forkedFromArtifactId?: number | string | null;
  };
}

export class HostBridgeService implements vscode.Disposable {
  private _disposables: vscode.Disposable[] = [];
  private _mountedArtifactId: string | number | undefined;
  private _mountedTitle: string | undefined;

  constructor(
    _context: vscode.ExtensionContext,
    private readonly memFs: MemoryFileSystemProvider,
    private readonly memfsRootUri: vscode.Uri | undefined,
    private readonly getTreeProvider: () => LibraryTreeProvider | undefined,
  ) {
    if (this.memfsRootUri?.path) {
      const m = this.memfsRootUri.path.match(/^\/artifact-(\d+)/);
      if (m?.[1]) {
        this._mountedArtifactId = Number(m[1]);
      }
    }
    this.register();
  }

  public async handleMountArtifact(payload: {
    artifactId: string | number;
    title?: string | undefined;
    viewType?: string | undefined;
    viewConfig?: any;
  }): Promise<void> {
    if (!payload?.artifactId) return;
    this._mountedArtifactId = payload.artifactId;
    if (payload.title) {
      this._mountedTitle = payload.title;
    }

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

  private toRelativeWorkspacePath(rawPath: string): string {
    const rootPrefix = this.memfsRootUri?.path ? `${this.memfsRootUri.path.replace(/\/+$/, "")}/` : "";
    if (rootPrefix && rawPath.startsWith(rootPrefix)) {
      return rawPath.slice(rootPrefix.length);
    }
    const stripped = rawPath.replace(/^\/+/, "");
    const parts = stripped.split("/");
    if (parts.length > 1 && (parts[0]!.startsWith("artifact-") || parts[0] === "project" || parts[0] === "workspace")) {
      return parts.slice(1).join("/");
    }
    return stripped;
  }

  public collectWorkspaceSnapshot(): WorkspaceSnapshotPayload {
    const files: Record<string, string> = {};
    const decoder = new TextDecoder();
    const rootPath = this.memfsRootUri?.path ? this.memfsRootUri.path.replace(/\/+$/, "") : "";

    // 1. Read all files from MemoryFileSystemProvider
    const rawFilesMap = (this.memFs as any)?.files as Map<string, Uint8Array> | undefined;
    if (rawFilesMap && typeof rawFilesMap.entries === "function") {
      for (const [fullPath, bytes] of rawFilesMap.entries()) {
        if (rootPath && !fullPath.startsWith(rootPath + "/") && fullPath !== rootPath) {
          continue;
        }
        const relPath = this.toRelativeWorkspacePath(fullPath);
        if (!relPath) continue;
        try {
          files[relPath] = decoder.decode(bytes);
        } catch {
          // Ignore binary files that fail UTF-8 decoding
        }
      }
    } else if (this.memfsRootUri) {
      const walk = (dirUri: vscode.Uri, prefix: string) => {
        try {
          const entries = this.memFs.readDirectory(dirUri);
          for (const [name, fileType] of entries) {
            const childUri = Uri.joinPath(dirUri, name);
            const rel = prefix ? `${prefix}/${name}` : name;
            if (fileType === vscode.FileType.Directory) {
              walk(childUri, rel);
            } else if (fileType === vscode.FileType.File) {
              try {
                files[rel] = decoder.decode(this.memFs.readFile(childUri));
              } catch {
                // Ignore read failure
              }
            }
          }
        } catch {
          // Ignore directory read error
        }
      };
      walk(this.memfsRootUri, "");
    }

    // 2. Overlay any open/modified text documents in VS Code
    for (const doc of workspace.textDocuments) {
      if (doc.uri.scheme === "memfs") {
        if (rootPath && !doc.uri.path.startsWith(rootPath + "/") && doc.uri.path !== rootPath) {
          continue;
        }
        const relPath = this.toRelativeWorkspacePath(doc.uri.path);
        if (relPath) {
          files[relPath] = doc.getText();
        }
      }
    }

    const editor = vscode.window.activeTextEditor;
    let activeFileName = "";
    let snippet = "";

    if (editor) {
      const doc = editor.document;
      activeFileName = this.toRelativeWorkspacePath(doc.uri.path) || doc.uri.path.split("/").pop() || "Model.mo";
      const selection = editor.selection;
      if (!selection.isEmpty) {
        snippet = doc.getText(selection);
      } else {
        snippet = doc.getText();
      }
      if (!files[activeFileName]) {
        files[activeFileName] = doc.getText();
      }
    }

    const allFileKeys = Object.keys(files);
    const primaryFile =
      activeFileName ||
      allFileKeys.find((f) => {
        const lower = f.toLowerCase();
        return !lower.endsWith(".md") && !lower.endsWith(".json");
      }) ||
      allFileKeys[0] ||
      "Model.mo";

    if (!snippet && files[primaryFile]) {
      snippet = files[primaryFile]!;
    }

    const dotIndex = primaryFile.lastIndexOf(".");
    const ext = dotIndex >= 0 ? primaryFile.slice(dotIndex).toLowerCase() : ".mo";
    const meta = EXT_METADATA[ext] || { dialect: "modelica", viewType: "modelica-code", langTag: "modelica" };

    const isMultiFile = allFileKeys.length > 1;
    const baseTitle =
      this._mountedTitle ||
      primaryFile
        .split("/")
        .pop()
        ?.replace(/\.[^/.]+$/, "") ||
      "Model";

    const forkedFromArtifactId =
      this._mountedArtifactId !== undefined
        ? Number.isNaN(Number(this._mountedArtifactId))
          ? this._mountedArtifactId
          : Number(this._mountedArtifactId)
        : null;

    const contentSummary = isMultiFile
      ? `Sharing multi-file workspace **${baseTitle}** (${allFileKeys.length} files, primary \`${primaryFile}\`) from ModelScript IDE:`
      : `Sharing model \`${primaryFile}\` from ModelScript IDE workbench:\n\n\`\`\`${meta.langTag}\n${snippet}\n\`\`\``;

    return {
      title: baseTitle,
      content: contentSummary,
      codeSnippet: snippet,
      viewType: meta.viewType,
      isMultiFile,
      files,
      primaryFile,
      dialect: meta.dialect,
      forkedFromArtifactId,
      morselPayload: {
        title: baseTitle,
        code: snippet,
        dialect: meta.dialect,
        isMultiFile,
        files,
        primaryFile,
        forkedFromArtifactId,
      },
    };
  }

  public sendWorkspaceSnapshot(requestId?: string): WorkspaceSnapshotPayload {
    const payload = this.collectWorkspaceSnapshot();
    try {
      if (typeof window !== "undefined" && window.parent && window.parent !== window) {
        window.parent.postMessage(
          { type: "MODELSCRIPT_WORKSPACE_SNAPSHOT", payload, requestId },
          window.location.origin,
        );
        window.parent.postMessage({ type: "MODELSCRIPT_SHARE_TO_FEED", payload, requestId }, window.location.origin);
      }
      const channel = new BroadcastChannel("modelscript:host-bridge");
      channel.postMessage({
        type: "MODELSCRIPT_WORKSPACE_SNAPSHOT",
        payload,
        requestId,
      });
      channel.postMessage({
        type: "MODELSCRIPT_SHARE_TO_FEED",
        payload,
        requestId,
      });
      channel.close();
    } catch {
      // Ignore postMessage/BroadcastChannel errors
    }
    return payload;
  }

  public async sendShareToFeed(): Promise<void> {
    const payload = this.collectWorkspaceSnapshot();

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
      vscode.window.showInformationMessage(`Opened share composer in ModelScript Hub for ${payload.title}`);
    } catch {
      await vscode.env.clipboard.writeText(payload.codeSnippet);
      vscode.window.showInformationMessage(`Copied snippet for ${payload.title} to clipboard.`);
    }
  }

  private register(): void {
    try {
      const bridge = new BroadcastChannel("modelscript:host-bridge");
      bridge.onmessage = (ev) => {
        if (ev.data?.type === "MODELSCRIPT_MOUNT_ARTIFACT" && ev.data?.artifactId) {
          this.handleMountArtifact(ev.data).catch((e) => console.warn("[host-bridge] Mount artifact error:", e));
        } else if (ev.data?.type === "MODELSCRIPT_REQUEST_WORKSPACE_SNAPSHOT") {
          this.sendWorkspaceSnapshot(ev.data?.requestId);
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
        } else if (ev.data?.type === "MODELSCRIPT_REQUEST_WORKSPACE_SNAPSHOT") {
          this.sendWorkspaceSnapshot(ev.data?.requestId);
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
