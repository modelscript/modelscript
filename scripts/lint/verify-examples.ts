// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Live Verification Gate for Ansatz Built-in Language Examples
 *
 * Validates all on-disk example workspaces under `languages/<slug>/examples/`:
 *   1. Schema & completeness (>= 5 examples per language spanning difficulties 1..5,
 *      descriptive non-generic titles/descriptions, realistic non-trivial content).
 *   2. Dependency & companion-file integrity (verifies includes/imports/redirects/data
 *      references resolve inside `files`, plus mandatory pairs like AMPL .mod+.dat,
 *      COMTRADE .cfg+.dat, SED-ML+.sbml/.cellml, SPARQL+.ttl/.owl, SU2+mesh, NMTRAN+.csv).
 *   3. Live parsing & single-file validation using each language's built package in `dist/`.
 *   4. Live multi-file workspace linting (`lint*Workspace`) across the full `files` map.
 *   5. Live solver/instantiation smoke checks (e.g. AMPL LP/MILP/NLP/script solve,
 *      COMTRADE waveform decode, CPLEX-LP/MPS/GAMS solve).
 *
 * Usage:
 *   npx tsx scripts/lint/verify-examples.ts                         # all 170 languages
 *   npx tsx scripts/lint/verify-examples.ts --lang=ampl,comtrade    # specific languages
 *   npx tsx scripts/lint/verify-examples.ts --allow-missing-dirs    # only langs with examples/
 *   npx tsx scripts/lint/verify-examples.ts --json                  # JSON report
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

export type ExampleDifficulty = 1 | 2 | 3 | 4 | 5;

export interface ExampleVerificationConfig {
  expectZeroErrors?: boolean | undefined;
  allowWarnings?: boolean | undefined;
  runAction?: string | undefined;
  expectedMetrics?:
    | {
        status?: string | undefined;
        minVariables?: number | undefined;
        minEquations?: number | undefined;
        minTimePoints?: number | undefined;
      }
    | undefined;
}

export interface LanguageExampleManifest {
  id: string;
  lang: string;
  subFormats?: string[] | undefined;
  difficulty: ExampleDifficulty;
  title: string;
  description: string;
  category: string;
  tags: string[];
  activeFile: string;
  fileOrder?: string[] | undefined;
  isDefaultStarter?: boolean | undefined;
  verification?: ExampleVerificationConfig | undefined;
}

export interface ExampleCheckResult {
  slug: string;
  folder: string;
  id: string;
  difficulty: number;
  title: string;
  fileCount: number;
  errors: string[];
  warnings: string[];
  solverChecked?: string | undefined;
}

export interface LanguageCheckResult {
  slug: string;
  exampleCount: number;
  difficultiesPresent: number[];
  multiFileCount: number;
  errors: string[];
  warnings: string[];
  examples: ExampleCheckResult[];
}

interface ParsedArgs {
  langs: string[] | null;
  allowMissingDirs: boolean;
  strictCount: boolean;
  json: boolean;
  verbose: boolean;
}

function parseCliArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    langs: null,
    allowMissingDirs: false,
    strictCount: true,
    json: false,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok.startsWith("--lang=")) {
      args.langs = tok
        .slice("--lang=".length)
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (tok === "--lang" && argv[i + 1]) {
      args.langs = argv[++i]!.split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (tok === "--allow-missing-dirs") {
      args.allowMissingDirs = true;
    } else if (tok === "--no-strict-count") {
      args.strictCount = false;
    } else if (tok === "--json") {
      args.json = true;
    } else if (tok === "--verbose" || tok === "-v") {
      args.verbose = true;
    }
  }
  return args;
}

function collectFilesRecursive(
  rootDir: string,
  baseDir = rootDir,
  out: Record<string, string> = {},
): Record<string, string> {
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "example.json") continue;
    const abs = path.join(rootDir, entry.name);
    const rel = path.relative(baseDir, abs).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      collectFilesRecursive(abs, baseDir, out);
    } else if (entry.isFile()) {
      out[rel] = fs.readFileSync(abs, "utf-8");
    }
  }
  return out;
}

function normalizeDiagnostics(res: unknown): { errors: string[]; warnings: string[] } {
  if (!res) return { errors: [], warnings: [] };
  const obj = res as { diagnostics?: unknown[]; errors?: unknown[] };
  const arr: unknown[] = Array.isArray(res)
    ? res
    : Array.isArray(obj.diagnostics)
      ? obj.diagnostics
      : Array.isArray(obj.errors)
        ? obj.errors
        : [];
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const item of arr) {
    if (!item) continue;
    if (typeof item === "string") {
      if (Array.isArray(obj.errors)) errors.push(item);
      continue;
    }
    const d = item as { message?: string; msg?: string; severity?: number | string; code?: string };
    const text = d.message || d.msg || JSON.stringify(d).slice(0, 140);
    const sev = d.severity;
    const isErr = sev === 1 || sev === "error" || sev === "Error" || (sev === undefined && Array.isArray(obj.errors));
    const isWarn = sev === 2 || sev === "warning" || sev === "Warning";
    if (isErr) errors.push(text);
    else if (isWarn) warnings.push(text);
  }
  return { errors, warnings };
}

function resolveRelativePath(fromFile: string, refPath: string): string {
  const cleanRef = refPath.trim().replace(/^["'<>@]+|["'<>@]+$/g, "");
  if (cleanRef.startsWith("/")) return cleanRef.slice(1);
  const fromDir = path.posix.dirname(fromFile);
  if (fromDir === "." || !fromDir) return path.posix.normalize(cleanRef);
  return path.posix.normalize(path.posix.join(fromDir, cleanRef));
}

function hasFileInMap(files: Record<string, string>, fromFile: string, rawRef: string): boolean {
  const clean = rawRef.trim().replace(/^["'<>@]+|["'<>@]+$/g, "");
  if (!clean || /^https?:\/\//i.test(clean) || /^builtin:\/\//i.test(clean) || /^urn:/i.test(clean)) return true;
  const resolved = resolveRelativePath(fromFile, clean);
  const keys = Object.keys(files);
  const lowerKeys = new Set(keys.map((k) => k.toLowerCase()));
  if (lowerKeys.has(clean.toLowerCase()) || lowerKeys.has(resolved.toLowerCase())) return true;
  const base = path.posix.basename(clean).toLowerCase();
  return keys.some((k) => path.posix.basename(k).toLowerCase() === base);
}

/**
 * Checks that every external file dependency referenced in any file exists inside `files`.
 */
function checkDependencies(slug: string, manifest: LanguageExampleManifest, files: Record<string, string>): string[] {
  const errs: string[] = [];
  const fileNames = Object.keys(files);
  const lowerNames = fileNames.map((n) => n.toLowerCase());
  const activeText = files[manifest.activeFile] ?? "";

  // Language-level mandatory companion rules
  if (slug === "ampl") {
    const hasMod = lowerNames.some((n) => n.endsWith(".mod") || n.endsWith(".ampl"));
    const hasDat = lowerNames.some((n) => n.endsWith(".dat"));
    if (!hasMod) errs.push("AMPL example must contain a .mod model file (standalone .dat is invalid).");
    const modEntry = Object.entries(files).find(
      ([n]) => n.toLowerCase().endsWith(".mod") || n.toLowerCase().endsWith(".ampl"),
    );
    if (modEntry) {
      const modText = modEntry[1];
      const hasUnboundSet = /^\s*set\s+[A-Za-z_]\w*\s*;/m.test(modText);
      const hasUnboundParam =
        /^\s*param\s+[A-Za-z_]\w*(?:\s*\{[^}]+\})?(?:\s*(?:>=|<=|=|>|<|integer|binary|symbolic)\s*[^;:]*)?;/m.test(
          modText,
        );
      const hasInlineData = /^\s*data\s*;/m.test(modText);
      if ((hasUnboundSet || hasUnboundParam) && !hasInlineData && !hasDat) {
        errs.push(`AMPL model '${modEntry[0]}' declares uninitialized sets/params without a companion .dat file.`);
      }
    }
  }

  if (slug === "comtrade") {
    const hasCfg = lowerNames.some((n) => n.endsWith(".cfg"));
    const hasDat = lowerNames.some((n) => n.endsWith(".dat"));
    const hasCff = lowerNames.some((n) => n.endsWith(".cff"));
    if (hasCfg && !hasDat && !hasCff) {
      errs.push("COMTRADE .cfg example is missing its companion .dat waveform file.");
    }
  }

  if (slug === "sedml") {
    const hasTargetModel = lowerNames.some((n) => n.endsWith(".sbml") || n.endsWith(".cellml") || n.endsWith(".xml"));
    if (!hasTargetModel) {
      errs.push("SED-ML example is missing its referenced .sbml or .cellml target model file.");
    }
  }

  if (slug === "sparql") {
    const hasDataset = lowerNames.some(
      (n) => n.endsWith(".ttl") || n.endsWith(".owl") || n.endsWith(".ofn") || n.endsWith(".rdf"),
    );
    if (!hasDataset) {
      errs.push("SPARQL example is missing a companion RDF/OWL (.ttl, .owl, .ofn, .rdf) dataset file.");
    }
  }

  if (slug === "cfd" && /MESH_FILENAME\s*=\s*([^\s;#]+)/i.test(activeText)) {
    const m = activeText.match(/MESH_FILENAME\s*=\s*([^\s;#]+)/i);
    if (m?.[1] && !hasFileInMap(files, manifest.activeFile, m[1])) {
      errs.push(`SU2 CFD config references MESH_FILENAME='${m[1]}' which is missing from example files.`);
    }
  }

  // Generic per-file reference checks
  for (const [fname, content] of Object.entries(files)) {
    const lowerF = fname.toLowerCase();
    // #include "..." (skip system headers <...>)
    for (const m of content.matchAll(/^\s*#include\s+"([^"]+)"/gm)) {
      if (m[1] && !hasFileInMap(files, fname, m[1])) {
        errs.push(`${fname}: missing #include "${m[1]}"`);
      }
    }
    // Verilog-A / Verilog `include "..."
    for (const m of content.matchAll(/^\s*`include\s+"([^"]+)"/gm)) {
      if (m[1] && !hasFileInMap(files, fname, m[1])) {
        errs.push(`${fname}: missing \`include "${m[1]}"`);
      }
    }
    // OpenSCAD use <...> / include <...>
    if (lowerF.endsWith(".scad")) {
      for (const m of content.matchAll(/^\s*(?:use|include)\s*<([^>]+)>/gm)) {
        if (m[1] && !hasFileInMap(files, fname, m[1])) {
          errs.push(`${fname}: missing OpenSCAD include/use <${m[1]}>`);
        }
      }
    }
    // Atopile from "..." import ...
    if (lowerF.endsWith(".ato")) {
      for (const m of content.matchAll(/^\s*from\s+"([^"]+)"\s+import\s+/gm)) {
        if (m[1] && !hasFileInMap(files, fname, m[1])) {
          errs.push(`${fname}: missing atopile import "${m[1]}"`);
        }
      }
    }
    // Antimony import "..."
    if (lowerF.endsWith(".ant") || lowerF.endsWith(".antimony")) {
      for (const m of content.matchAll(/^\s*import\s+"([^"]+)"/gm)) {
        if (m[1] && !hasFileInMap(files, fname, m[1])) {
          errs.push(`${fname}: missing antimony import "${m[1]}"`);
        }
      }
    }
    // SPICE .include / .lib
    if (lowerF.endsWith(".sp") || lowerF.endsWith(".cir") || lowerF.endsWith(".net")) {
      for (const m of content.matchAll(/^\s*\.(?:include|inc|lib)\s+["']?([^\s"']+)["']?/gim)) {
        if (m[1] && !hasFileInMap(files, fname, m[1])) {
          errs.push(`${fname}: missing SPICE .include/.lib '${m[1]}'`);
        }
      }
    }
    // OpenDSS Redirect / Compile
    if (lowerF.endsWith(".dss")) {
      for (const m of content.matchAll(/^\s*(?:Redirect|Compile)\s+["']?([^\s"']+)["']?/gim)) {
        if (m[1] && !hasFileInMap(files, fname, m[1])) {
          errs.push(`${fname}: missing OpenDSS Redirect/Compile '${m[1]}'`);
        }
      }
    }
    // FEA / LS-DYNA *INCLUDE
    if (lowerF.endsWith(".inp") || lowerF.endsWith(".k")) {
      for (const m of content.matchAll(/^\s*\*INCLUDE\s*,\s*INPUT\s*=\s*([^\s,]+)/gim)) {
        if (m[1] && !hasFileInMap(files, fname, m[1])) {
          errs.push(`${fname}: missing *INCLUDE INPUT='${m[1]}'`);
        }
      }
    }
    // OBJ mtllib
    if (lowerF.endsWith(".obj")) {
      for (const m of content.matchAll(/^\s*mtllib\s+(\S+)/gm)) {
        if (m[1] && !hasFileInMap(files, fname, m[1])) {
          errs.push(`${fname}: missing OBJ mtllib '${m[1]}'`);
        }
      }
    }
    // NMTRAN $DATA
    if (lowerF.endsWith(".ctl") || (slug === "nmtran" && lowerF.endsWith(".mod"))) {
      for (const m of content.matchAll(/\$DATA\s+([^\s;]+)/gi)) {
        if (m[1] && !hasFileInMap(files, fname, m[1])) {
          errs.push(`${fname}: missing NMTRAN $DATA '${m[1]}'`);
        }
      }
    }
    // TOPAS includeFile = ...
    if (lowerF.endsWith(".topas") || lowerF.endsWith(".tps")) {
      for (const m of content.matchAll(/^\s*includeFile\s*=\s*([^\s#]+)/gm)) {
        if (m[1] && !hasFileInMap(files, fname, m[1])) {
          errs.push(`${fname}: missing TOPAS includeFile '${m[1]}'`);
        }
      }
    }
    // OpenSCENARIO LogicFile filepath="..."
    if (lowerF.endsWith(".xosc")) {
      for (const m of content.matchAll(/LogicFile\s+filepath\s*=\s*["']([^"']+)["']/gi)) {
        if (m[1] && !hasFileInMap(files, fname, m[1])) {
          errs.push(`${fname}: missing OpenSCENARIO LogicFile '${m[1]}'`);
        }
      }
    }
    // USD subLayers / references = @...@
    if (lowerF.endsWith(".usda")) {
      for (const m of content.matchAll(/@([^@]+\.usd[ac]?)@/gi)) {
        if (m[1] && !hasFileInMap(files, fname, m[1])) {
          errs.push(`${fname}: missing USD layer/asset '@${m[1]}@'`);
        }
      }
    }
    // SED-ML model source="..."
    if (lowerF.endsWith(".sedml")) {
      for (const m of content.matchAll(/<model\b[^>]*\bsource\s*=\s*["']([^"'#]+)["']/gi)) {
        if (m[1] && /\.[a-z0-9]+$/i.test(m[1]) && !hasFileInMap(files, fname, m[1])) {
          errs.push(`${fname}: missing SED-ML model source '${m[1]}'`);
        }
      }
    }
    // CellML <import xlink:href="...">
    if (lowerF.endsWith(".cellml")) {
      for (const m of content.matchAll(/xlink:href\s*=\s*["']([^"']+)["']/gi)) {
        if (m[1] && !hasFileInMap(files, fname, m[1])) {
          errs.push(`${fname}: missing CellML import '${m[1]}'`);
        }
      }
    }
    // GAMS $include
    if (lowerF.endsWith(".gms")) {
      for (const m of content.matchAll(/^\s*\$include\s+["']?([^\s"']+)["']?/gim)) {
        if (m[1] && !hasFileInMap(files, fname, m[1])) {
          errs.push(`${fname}: missing GAMS $include '${m[1]}'`);
        }
      }
    }
    // ATP $INCLUDE
    if (lowerF.endsWith(".atp")) {
      for (const m of content.matchAll(/^\s*\$INCLUDE\s*,?\s*([^\s,]+)/gim)) {
        if (m[1] && !hasFileInMap(files, fname, m[1])) {
          errs.push(`${fname}: missing ATP $INCLUDE '${m[1]}'`);
        }
      }
    }
    // URDF <mesh filename="...">
    if (lowerF.endsWith(".urdf") || lowerF.endsWith(".xacro")) {
      for (const m of content.matchAll(/<mesh\b[^>]*\bfilename\s*=\s*["']([^"']+)["']/gi)) {
        const ref = m[1]!.replace(/^package:\/\/[^/]+\//, "");
        if (ref && !hasFileInMap(files, fname, ref)) {
          errs.push(`${fname}: missing URDF mesh '${m[1]}'`);
        }
      }
    }
  }

  return errs;
}

const moduleCache = new Map<string, Record<string, unknown> | null>();

async function loadLanguageModule(slug: string): Promise<Record<string, unknown> | null> {
  if (moduleCache.has(slug)) return moduleCache.get(slug)!;
  const pkgPath = path.join(REPO_ROOT, "languages", slug, "package.json");
  if (!fs.existsSync(pkgPath)) {
    moduleCache.set(slug, null);
    return null;
  }
  const pkgJson = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
    main?: string;
    exports?: Record<string, string | { import?: string; default?: string }>;
  };
  const expDot = pkgJson.exports?.["."];
  const relEntry =
    (typeof expDot === "string" ? expDot : expDot?.import || expDot?.default) || pkgJson.main || "dist/src/index.js";
  const absEntry = path.join(REPO_ROOT, "languages", slug, relEntry);
  try {
    const mod = (await import(pathToFileURL(absEntry).href)) as Record<string, unknown>;
    moduleCache.set(slug, mod);
    return mod;
  } catch {
    moduleCache.set(slug, null);
    return null;
  }
}

function discoverLanguageFns(mod: Record<string, unknown>, slug: string) {
  const keys = Object.keys(mod);
  const slugNorm = slug.replace(/[^a-z0-9]/gi, "").toLowerCase();

  const validateFns = keys
    .filter(
      (k) =>
        typeof mod[k] === "function" && /^validate[A-Z]|^get.*Diagnostics$|^lint[A-Z]/.test(k) && !/Workspace$/.test(k),
    )
    .sort((a, b) => {
      const aExact =
        a.toLowerCase().includes(slugNorm) && a.startsWith("validate")
          ? 0
          : a.startsWith("validate")
            ? 1
            : a.startsWith("get")
              ? 2
              : 3;
      const bExact =
        b.toLowerCase().includes(slugNorm) && b.startsWith("validate")
          ? 0
          : b.startsWith("validate")
            ? 1
            : b.startsWith("get")
              ? 2
              : 3;
      return aExact - bExact;
    });

  const parseFns = keys
    .filter(
      (k) =>
        typeof mod[k] === "function" &&
        /^parse[A-Z]/.test(k) &&
        !/Table|Expr|Header|Line|Card|Record|Row|Block|Section|Chunk|Node|Token|Url|Uri|Coord|Date|Time|Unit|Snapshot|EquationsForVariablesCounts|OpenRoadmTopology|PowerFactoryAscii|AmplData/i.test(
          k,
        ),
    )
    .sort((a, b) => {
      const aScore = a.toLowerCase() === `parse${slugNorm}` ? 0 : a.toLowerCase().includes(slugNorm) ? 1 : 2;
      const bScore = b.toLowerCase() === `parse${slugNorm}` ? 0 : b.toLowerCase().includes(slugNorm) ? 1 : 2;
      return aScore - bScore;
    });

  const workspaceLintFns = keys.filter((k) => typeof mod[k] === "function" && /lint\w*Workspace$/.test(k));
  return { validateFns, parseFns, workspaceLintFns };
}

async function runLiveValidation(
  slug: string,
  manifest: LanguageExampleManifest,
  files: Record<string, string>,
): Promise<{ errors: string[]; warnings: string[]; solverChecked?: string | undefined }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let solverChecked: string | undefined;

  const mod = await loadLanguageModule(slug);
  if (!mod) {
    errors.push(`Could not import built package @modelscript/${slug} (dist entry missing or failed).`);
    return { errors, warnings };
  }

  const activeText = files[manifest.activeFile] ?? "";
  const fns = discoverLanguageFns(mod, slug);

  // ── Language-specific multi-file & solver verification ──────────────────
  if (slug === "ampl") {
    const parseAmplModel = mod["parseAmplModel"] as ((s: string) => unknown) | undefined;
    const parseAmplData = mod["parseAmplData"] as ((s: string) => unknown) | undefined;
    const lintAmpl = mod["lintAmpl"] as ((m: unknown, d?: unknown) => unknown) | undefined;
    const instantiateAmpl = mod["instantiateAmpl"] as
      ((m: unknown, d?: unknown) => { variables?: unknown[]; constraints?: unknown[] }) | undefined;
    const solveAmpl = mod["solveAmpl"] as
      ((p: unknown) => Promise<{ status?: string; objectiveValue?: number | null; error?: string }>) | undefined;
    const runAmplScript = mod["runAmplScript"] as
      | ((
          s: string,
          opts?: { virtualFiles?: Record<string, string> },
        ) => Promise<{
          lastSolveResult?: { status?: string; objectiveValue?: number | null };
          solveResults?: Array<{ status?: string }>;
          errors?: unknown[];
        }>)
      | undefined;

    const modEntry = Object.entries(files).find(
      ([k]) => k.toLowerCase().endsWith(".mod") || k.toLowerCase().endsWith(".ampl"),
    );
    const datChunks = Object.entries(files)
      .filter(([k]) => k.toLowerCase().endsWith(".dat"))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);
    const runEntry = Object.entries(files).find(([k]) => k.toLowerCase().endsWith(".run"));

    if (modEntry && parseAmplModel && instantiateAmpl && solveAmpl) {
      try {
        const model = parseAmplModel(modEntry[1]);
        const data = datChunks.length > 0 && parseAmplData ? parseAmplData(datChunks.join("\n\n")) : undefined;
        if (lintAmpl) {
          const norm = normalizeDiagnostics(lintAmpl(model, data));
          errors.push(...norm.errors.map((m) => `[lintAmpl] ${m}`));
          warnings.push(...norm.warnings.map((m) => `[lintAmpl] ${m}`));
        }
        const prob = instantiateAmpl(model, data);
        if (!prob || !prob.variables || prob.variables.length === 0) {
          errors.push("AMPL instantiateAmpl produced 0 variables.");
        } else {
          const sol = await solveAmpl(prob);
          if (!sol || sol.error || (sol.status && !/optimal|feasible|solved/i.test(sol.status))) {
            errors.push(
              `AMPL solveAmpl did not converge cleanly (status=${sol?.status ?? "null"}, error=${sol?.error ?? "none"}).`,
            );
          } else {
            solverChecked = `ampl_solve:${sol.status}(obj=${sol.objectiveValue ?? "n/a"},vars=${prob.variables.length})`;
          }
        }
      } catch (e) {
        errors.push(`[ampl THROW] ${String((e as Error)?.message ?? e).slice(0, 180)}`);
      }
    }
    if (runEntry && runAmplScript) {
      try {
        const res = await runAmplScript(runEntry[1], { virtualFiles: files });
        if (Array.isArray(res?.errors) && res.errors.length > 0) {
          errors.push(`[runAmplScript] ${String(res.errors[0]).slice(0, 140)}`);
        } else {
          solverChecked = `${solverChecked ? solverChecked + "+" : ""}ampl_run:ok`;
        }
      } catch (e) {
        errors.push(`[runAmplScript THROW] ${String((e as Error)?.message ?? e).slice(0, 180)}`);
      }
    }
  } else if (slug === "comtrade") {
    const parseComtrade = mod["parseComtrade"] as
      ((cfg: string, dat: Uint8Array | string) => { samples?: unknown[]; analogChannels?: unknown[] }) | undefined;
    const parseComtradeCff = mod["parseComtradeCff"] as ((cff: string) => unknown) | undefined;
    const cfgEntry = Object.entries(files).find(([k]) => k.toLowerCase().endsWith(".cfg"));
    const datEntry = Object.entries(files).find(([k]) => k.toLowerCase().endsWith(".dat"));
    const cffEntry = Object.entries(files).find(([k]) => k.toLowerCase().endsWith(".cff"));
    if (cfgEntry && datEntry && parseComtrade) {
      try {
        const rec = parseComtrade(cfgEntry[1], new TextEncoder().encode(datEntry[1]));
        if (!rec) errors.push("parseComtrade returned empty record.");
        else solverChecked = `comtrade_decode:ok`;
      } catch (e) {
        errors.push(`[parseComtrade THROW] ${String((e as Error)?.message ?? e).slice(0, 180)}`);
      }
    } else if (cffEntry && parseComtradeCff) {
      try {
        const rec = parseComtradeCff(cffEntry[1]);
        if (!rec) errors.push("parseComtradeCff returned empty record.");
        else solverChecked = `comtrade_cff:ok`;
      } catch (e) {
        errors.push(`[parseComtradeCff THROW] ${String((e as Error)?.message ?? e).slice(0, 180)}`);
      }
    }
  } else {
    // Generic single-file validator + parser execution
    let ranValidate = false;
    for (const vfn of fns.validateFns.slice(0, 2)) {
      if (vfn.startsWith("lint")) continue;
      try {
        const fn = mod[vfn] as (input: string) => Promise<unknown> | unknown;
        const res = await fn(activeText);
        const norm = normalizeDiagnostics(res);
        errors.push(...norm.errors.map((m) => `[${vfn}] ${m}`));
        warnings.push(...norm.warnings.map((m) => `[${vfn}] ${m}`));
        ranValidate = true;
        break;
      } catch {
        // Function may take a parsed AST object rather than raw text
      }
    }

    let parsedObj: unknown = null;
    const primaryParse = fns.parseFns[0];
    if (primaryParse && slug !== "optical" && slug !== "modelica") {
      try {
        const pfn = mod[primaryParse] as (input: string) => Promise<unknown> | unknown;
        const res = await pfn(activeText);
        parsedObj = res;
        if (res === null || res === undefined) {
          errors.push(`[${primaryParse}] returned null/undefined`);
        } else if (typeof res === "object") {
          const rObj = res as { errors?: unknown[]; diagnostics?: unknown[] };
          if (Array.isArray(rObj.errors) && rObj.errors.length > 0) {
            errors.push(
              ...rObj.errors.map(
                (e) =>
                  `[${primaryParse}.errors] ${typeof e === "string" ? e : ((e as { message?: string })?.message ?? JSON.stringify(e).slice(0, 120))}`,
              ),
            );
          }
          if (Array.isArray(rObj.diagnostics) && rObj.diagnostics.length > 0) {
            const norm = normalizeDiagnostics(rObj.diagnostics);
            errors.push(...norm.errors.map((m) => `[${primaryParse}.diag] ${m}`));
            warnings.push(...norm.warnings.map((m) => `[${primaryParse}.diag] ${m}`));
          }
        }
      } catch (e) {
        errors.push(`[${primaryParse} THROW] ${String((e as Error)?.message ?? e).slice(0, 180)}`);
      }
    }

    if (!ranValidate) {
      const lintFnName = fns.validateFns.find((f) => f.startsWith("lint"));
      if (lintFnName) {
        const lfn = mod[lintFnName] as (arg: unknown) => Promise<unknown> | unknown;
        try {
          const res = await lfn(parsedObj && typeof parsedObj === "object" ? parsedObj : activeText);
          const norm = normalizeDiagnostics(res);
          errors.push(...norm.errors.map((m) => `[${lintFnName}] ${m}`));
          warnings.push(...norm.warnings.map((m) => `[${lintFnName}] ${m}`));
        } catch {
          try {
            const res = await lfn(activeText);
            const norm = normalizeDiagnostics(res);
            errors.push(...norm.errors.map((m) => `[${lintFnName}] ${m}`));
            warnings.push(...norm.warnings.map((m) => `[${lintFnName}] ${m}`));
          } catch {
            // ignore incompatible lint signature
          }
        }
      }
    }

    // Special solver smoke checks for optimization formats
    if (slug === "cplex-lp" && typeof mod["parseCplexLp"] === "function" && typeof mod["solveCplexLp"] === "function") {
      try {
        const lp = (mod["parseCplexLp"] as (s: string) => unknown)(activeText);
        const sol = await (mod["solveCplexLp"] as (p: unknown) => Promise<{ status?: string }>)(lp);
        if (sol?.status && !/optimal|feasible/i.test(sol.status)) {
          errors.push(`solveCplexLp returned status='${sol.status}'`);
        } else {
          solverChecked = `cplex-lp:${sol?.status ?? "ok"}`;
        }
      } catch (e) {
        errors.push(`[solveCplexLp THROW] ${String((e as Error)?.message ?? e).slice(0, 140)}`);
      }
    }
    if (slug === "gams" && typeof mod["solveGams"] === "function") {
      try {
        const sol = await (mod["solveGams"] as (s: string) => Promise<{ status?: string }>)(activeText);
        if (sol?.status) solverChecked = `gams:${sol.status}`;
      } catch {
        // Multi-file $include gams may require expanded text
      }
    }
  }

  // ── Multi-file Workspace Linter Gate ────────────────────────────────────
  if (fns.workspaceLintFns.length > 0 && slug !== "modelica") {
    const wsFnName = fns.workspaceLintFns[0]!;
    const wsFn = mod[wsFnName] as (docs: Array<{ uri: string; text: string }>) => Promise<unknown> | unknown;
    try {
      const docs = Object.entries(files).map(([rel, text]) => ({
        uri: `file:///workspace/${rel}`,
        text,
      }));
      const wsRes = await wsFn(docs);
      const norm = normalizeDiagnostics(wsRes);
      errors.push(...norm.errors.map((m) => `[${wsFnName}] ${m}`));
      warnings.push(...norm.warnings.map((m) => `[${wsFnName}] ${m}`));
    } catch {
      // Some workspace linters expect Map or Record
      try {
        const docMap = new Map<string, string>(
          Object.entries(files).map(([rel, text]) => [`file:///workspace/${rel}`, text]),
        );
        const wsRes = await (wsFn as unknown as (d: Map<string, string>) => Promise<unknown> | unknown)(docMap);
        const norm = normalizeDiagnostics(wsRes);
        errors.push(...norm.errors.map((m) => `[${wsFnName}] ${m}`));
        warnings.push(...norm.warnings.map((m) => `[${wsFnName}] ${m}`));
      } catch {
        // ignore signature mismatch
      }
    }
  }

  return {
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    solverChecked,
  };
}

export async function verifyLanguageExamples(
  slug: string,
  seenIds: Set<string>,
  options: { strictCount: boolean },
): Promise<LanguageCheckResult> {
  const examplesDir = path.join(REPO_ROOT, "languages", slug, "examples");
  const result: LanguageCheckResult = {
    slug,
    exampleCount: 0,
    difficultiesPresent: [],
    multiFileCount: 0,
    errors: [],
    warnings: [],
    examples: [],
  };

  if (!fs.existsSync(examplesDir)) {
    result.errors.push(`Missing examples directory: languages/${slug}/examples`);
    return result;
  }

  const folders = fs
    .readdirSync(examplesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();

  const difficulties = new Set<number>();

  for (const folder of folders) {
    const folderPath = path.join(examplesDir, folder);
    const manifestPath = path.join(folderPath, "example.json");
    const exRes: ExampleCheckResult = {
      slug,
      folder,
      id: `${slug}/${folder}`,
      difficulty: 0,
      title: "",
      fileCount: 0,
      errors: [],
      warnings: [],
    };

    if (!fs.existsSync(manifestPath)) {
      exRes.errors.push(`Missing example.json in languages/${slug}/examples/${folder}`);
      result.examples.push(exRes);
      continue;
    }

    let manifest: LanguageExampleManifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as LanguageExampleManifest;
    } catch (e) {
      exRes.errors.push(`Invalid JSON in example.json: ${String((e as Error)?.message ?? e)}`);
      result.examples.push(exRes);
      continue;
    }

    exRes.id = manifest.id || exRes.id;
    exRes.difficulty = manifest.difficulty || 0;
    exRes.title = manifest.title || "";

    // 1. Schema & Metadata checks
    if (!manifest.id || typeof manifest.id !== "string") exRes.errors.push("Missing string 'id'.");
    else if (seenIds.has(manifest.id)) exRes.errors.push(`Duplicate example id '${manifest.id}'.`);
    else seenIds.add(manifest.id);

    if (manifest.lang !== slug)
      exRes.errors.push(`Manifest lang '${manifest.lang}' does not match directory '${slug}'.`);
    if (![1, 2, 3, 4, 5].includes(manifest.difficulty)) {
      exRes.errors.push(`Invalid difficulty '${manifest.difficulty}'; expected integer 1..5.`);
    } else {
      difficulties.add(manifest.difficulty);
    }
    if (!manifest.title || manifest.title.trim().length < 4) {
      exRes.errors.push("Missing or overly short 'title'.");
    } else if (/example\s+\d+$/i.test(manifest.title.trim())) {
      exRes.errors.push(`Generic placeholder title '${manifest.title}' is not allowed.`);
    }
    if (!manifest.description || manifest.description.trim().length < 25) {
      exRes.errors.push("Description must be at least 25 characters explaining the engineering scenario.");
    } else if (/starter model$/i.test(manifest.description.trim())) {
      exRes.errors.push(`Generic placeholder description '${manifest.description}' is not allowed.`);
    }
    if (!Array.isArray(manifest.tags) || manifest.tags.length < 2) {
      exRes.errors.push("At least 2 descriptive tags are required.");
    }

    const files = collectFilesRecursive(folderPath);
    const fileKeys = Object.keys(files);
    exRes.fileCount = fileKeys.length;
    if (fileKeys.length > 1) result.multiFileCount++;

    if (!manifest.activeFile || !(manifest.activeFile in files)) {
      exRes.errors.push(`activeFile '${manifest.activeFile}' not found in folder files [${fileKeys.join(", ")}].`);
    } else {
      const primary = files[manifest.activeFile]!;
      const lineCount = primary.split("\n").filter((l) => l.trim().length > 0).length;
      if (primary.trim().length === 0) {
        exRes.errors.push(`activeFile '${manifest.activeFile}' is empty.`);
      } else if (lineCount < 4 && primary.trim().length < 140) {
        exRes.errors.push(
          `activeFile '${manifest.activeFile}' is too trivial (${lineCount} non-empty lines, ${primary.length} bytes).`,
        );
      }
      if (/\b(BAD_BUS|RATE TURBO|NOTHEX|UNKNOWN_DIRECTIVE|FOOBAR|pMismatch|pBadChar|BADTEMP|BAD_IED)\b/.test(primary)) {
        exRes.errors.push("Detected negative unit-test fixture marker inside example code.");
      }
    }

    // 2. Dependency Integrity Check
    if (manifest.activeFile && manifest.activeFile in files) {
      exRes.errors.push(...checkDependencies(slug, manifest, files));

      // 3-5. Live Parser, Linter, Workspace Linter & Solver Verification
      const live = await runLiveValidation(slug, manifest, files);
      exRes.errors.push(...live.errors);
      exRes.solverChecked = live.solverChecked;
      if (manifest.verification?.allowWarnings) {
        exRes.warnings.push(...live.warnings);
      } else if (live.warnings.length > 0) {
        exRes.errors.push(...live.warnings.map((w) => `[WARNING->STRICT] ${w}`));
      }
    }

    result.examples.push(exRes);
  }

  result.exampleCount = result.examples.length;
  result.difficultiesPresent = [...difficulties].sort((a, b) => a - b);

  if (options.strictCount) {
    if (result.exampleCount < 5) {
      result.errors.push(`Expected >= 5 examples for '${slug}', found ${result.exampleCount}.`);
    }
    for (const d of [1, 2, 3, 4, 5]) {
      if (!difficulties.has(d)) {
        result.errors.push(`Missing difficulty level L${d} example for '${slug}'.`);
      }
    }
  }

  return result;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const allLangs = fs
    .readdirSync(path.join(REPO_ROOT, "languages"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(REPO_ROOT, "languages", d.name, "package.json")))
    .map((d) => d.name)
    .sort();

  let targetLangs = args.langs ? allLangs.filter((l) => args.langs!.includes(l)) : allLangs;
  if (args.allowMissingDirs && !args.langs) {
    targetLangs = targetLangs.filter((l) => fs.existsSync(path.join(REPO_ROOT, "languages", l, "examples")));
  }

  const seenIds = new Set<string>();
  const results: LanguageCheckResult[] = [];
  let totalExamples = 0;
  let totalMultiFile = 0;
  let failedLangs = 0;
  let failedExamples = 0;

  for (const slug of targetLangs) {
    const res = await verifyLanguageExamples(slug, seenIds, { strictCount: args.strictCount });
    results.push(res);
    totalExamples += res.exampleCount;
    totalMultiFile += res.multiFileCount;
    const exFailures = res.examples.filter((e) => e.errors.length > 0);
    failedExamples += exFailures.length;
    if (res.errors.length > 0 || exFailures.length > 0) {
      failedLangs++;
    }
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          targetLanguages: targetLangs.length,
          totalExamples,
          totalMultiFile,
          failedLangs,
          failedExamples,
          results,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `\n=== verify-examples: ${targetLangs.length} language(s), ${totalExamples} example(s) (${totalMultiFile} multi-file) ===`,
    );
    for (const r of results) {
      const exFails = r.examples.filter((e) => e.errors.length > 0);
      const ok = r.errors.length === 0 && exFails.length === 0;
      if (!ok || args.verbose) {
        const icon = ok ? "PASS" : "FAIL";
        console.log(
          `[${icon}] ${r.slug} (${r.exampleCount} examples, ${r.multiFileCount} multi-file, levels=[${r.difficultiesPresent.join(",")}])`,
        );
        for (const err of r.errors) console.log(`  - [LANG] ${err}`);
        for (const e of r.examples) {
          if (e.errors.length > 0 || args.verbose) {
            const solverTag = e.solverChecked ? ` (${e.solverChecked})` : "";
            console.log(
              `  - [${e.errors.length === 0 ? "OK" : "ERR"}] L${e.difficulty} ${e.folder} (${e.fileCount}f)${solverTag}`,
            );
            for (const err of e.errors) console.log(`      * ${err}`);
          }
        }
      }
    }
    console.log(
      `\nSummary: ${targetLangs.length - failedLangs}/${targetLangs.length} languages PASS | ${totalExamples - failedExamples}/${totalExamples} examples PASS`,
    );
  }

  if (failedLangs > 0 || failedExamples > 0) {
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
