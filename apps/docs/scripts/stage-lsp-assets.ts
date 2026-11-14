// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Stages @modelscript/lsp browser worker artifacts and per-language WASM parsers
 * into `docs/public/lsp/server/dist/` so VitePress can lazy-boot the full 93+
 * language LSP & digital-thread verifier on user interaction without bloating the
 * initial landing-page JS bundle.
 */

import fs from "node:fs";
import path from "node:path";

const LANGUAGE_EXTENSIONS_MAP: Record<string, string[]> = {
  adams: [".adm", ".cmd", ".acf"],
  aspen: [".bkp", ".inp", ".apw"],
  autosar: [".arxml"],
  c: [".c", ".h"],
  ccsds: [".oem", ".omm", ".opm", ".ocm", ".tdm", ".ndm"],
  cfd: [".su2", ".cfg"],
  csv: [".csv", ".tsv"],
  easy5: [".ezmf", ".ez5", ".easy5"],
  eclipse: [".data", ".inc", ".grdecl"],
  energyplus: [".idf", ".epJSON"],
  epanet: [".inp", ".net"],
  fea: [".inp", ".bdf", ".dat", ".fem", ".k"],
  fortran: [".f90", ".f95", ".f03", ".f08", ".f", ".for"],
  gensys: [".gen", ".tsimf", ".runf", ".mplotf", ".optif", ".fresf"],
  gtsuite: [".gtm", ".gtp"],
  ibis: [".ibs", ".ebd", ".pkg"],
  jsbsim: [".xml"],
  lps: [".lps", ".lpsx"],
  modelica: [".mo"],
  modelscript: [".msx", ".modelscript"],
  olga: [".genkey", ".key", ".inp"],
  opendrive: [".xodr"],
  opendss: [".dss"],
  openscenario: [".xosc"],
  owl2: [".ofn", ".owl", ".owl2", ".fss", ".ttl"],
  plcopen: [".st", ".iec", ".plcopen"],
  pscad: [".pscx", ".pslx"],
  psse: [".raw", ".dyr", ".seq"],
  relap5: [".i", ".relap"],
  reqif: [".reqif", ".reqifz"],
  rocets: [".roc", ".rocets", ".inp"],
  sbml: [".sbml", ".xml"],
  scad: [".scad"],
  sima: [".sima", ".stask"],
  simpack: [".spck", ".sim", ".sub"],
  simulink: [".slx", ".mdl"],
  spice: [".sp", ".cir", ".net", ".lib", ".sub"],
  ssp: [".ssd", ".ssv", ".ssm", ".ssp"],
  step: [".step", ".stp", ".p21"],
  swmm: [".inp", ".swmm"],
  sysml2: [".sysml", ".kerml", ".sysml2"],
  touchstone: [".s1p", ".s2p", ".s3p", ".s4p", ".snp", ".ts"],
  urdf: [".urdf", ".sdf", ".xacro"],
  "verilog-a": [".va", ".vams"],
};

const docsRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(docsRoot, "../..");
const outDir = path.join(docsRoot, "docs", "public", "lsp", "server", "dist");
const workersOutDir = path.join(outDir, "workers");

fs.mkdirSync(workersOutDir, { recursive: true });

let copiedCount = 0;
let skippedCount = 0;

function copyIfChanged(src: string, dest: string): boolean {
  if (!fs.existsSync(src)) return false;
  const srcStat = fs.statSync(src);
  if (fs.existsSync(dest)) {
    const destStat = fs.statSync(dest);
    if (destStat.size === srcStat.size && srcStat.mtimeMs <= destStat.mtimeMs) {
      skippedCount++;
      return true;
    }
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  copiedCount++;
  return true;
}

copyIfChanged(path.join(repoRoot, "packages/lsp/dist/browserServerMain.js"), path.join(outDir, "browserServerMain.js"));
copyIfChanged(
  path.join(repoRoot, "packages/lsp/dist/workers/indexer.worker.js"),
  path.join(workersOutDir, "indexer.worker.js"),
);
copyIfChanged(path.join(repoRoot, "packages/runtime/build/release.wasm"), path.join(outDir, "release.wasm"));

const languagesRoot = path.join(repoRoot, "languages");
const manifest: { id: string; extensions: string[]; wasm: string }[] = [];

if (fs.existsSync(languagesRoot)) {
  for (const entry of fs.readdirSync(languagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const lang = entry.name;
    const distWasm = path.join(languagesRoot, lang, "dist", "parser.wasm");
    const rootWasm = path.join(languagesRoot, lang, "parser.wasm");
    const wasmSrc = fs.existsSync(distWasm) ? distWasm : fs.existsSync(rootWasm) ? rootWasm : null;
    if (wasmSrc) {
      const wasmFileName = `${lang}.wasm`;
      copyIfChanged(wasmSrc, path.join(outDir, wasmFileName));
      manifest.push({
        id: lang,
        extensions: LANGUAGE_EXTENSIONS_MAP[lang] ?? [`.${lang}`],
        wasm: wasmFileName,
      });

      const distBindings = path.join(languagesRoot, lang, "dist", "src-gen", "bindings.js");
      const srcGenBindings = path.join(languagesRoot, lang, "src-gen", "bindings.js");
      const bindingsSrc = fs.existsSync(distBindings)
        ? distBindings
        : fs.existsSync(srcGenBindings)
          ? srcGenBindings
          : null;
      if (bindingsSrc) {
        copyIfChanged(bindingsSrc, path.join(outDir, `${lang}.bindings.js`));
      }
    }
  }
}

const manifestPath = path.join(outDir, "languages-manifest.json");
const manifestJson = JSON.stringify(manifest, null, 2);
if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, "utf-8") !== manifestJson) {
  fs.writeFileSync(manifestPath, manifestJson, "utf-8");
}
console.log(
  `[stage-lsp-assets] Staged ${manifest.length} language WASM parsers (${copiedCount} updated, ${skippedCount} cached) in ${path.relative(repoRoot, outDir)}`,
);
