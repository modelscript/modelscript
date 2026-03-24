// SPDX-License-Identifier: AGPL-3.0-or-later
//
// GitHub FileSystemProvider: implements vscode.FileSystemProvider for
// reading GitHub repositories via the GitHub REST API.
//
// URI format: github:///owner/repo/path/to/file?ref=main
//   authority = "" (empty)
//   path      = "/owner/repo/path/to/file"
//   query     = "ref=main" (branch, tag, or commit; defaults to "main")

import * as vscode from "vscode";

// ── Types ──

interface TreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
}

interface TreeResponse {
  sha: string;
  tree: TreeEntry[];
  truncated: boolean;
}

interface ContentResponse {
  content: string;
  encoding: string;
  sha: string;
  size: number;
}

// ── Caches ──

interface CachedTree {
  entries: Map<string, TreeEntry>;
  timestamp: number;
}

const TREE_CACHE = new Map<string, CachedTree>();
const FILE_CACHE = new Map<string, Uint8Array>();
const TREE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_FILE_CACHE_SIZE = 100 * 1024 * 1024; // 100 MB
let fileCacheSize = 0;

// ── API helpers ──

function getApiBase(): string {
  // Use the proxy on the same origin as the extension host worker
  if (typeof self !== "undefined" && self.location && self.location.origin && self.location.origin !== "null") {
    return `${self.location.origin}/api/github`;
  }
  // Fallback: direct GitHub API (may hit rate limits / CORS issues)
  return "https://api.github.com";
}

async function githubFetch(apiPath: string): Promise<Response> {
  const url = `${getApiBase()}${apiPath}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "ModelScript-IDE",
  };

  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 404) {
      throw vscode.FileSystemError.FileNotFound();
    }
    if (response.status === 403) {
      const remaining = response.headers.get("X-RateLimit-Remaining");
      if (remaining === "0") {
        throw new Error("GitHub API rate limit exceeded. Set GITHUB_TOKEN on the server.");
      }
    }
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return response;
}

// ── Parse URI ──

interface ParsedUri {
  owner: string;
  repo: string;
  ref: string;
  filePath: string; // path within the repo (e.g. "/src/main.ts")
}

function parseGitHubUri(uri: vscode.Uri): ParsedUri {
  // URI path format: /owner/repo/rest/of/path
  const segments = uri.path.split("/").filter(Boolean);
  const owner = segments[0] || "";
  const repo = segments[1] || "";
  const filePath = segments.length > 2 ? "/" + segments.slice(2).join("/") : "/";
  const query = new URLSearchParams(uri.query);
  const ref = query.get("ref") || "main";
  return { owner, repo, ref, filePath };
}

function treeKey(owner: string, repo: string, ref: string): string {
  return `${owner}/${repo}@${ref}`;
}

// ── Fetch and cache the full recursive tree ──

async function getTree(owner: string, repo: string, ref: string): Promise<Map<string, TreeEntry>> {
  const key = treeKey(owner, repo, ref);
  const cached = TREE_CACHE.get(key);
  if (cached && Date.now() - cached.timestamp < TREE_TTL) {
    return cached.entries;
  }

  console.log(`[github-fs] Fetching tree: ${owner}/${repo}@${ref}`);
  const response = await githubFetch(`/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`);
  const data: TreeResponse = await response.json();

  const entries = new Map<string, TreeEntry>();
  for (const entry of data.tree) {
    entries.set("/" + entry.path, entry);
  }

  console.log(`[github-fs] Tree loaded: ${entries.size} entries`);
  TREE_CACHE.set(key, { entries, timestamp: Date.now() });
  return entries;
}

// ── FileSystemProvider implementation ──

export class GitHubFileSystemProvider implements vscode.FileSystemProvider {
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

  watch(): vscode.Disposable {
    // Read-only: no watching needed
    return new vscode.Disposable(() => {
      /* read-only: no-op */
    });
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { owner, repo, ref, filePath } = parseGitHubUri(uri);

    // Root directory (just /owner/repo)
    if (filePath === "/" || filePath === "") {
      return {
        type: vscode.FileType.Directory,
        ctime: 0,
        mtime: 0,
        size: 0,
      };
    }

    const tree = await getTree(owner, repo, ref);
    const entry = tree.get(filePath);

    if (!entry) {
      // Check if it's a directory by looking for children
      const prefix = filePath.endsWith("/") ? filePath : filePath + "/";
      const isDir = Array.from(tree.keys()).some((k) => k.startsWith(prefix));
      if (isDir) {
        return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
      }
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    if (entry.type === "tree") {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }

    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: entry.size ?? 0,
    };
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const { owner, repo, ref, filePath } = parseGitHubUri(uri);
    const tree = await getTree(owner, repo, ref);

    const normalizedPath = filePath === "/" ? "" : filePath;
    const prefix = normalizedPath + "/";
    const results: [string, vscode.FileType][] = [];
    const seen = new Set<string>();

    for (const [entryPath, entry] of tree) {
      if (!entryPath.startsWith(prefix)) continue;
      const relative = entryPath.substring(prefix.length);
      // Only direct children (no nested slashes)
      const slashIndex = relative.indexOf("/");
      if (slashIndex !== -1) {
        // This is a nested entry — record the directory name
        const dirName = relative.substring(0, slashIndex);
        if (!seen.has(dirName)) {
          seen.add(dirName);
          results.push([dirName, vscode.FileType.Directory]);
        }
        continue;
      }
      if (relative === "") continue;
      if (seen.has(relative)) continue;
      seen.add(relative);
      results.push([relative, entry.type === "tree" ? vscode.FileType.Directory : vscode.FileType.File]);
    }

    return results;
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const { owner, repo, ref, filePath } = parseGitHubUri(uri);

    // Directories can't be read as files
    if (filePath === "/" || filePath === "") {
      throw vscode.FileSystemError.FileIsADirectory(uri);
    }

    const cacheKey = `${owner}/${repo}@${ref}:${filePath}`;

    const cached = FILE_CACHE.get(cacheKey);
    if (cached) return cached;

    // Use the Contents API to get file content
    const response = await githubFetch(`/repos/${owner}/${repo}/contents${filePath}?ref=${ref}`);
    const data: ContentResponse = await response.json();

    let content: Uint8Array;
    if (data.encoding === "base64") {
      // Decode base64
      const binary = atob(data.content.replace(/\n/g, ""));
      content = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        content[i] = binary.charCodeAt(i);
      }
    } else {
      // Plain text
      const encoder = new TextEncoder();
      content = encoder.encode(data.content);
    }

    // Cache with LRU eviction
    if (fileCacheSize + content.length > MAX_FILE_CACHE_SIZE) {
      // Evict oldest entries
      const entries = Array.from(FILE_CACHE.entries());
      while (fileCacheSize + content.length > MAX_FILE_CACHE_SIZE && entries.length > 0) {
        const oldest = entries.shift();
        if (!oldest) break;
        const [key, val] = oldest;
        fileCacheSize -= val.length;
        FILE_CACHE.delete(key);
      }
    }
    FILE_CACHE.set(cacheKey, content);
    fileCacheSize += content.length;

    return content;
  }

  // ── Read-only: all write operations throw ──

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions("GitHub repositories are read-only");
  }

  writeFile(): void {
    throw vscode.FileSystemError.NoPermissions("GitHub repositories are read-only");
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions("GitHub repositories are read-only");
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions("GitHub repositories are read-only");
  }
}
