// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Formats an ISO date string into an accurate, human-readable relative time
 * (e.g., "just now", "12 minutes ago", "3 hours ago", "2 days ago", "last month").
 */
export function getRelativeTime(dateString?: string | null): string {
  if (!dateString) return "recently";
  const parsed = new Date(dateString).getTime();
  if (Number.isNaN(parsed)) return "recently";

  const diffMs = parsed - Date.now();
  const absSec = Math.abs(diffMs) / 1000;

  if (absSec < 45) return "just now";

  try {
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    if (absSec < 3600) {
      return rtf.format(Math.round(diffMs / (1000 * 60)), "minute");
    }
    if (absSec < 86400) {
      return rtf.format(Math.round(diffMs / (1000 * 60 * 60)), "hour");
    }
    if (absSec < 86400 * 30) {
      return rtf.format(Math.round(diffMs / (1000 * 60 * 60 * 24)), "day");
    }
    if (absSec < 86400 * 365) {
      return rtf.format(Math.round(diffMs / (1000 * 60 * 60 * 24 * 30)), "month");
    }
    return rtf.format(Math.round(diffMs / (1000 * 60 * 60 * 24 * 365)), "year");
  } catch {
    return new Date(parsed).toLocaleDateString();
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 1 : 2)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

export function getLanguageFromFileName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
    case "msx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
      return "javascript";
    case "json":
      return "json";
    case "css":
    case "scss":
      return "css";
    case "html":
      return "html";
    case "md":
    case "markdown":
      return "markdown";
    case "yml":
    case "yaml":
      return "yaml";
    case "py":
      return "python";
    case "java":
      return "java";
    case "cpp":
    case "cc":
    case "cxx":
    case "c":
    case "h":
    case "hpp":
    case "scad":
      return "cpp";
    case "cs":
      return "csharp";
    case "go":
      return "go";
    case "rs":
      return "rust";
    case "php":
      return "php";
    case "rb":
      return "ruby";
    case "sh":
    case "bash":
      return "shell";
    case "sql":
      return "sql";
    case "xml":
    case "ssd":
    case "ssp":
    case "svg":
    case "pscx":
    case "pslx":
      return "xml";
    case "mo":
      return "modelica";
    case "sysml":
    case "kerml":
      return "kotlin";
    case "cfg":
    case "inp":
    case "spck":
    case "sim":
    case "tsf":
      return "ini";
    case "cmake":
      return "cmake";
    default:
      return "plaintext";
  }
}

export function getDialectForFileName(fileName: string): string | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mo":
      return "modelica";
    case "sysml":
    case "kerml":
      return "sysml2";
    case "msx":
      return "modelscript";
    case "scad":
      return "scad";
    case "step":
    case "stp":
      return "step";
    case "cfg":
      return "cfd";
    case "inp":
      return "fea";
    case "ssd":
    case "ssp":
      return "ssp";
    case "owl":
    case "ofn":
      return "owl2";
    case "spck":
    case "sim":
      return "simpack";
    case "tsf":
      return "gensys";
    case "pscx":
    case "pslx":
      return "pscad";
    default:
      return null;
  }
}

export function canOpenFileInPlayground(fileName: string): boolean {
  return getDialectForFileName(fileName) !== null;
}

export function getFileDomainBadge(fileName: string): { label: string; color: string } | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mo":
      return { label: "Modelica", color: "#0284c7" };
    case "sysml":
    case "kerml":
      return { label: "SysML v2", color: "#7c3aed" };
    case "msx":
      return { label: "ModelScript", color: "#0f766e" };
    case "scad":
    case "step":
    case "stp":
      return { label: "3D CAD", color: "#d97706" };
    case "cfg":
      return { label: "SU2 CFD", color: "#2563eb" };
    case "inp":
      return { label: "CalculiX FEA", color: "#dc2626" };
    case "ssd":
    case "ssp":
      return { label: "SSP Co-Sim", color: "#059669" };
    case "cpp":
    case "h":
    case "hpp":
    case "c":
      return { label: "C / C++", color: "#4f46e5" };
    case "md":
      return { label: "Docs", color: "#64748b" };
    default:
      return null;
  }
}

/* ── Unified Repository Engagement State (Star / Follow / Watch / Fork) ── */

function emitRepoEngagementChange(repoKey: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("modelscript:repo-engagement-changed", { detail: { repoKey } }));
  }
}

export function getFollowedReposMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem("modelscript.followed_repos");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function isRepoStarred(repoKey: string): boolean {
  try {
    if (localStorage.getItem(`modelscript.repo.star.${repoKey}`) === "1") return true;
    const map = getFollowedReposMap();
    return Boolean(map[repoKey]);
  } catch {
    return false;
  }
}

export function setRepoStarred(repoKey: string, starred: boolean): void {
  try {
    localStorage.setItem(`modelscript.repo.star.${repoKey}`, starred ? "1" : "0");
    const map = getFollowedReposMap();
    map[repoKey] = starred;
    localStorage.setItem("modelscript.followed_repos", JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
  emitRepoEngagementChange(repoKey);
}

export function isRepoWatching(repoKey: string): boolean {
  try {
    return localStorage.getItem(`modelscript.repo.watch.${repoKey}`) === "1";
  } catch {
    return false;
  }
}

export function setRepoWatching(repoKey: string, watching: boolean): void {
  try {
    localStorage.setItem(`modelscript.repo.watch.${repoKey}`, watching ? "1" : "0");
  } catch {
    // Ignore
  }
  emitRepoEngagementChange(repoKey);
}

export function isRepoForked(repoKey: string): boolean {
  try {
    return localStorage.getItem(`modelscript.repo.fork.${repoKey}`) === "1";
  } catch {
    return false;
  }
}

export function setRepoForked(repoKey: string, forked: boolean): void {
  try {
    localStorage.setItem(`modelscript.repo.fork.${repoKey}`, forked ? "1" : "0");
  } catch {
    // Ignore
  }
  emitRepoEngagementChange(repoKey);
}

export function normalizeWebhookEvents(events: unknown): string[] {
  if (Array.isArray(events)) {
    return events.map((e) => String(e).trim()).filter(Boolean);
  }
  if (typeof events === "string") {
    const trimmed = events.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((e) => String(e).trim()).filter(Boolean);
        }
      } catch {
        // Fallback to comma split
      }
    }
    return trimmed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return ["push"];
}

export function parseRepositoryInput(
  rawInput: string,
  fallbackProvider: "github" | "gitlab" | "local" = "github",
): { provider: string; repo_full_name: string } {
  const trimmed = rawInput.trim().replace(/\.git$/i, "");
  if (!trimmed) {
    throw new Error("Please enter a repository URL or owner/name");
  }

  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed) && !trimmed.includes(".com") && !trimmed.includes(".org")) {
    return { provider: fallbackProvider, repo_full_name: trimmed };
  }

  const parsedUrl = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  const host = parsedUrl.hostname.toLowerCase();
  let provider: string;
  if (host === "github.com" || host.endsWith(".github.com")) {
    provider = "github";
  } else if (host === "gitlab.com" || host.endsWith(".gitlab.com")) {
    provider = "gitlab";
  } else if (
    host === "ansatz.social" ||
    host.endsWith(".ansatz.social") ||
    host === "modelscript.org" ||
    host.endsWith(".modelscript.org") ||
    host === "localhost" ||
    host.endsWith(".local")
  ) {
    provider = "local";
  } else {
    throw new Error("Supported providers are GitHub, GitLab, or Ansatz Git (owner/repo)");
  }

  const parts = parsedUrl.pathname
    .split("/")
    .filter(Boolean)
    .filter((p) => p !== "git" && p !== "repos");
  if (parts.length < 2) {
    throw new Error("Invalid repository URL format (expected owner/project)");
  }
  const repo_full_name = `${parts[0]}/${parts[1]}`.replace(/\.git$/i, "");
  return { provider, repo_full_name };
}
