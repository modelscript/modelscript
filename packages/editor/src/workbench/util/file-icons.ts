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

function loadAvailableFileIcons(): Map<string, string> {
  if (typeof __AVAILABLE_FILE_ICONS__ !== "undefined" && __AVAILABLE_FILE_ICONS__) {
    return new Map(Object.entries(__AVAILABLE_FILE_ICONS__).map(([k, v]) => [k.toLowerCase(), v]));
  }

  const map = new Map<string, string>();
  try {
    const getBuiltin = (globalThis as { process?: { getBuiltinModule?: (id: string) => any } }).process
      ?.getBuiltinModule;
    if (typeof getBuiltin === "function") {
      const fs = getBuiltin("node:fs");
      const path = getBuiltin("node:path");
      const url = getBuiltin("node:url");
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      const iconsDir = path.resolve(here, "../../../../../apps/web/public/file-icons");
      if (fs.existsSync(iconsDir)) {
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
      }
    }
  } catch {
    // Browser or restricted runtime without Vite define
  }

  map.set("default", "default.svg");
  return map;
}

const AVAILABLE_FILE_ICONS = loadAvailableFileIcons();

/**
 * Returns the map of icon base names to filenames (preferring `.svg` over `.png`)
 * available under `/file-icons/`.
 */
export function getAvailableFileIcons(): ReadonlyMap<string, string> {
  return AVAILABLE_FILE_ICONS;
}

/**
 * Resolves the `/file-icons/*` asset path for a workspace file name using its
 * language name (explicit or inferred from filename), preferring `.svg` with `.png`
 * fallback and defaulting to `default.svg` (or `default.png`).
 */
export function getFileIconPath(fileName: string, language?: string | null): string {
  const lang = (language?.trim() || inferDialectFromFilename(fileName) || "").toLowerCase();
  const matched = lang ? AVAILABLE_FILE_ICONS.get(lang) : undefined;
  if (matched) {
    return `/file-icons/${matched}`;
  }
  return `/file-icons/${AVAILABLE_FILE_ICONS.get("default") ?? "default.svg"}`;
}
