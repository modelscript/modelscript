// SPDX-License-Identifier: AGPL-3.0-or-later

function inferDialectFromFilename(filename?: string | null): string | undefined {
  if (!filename) return undefined;
  const dot = filename.lastIndexOf(".");
  if (dot === -1) return undefined;
  const ext = filename.slice(dot + 1).toLowerCase();
  const map: Record<string, string> = {
    mo: "modelica",
    msx: "modelscript",
    sysml: "sysml2",
    kerml: "sysml2",
    opi: "olga",
    key: "olga",
    genkey: "olga",
    pscx: "pscad",
    raw: "psse",
    dyr: "psse",
    cir: "spice",
    sp: "spice",
    inp: "epanet",
    mod: "ampl",
    dat: "ampl",
    owl: "owl2",
    ttl: "owl2",
    urdf: "urdf",
    step: "step",
    stp: "step",
    scad: "scad",
    usd: "usd",
    usda: "usd",
    yaml: "cantera",
    sbml: "sbml",
    xml: "sbml",
    csv: "csv",
    c: "c",
    f90: "fortran",
  };
  return map[ext] ?? ext;
}

declare const __AVAILABLE_FILE_ICONS__: Record<string, string> | undefined;

interface NodeProcessLike {
  env?: Record<string, string | undefined>;
  getBuiltinModule?: (id: string) => unknown;
}

export interface FileIconsConfig {
  /** Explicit directory on disk containing `.svg`/`.png` file icons (Node environments only). */
  iconsDir?: string | undefined;
  /** Explicit map of language/icon base names to icon filenames. */
  icons?: Record<string, string> | undefined;
}

function scanFileIconsDir(iconsDir: string): Map<string, string> | null {
  try {
    const getBuiltin = (globalThis as { process?: NodeProcessLike }).process?.getBuiltinModule;
    if (typeof getBuiltin !== "function") return null;
    const fs = getBuiltin("node:fs") as { existsSync(p: string): boolean; readdirSync(p: string): string[] };
    if (!fs.existsSync(iconsDir)) return null;
    const map = new Map<string, string>();
    for (const f of fs.readdirSync(iconsDir).sort()) {
      const lower = f.toLowerCase();
      if (lower.endsWith(".svg")) {
        map.set(lower.slice(0, -4), f);
      } else if (lower.endsWith(".png")) {
        const name = lower.slice(0, -4);
        if (!map.has(name)) map.set(name, f);
      }
    }
    return map;
  } catch {
    return null;
  }
}

function loadAvailableFileIcons(config?: FileIconsConfig): Map<string, string> {
  if (config?.icons) {
    return new Map(Object.entries(config.icons).map(([k, v]) => [k.toLowerCase(), v]));
  }

  if (config?.iconsDir) {
    const scanned = scanFileIconsDir(config.iconsDir);
    if (scanned) return scanned;
    return new Map([["default", "default.svg"]]);
  }

  if (typeof __AVAILABLE_FILE_ICONS__ !== "undefined" && __AVAILABLE_FILE_ICONS__) {
    return new Map(Object.entries(__AVAILABLE_FILE_ICONS__).map(([k, v]) => [k.toLowerCase(), v]));
  }

  try {
    const proc = (globalThis as { process?: NodeProcessLike }).process;
    const envDir = proc?.env?.MODELSCRIPT_FILE_ICONS_DIR?.trim();
    if (envDir) {
      const scanned = scanFileIconsDir(envDir);
      if (scanned) return scanned;
      return new Map([["default", "default.svg"]]);
    }

    const getBuiltin = proc?.getBuiltinModule;
    if (typeof getBuiltin === "function") {
      const path = getBuiltin("node:path") as { dirname(p: string): string; resolve(...p: string[]): string };
      const url = getBuiltin("node:url") as { fileURLToPath(u: string): string };
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      // Last-resort monorepo dev default when neither Vite define nor MODELSCRIPT_FILE_ICONS_DIR is configured.
      const devFallbackDir = path.resolve(here, "../../../../../apps/web/public/file-icons");
      const scanned = scanFileIconsDir(devFallbackDir);
      if (scanned) return scanned;
    }
  } catch {
    // Browser or restricted runtime without Vite define
  }

  return new Map([["default", "default.svg"]]);
}

let availableFileIcons = loadAvailableFileIcons();

/**
 * Configures the available file icons from an explicit icon map or directory path,
 * avoiding any reliance on monorepo-relative filesystem paths.
 */
export function configureFileIcons(config: FileIconsConfig): ReadonlyMap<string, string> {
  availableFileIcons = loadAvailableFileIcons(config);
  return availableFileIcons;
}

/**
 * Resets the available file icons to the default discovery order
 * (`__AVAILABLE_FILE_ICONS__`, `MODELSCRIPT_FILE_ICONS_DIR`, or dev fallback).
 */
export function resetFileIcons(): ReadonlyMap<string, string> {
  availableFileIcons = loadAvailableFileIcons();
  return availableFileIcons;
}

/**
 * Returns the map of icon base names to filenames (preferring `.svg` over `.png`)
 * available under `/file-icons/`.
 */
export function getAvailableFileIcons(): ReadonlyMap<string, string> {
  return availableFileIcons;
}

/**
 * Resolves the `/file-icons/*` asset path for a workspace file name using its
 * language name (explicit or inferred from filename), preferring `.svg` with `.png`
 * fallback and defaulting to `default.svg` (or `default.png`).
 */
const SAFE_ICON_FILENAME_RE = /^[a-z0-9._-]+\.(?:svg|png)$/i;

export function getFileIconPath(fileName: string, language?: string | null): string {
  const lang = (language?.trim() || inferDialectFromFilename(fileName) || "").toLowerCase();
  const matched = lang ? availableFileIcons.get(lang) : undefined;
  if (matched && SAFE_ICON_FILENAME_RE.test(matched)) {
    return `/file-icons/${encodeURIComponent(matched)}`;
  }
  const fallback = availableFileIcons.get("default");
  const safeFallback = fallback && SAFE_ICON_FILENAME_RE.test(fallback) ? fallback : "default.svg";
  return `/file-icons/${encodeURIComponent(safeFallback)}`;
}
