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
  resolvedRef: string;
}

const TREE_CACHE = new Map<string, CachedTree>();
const INFLIGHT_TREES = new Map<string, Promise<CachedTree>>();
const FILE_CACHE = new Map<string, Uint8Array>();
const INFLIGHT_FILES = new Map<string, Promise<Uint8Array>>();
const TREE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_FILE_CACHE_SIZE = 100 * 1024 * 1024; // 100 MB
let fileCacheSize = 0;

// ── API helpers ──

function getApiBase(): { baseUrl: string; isSameOriginProxy: boolean } {
  // Use the proxy on the same origin as the extension host worker
  if (typeof self !== "undefined" && self.location && self.location.origin && self.location.origin !== "null") {
    return { baseUrl: `${self.location.origin}/api/github`, isSameOriginProxy: true };
  }
  const airgapped = vscode.workspace.getConfiguration("modelscript").get<boolean>("network.airgapped", false);
  if (airgapped) {
    throw new Error(
      "Outbound GitHub API requests are blocked in airgapped mode (modelscript.network.airgapped = true).",
    );
  }
  // Fallback: direct GitHub API (may hit rate limits / CORS issues)
  return { baseUrl: "https://api.github.com", isSameOriginProxy: false };
}

async function githubFetch(apiPath: string): Promise<Response> {
  const { baseUrl, isSameOriginProxy } = getApiBase();
  const url = `${baseUrl}${apiPath}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "ModelScript-IDE",
  };
  const ghToken = vscode.workspace.getConfiguration("github-fs").get<string>("token")?.trim();
  const msConfig = vscode.workspace.getConfiguration("modelscript");
  const ansatzToken = msConfig.get<string>("cloud.authToken")?.trim() || msConfig.get<string>("apiKey")?.trim();
  if (ghToken) {
    headers.Authorization = `Bearer ${ghToken}`;
  } else if (isSameOriginProxy && ansatzToken) {
    // Authenticate private/internal Ansatz Spaces via the same-origin /api/github endpoint
    headers.Authorization = `Bearer ${ansatzToken}`;
  }

  const response = await fetch(url, {
    headers,
    ...(isSameOriginProxy ? { credentials: "include" as RequestCredentials } : {}),
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw vscode.FileSystemError.FileNotFound();
    }
    if (response.status === 403) {
      const remaining = response.headers.get("X-RateLimit-Remaining");
      if (remaining === "0") {
        throw new Error("GitHub API rate limit exceeded. Set GITHUB_TOKEN on the server or configure github-fs.token.");
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

const VALID_GITHUB_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;

function isValidGitHubSegment(seg: string): boolean {
  return Boolean(seg && seg !== "." && seg !== ".." && VALID_GITHUB_SEGMENT_RE.test(seg));
}

function encodeGitHubFilePath(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  for (const part of parts) {
    if (part === "." || part === "..") {
      throw vscode.FileSystemError.NoPermissions(`Invalid path traversal segment in '${filePath}'`);
    }
  }
  return "/" + parts.map((p) => encodeURIComponent(p)).join("/");
}

function parseGitHubUri(uri: vscode.Uri): ParsedUri {
  // URI path format: /owner/repo/rest/of/path
  const segments = uri.path.split("/").filter(Boolean);
  const owner = segments[0] || "";
  const repo = segments[1] || "";
  if (!isValidGitHubSegment(owner) || !isValidGitHubSegment(repo)) {
    throw vscode.FileSystemError.FileNotFound(uri);
  }
  const filePath = segments.length > 2 ? "/" + segments.slice(2).join("/") : "/";
  const query = new URLSearchParams(uri.query);
  const ref = query.get("ref") || "main";
  return { owner, repo, ref, filePath };
}

function treeKey(owner: string, repo: string, ref: string): string {
  return `${owner}/${repo}@${ref}`;
}

// ── Fetch and cache the full recursive tree ──

async function fetchTreeWithFallback(owner: string, repo: string, ref: string): Promise<CachedTree> {
  const key = treeKey(owner, repo, ref);
  let resolvedRef = ref;
  let response: Response;
  try {
    console.log(`[github-fs] Fetching tree: ${owner}/${repo}@${ref}`);
    response = await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    );
  } catch (err) {
    const fallbackRef = ref === "main" ? "master" : ref === "master" ? "main" : null;
    if (fallbackRef && err instanceof vscode.FileSystemError) {
      console.log(`[github-fs] Branch '${ref}' not found for ${owner}/${repo}, falling back to '${fallbackRef}'`);
      resolvedRef = fallbackRef;
      response = await githubFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(fallbackRef)}?recursive=1`,
      );
    } else {
      throw err;
    }
  }

  const data: TreeResponse = await response.json();
  if (data.truncated) {
    console.warn(`[github-fs] Repository tree for ${owner}/${repo}@${resolvedRef} was truncated by the GitHub API.`);
  }

  const entries = new Map<string, TreeEntry>();
  for (const entry of data.tree || []) {
    entries.set("/" + entry.path, entry);
  }

  console.log(`[github-fs] Tree loaded: ${entries.size} entries (${owner}/${repo}@${resolvedRef})`);
  const cached: CachedTree = { entries, timestamp: Date.now(), resolvedRef };
  TREE_CACHE.set(key, cached);
  if (resolvedRef !== ref) {
    TREE_CACHE.set(treeKey(owner, repo, resolvedRef), cached);
  }
  return cached;
}

async function getTreeWithMeta(owner: string, repo: string, ref: string): Promise<CachedTree> {
  const key = treeKey(owner, repo, ref);
  const cached = TREE_CACHE.get(key);
  if (cached && Date.now() - cached.timestamp < TREE_TTL) {
    return cached;
  }

  const inflight = INFLIGHT_TREES.get(key);
  if (inflight) {
    return inflight;
  }

  const promise = fetchTreeWithFallback(owner, repo, ref).finally(() => {
    INFLIGHT_TREES.delete(key);
  });
  INFLIGHT_TREES.set(key, promise);
  return promise;
}

async function getTree(owner: string, repo: string, ref: string): Promise<Map<string, TreeEntry>> {
  const cached = await getTreeWithMeta(owner, repo, ref);
  return cached.entries;
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

    const encodedFilePath = encodeGitHubFilePath(filePath);
    const cacheKey = `${owner}/${repo}@${ref}:${filePath}`;

    const cached = FILE_CACHE.get(cacheKey);
    if (cached) return cached;

    const inflight = INFLIGHT_FILES.get(cacheKey);
    if (inflight) return inflight;

    const promise = (async () => {
      const treeMeta = await getTreeWithMeta(owner, repo, ref);
      const treeEntry = treeMeta.entries.get(filePath);
      if (!treeEntry) {
        const prefix = filePath.endsWith("/") ? filePath : filePath + "/";
        const isDir = Array.from(treeMeta.entries.keys()).some((k) => k.startsWith(prefix));
        if (isDir) {
          throw vscode.FileSystemError.FileIsADirectory(uri);
        }
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      if (treeEntry.type === "tree") {
        throw vscode.FileSystemError.FileIsADirectory(uri);
      }

      const effectiveRef = treeMeta.resolvedRef || ref;
      let data: ContentResponse;
      if (treeEntry.sha && (treeEntry.size ?? 0) > 1000000) {
        const blobResp = await githubFetch(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(treeEntry.sha)}`,
        );
        data = await blobResp.json();
      } else {
        // Use the Contents API to get file content, falling back to Git Blobs API for >1MB files
        const response = await githubFetch(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents${encodedFilePath}?ref=${encodeURIComponent(effectiveRef)}`,
        );
        data = await response.json();
        if ((!data.content || data.content.length === 0) && data.sha && data.size > 0) {
          const blobResp = await githubFetch(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(data.sha)}`,
          );
          data = await blobResp.json();
        }
      }

      let content: Uint8Array;
      if (data.encoding === "base64") {
        // Decode base64
        const binary = atob(data.content.replace(/\s+/g, ""));
        content = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          content[i] = binary.charCodeAt(i);
        }
      } else {
        // Plain text
        const encoder = new TextEncoder();
        content = encoder.encode(data.content ?? "");
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
    })().finally(() => {
      INFLIGHT_FILES.delete(cacheKey);
    });

    INFLIGHT_FILES.set(cacheKey, promise);
    return promise;
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
