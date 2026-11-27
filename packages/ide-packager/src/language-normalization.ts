// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LanguageMaturity, LanguageOptions } from "@modelscript/dsl";
import type * as FsTypes from "node:fs";
import type * as PathTypes from "node:path";
import type * as UrlTypes from "node:url";

/** Language ID aliases that inherit maturity from their canonical workspace language package. */
const LANGUAGE_MATURITY_ALIASES: Record<string, string> = {
  sysml: "sysml2",
  openscad: "scad",
  owl: "owl2",
  openfoam: "cfd",
  aml: "automationml",
  caex: "automationml",
};

/** Minimal fallback for non-package domain variants that do not have a standalone `languages/<id>/` directory. */
const DOMAIN_VARIANT_FALLBACK_MATURITY: Record<string, LanguageMaturity> = {
  vhdlams: "beta",
  verilogams: "beta",
  bondgraph: "beta",
  smv: "beta",
};

function getNodeBuiltin<T>(id: string): T | undefined {
  const proc = (globalThis as { process?: { getBuiltinModule?: (m: string) => T | undefined } }).process;
  return proc?.getBuiltinModule?.(id);
}

/**
 * Maps a package manifest's `modelscript.tier` (`"beta" | "alpha" | "pre-alpha"`) to the
 * IDE extension's `LanguageMaturity` (`"stable" | "beta" | "experimental"`).
 */
export function mapPackageTierToMaturity(tier: unknown): LanguageMaturity {
  if (tier === "stable" || tier === "beta") return "stable";
  if (tier === "alpha") return "beta";
  return "experimental";
}

function findWorkspaceLanguagesDir(
  fsMod: typeof FsTypes,
  pathMod: typeof PathTypes,
  urlMod?: typeof UrlTypes,
): string | undefined {
  const candidates: string[] = [];
  try {
    if (urlMod && typeof import.meta?.url === "string" && import.meta.url.startsWith("file:")) {
      let dir = pathMod.dirname(urlMod.fileURLToPath(import.meta.url));
      for (let depth = 0; depth < 7; depth++) {
        candidates.push(pathMod.join(dir, "languages"));
        const parent = pathMod.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
  } catch {
    // Ignore URL resolution failures in non-Node runtimes
  }
  const cwd = (globalThis as { process?: { cwd?: () => string } }).process?.cwd?.();
  if (cwd) {
    candidates.push(pathMod.join(cwd, "languages"));
  }
  for (const candidate of candidates) {
    if (fsMod.existsSync(pathMod.join(candidate, "modelica", "package.json"))) {
      return candidate;
    }
  }
  return candidates.find((c) => fsMod.existsSync(c));
}

/**
 * Dynamically derives language maturity tiers from each workspace language package's
 * `languages/<id>/package.json#modelscript.tier`.
 */
export function loadWorkspaceLanguageMaturity(languagesDir?: string): Record<string, LanguageMaturity> {
  const maturity: Record<string, LanguageMaturity> = {};
  const fsMod = getNodeBuiltin<typeof FsTypes>("node:fs");
  const pathMod = getNodeBuiltin<typeof PathTypes>("node:path");
  const urlMod = getNodeBuiltin<typeof UrlTypes>("node:url");

  if (fsMod && pathMod) {
    const resolvedDir = languagesDir ?? findWorkspaceLanguagesDir(fsMod, pathMod, urlMod);
    if (resolvedDir && fsMod.existsSync(resolvedDir)) {
      let entries: FsTypes.Dirent[] = [];
      try {
        entries = fsMod.readdirSync(resolvedDir, { withFileTypes: true });
      } catch {
        entries = [];
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pkgPath = pathMod.join(resolvedDir, entry.name, "package.json");
        if (!fsMod.existsSync(pkgPath)) continue;
        try {
          const pkg = JSON.parse(fsMod.readFileSync(pkgPath, "utf8")) as {
            modelscript?: { tier?: unknown };
          };
          maturity[entry.name.toLowerCase()] = mapPackageTierToMaturity(pkg.modelscript?.tier);
        } catch {
          maturity[entry.name.toLowerCase()] = "experimental";
        }
      }
    }
  }

  for (const [alias, canonical] of Object.entries(LANGUAGE_MATURITY_ALIASES)) {
    const canonicalMaturity = maturity[canonical];
    if (canonicalMaturity && !(alias in maturity)) {
      maturity[alias] = canonicalMaturity;
    }
  }

  for (const [variant, fallbackMaturity] of Object.entries(DOMAIN_VARIANT_FALLBACK_MATURITY)) {
    if (!(variant in maturity)) {
      maturity[variant] = fallbackMaturity;
    }
  }

  return maturity;
}

/**
 * Canonical maturity classification derived dynamically from `languages/*\/package.json#modelscript.tier`.
 */
export const DEFAULT_LANGUAGE_MATURITY: Record<string, LanguageMaturity> = loadWorkspaceLanguageMaturity();

/**
 * Languages that have a registered 2D diagram editor provider in @modelscript/ide-client.
 */
export const DIAGRAM_EDITOR_SUPPORTED_LANGS = new Set<string>([
  "modelica",
  "sysml2",
  "sysml",
  "step",
  "scad",
  "owl2",
  "csv",
  "pscad",
  "cfd",
  "fea",
  "ssp",
  "modelscript",
  "adams",
  "ampl",
  "antimony",
  "aspen",
  "automationml",
  "autosar",
  "bngl",
  "c",
  "cantera",
  "ccsds",
  "cellml",
  "cgmes",
  "dicom-rt",
  "easy5",
  "eclipse",
  "energyplus",
  "epanet",
  "febio",
  "fiber",
  "fortran",
  "genbank",
  "gensys",
  "gproms",
  "gtfs",
  "gtsuite",
  "hec-ras",
  "ibis",
  "igtl",
  "jsbsim",
  "landgem",
  "lps",
  "modflow",
  "nifti",
  "nmtran",
  "ocpp",
  "olga",
  "openadr",
  "opendrive",
  "opendss",
  "openscenario",
  "opensim",
  "optical",
  "oscal",
  "pdb",
  "phreeqc",
  "plcopen",
  "powerfactory",
  "pslf",
  "psse",
  "qif",
  "ran",
  "relap5",
  "reqif",
  "rocets",
  "sbml",
  "sbol",
  "sedml",
  "sima",
  "simpack",
  "simulink",
  "smiles",
  "spice",
  "swmm",
  "three-mf",
  "topas",
  "touchstone",
  "tough",
  "urdf",
  "verilog-a",
  "usd",
]);

/**
 * Configuration options for generating a VS Code extension.
 */
export interface ExtensionOptions {
  /** Extension unique identifier (e.g. "modelscript", "calc-lang") */
  name?: string | undefined;
  /** Human-readable display name (e.g. "Ansatz Studio") */
  displayName?: string | undefined;
  /** Semantic version string */
  version?: string | undefined;
  /** Publisher name */
  publisher?: string | undefined;
  /** Extension description */
  description?: string | undefined;
  /** Extension icon path relative to extension root (e.g. "images/icon.png") */
  icon?: string | undefined;
  /** Homepage URL */
  homepage?: string | undefined;
  /** Repository URL */
  repository?: string | undefined;
  /** Minimum VS Code engine version (default: "^1.90.0") */
  vscodeEngine?: string | undefined;
  /** Output mode: "web" (pure browser) | "node" (desktop) | "universal" (both) */
  target?: "web" | "node" | "universal" | undefined;
  /** VS Code Marketplace platform target for native desktop VSIX packaging */
  platformTarget?: "web" | "darwin-arm64" | "darwin-x64" | "win32-x64" | "linux-x64" | "linux-arm64" | undefined;
  /** Explicit path to compiled modelscript_native.node addon to bundle into desktop VSIX */
  nativeAddonPath?: string | undefined;
  /** Minify bundled JavaScript assets (default: true in buildIdeExtension) */
  minify?: boolean | undefined;
  /** Emit source maps for bundled JavaScript assets (default: false in buildIdeExtension) */
  sourcemap?: boolean | "linked" | "inline" | "external" | undefined;
  /** Feature toggles */
  features?:
    | {
        diagramEditor?: boolean | undefined;
        cad3dViewer?: boolean | undefined;
        simulationPanels?: boolean | undefined;
        notebooks?: boolean | undefined;
        mcpBridge?: boolean | undefined;
        chatParticipant?: boolean | undefined;
      }
    | undefined;
}

export interface ExtensionGeneratedFile {
  path: string;
  content: string | Uint8Array;
}

/**
 * Normalized language descriptor for extension generation.
 */
export interface NormalizedLanguage {
  id: string;
  name: string;
  displayName: string;
  maturity: LanguageMaturity;
  fileExtensions: string[];
  primaryExtension: string;
  options: LanguageOptions;
  lineComment?: string | undefined;
  blockComment?: { open: string; close: string } | undefined;
  icon?: { light: string; dark: string } | undefined;
}

/**
 * Input shape accepted by `normalizeLanguages`, `bundleExtension`, and `generateFileIconTheme`.
 */
export type LanguageInputLike = LanguageOptions & {
  displayName?: string;
  maturity?: LanguageMaturity;
  extensions?: string[];
  fileExtensions?: string[];
  lsp?: { fileExtensions?: string[]; fileExtension?: string; icons?: unknown };
  primitives?: { lineComment?: string; nestedComment?: unknown };
};

/**
 * Returns whether a normalized language should receive a `<lang>.diagramEditor` custom editor.
 */
export function isSupportedDiagramLanguage(lang: NormalizedLanguage, options?: ExtensionOptions): boolean {
  return (
    Boolean(lang.options.diagram) ||
    DIAGRAM_EDITOR_SUPPORTED_LANGS.has(lang.id) ||
    (options?.features?.diagramEditor === true && !(lang.id in DEFAULT_LANGUAGE_MATURITY) && lang.id !== "smv")
  );
}

/**
 * Normalizes a list of LanguageOptions into standard descriptors.
 */
export function normalizeLanguages(languages: LanguageInputLike[]): NormalizedLanguage[] {
  return languages.map((lang) => {
    const rawName = lang.name || "dsl";
    const id = rawName.toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const displayName = lang.displayName || rawName.charAt(0).toUpperCase() + rawName.slice(1);
    const maturity: LanguageMaturity = lang.maturity || DEFAULT_LANGUAGE_MATURITY[id] || "experimental";

    // Extract file extensions
    let extensions: string[] = [];
    if (lang.extensions && Array.isArray(lang.extensions)) {
      extensions = lang.extensions.map((e: string) => (e.startsWith(".") ? e : `.${e}`));
    } else if (lang.lsp?.fileExtensions && Array.isArray(lang.lsp.fileExtensions)) {
      extensions = lang.lsp.fileExtensions.map((e: string) => (e.startsWith(".") ? e : `.${e}`));
    } else if (lang.lsp?.fileExtension) {
      const ext = lang.lsp.fileExtension.startsWith(".") ? lang.lsp.fileExtension : `.${lang.lsp.fileExtension}`;
      extensions = [ext];
    } else if (lang.fileExtensions && Array.isArray(lang.fileExtensions)) {
      extensions = lang.fileExtensions.map((e: string) => (e.startsWith(".") ? e : `.${e}`));
    } else if (id === "sysml2" || id === "sysml") {
      extensions = [".sysml", ".sysml2"];
    } else if (id === "step") {
      extensions = [".step", ".stp", ".p21"];
    } else if (id === "owl2" || id === "owl") {
      extensions = [".owl", ".owl2", ".ofn", ".ttl"];
    } else if (id === "usd") {
      extensions = [".usd", ".usda", ".usdz"];
    } else {
      extensions = [`.${id}`];
    }

    // Never allow .ts (TypeScript) to be hijacked by a domain language
    extensions = extensions.map((ext) => (ext.toLowerCase() === ".ts" ? ".ts2" : ext));

    // Extract comment delimiters
    const lineComment = lang.primitives?.lineComment || "//";
    const blockComment = (lang.primitives?.nestedComment as { open: string; close: string } | undefined) || {
      open: "/*",
      close: "*/",
    };

    return {
      id,
      name: rawName,
      displayName,
      maturity,
      fileExtensions: extensions,
      primaryExtension: extensions[0] || `.${id}`,
      options: lang,
      lineComment,
      blockComment,
      icon: lang.lsp?.icons as NormalizedLanguage["icon"],
    };
  });
}
