// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import { Uri, workspace } from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";
import { type LibraryTreeItem, type LibraryTreeProvider } from "../library-tree-provider.js";
import {
  type ArtifactWorkspaceDescriptor,
  getTemplatePrimaryFile,
  mountArtifactToMemFs,
  registerPackageDescriptor,
  type RemoteFileEntry,
  scaffoldTemplateFiles,
} from "../templates/catalog.js";

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
 * Supports both eager in-memory files (`files`) and lazy remote files (`remoteFiles`)
 * fetched on demand when opened in the VS Code Explorer.
 */
export class MemoryFileSystemProvider implements vscode.FileSystemProvider {
  private files = new Map<string, Uint8Array>();
  private remoteFiles = new Map<string, { url: string; size: number }>();
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
    const remote = this.remoteFiles.get(path);
    if (remote) {
      return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: remote.size };
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
        if (name && !seen.has(name)) {
          seen.add(name);
          result.push([name, rest.includes("/") ? vscode.FileType.Directory : vscode.FileType.File]);
        }
      }
    }
    for (const [path] of this.remoteFiles) {
      if (path.startsWith(prefix)) {
        const rest = path.slice(prefix.length);
        const name = rest.split("/")[0]!;
        if (name && !seen.has(name)) {
          seen.add(name);
          result.push([name, rest.includes("/") ? vscode.FileType.Directory : vscode.FileType.File]);
        }
      }
    }
    for (const dir of this.directories) {
      if (dir.startsWith(prefix)) {
        const rest = dir.slice(prefix.length);
        if (rest && !rest.includes("/") && !seen.has(rest)) {
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

  readFile(uri: vscode.Uri): Uint8Array | Promise<Uint8Array> {
    const data = this.files.get(uri.path);
    if (data) return data;
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.scheme === uri.scheme && d.uri.path === uri.path);
    if (doc) {
      const content = new TextEncoder().encode(doc.getText());
      this.files.set(uri.path, content);
      return content;
    }
    const remote = this.remoteFiles.get(uri.path);
    if (remote) {
      return fetch(remote.url).then(async (resp) => {
        if (!resp.ok) {
          throw vscode.FileSystemError.FileNotFound(uri);
        }
        const buf = await resp.arrayBuffer();
        const bytes = new Uint8Array(buf);
        this.files.set(uri.path, bytes);
        return bytes;
      });
    }
    throw vscode.FileSystemError.FileNotFound(uri);
  }

  writeFile(uri: vscode.Uri, content: Uint8Array): void {
    const parts = uri.path.split("/");
    for (let i = 1; i < parts.length - 1; i++) {
      this._mkdirp(parts.slice(0, i + 1).join("/"));
    }
    const isNew = !this.files.has(uri.path) && !this.remoteFiles.has(uri.path);
    this.remoteFiles.delete(uri.path);
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
      const isNew = !this.files.has(uri.path) && !this.remoteFiles.has(uri.path);
      this.remoteFiles.delete(uri.path);
      this.files.set(uri.path, content);
      events.push({ type: isNew ? vscode.FileChangeType.Created : vscode.FileChangeType.Changed, uri });
    }
    this._emitter.fire(events);
  }

  registerRemoteFiles(workspaceUri: vscode.Uri, entries: RemoteFileEntry[]): void {
    const events: vscode.FileChangeEvent[] = [];
    for (const entry of entries) {
      const cleanRel = entry.path.replace(/^\/+/, "");
      if (!cleanRel) continue;
      const fileUri = vscode.Uri.joinPath(workspaceUri, ...cleanRel.split("/"));
      const parts = fileUri.path.split("/");
      for (let i = 1; i < parts.length - 1; i++) {
        this._mkdirp(parts.slice(0, i + 1).join("/"));
      }
      if (!this.files.has(fileUri.path)) {
        const isNew = !this.remoteFiles.has(fileUri.path);
        this.remoteFiles.set(fileUri.path, { url: entry.url, size: entry.size ?? 0 });
        if (isNew) {
          events.push({ type: vscode.FileChangeType.Created, uri: fileUri });
        }
      }
    }
    if (events.length > 0) {
      this._emitter.fire(events);
    }
  }

  clearDirectory(workspaceUri: vscode.Uri): void {
    const rootPath = workspaceUri.path.replace(/\/+$/, "");
    const prefix = rootPath + "/";
    const events: vscode.FileChangeEvent[] = [];
    for (const filePath of Array.from(this.files.keys())) {
      if (filePath.startsWith(prefix)) {
        this.files.delete(filePath);
        events.push({
          type: vscode.FileChangeType.Deleted,
          uri: workspaceUri.with({ path: filePath }),
        });
      }
    }
    for (const filePath of Array.from(this.remoteFiles.keys())) {
      if (filePath.startsWith(prefix)) {
        this.remoteFiles.delete(filePath);
        events.push({
          type: vscode.FileChangeType.Deleted,
          uri: workspaceUri.with({ path: filePath }),
        });
      }
    }
    for (const dirPath of Array.from(this.directories)) {
      if (dirPath.startsWith(prefix)) {
        this.directories.delete(dirPath);
      }
    }
    if (events.length > 0) {
      this._emitter.fire(events);
    }
  }

  delete(uri: vscode.Uri): void {
    this.files.delete(uri.path);
    this.remoteFiles.delete(uri.path);
    this.directories.delete(uri.path);
    this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri): void {
    const data = this.files.get(oldUri.path);
    if (data) {
      this.files.delete(oldUri.path);
      this.files.set(newUri.path, data);
    }
    const remote = this.remoteFiles.get(oldUri.path);
    if (remote) {
      this.remoteFiles.delete(oldUri.path);
      this.remoteFiles.set(newUri.path, remote);
    }
  }

  private _mkdirp(path: string): void {
    this.directories.add(path);
  }
}

function encodeLibraryPath(pkgName: string): string {
  if (pkgName.startsWith("@") && pkgName.includes("/")) {
    const [scope, ...rest] = pkgName.split("/");
    return `${encodeURIComponent(scope!)}/${encodeURIComponent(rest.join("/"))}`;
  }
  return encodeURIComponent(pkgName);
}

/**
 * Hydrates an artifact or package workspace descriptor with actual files/tree from the backend API
 * when the descriptor references a registry package, library class, or remote resource URL.
 */
export async function hydrateArtifactDescriptor(
  descriptor: ArtifactWorkspaceDescriptor,
): Promise<ArtifactWorkspaceDescriptor> {
  const config = descriptor.viewConfig || {};
  const viewType = (
    descriptor.viewType ||
    (typeof config["view_type"] === "string" ? config["view_type"] : "") ||
    (typeof config["viewType"] === "string" ? config["viewType"] : "")
  )
    .toLowerCase()
    .trim();

  const hasCustomFiles =
    (descriptor.files && typeof descriptor.files === "object" && Object.keys(descriptor.files).length > 0) ||
    (config["files"] &&
      typeof config["files"] === "object" &&
      !Array.isArray(config["files"]) &&
      Object.keys(config["files"] as Record<string, unknown>).length > 0) ||
    (descriptor.remoteFiles && descriptor.remoteFiles.length > 0);

  if (hasCustomFiles) {
    return descriptor;
  }

  // 1. Package / Library artifact card -> fetch package files & lazy tree from /api/v1/libraries/:name/:version/files?tree=true
  if (viewType === "package" || viewType === "library") {
    const rawTitle = (descriptor.title || "").trim();
    const lastAt = rawTitle.lastIndexOf("@");
    const pkgName =
      (typeof config["name"] === "string" && config["name"].trim()) ||
      (typeof config["packageName"] === "string" && config["packageName"].trim()) ||
      (lastAt > 0 ? rawTitle.slice(0, lastAt).trim() : rawTitle);
    let pkgVersion =
      (typeof config["version"] === "string" && config["version"].trim()) ||
      (typeof config["packageVersion"] === "string" && config["packageVersion"].trim()) ||
      (lastAt > 0 ? rawTitle.slice(lastAt + 1).trim() : "");

    if (pkgName) {
      try {
        if (!pkgVersion || pkgVersion === "latest") {
          const metaResp = await fetch(`/api/v1/libraries/${encodeLibraryPath(pkgName)}`);
          if (metaResp.ok) {
            const meta = await metaResp.json();
            pkgVersion =
              (typeof meta?.latest_version === "string" && meta.latest_version) ||
              (Array.isArray(meta?.versions) && typeof meta.versions[0]?.version === "string"
                ? meta.versions[0].version
                : "1.0.0");
          } else {
            pkgVersion = "1.0.0";
          }
        }

        const filesResp = await fetch(
          `/api/v1/libraries/${encodeLibraryPath(pkgName)}/${encodeURIComponent(pkgVersion)}/files?tree=true`,
        );
        if (filesResp.ok) {
          const data = await filesResp.json();
          if (data?.files && typeof data.files === "object") {
            descriptor.files = data.files as Record<string, string>;
          }
          if (typeof data?.primaryFile === "string" && data.primaryFile) {
            descriptor.primaryFile = data.primaryFile;
          }
          if (Array.isArray(data?.tree) && data.tree.length > 0) {
            descriptor.remoteFiles = data.tree.map((entry: { path: string; rawPath?: string; size?: number }) => {
              const rawRel = (entry.rawPath || entry.path)
                .split("/")
                .map((seg) => encodeURIComponent(seg))
                .join("/");
              return {
                path: entry.path,
                url: `/api/v1/libraries/${encodeLibraryPath(pkgName)}/${encodeURIComponent(pkgVersion)}/resources/${rawRel}`,
                size: entry.size ?? 0,
              };
            });
          }
          registerPackageDescriptor(pkgName, descriptor);
        }
      } catch (err) {
        console.warn("[artifact-hydrate] Failed to fetch package files for %s@%s:", pkgName, pkgVersion, err);
      }
    }
    return descriptor;
  }

  const hasInlineCode =
    typeof config["code"] === "string" ||
    typeof config["content"] === "string" ||
    typeof config["source"] === "string" ||
    typeof config["modelicaCode"] === "string" ||
    typeof config["step"] === "string" ||
    typeof config["gcode"] === "string" ||
    typeof config["xml"] === "string" ||
    typeof config["csv"] === "string";

  if (hasInlineCode) {
    return descriptor;
  }

  // 2. Class reference in a library (e.g. modelica-diagram with className + packageName)
  const className =
    (typeof config["className"] === "string" && config["className"].trim()) ||
    (typeof config["model"] === "string" && config["model"].includes(".") ? config["model"].trim() : "");
  if (className) {
    const pkgName =
      (typeof config["packageName"] === "string" && config["packageName"].trim()) ||
      (typeof config["package"] === "string" && config["package"].trim()) ||
      (className.startsWith("Modelica.") ? "Modelica" : className.split(".")[0] || "");
    const pkgVersion =
      (typeof config["packageVersion"] === "string" && config["packageVersion"].trim()) ||
      (typeof config["version"] === "string" && config["version"].trim()) ||
      (pkgName === "Modelica" ? "4.1.0" : "1.0.0");

    if (pkgName) {
      try {
        const clsResp = await fetch(
          `/api/v1/libraries/${encodeLibraryPath(pkgName)}/${encodeURIComponent(pkgVersion)}/classes/${encodeURIComponent(className)}`,
        );
        if (clsResp.ok) {
          const clsData = await clsResp.json();
          if (typeof clsData?.sourceCode === "string" && clsData.sourceCode.trim()) {
            const shortName = className.split(".").pop() || "Model";
            const filename = `${shortName}.mo`;
            descriptor.files = { [filename]: clsData.sourceCode };
            descriptor.primaryFile = filename;
            return descriptor;
          }
        }
      } catch {
        // fall through
      }
    }
  }

  // 3. Remote resource URL (e.g. cad-step or dataset referencing /api/v1/libraries/.../resources/...)
  const resourceUrl =
    (typeof config["url"] === "string" && config["url"].trim()) ||
    (typeof config["stepUrl"] === "string" && config["stepUrl"].trim()) ||
    (typeof config["fileUrl"] === "string" && config["fileUrl"].trim()) ||
    (typeof config["resourceUrl"] === "string" && config["resourceUrl"].trim()) ||
    "";
  if (
    resourceUrl &&
    (resourceUrl.startsWith("/") || resourceUrl.startsWith("http://") || resourceUrl.startsWith("https://"))
  ) {
    try {
      const resResp = await fetch(resourceUrl);
      if (resResp.ok) {
        const text = await resResp.text();
        if (text) {
          const explicitName =
            (typeof config["filename"] === "string" && config["filename"].trim()) ||
            (typeof config["fileName"] === "string" && config["fileName"].trim()) ||
            decodeURIComponent(resourceUrl.split("?")[0]!.split("/").pop() || "") ||
            "resource.txt";
          descriptor.files = { [explicitName]: text };
          descriptor.primaryFile = explicitName;
        }
      }
    } catch {
      // fall through
    }
  }

  return descriptor;
}

/**
 * Read-only filesystem provider for the `modelica://` virtual scheme.
 * Resolves standard library files (e.g. MSL) hosted in the language server's virtual VFS.
 */
export class ModelicaFileSystemProvider implements vscode.FileSystemProvider {
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._emitter.event;
  private cache = new Map<string, Uint8Array>();

  constructor(private readonly getClient?: () => LanguageClient | undefined) {}

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
      const res = await client.sendRequest<{ name: string; isDirectory?: boolean | undefined }[]>(
        "modelscript/readVirtualDirectory",
        { uri: uri.toString() },
      );
      if (Array.isArray(res)) {
        return res.map((e) => [e.name, e.isDirectory ? vscode.FileType.Directory : vscode.FileType.File]);
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
      const res = await client.sendRequest<{ content?: string | undefined; encoding?: string | undefined }>(
        "modelscript/readVirtualFile",
        { uri: key },
      );
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
  getClient?: () => LanguageClient | undefined,
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
        const rawSpec = hash.split(":")[1] || "empty";
        const qIdx = rawSpec.indexOf("?");
        const template = qIdx !== -1 ? rawSpec.slice(0, qIdx) || "empty" : rawSpec;
        const query = qIdx !== -1 ? rawSpec.slice(qIdx + 1) : "";
        memfsRootUri = vscode.Uri.from({ scheme: "memfs", path: "/" + template, query });
      }
    } catch {
      // ignore
    }
  }

  if (memfsRootUri) {
    memFs.createDirectory(memfsRootUri);
    const rawTemplate = (memfsRootUri.path.substring(1) || "empty").split("?")[0] || "empty";
    // Defer artifact-*, numeric/snowflake, package-*, and scratch scaffolding to initWorkspaceAndTree so async API hydration
    // completes first instead of populating placeholder stub files in the Extension Host worker.
    const isArtifactWorkspace =
      rawTemplate.startsWith("artifact-") || /^\d+$/.test(rawTemplate) || rawTemplate === "scratch";
    if (!isArtifactWorkspace && !rawTemplate.startsWith("package-")) {
      scaffoldTemplateFiles(memFs, memfsRootUri);
    }
  }

  return { memFs, modelicaFs, memfsRootUri };
}

/**
 * Discovers and mounts the active workspace (or memfs template) and binds the library tree.
 */
export async function initWorkspaceAndTree(
  treeProvider: LibraryTreeProvider,
  treeView: vscode.TreeView<LibraryTreeItem> | vscode.TreeView<vscode.TreeItem> | undefined,
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
        const rawSpec = hash.split(":")[1] || "empty";
        const qIdx = rawSpec.indexOf("?");
        const template = qIdx !== -1 ? rawSpec.slice(0, qIdx) || "empty" : rawSpec;
        const query = qIdx !== -1 ? rawSpec.slice(qIdx + 1) : "";
        workspaceUri = vscode.Uri.from({ scheme: "memfs", path: "/" + template, query });
      }
    } catch {
      // ignore
    }
  }

  if (workspaceUri && workspaceUri.scheme === "memfs") {
    try {
      const rawTemplate = workspaceUri.path.substring(1) || "empty";
      const template = rawTemplate.split("?")[0] || "empty";

      const isArtifact = template === "scratch" || template.startsWith("artifact-") || /^\d+$/.test(template);
      if (isArtifact && memFs) {
        const artifactId =
          template === "scratch"
            ? "scratch"
            : template.startsWith("artifact-")
              ? template.slice("artifact-".length)
              : template;
        let descriptor: ArtifactWorkspaceDescriptor | null = null;
        try {
          const raw =
            typeof sessionStorage !== "undefined" ? sessionStorage.getItem(`modelscript.artifact_${artifactId}`) : null;
          const localRaw =
            typeof localStorage !== "undefined"
              ? localStorage.getItem(`modelscript.artifact_${artifactId}`) ||
                localStorage.getItem(`modelscript:ide:memfs:${artifactId}`) ||
                localStorage.getItem(`modelscript:ide:memfs:artifact-${artifactId}`)
              : null;
          const scratchRaw =
            template === "scratch"
              ? (typeof sessionStorage !== "undefined"
                  ? sessionStorage.getItem("modelscript.artifact_scratch")
                  : null) ||
                (typeof localStorage !== "undefined" ? localStorage.getItem("modelscript.artifact_scratch") : null)
              : null;
          const effectiveRaw = raw || localRaw || scratchRaw;
          if (effectiveRaw) {
            const parsed = JSON.parse(effectiveRaw) as Partial<ArtifactWorkspaceDescriptor>;
            if (parsed && (parsed.viewConfig || parsed.viewType || parsed.files)) {
              descriptor = {
                artifactId,
                title: parsed.title,
                viewType: parsed.viewType,
                viewConfig: parsed.viewConfig,
                files: parsed.files,
                remoteFiles: parsed.remoteFiles,
                primaryFile: parsed.primaryFile,
              };
            }
          }
        } catch {
          // ignore
        }

        if (!descriptor && artifactId !== "scratch") {
          try {
            const resp = await fetch(`/api/v1/social/artifact-views/${encodeURIComponent(artifactId)}`);
            if (resp.ok) {
              const data = await resp.json();
              if (data?.artifactView) {
                const av = data.artifactView;
                const config = typeof av.view_config === "string" ? JSON.parse(av.view_config) : av.view_config || {};
                descriptor = {
                  artifactId: av.id ?? artifactId,
                  title: av.title || av.name,
                  viewType: av.view_type,
                  viewConfig: config,
                  files: config.files,
                  primaryFile: config.primaryFile || config.filename,
                };
              }
            }
          } catch (e) {
            console.warn("[artifact-init] Proactive fetch failed:", e);
          }
        }

        if (descriptor) {
          await hydrateArtifactDescriptor(descriptor);
          mountArtifactToMemFs(memFs, workspaceUri, descriptor);
          try {
            if (typeof sessionStorage !== "undefined") {
              sessionStorage.setItem(`modelscript.artifact_${artifactId}`, JSON.stringify(descriptor));
            }
            if (typeof localStorage !== "undefined") {
              localStorage.setItem(`modelscript.artifact_${artifactId}`, JSON.stringify(descriptor));
              localStorage.setItem(`modelscript:ide:memfs:${artifactId}`, JSON.stringify(descriptor));
              localStorage.setItem(`modelscript:ide:memfs:artifact-${artifactId}`, JSON.stringify(descriptor));
            }
          } catch {
            // ignore
          }
        }
      } else if (template.startsWith("package-") && memFs) {
        const rawPkgSpec = decodeURIComponent(template.slice("package-".length));
        const lastAt = rawPkgSpec.lastIndexOf("@");
        const pkgName = lastAt > 0 ? rawPkgSpec.slice(0, lastAt) : rawPkgSpec;
        const pkgVersion = lastAt > 0 ? rawPkgSpec.slice(lastAt + 1) : "";
        const descriptor: ArtifactWorkspaceDescriptor = {
          artifactId: `package-${pkgName}`,
          title: rawPkgSpec,
          viewType: "package",
          viewConfig: { name: pkgName, ...(pkgVersion ? { version: pkgVersion } : {}) },
        };
        await hydrateArtifactDescriptor(descriptor);
        mountArtifactToMemFs(memFs, workspaceUri, descriptor);
      }

      const primaryFile = getTemplatePrimaryFile(template);
      const fileUri = Uri.joinPath(workspaceUri, ...primaryFile.split("/"));

      if (memFs) {
        try {
          memFs.stat(fileUri);
        } catch {
          memFs.createDirectory(workspaceUri);
          scaffoldTemplateFiles(memFs, workspaceUri);
        }
      }

      // Pre-open up to 8 root code files in this memfs workspace so the LSP server indexes them
      try {
        const dirEntries = await workspace.fs.readDirectory(workspaceUri);
        let preOpened = 0;
        for (const [name, type] of dirEntries) {
          if (
            type === vscode.FileType.File &&
            name !== primaryFile &&
            !name.toLowerCase().endsWith(".md") &&
            !name.toLowerCase().endsWith(".json") &&
            !name.toLowerCase().endsWith(".pdf") &&
            !name.toLowerCase().endsWith(".png") &&
            !name.toLowerCase().endsWith(".jpg") &&
            preOpened < 8
          ) {
            try {
              await workspace.openTextDocument(Uri.joinPath(workspaceUri, name));
              preOpened++;
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
          const editor = await vscode.window.showTextDocument(doc);
          treeProvider.setDocumentUri(fileUri.toString());

          // Deep-link anchor auto-reveal from embed launch
          try {
            const initialAnchor =
              typeof sessionStorage !== "undefined" ? sessionStorage.getItem("modelscript.initialAnchor") : null;
            if (initialAnchor && editor) {
              sessionStorage.removeItem("modelscript.initialAnchor");
              const text = doc.getText();
              const regex = new RegExp(`\\b${initialAnchor}\\b`);
              const match = regex.exec(text);
              if (match) {
                const pos = doc.positionAt(match.index);
                const range = new vscode.Range(pos, pos.translate(0, initialAnchor.length));
                editor.selection = new vscode.Selection(pos, pos.translate(0, initialAnchor.length));
                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
              }
            }
          } catch {
            // ignore if sessionStorage is unavailable in extension host
          }
        }
      } catch (e: unknown) {
        console.error("[blank-project] Failed to open primary template file:", e);
      }

      if (template === "mbse-verification") {
        try {
          const mdUri = Uri.joinPath(workspaceUri, "VerificationReport.md");
          await vscode.workspace.fs.stat(mdUri);
          await vscode.commands.executeCommand("markdown.showPreviewToSide", mdUri);
        } catch {
          // Fallback
        }
      } else if (template === "cad") {
        try {
          const stepUri = Uri.joinPath(workspaceUri, "drone.step");
          await vscode.workspace.fs.stat(stepUri);
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

  if (folders && folders.length > 0 && folders[0]!.uri.scheme === "github") {
    try {
      await vscode.commands.executeCommand("workbench.view.explorer");
      const readmeUri = Uri.joinPath(folders[0]!.uri, "README.md");
      await vscode.workspace.fs.stat(readmeUri);
      const doc = await vscode.workspace.openTextDocument(readmeUri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch {
      // README.md is optional in github workspaces
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
  if (folders && folders.length > 0 && folders.every((f) => f.uri.scheme === "memfs" || f.uri.scheme === "github")) {
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
