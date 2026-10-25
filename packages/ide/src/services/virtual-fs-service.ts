// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import { Uri, workspace } from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";
import { type LibraryTreeProvider } from "../library-tree-provider.js";
import { getTemplatePrimaryFile, mountArtifactToMemFs, scaffoldTemplateFiles } from "../templates/catalog.js";

export function decodeBase64ToArray(base64: string): Uint8Array {
  // Extract only base64 characters
  const b64 = base64.replace(/[^A-Za-z0-9+/=]/g, "");

  // Calculate unpadded length
  let padding = 0;
  if (b64.endsWith("==")) padding = 2;
  else if (b64.endsWith("=")) padding = 1;
  const bufferLength = b64.length * 0.75 - padding;

  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }

  const bytes = new Uint8Array(bufferLength);
  let p = 0;
  for (let i = 0; i < b64.length; i += 4) {
    const encoded1 = lookup[b64.charCodeAt(i)]!;
    const encoded2 = lookup[b64.charCodeAt(i + 1)]!;
    const encoded3 = lookup[b64.charCodeAt(i + 2)]!;
    const encoded4 = lookup[b64.charCodeAt(i + 3)]!;

    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    if (p < bufferLength) bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    if (p < bufferLength) bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
  }
  return bytes;
}

/**
 * Simple in-memory filesystem provider for the `tmp` and `memfs` schemes.
 * Used by blank project mode to store files in memory.
 */
export class MemoryFileSystemProvider implements vscode.FileSystemProvider {
  private files = new Map<string, Uint8Array>();
  private directories = new Set<string>(["/"]); // Root always exists
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._emitter.event;

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const path = uri.path;
    if (this.directories.has(path) || path === "/" || path === "") {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }
    if (this.files.has(path)) {
      return { type: vscode.FileType.File, ctime: 0, mtime: Date.now(), size: this.files.get(path)?.length ?? 0 };
    }
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.scheme === uri.scheme && d.uri.path === path);
    if (doc) {
      const content = new TextEncoder().encode(doc.getText());
      return { type: vscode.FileType.File, ctime: 0, mtime: Date.now(), size: content.length };
    }
    throw vscode.FileSystemError.FileNotFound(uri);
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
    const prefix = uri.path === "/" ? "/" : uri.path + "/";
    const result: [string, vscode.FileType][] = [];
    const seen = new Set<string>();
    for (const [path] of this.files) {
      if (path.startsWith(prefix)) {
        const rest = path.slice(prefix.length);
        const name = rest.split("/")[0]!;
        if (!seen.has(name)) {
          seen.add(name);
          result.push([name, rest.includes("/") ? vscode.FileType.Directory : vscode.FileType.File]);
        }
      }
    }
    for (const dir of this.directories) {
      if (dir.startsWith(prefix)) {
        const rest = dir.slice(prefix.length);
        if (!rest.includes("/") && !seen.has(rest)) {
          seen.add(rest);
          result.push([rest, vscode.FileType.Directory]);
        }
      }
    }
    return result;
  }

  createDirectory(uri: vscode.Uri): void {
    this._mkdirp(uri.path);
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const data = this.files.get(uri.path);
    if (data) return data;
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.scheme === uri.scheme && d.uri.path === uri.path);
    if (doc) {
      const content = new TextEncoder().encode(doc.getText());
      this.files.set(uri.path, content);
      return content;
    }
    throw vscode.FileSystemError.FileNotFound(uri);
  }

  writeFile(uri: vscode.Uri, content: Uint8Array): void {
    const parts = uri.path.split("/");
    for (let i = 1; i < parts.length - 1; i++) {
      this._mkdirp(parts.slice(0, i + 1).join("/"));
    }
    const isNew = !this.files.has(uri.path);
    this.files.set(uri.path, content);
    this._emitter.fire([{ type: isNew ? vscode.FileChangeType.Created : vscode.FileChangeType.Changed, uri }]);
  }

  writeFiles(entries: [vscode.Uri, Uint8Array][]): void {
    const events: vscode.FileChangeEvent[] = [];
    for (const [uri, content] of entries) {
      const parts = uri.path.split("/");
      for (let i = 1; i < parts.length - 1; i++) {
        this._mkdirp(parts.slice(0, i + 1).join("/"));
      }
      const isNew = !this.files.has(uri.path);
      this.files.set(uri.path, content);
      events.push({ type: isNew ? vscode.FileChangeType.Created : vscode.FileChangeType.Changed, uri });
    }
    this._emitter.fire(events);
  }

  delete(uri: vscode.Uri): void {
    this.files.delete(uri.path);
    this.directories.delete(uri.path);
    this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri): void {
    const data = this.files.get(oldUri.path);
    if (data) {
      this.files.delete(oldUri.path);
      this.files.set(newUri.path, data);
    }
  }

  private _mkdirp(path: string): void {
    this.directories.add(path);
  }
}

/**
 * Read-only filesystem provider for the `modelica://` virtual scheme.
 * Resolves standard library files (e.g. MSL) hosted in the language server's virtual VFS.
 */
export class ModelicaFileSystemProvider implements vscode.FileSystemProvider {
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._emitter.event;
  private cache = new Map<string, Uint8Array>();

  constructor(private readonly getClient?: () => any) {}

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const data = await this._fetchFile(uri);
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: data.length,
    };
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const client = this.getClient ? this.getClient() : undefined;
    if (!client) return [];
    try {
      const res: any = await client.sendRequest("modelscript/readVirtualDirectory", { uri: uri.toString() });
      if (Array.isArray(res)) {
        return res.map((e: any) => [e.name, e.isDirectory ? vscode.FileType.Directory : vscode.FileType.File]);
      }
    } catch (e) {
      console.warn("[ModelicaFileSystemProvider] readDirectory error:", e);
    }
    return [];
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions("Readonly filesystem");
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    return this._fetchFile(uri);
  }

  writeFile(): void {
    throw vscode.FileSystemError.NoPermissions("Readonly filesystem");
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions("Readonly filesystem");
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions("Readonly filesystem");
  }

  private async _fetchFile(uri: vscode.Uri): Promise<Uint8Array> {
    const key = uri.toString();
    const cached = this.cache.get(key);
    if (cached) return cached;

    const client = this.getClient ? this.getClient() : undefined;
    if (!client) {
      throw vscode.FileSystemError.Unavailable("Language server not ready");
    }

    try {
      const res = await client.sendRequest("modelscript/readVirtualFile", { uri: key });
      if (res && res.content) {
        const data =
          res.encoding === "base64" ? decodeBase64ToArray(res.content) : new TextEncoder().encode(res.content);
        this.cache.set(key, data);
        return data;
      }
    } catch (err) {
      console.warn(`[modelica-vfs] Failed to read ${key} from server:`, err);
    }

    throw vscode.FileSystemError.FileNotFound(uri);
  }
}

/**
 * Registers both the in-memory ('memfs') and Modelica VFS ('modelica') providers,
 * and scaffolds initial template files if running in browser memfs mode.
 */
export function registerVirtualFileSystems(
  context: vscode.ExtensionContext,
  getClient?: () => any,
): {
  memFs: MemoryFileSystemProvider;
  modelicaFs: ModelicaFileSystemProvider;
  memfsRootUri?: vscode.Uri | undefined;
} {
  const memFs = new MemoryFileSystemProvider();
  context.subscriptions.push(workspace.registerFileSystemProvider("memfs", memFs, { isCaseSensitive: true }));
  console.log("[blank-project] Registered memfs:// filesystem provider");

  const modelicaFs = new ModelicaFileSystemProvider(getClient);
  context.subscriptions.push(
    workspace.registerFileSystemProvider("modelica", modelicaFs, { isReadonly: true, isCaseSensitive: true }),
  );
  console.log("[modelica-vfs] Registered modelica:// filesystem provider");

  const folders = workspace.workspaceFolders;
  let memfsRootUri: vscode.Uri | undefined;
  if (folders && folders.length > 0 && folders[0]!.uri.scheme === "memfs") {
    memfsRootUri = folders[0]!.uri;
  } else {
    try {
      const hash = typeof location !== "undefined" ? location.hash.slice(1) : "";
      if (hash.startsWith("memfs")) {
        const template = hash.split(":")[1] || "empty";
        memfsRootUri = vscode.Uri.from({ scheme: "memfs", path: "/" + template });
      }
    } catch {
      // ignore
    }
  }

  if (memfsRootUri) {
    memFs.createDirectory(memfsRootUri);
    scaffoldTemplateFiles(memFs, memfsRootUri);
  }

  return { memFs, modelicaFs, memfsRootUri };
}

/**
 * Discovers and mounts the active workspace (or memfs template) and binds the library tree.
 */
export async function initWorkspaceAndTree(
  treeProvider: LibraryTreeProvider,
  treeView: vscode.TreeView<vscode.TreeItem> | undefined,
  memFs?: MemoryFileSystemProvider,
  getClient?: () => LanguageClient | undefined,
): Promise<void> {
  const folders = workspace.workspaceFolders;

  let workspaceUri: vscode.Uri | undefined =
    folders && folders.length > 0 && folders[0]!.uri.scheme === "memfs" ? folders[0]!.uri : undefined;
  if (!workspaceUri) {
    try {
      const hash = typeof location !== "undefined" ? location.hash.slice(1) : "";
      if (hash.startsWith("memfs")) {
        const template = hash.split(":")[1] || "empty";
        workspaceUri = vscode.Uri.from({ scheme: "memfs", path: "/" + template });
      }
    } catch {
      // ignore
    }
  }

  if (workspaceUri && workspaceUri.scheme === "memfs") {
    try {
      const template = workspaceUri.path.substring(1) || "empty";

      if ((template === "scratch" || template.startsWith("artifact-")) && memFs) {
        const artifactId = template === "scratch" ? "scratch" : template.slice("artifact-".length);
        let cachedPayload: any = null;
        try {
          const raw =
            typeof sessionStorage !== "undefined" ? sessionStorage.getItem(`modelscript.artifact_${artifactId}`) : null;
          if (raw) cachedPayload = JSON.parse(raw);
        } catch {
          // ignore
        }

        if (cachedPayload) {
          mountArtifactToMemFs(memFs, workspaceUri, {
            artifactId,
            title: cachedPayload.title,
            viewType: cachedPayload.viewType,
            viewConfig: cachedPayload.viewConfig,
          });
        } else {
          try {
            const resp = await fetch(`/api/v1/social/artifact-views/${artifactId}`);
            if (resp.ok) {
              const data = await resp.json();
              if (data?.artifactView) {
                const av = data.artifactView;
                const config = typeof av.view_config === "string" ? JSON.parse(av.view_config) : av.view_config || {};
                mountArtifactToMemFs(memFs, workspaceUri, {
                  artifactId: av.id,
                  title: av.title || av.name,
                  viewType: av.view_type,
                  viewConfig: config,
                });
              }
            }
          } catch (e) {
            console.warn("[artifact-init] Proactive fetch failed:", e);
          }
        }
      }

      const primaryFile = getTemplatePrimaryFile(template);
      const fileUri = Uri.joinPath(workspaceUri, primaryFile);

      // Pre-open any other files in this memfs template workspace so LSP server tracks them
      try {
        const dirEntries = await workspace.fs.readDirectory(workspaceUri);
        for (const [name, type] of dirEntries) {
          if (type === vscode.FileType.File && name !== primaryFile) {
            try {
              await workspace.openTextDocument(Uri.joinPath(workspaceUri, name));
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // ignore
      }

      try {
        if (primaryFile.endsWith(".monb")) {
          await vscode.commands.executeCommand("vscode.openWith", fileUri, "modelscript-notebook");
        } else {
          const doc = await workspace.openTextDocument(fileUri);
          await vscode.window.showTextDocument(doc);
          treeProvider.setDocumentUri(fileUri.toString());
        }
      } catch (e: unknown) {
        console.error("[blank-project] Failed to open primary template file:", e);
      }

      if (template === "mbse-verification") {
        try {
          const mdUri = Uri.joinPath(workspaceUri, "VerificationReport.md");
          await vscode.commands.executeCommand("markdown.showPreviewToSide", mdUri);
        } catch {
          // Fallback
        }
      } else if (template === "cad") {
        try {
          const stepUri = Uri.joinPath(workspaceUri, "drone.step");
          let attempts = 0;
          while (attempts < 10) {
            try {
              await vscode.workspace.fs.stat(stepUri);
              break;
            } catch {
              await new Promise((r) => setTimeout(r, 100));
              attempts++;
            }
          }
          await vscode.commands.executeCommand("vscode.open", stepUri, { viewColumn: 2, preview: false });
        } catch {
          // Fallback
        }
      }
    } catch (e: unknown) {
      console.error("[blank-project] Failed to initialize workspace template:", e);
    }

    // Auto-expand root items after tree data loads
    const expandTreeRoots = async () => {
      try {
        const rootItems = await treeProvider.getChildren();
        for (const item of rootItems) {
          await treeView?.reveal(item, { expand: true, select: false, focus: false });
        }
      } catch {
        // ignore — tree may not be ready yet
      }
    };
    if (typeof treeProvider.onDidChangeTreeData === "function") {
      const sub = treeProvider.onDidChangeTreeData(() => {
        sub.dispose();
        void expandTreeRoots();
      });
      setTimeout(() => {
        sub.dispose();
        void expandTreeRoots();
      }, 800);
    } else {
      void expandTreeRoots();
    }
    return;
  }

  // Always scan for existing .mo/.sysml files so the LSP indexes the workspace
  const moFiles = await scanWorkspaceFiles(getClient);
  const isMemfs = folders && folders.length > 0 && folders[0]!.uri.scheme === "memfs";
  if (moFiles.length > 0 && !isMemfs) {
    // Only set tree focus for non-memfs since memfs templates do their own opening
    treeProvider.setDocumentUri(moFiles[0]!.toString());
  }

  // Auto-expand root items after tree data loads
  setTimeout(async () => {
    try {
      const rootItems = await treeProvider.getChildren();
      for (const item of rootItems) {
        await treeView?.reveal(item, { expand: true, select: false, focus: false });
      }
    } catch {
      // ignore — tree may not be ready yet
    }
  }, 3000);
}

/**
 * Scan the workspace for all .mo files and open them as text documents.
 * Retries up to 5 times with a 2-second delay if the filesystem provider
 * isn't available yet (e.g. GitHub FS extension still activating).
 */
export async function scanWorkspaceFiles(getClient?: () => LanguageClient | undefined): Promise<vscode.Uri[]> {
  const folders = workspace.workspaceFolders;
  if (folders && folders.length > 0 && folders.every((f) => f.uri.scheme === "memfs")) {
    return [];
  }
  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const moFiles = await workspace.findFiles(
        "**/*.{mo,mos,sysml,sysml2,step,stp,p21,owl,ttl,ofn,csv,js,ts,msim,pscx,pslx,pswx,psmx}",
        "**/{node_modules,dist,.git,testsuite,packages/core/testsuite}/**",
      );
      console.log(`[workspace-scan] Found ${moFiles.length} files matching ModelScript workspace rules`);
      for (const uri of moFiles) {
        try {
          await workspace.openTextDocument(uri);
          console.log(`[workspace-scan] Opened ${uri.path.split("/").pop()}`);
        } catch (e) {
          console.warn(`[workspace-scan] Failed to open ${uri.path}:`, e);
        }
      }

      const client = getClient?.();

      // Also scan for FMU archive files and register them with the LSP
      const fmuFiles = await workspace.findFiles("**/*.fmu");
      for (const uri of fmuFiles) {
        try {
          const fmuBytes = await workspace.fs.readFile(uri);
          const name =
            uri.path
              .split("/")
              .pop()
              ?.replace(/\\.fmu$/, "") ?? "FMU";
          // Convert to base64
          const b64 = btoa(Array.from(fmuBytes, (b) => String.fromCharCode(b)).join(""));
          if (client) {
            await client.sendRequest("modelscript/registerFmu", { name, data: b64 });
            console.log(`[workspace-scan] Registered FMU ${name}`);
          }
        } catch (e) {
          console.warn(`[workspace-scan] Failed to register FMU ${uri.path}:`, e);
        }
      }

      // Also scan node_modules/ for installed registry packages
      try {
        const pkgJsons = await workspace.findFiles("node_modules/**/package.json");
        const registryPackages = [];

        for (const pkgUri of pkgJsons) {
          try {
            const contentBytes = await workspace.fs.readFile(pkgUri);
            const content = new TextDecoder("utf-8").decode(contentBytes);
            const pkgData = JSON.parse(content);

            if (pkgData && pkgData.modelscript) {
              const pkgName = pkgData.name;
              const pkgVersion = pkgData.version;

              // Read all .mo files in this package directory
              const pkgDir = Uri.joinPath(pkgUri, "..");
              const relativePattern = new vscode.RelativePattern(pkgDir, "**/*.mo");
              const moFiles = await workspace.findFiles(relativePattern);

              const files: Record<string, string> = {};
              for (const moUri of moFiles) {
                // Compute relative path
                const relPath = workspace.asRelativePath(moUri, false);
                const pkgPrefix = workspace.asRelativePath(pkgDir, false) + "/";
                const internalPath = relPath.startsWith(pkgPrefix) ? relPath.substring(pkgPrefix.length) : relPath;

                const fileBytes = await workspace.fs.readFile(moUri);
                files[internalPath] = new TextDecoder("utf-8").decode(fileBytes);
              }

              if (Object.keys(files).length > 0) {
                registryPackages.push({
                  name: pkgName,
                  version: String(pkgVersion),
                  files,
                  modelscript: pkgData.modelscript,
                });
                console.log(
                  `[workspace-scan] Discovered registry package ${pkgName}@${pkgVersion} (${Object.keys(files).length} files)`,
                );
              }
            }
          } catch (e) {
            console.warn(`[workspace-scan] Failed to read ${pkgUri.path}:`, e);
          }
        }

        if (registryPackages.length > 0 && client) {
          await client.sendNotification("modelscript/registryPackages", { packages: registryPackages });
        }
      } catch (e) {
        console.warn(`[workspace-scan] Failed to scan node_modules:`, e);
      }

      return moFiles;
    } catch (e) {
      const msg = String(e);
      if (msg.includes("ENOPRO") && attempt < maxRetries - 1) {
        console.log(`[workspace-scan] Filesystem not ready, retrying in 2s (attempt ${attempt + 1}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        console.error("[workspace-scan] Workspace scan failed:", e);
        return [];
      }
    }
  }
  return [];
}
