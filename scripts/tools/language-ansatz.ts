// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Lightweight Single-Language Dev Ansatz
 *
 * Launches a fast, isolated Vite dev server for ONE language package in
 * `languages/<lang>/` so developers can test the grammar, WASM CST parser,
 * single-language LSP diagnostics/actions, stencils, `ui.panels`, and
 * `ui.simulationCards` across all 3 host modes (VS Code workbench / Ansatz
 * inspector / Ansatz artifact) with instant HMR — without rebuilding the
 * other 92 languages, `apps/web`, or `packages/ide`.
 *
 * Usage:
 *   npm run ansatz -- olga
 *   npm run ansatz -- psse --file languages/psse/testsuite/ieee14.raw
 *   npm run ansatz -- fea --mode inspector --theme light --port 5180
 *   npm run ansatz --workspace=@modelscript/olga
 */

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLogger, createServer, type Plugin, type PluginOption } from "vite";
import { generateTextMate } from "../../packages/dsl/src/codegen/parser/textmate.js";
import {
  discoverSingleLanguage,
  type DiscoveredSingleLanguageResult,
} from "../../packages/ide-packager/src/language-discovery.js";
import { buildLanguagePluginFromModule, createLspRuntime, type LspRuntime } from "../../packages/lsp/src/core/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const ANSATZ_ROOT = path.resolve(__dirname, "../editor");

export interface AnsatzCliArgs {
  target: string | null;
  port: number;
  host: string;
  file: string | null;
  mode: "workbench" | "inspector" | "artifact";
  theme: "dark" | "light";
  open: boolean;
  ansatz: boolean;
}

interface SampleFileEntry {
  label: string;
  path: string;
  absPath: string;
}

function parseCliArgs(argv: string[]): AnsatzCliArgs {
  const args: AnsatzCliArgs = {
    target: null,
    port: 5179,
    host: "127.0.0.1",
    file: null,
    mode: "workbench",
    theme: "dark",
    open: false,
    ansatz: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok === "--help" || tok === "-h") {
      printUsage();
      process.exit(0);
    } else if (tok === "--lang" || tok === "-l") {
      args.target = argv[++i] ?? null;
    } else if (tok === "--port" || tok === "-p") {
      const parsed = Number(argv[++i]);
      if (Number.isFinite(parsed) && parsed > 0) args.port = parsed;
    } else if (tok === "--host") {
      args.host = argv[++i] ?? args.host;
    } else if (tok === "--file" || tok === "-f") {
      args.file = argv[++i] ?? null;
    } else if (tok === "--mode" || tok === "-m") {
      const m = argv[++i];
      if (m === "workbench" || m === "inspector" || m === "artifact") args.mode = m;
    } else if (tok === "--theme" || tok === "-t") {
      const t = argv[++i];
      if (t === "dark" || t === "light") args.theme = t;
    } else if (tok === "--open") {
      args.open = true;
    } else if (tok === "--ansatz") {
      args.ansatz = true;
    } else if (!tok.startsWith("-") && !args.target) {
      args.target = tok;
    }
  }

  return args;
}

function printUsage(): void {
  console.log(`ModelScript Lightweight Language Ansatz

Usage:
  npm run ansatz -- <language|path> [options]

Examples:
  npm run ansatz -- olga
  npm run ansatz -- modelica --ansatz
  npm run ansatz -- psse --file languages/psse/testsuite/ieee14.raw
  npm run ansatz -- fea --mode inspector --theme light
  npm run ansatz -- epanet --port 5180

Options:
  --port, -p <num>                           Dev server port (default: 5179)
  --host <addr>                              Bind host (default: 127.0.0.1)
  --file, -f <path>                          Initial source file to load
  --mode, -m <workbench|inspector|artifact>  Initial host mode (default: workbench)
  --theme, -t <dark|light>                   Initial color theme (default: dark)
  --ansatz                                   Launch full Ansatz web editor locked to this single language
  --open                                     Open browser automatically
  --help, -h                                 Show this help
`);
}

function resolveLanguageDir(target: string | null): string {
  if (!target) {
    const cwdPkg = path.join(process.cwd(), "package.json");
    const languagesRoot = path.join(REPO_ROOT, "languages");
    if (process.cwd().startsWith(languagesRoot + path.sep) && fs.existsSync(cwdPkg)) {
      return process.cwd();
    }
    console.error("Error: Please specify a language name (e.g. `npm run ansatz -- olga`).");
    printUsage();
    process.exit(1);
  }

  const candidates = [
    path.resolve(process.cwd(), target),
    path.join(REPO_ROOT, "languages", target),
    path.resolve(REPO_ROOT, target),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }

  console.error(`Error: Could not find language package for '${target}'.`);
  console.error(`Checked:\n${candidates.map((c) => `  - ${c}`).join("\n")}`);
  process.exit(1);
}

function discoverSampleFiles(langDir: string, extensions: string[]): SampleFileEntry[] {
  const extSet = new Set(extensions.map((e) => e.toLowerCase()));
  const roots = ["examples", "testsuite", "tests"];
  const results: SampleFileEntry[] = [];
  const MAX_SAMPLES = 50;

  function walk(dir: string, depth: number): void {
    if (depth > 4 || results.length >= MAX_SAMPLES || !fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (results.length >= MAX_SAMPLES) return;
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (extSet.has(ext)) {
          const rel = path.relative(langDir, full).replace(/\\/g, "/");
          results.push({ label: rel, path: rel, absPath: full });
        }
      }
    }
  }

  for (const r of roots) {
    walk(path.join(langDir, r), 0);
  }
  return results;
}

const DEFAULT_STARTER_SNIPPETS: Record<string, string> = {
  olga: `CASE TITLE="Subsea Tieback Multiphase Flow"
INTEGRATION STARTTIME=0 s, ENDTIME=3600 s, MINDT=0.5 s, MAXDT=5 s
NODE LABEL=WELLHEAD, TYPE=TERMINAL, PRESSURE=85 bar, TEMPERATURE=65 C
NODE LABEL=RISER_BASE, TYPE=INTERNAL
NODE LABEL=TOPSIDE, TYPE=TERMINAL, PRESSURE=25 bar, TEMPERATURE=20 C
BRANCH LABEL=FLOWLINE, FROM=WELLHEAD, TO=RISER_BASE, DIAMETER=0.254 m, LENGTH=4500 m, ELEVATION=-120 m, NSEGMENTS=20
BRANCH LABEL=RISER, FROM=RISER_BASE, TO=TOPSIDE, DIAMETER=0.254 m, LENGTH=180 m, ELEVATION=150 m, NSEGMENTS=10
SOURCE LABEL=INLET_SRC, BRANCH=FLOWLINE, MASSFLOW=35 kg/s, TEMPERATURE=65 C, GASFRACTION=0.18
`,
  fea: `*HEADING
Cantilever Beam Benchmark (2D Quad Mesh)
*NODE
1, 0.0, 0.0, 0.0
2, 1.0, 0.0, 0.0
3, 2.0, 0.0, 0.0
4, 0.0, 0.5, 0.0
5, 1.0, 0.5, 0.0
6, 2.0, 0.5, 0.0
*ELEMENT, TYPE=CPS4, ELSET=BEAM
1, 1, 2, 5, 4
2, 2, 3, 6, 5
*MATERIAL, NAME=STEEL_A36
*ELASTIC
210000.0, 0.3
*DENSITY
7.85e-9
*BOUNDARY
1, 1, 2, 0.0
4, 1, 2, 0.0
*STEP, NAME=STATIC_BENDING
*STATIC
*CLOAD
3, 2, -1000.0
*END STEP
`,
  owl2: `Prefix(:=<http://modelscript.org/ontologies/power-grid#>)
Prefix(owl:=<http://www.w3.org/2002/07/owl#>)
Prefix(rdfs:=<http://www.w3.org/2000/01/rdf-schema#>)

Ontology(<http://modelscript.org/ontologies/power-grid>
  Declaration(Class(:Asset))
  Declaration(Class(:Substation))
  Declaration(Class(:Generator))
  Declaration(Class(:WindTurbine))
  Declaration(Class(:Bus))
  Declaration(ObjectProperty(:connectedTo))
  Declaration(DataProperty(:ratedPowerMW))
  Declaration(NamedIndividual(:Bus101))
  Declaration(NamedIndividual(:WindFarmNorth))

  SubClassOf(:Substation :Asset)
  SubClassOf(:Generator :Asset)
  SubClassOf(:WindTurbine :Generator)

  ObjectPropertyDomain(:connectedTo :Generator)
  ObjectPropertyRange(:connectedTo :Bus)
  DataPropertyDomain(:ratedPowerMW :Generator)

  ClassAssertion(:Bus :Bus101)
  ClassAssertion(:WindTurbine :WindFarmNorth)
)
`,
  easy5: `MODEL: PitchControlLoop
COMPONENT: REF_STEP, TYPE=STEP, X=80, Y=120
  PARAM: T_STEP = 1.0
  PARAM: VAL_FINAL = 10.0
END COMPONENT
COMPONENT: SUM1, TYPE=SJ, X=220, Y=120
END COMPONENT
COMPONENT: PID1, TYPE=PID, X=360, Y=120
  PARAM: KP = 2.5
  PARAM: KI = 0.8
  PARAM: KD = 0.15
END COMPONENT
COMPONENT: ACT1, TYPE=LAG, X=520, Y=120
  PARAM: TAU = 0.2
END COMPONENT
CONNECTION: REF_STEP.S_Out -> SUM1.S_In1
CONNECTION: SUM1.S_Out -> PID1.S_In
CONNECTION: PID1.S_Out -> ACT1.S_In
CONNECTION: ACT1.S_Out -> SUM1.S_In2
`,
  epanet: `[TITLE]
Municipal Water Distribution Loop

[JUNCTIONS]
;ID              Elev    Demand
J1               100     120
J2               95      180
J3               90      150

[RESERVOIRS]
;ID              Head
R1               140

[TANKS]
;ID              Elevation   InitLevel   MinLevel   MaxLevel   Diameter
T1               115         12          2          20         40

[PIPES]
;ID              Node1   Node2   Length  Diameter  Roughness
P1               R1      J1      1000    300       120
P2               J1      J2      800     250       115
P3               J2      J3      600     200       110
P4               J3      T1      900     250       120
P5               J1      J3      1100    200       115

[COORDINATES]
R1               100     300
J1               250     300
J2               420     200
J3               420     380
T1               580     300

[END]
`,
  swmm: `[TITLE]
Urban Stormwater Catchment

[SUBCATCHMENTS]
;Name            RainGage         Outlet           Area     %Imperv  Width    %Slope
S1               RG1              J1               12.0     65       500      1.2
S2               RG1              J2               8.5      45       400      0.9

[JUNCTIONS]
;Name            Elevation  MaxDepth
J1               100.0      10.0
J2               96.5       10.0

[OUTFALLS]
;Name            Elevation  Type
OUT1             92.0       FREE

[CONDUITS]
;Name            FromNode   ToNode     Length     Roughness
C1               J1         J2         400        0.013
C2               J2         OUT1       350        0.013

[COORDINATES]
J1               150        200
J2               350        200
OUT1             550        200
`,
  gtsuite: `MODEL: Turbocharged_I4_Engine
COMPONENT: AMBIENT, TYPE=EndEnvironment
  PARAM: Pressure = 1.013 bar
  PARAM: Temperature = 298 K
COMPONENT: COMP1, TYPE=Compressor
  PARAM: PressureRatio = 2.1
  PARAM: Efficiency = 0.76
COMPONENT: IC1, TYPE=HeatExchanger
  PARAM: WallTemp = 315 K
COMPONENT: CYL1, TYPE=EngCylinder
  PARAM: Bore = 86 mm
  PARAM: Stroke = 86 mm
  PARAM: CompressionRatio = 10.2
COMPONENT: TURB1, TYPE=Turbine
  PARAM: Efficiency = 0.74
CONNECTION: AMBIENT -> COMP1
CONNECTION: COMP1 -> IC1
CONNECTION: IC1 -> CYL1
CONNECTION: CYL1 -> TURB1
`,
  lps: `NETWORK: CrudeTransferLine
NODE: PUMP_STATION, TYPE=SOURCE, ELEVATION=10 m, PRESSURE=45 bar
NODE: HIGH_POINT, TYPE=JUNCTION, ELEVATION=85 m
NODE: TERMINAL, TYPE=SINK, ELEVATION=15 m, PRESSURE=4 bar
PIPE: SEG_1, FROM=PUMP_STATION, TO=HIGH_POINT, LENGTH=12000 m, DIAMETER=0.4 m, ROUGHNESS=0.045 mm
PIPE: SEG_2, FROM=HIGH_POINT, TO=TERMINAL, LENGTH=15000 m, DIAMETER=0.4 m, ROUGHNESS=0.045 mm
`,
  rocets: `SYSTEM: LOX_LH2_ExpanderCycle
COMPONENT: LOX_TANK, TYPE=Tank, FLUID=LOX, PRESSURE=3.5 bar, TEMP=90 K
COMPONENT: LOX_PUMP, TYPE=Pump, HEAD=180 bar, EFFICIENCY=0.82
COMPONENT: MAIN_CHAMBER, TYPE=Combustor, PC=120 bar, OF_RATIO=6.0
COMPONENT: NOZZLE, TYPE=Nozzle, AREA_RATIO=45
CONNECT: LOX_TANK.OUT -> LOX_PUMP.IN
CONNECT: LOX_PUMP.OUT -> MAIN_CHAMBER.OX_IN
CONNECT: MAIN_CHAMBER.OUT -> NOZZLE.IN
`,
  sima: `MODEL: SemiSubmersible_FloatingWind
BODY: HULL_1, TYPE=FloatingBody, MASS=1.4e7 kg
  POSITION: 0, 0, -12
LINE: MOOR_1, FROM=HULL_1, TO=ANCHOR_1, LENGTH=850 m, EA=8.5e8 N
LINE: MOOR_2, FROM=HULL_1, TO=ANCHOR_2, LENGTH=850 m, EA=8.5e8 N
LINE: MOOR_3, FROM=HULL_1, TO=ANCHOR_3, LENGTH=850 m, EA=8.5e8 N
ENVIRONMENT: NORTH_SEA, HS=4.5 m, TP=10.2 s, CURRENT=0.6 m/s
`,
};

function getInitialCode(
  discovered: DiscoveredSingleLanguageResult,
  samples: SampleFileEntry[],
  explicitFile: string | null,
): { code: string; documentUri: string; samplePath: string } {
  if (explicitFile) {
    const abs = path.resolve(process.cwd(), explicitFile);
    if (fs.existsSync(abs)) {
      return {
        code: fs.readFileSync(abs, "utf-8"),
        documentUri: path.basename(abs),
        samplePath: "",
      };
    }
    console.warn(`Warning: --file '${explicitFile}' not found; falling back to default sample.`);
  }

  const firstSample = samples[0];
  if (firstSample) {
    return {
      code: fs.readFileSync(firstSample.absPath, "utf-8"),
      documentUri: path.basename(firstSample.absPath),
      samplePath: firstSample.path,
    };
  }

  const starter = DEFAULT_STARTER_SNIPPETS[discovered.language.id];
  if (starter) {
    return {
      code: starter,
      documentUri: `example${discovered.language.primaryExtension}`,
      samplePath: "",
    };
  }

  if (discovered.ui.stencils.length > 0) {
    return {
      code: discovered.ui.stencils.map((s) => s.snippet).join("\n\n") + "\n",
      documentUri: `example${discovered.language.primaryExtension}`,
      samplePath: "",
    };
  }

  return {
    code: "",
    documentUri: `example${discovered.language.primaryExtension}`,
    samplePath: "",
  };
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
    });
    req.on("end", () => {
      try {
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function resolveLspModulePath(langDir: string): string | null {
  const candidates = [
    path.join(langDir, "src", "lsp.ts"),
    path.join(langDir, "src", "lsp", "index.ts"),
    path.join(langDir, "dist", "src", "lsp.js"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

async function loadWasmParserAndFacade(discovered: DiscoveredSingleLanguageResult): Promise<{
  parser?: { parse: (input: string) => { rootNode: unknown } };
  facade?: {
    loadSource?: (text: string) => void;
    getDiagnostics?: (rootPtr: number, a?: number, b?: number, text?: string) => unknown[];
  };
}> {
  if (!discovered.wasmPath || !discovered.bindingsPath) return {};
  if (!fs.existsSync(discovered.wasmPath) || !fs.existsSync(discovered.bindingsPath)) return {};
  try {
    const bindingsUrl = `${pathToFileURL(discovered.bindingsPath).href}?t=${Date.now()}`;
    const bindingsMod = (await import(bindingsUrl)) as {
      createWasmParser?: (wasmInput: Uint8Array) => Promise<{
        parser: { parse: (input: string) => { rootNode: unknown } };
        facade?: {
          loadSource?: (text: string) => void;
          getDiagnostics?: (rootPtr: number, a?: number, b?: number, text?: string) => unknown[];
        };
      }>;
    };
    if (typeof bindingsMod.createWasmParser === "function") {
      const wasmBytes = new Uint8Array(fs.readFileSync(discovered.wasmPath));
      const res = await bindingsMod.createWasmParser(wasmBytes);
      return { parser: res.parser, ...(res.facade !== undefined ? { facade: res.facade } : {}) };
    }
  } catch {
    return {};
  }
  return {};
}

async function createAnsatzLspRuntime(
  discovered: DiscoveredSingleLanguageResult,
  lspModulePath: string | null,
): Promise<LspRuntime> {
  let lspModule: Record<string, unknown> | null = null;
  if (lspModulePath && fs.existsSync(lspModulePath)) {
    try {
      lspModule = (await import(pathToFileURL(lspModulePath).href)) as Record<string, unknown>;
    } catch {
      lspModule = null;
    }
  }

  const { parser: wasmParser, facade: wasmFacade } = await loadWasmParserAndFacade(discovered);

  const plugin = buildLanguagePluginFromModule({
    id: discovered.language.id,
    name: discovered.language.displayName,
    extensions: discovered.language.fileExtensions,
    languageDef: discovered.language.options,
    lspModule,
    parser: wasmParser,
    facade: wasmFacade,
  });

  return createLspRuntime({ plugins: [plugin] });
}

function createAnsatzPlugin(
  discovered: DiscoveredSingleLanguageResult,
  samples: SampleFileEntry[],
  initial: { code: string; documentUri: string; samplePath: string },
  cliArgs: AnsatzCliArgs,
  lspModulePath: string | null,
  lspRuntime: LspRuntime,
): Plugin {
  const virtualId = "virtual:modelscript-ansatz-lang";
  const resolvedVirtualId = `\0${virtualId}`;
  const sampleMap = new Map(samples.map((s) => [s.path, s.absPath]));

  return {
    name: "modelscript-single-language-ansatz",
    resolveId(id) {
      if (id === virtualId) return resolvedVirtualId;
      return null;
    },
    load(id) {
      if (id !== resolvedVirtualId) return null;

      const imports: string[] = [];
      const panelEntries: string[] = [];
      const simCardEntries: string[] = [];

      discovered.ui.panels.forEach((panel, idx) => {
        const importPath = panel.resolvedEntryPath.replace(/\\/g, "/");
        const modAlias = `PanelMod_${idx}`;
        imports.push(`import * as ${modAlias} from ${JSON.stringify(importPath)};`);
        const exportExpr =
          panel.exportName === "default"
            ? `(${modAlias}.default ?? Object.values(${modAlias}).find((v) => typeof v === "function"))`
            : `(${modAlias}[${JSON.stringify(panel.exportName)}] ?? ${modAlias}.default)`;
        panelEntries.push(`  {
    id: ${JSON.stringify(panel.id)},
    title: ${JSON.stringify(panel.title)},
    shortTitle: ${JSON.stringify(panel.shortTitle ?? panel.title)},
    viewType: ${JSON.stringify(panel.viewType)},
    targets: ${JSON.stringify(panel.targets)},
    Component: ${exportExpr},
  }`);
      });

      discovered.ui.simulationCards.forEach((card, idx) => {
        const importPath = card.resolvedEntryPath.replace(/\\/g, "/");
        const modAlias = `SimCardMod_${idx}`;
        imports.push(`import * as ${modAlias} from ${JSON.stringify(importPath)};`);
        const exportExpr =
          card.exportName === "default"
            ? `(${modAlias}.default ?? Object.values(${modAlias}).find((v) => typeof v === "function"))`
            : `(${modAlias}[${JSON.stringify(card.exportName)}] ?? ${modAlias}.default)`;
        simCardEntries.push(`  {
    id: ${JSON.stringify(card.id)},
    title: ${JSON.stringify(card.title)},
    standards: ${JSON.stringify(card.standards ?? [])},
    Component: ${exportExpr},
  }`);
      });

      let highlightConfig: {
        keywords: string[];
        typeKeywords: string[];
        operators: string[];
        lineComment?: string | undefined;
        blockComment?: { open: string; close: string } | undefined;
      } = {
        keywords: [],
        typeKeywords: [],
        operators: [],
        lineComment: discovered.language.lineComment,
        blockComment: discovered.language.blockComment,
      };
      try {
        const { monarch } = generateTextMate(discovered.language.options);
        const parsedMonarch = JSON.parse(monarch) as {
          keywords?: unknown;
          typeKeywords?: unknown;
          operators?: unknown;
        };
        highlightConfig = {
          keywords: Array.isArray(parsedMonarch.keywords) ? (parsedMonarch.keywords as string[]) : [],
          typeKeywords: Array.isArray(parsedMonarch.typeKeywords) ? (parsedMonarch.typeKeywords as string[]) : [],
          operators: Array.isArray(parsedMonarch.operators) ? (parsedMonarch.operators as string[]) : [],
          lineComment: discovered.language.lineComment,
          blockComment: discovered.language.blockComment,
        };
      } catch {
        // Fallback to comment-only highlight config
      }

      return `${imports.join("\n")}

export const ANSATZ_LANG = {
  id: ${JSON.stringify(discovered.language.id)},
  name: ${JSON.stringify(discovered.language.name)},
  displayName: ${JSON.stringify(discovered.language.displayName)},
  packageName: ${JSON.stringify(discovered.packageName)},
  fileExtensions: ${JSON.stringify(discovered.language.fileExtensions)},
  primaryExtension: ${JSON.stringify(discovered.language.primaryExtension)},
  hasWasm: ${JSON.stringify(Boolean(discovered.wasmPath))},
  hasBindings: ${JSON.stringify(Boolean(discovered.bindingsPath))},
  hasLsp: ${JSON.stringify(Boolean(lspModulePath))},
  highlight: ${JSON.stringify(highlightConfig)},
  initialMode: ${JSON.stringify(cliArgs.mode)},
  initialTheme: ${JSON.stringify(cliArgs.theme)},
  initialDocumentUri: ${JSON.stringify(initial.documentUri)},
  initialCode: ${JSON.stringify(initial.code)},
  initialSamplePath: ${JSON.stringify(initial.samplePath)},
  stencils: ${JSON.stringify(discovered.ui.stencils)},
  toolbarButtons: ${JSON.stringify(discovered.ui.toolbarButtons ?? [])},
  treeViews: ${JSON.stringify(discovered.ui.treeViews.map((t) => ({ id: t.id, name: t.name })))},
  samples: ${JSON.stringify(samples.map((s) => ({ label: s.label, path: s.path })))},
  panels: [
${panelEntries.join(",\n")}
  ],
  simulationCards: [
${simCardEntries.join(",\n")}
  ],
};
`;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url || "/";
        const parsed = new URL(rawUrl, "http://localhost");
        const pathname = parsed.pathname;

        if (pathname === "/__ansatz/parser.wasm") {
          const wasmPath =
            discovered.wasmPath && fs.existsSync(discovered.wasmPath)
              ? discovered.wasmPath
              : path.join(discovered.packageDir, "dist", "parser.wasm");
          if (fs.existsSync(wasmPath)) {
            res.setHeader("Content-Type", "application/wasm");
            res.setHeader("Cache-Control", "no-store");
            fs.createReadStream(wasmPath).pipe(res);
            return;
          }
          res.statusCode = 404;
          res.end("parser.wasm not found");
          return;
        }

        if (pathname === "/__ansatz/bindings.js") {
          const bindingsPath =
            discovered.bindingsPath && fs.existsSync(discovered.bindingsPath)
              ? discovered.bindingsPath
              : path.join(discovered.packageDir, "src-gen", "bindings.js");
          if (fs.existsSync(bindingsPath)) {
            res.setHeader("Content-Type", "application/javascript; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            fs.createReadStream(bindingsPath).pipe(res);
            return;
          }
          res.statusCode = 404;
          res.end("bindings.js not found");
          return;
        }

        if (pathname === "/__ansatz/sample") {
          const relPath = parsed.searchParams.get("path") || "";
          const absPath = sampleMap.get(relPath);
          if (!absPath || !fs.existsSync(absPath)) {
            res.statusCode = 404;
            res.end("Sample not found");
            return;
          }
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          fs.createReadStream(absPath).pipe(res);
          return;
        }

        if (pathname === "/__ansatz/lsp" && req.method === "POST") {
          void readJsonBody(req)
            .then(async (body) => {
              const method = typeof body["method"] === "string" ? body["method"] : "";
              const code = typeof body["code"] === "string" ? body["code"] : undefined;
              const documentUri = typeof body["documentUri"] === "string" ? body["documentUri"] : undefined;
              const params =
                body["params"] && typeof body["params"] === "object"
                  ? (body["params"] as Record<string, unknown>)
                  : undefined;
              const result = await lspRuntime.handleRequest({ method, params, code, documentUri });
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(result));
            })
            .catch((err) => {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ handled: false, error: err instanceof Error ? err.message : String(err) }));
            });
          return;
        }

        if (pathname === "/__ansatz/rebuild-parser" && req.method === "POST") {
          const buildScript = path.join(REPO_ROOT, "scripts", "build-language-parser.js");
          execFile(
            process.execPath,
            [buildScript, "--force"],
            { cwd: discovered.packageDir, timeout: 60_000 },
            (err, stdout, stderr) => {
              const finish = () => {
                res.setHeader("Content-Type", "application/json");
                const output = [stdout, stderr].filter(Boolean).join("\n").trim();
                res.end(JSON.stringify({ ok: !err, output: output || (err ? err.message : "OK") }));
              };
              if (!err) {
                loadWasmParserAndFacade(discovered)
                  .then(({ parser, facade }) => {
                    if (parser) {
                      lspRuntime.setParser(discovered.language.id, parser, facade);
                    }
                  })
                  .catch(() => {})
                  .finally(finish);
              } else {
                finish();
              }
            },
          );
          return;
        }

        next();
      });
    },
  };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildDiagramAliases(): { find: string | RegExp; replacement: string }[] {
  const diagramPkgPath = path.join(REPO_ROOT, "packages", "diagram", "package.json");
  const aliases: { find: string | RegExp; replacement: string }[] = [];
  if (fs.existsSync(diagramPkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(diagramPkgPath, "utf-8")) as {
        exports?: Record<string, string | { default?: string }>;
      };
      for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
        if (!subpath.startsWith("./") || subpath.includes("*")) continue;
        const relOut = typeof target === "string" ? target : target?.default;
        if (!relOut) continue;
        const srcGuess = relOut.replace(/^\.\/dist\//, "src/").replace(/\.js$/, ".ts");
        const absSrc = path.join(REPO_ROOT, "packages", "diagram", srcGuess);
        if (fs.existsSync(absSrc)) {
          aliases.push({
            find: new RegExp(`^@modelscript/diagram/${escapeRegExp(subpath.slice(2))}$`),
            replacement: absSrc,
          });
        }
      }
    } catch {
      // ignore
    }
  }
  aliases.push({
    find: /^@modelscript\/diagram\/(.+)$/,
    replacement: path.join(REPO_ROOT, "packages", "diagram", "src", "$1.ts"),
  });
  aliases.push({
    find: /^@modelscript\/diagram$/,
    replacement: path.join(REPO_ROOT, "packages", "diagram", "src", "index.ts"),
  });
  return aliases;
}

async function tryLoadReactPlugin(): Promise<PluginOption | null> {
  const candidate = path.join(REPO_ROOT, "apps", "web", "node_modules", "@vitejs", "plugin-react", "dist", "index.js");
  if (!fs.existsSync(candidate)) return null;
  try {
    const mod = (await import(pathToFileURL(candidate).href)) as { default?: () => PluginOption };
    if (typeof mod.default === "function") return mod.default();
  } catch {
    // Fallback to Vite built-in JSX transform
  }
  return null;
}

export async function startLanguageAnsatz(argv: string[] = process.argv.slice(2)): Promise<void> {
  const cliArgs = parseCliArgs(argv);
  const langDir = resolveLanguageDir(cliArgs.target);
  const discovered = await discoverSingleLanguage(langDir);

  if (!discovered) {
    console.error(`Error: Failed to load language metadata from ${langDir}`);
    process.exit(1);
  }

  if (cliArgs.ansatz) {
    const webPort = cliArgs.port === 5179 ? 5173 : cliArgs.port;
    const url = `http://localhost:${webPort}/editor?lang=${encodeURIComponent(discovered.language.id)}&single=1`;
    console.log(`\n  ModelScript Single-Language Ansatz Mode`);
    console.log(`  Language : ${discovered.language.displayName} (${discovered.language.id})`);
    console.log(`  URL      : ${url}\n`);
    const child = spawn(
      "npm",
      [
        "run",
        "dev",
        "--workspace=@modelscript/web",
        "--",
        "--port",
        String(webPort),
        ...(cliArgs.open ? ["--open", `/editor?lang=${encodeURIComponent(discovered.language.id)}&single=1`] : []),
      ],
      { cwd: REPO_ROOT, stdio: "inherit" },
    );
    await new Promise<void>((resolvePromise, rejectPromise) => {
      child.on("error", rejectPromise);
      child.on("exit", (code) => {
        if (code && code !== 0) process.exitCode = code;
        resolvePromise();
      });
    });
    return;
  }

  const samples = discoverSampleFiles(langDir, discovered.language.fileExtensions);
  const initial = getInitialCode(discovered, samples, cliArgs.file);
  const lspModulePath = resolveLspModulePath(discovered.packageDir);
  const lspRuntime = await createAnsatzLspRuntime(discovered, lspModulePath);
  const reactPlugin = await tryLoadReactPlugin();

  const plugins: PluginOption[] = [
    createAnsatzPlugin(discovered, samples, initial, cliArgs, lspModulePath, lspRuntime),
  ];
  if (reactPlugin) plugins.unshift(reactPlugin);

  const baseLogger = createLogger("info", { prefix: "[ansatz]" });
  const customLogger: typeof baseLogger = {
    ...baseLogger,
    warn(msg, options) {
      if (msg.includes("cannot be analyzed by Vite") && msg.includes("/packages/")) return;
      baseLogger.warn(msg, options);
    },
  };

  const server = await createServer({
    root: ANSATZ_ROOT,
    cacheDir: path.join(REPO_ROOT, "node_modules", ".vite-ansatz"),
    publicDir: path.join(REPO_ROOT, "apps", "web", "public"),
    configFile: false,
    clearScreen: false,
    customLogger,
    resolve: {
      alias: [
        { find: /^react$/, replacement: path.join(REPO_ROOT, "node_modules", "react", "index.js") },
        {
          find: /^react\/jsx-runtime$/,
          replacement: path.join(REPO_ROOT, "node_modules", "react", "jsx-runtime.js"),
        },
        {
          find: /^react\/jsx-dev-runtime$/,
          replacement: path.join(REPO_ROOT, "node_modules", "react", "jsx-dev-runtime.js"),
        },
        { find: /^react-dom$/, replacement: path.join(REPO_ROOT, "node_modules", "react-dom", "index.js") },
        {
          find: /^react-dom\/client$/,
          replacement: path.join(REPO_ROOT, "node_modules", "react-dom", "client.js"),
        },
        ...(fs.existsSync(path.join(REPO_ROOT, "packages", "diagram", "node_modules", "@antv", "x6"))
          ? [
              {
                find: /^@antv\/x6$/,
                replacement: path.join(REPO_ROOT, "packages", "diagram", "node_modules", "@antv", "x6"),
              },
            ]
          : []),
        {
          find: /^@modelscript\/design-tokens\/tokens-web\.css$/,
          replacement: path.join(REPO_ROOT, "packages", "design-tokens", "src", "tokens-web.css"),
        },
        {
          find: /^@modelscript\/design-tokens\/tokens-vscode\.css$/,
          replacement: path.join(REPO_ROOT, "packages", "design-tokens", "src", "tokens-vscode.css"),
        },
        {
          find: /^@modelscript\/design-tokens$/,
          replacement: path.join(REPO_ROOT, "packages", "design-tokens", "src", "tokens.css"),
        },
        {
          find: /^@modelscript\/editor$/,
          replacement: path.join(REPO_ROOT, "packages", "editor", "src", "index.ts"),
        },
        {
          find: /^@modelscript\/editor\/workbench\/(.+)$/,
          replacement: path.join(REPO_ROOT, "packages", "editor", "src", "workbench", "$1"),
        },
        {
          find: /^@modelscript\/editor\/(.+)$/,
          replacement: path.join(REPO_ROOT, "packages", "editor", "src", "$1.ts"),
        },
        {
          find: /^@modelscript\/react\/panel$/,
          replacement: path.join(REPO_ROOT, "packages", "react", "src", "panel.ts"),
        },
        {
          find: /^@modelscript\/react$/,
          replacement: path.join(REPO_ROOT, "packages", "react", "src", "index.ts"),
        },
        ...buildDiagramAliases(),
        {
          find: new RegExp(`^${escapeRegExp(discovered.packageName)}$`),
          replacement: path.join(discovered.packageDir, "src", "index.ts"),
        },
        { find: /^node:url$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-url-shim.ts") },
        { find: /^url$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-url-shim.ts") },
        {
          find: /^node:child_process$/,
          replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts"),
        },
        { find: /^child_process$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts") },
        {
          find: /^node:fs\/promises$/,
          replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts"),
        },
        { find: /^fs\/promises$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts") },
        { find: /^node:fs$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts") },
        { find: /^fs$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts") },
        { find: /^node:os$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts") },
        { find: /^os$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts") },
        { find: /^node:path$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts") },
        { find: /^path$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts") },
        {
          find: /^node:readline\/promises$/,
          replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts"),
        },
        {
          find: /^readline\/promises$/,
          replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts"),
        },
        { find: /^node:readline$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts") },
        { find: /^readline$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts") },
        { find: /^node:zlib$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts") },
        { find: /^zlib$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts") },
        { find: /^node:crypto$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts") },
        { find: /^crypto$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts") },
        { find: /^node:net$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts") },
        { find: /^net$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts") },
        { find: /^node:events$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts") },
        { find: /^events$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts") },
        { find: /^node:module$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts") },
        { find: /^module$/, replacement: path.join(REPO_ROOT, "apps", "web", "src", "util", "node-shims.ts") },
      ],
      dedupe: ["react", "react-dom", "styled-components", "@primer/react", "three"],
    },
    server: {
      host: cliArgs.host,
      port: cliArgs.port,
      open: cliArgs.open,
      fs: {
        allow: [REPO_ROOT],
      },
    },
    define: {
      "process.env": {},
      "process.browser": true,
      "process.versions": {},
      __AVAILABLE_FILE_ICONS__: JSON.stringify({}),
    },
    optimizeDeps: {
      include: [
        "react",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "react-dom",
        "react-dom/client",
        "styled-components",
        "monaco-editor",
        "@monaco-editor/react",
        "@primer/react",
        "@primer/octicons-react",
        "@antv/layout",
        "@react-three/drei",
        "@react-three/fiber",
        "three",
        "pako",
        "recharts",
        "dompurify",
        "fflate",
        "lodash/debounce",
        "papaparse",
        "parse-data-url",
        "react-dropzone",
        "react-markdown",
      ],
      exclude: [
        "@modelscript/runtime",
        "@modelscript/dsl",
        "@modelscript/lsp",
        "@modelscript/diagram",
        "@modelscript/simulate",
        "@modelscript/cad",
        "@modelscript/exchange",
        discovered.packageName,
      ],
    },
    plugins,
  });

  await server.listen();

  const address = server.httpServer?.address();
  const port = typeof address === "object" && address ? address.port : cliArgs.port;
  const url = `http://${cliArgs.host}:${port}/`;

  console.log(`\n  ModelScript Language Ansatz (${discovered.language.displayName})`);
  console.log(`  ➜  Local:     ${url}`);
  console.log(`  ➜  Package:   ${discovered.packageName} (${path.relative(REPO_ROOT, discovered.packageDir)})`);
  console.log(
    `  ➜  Panels:    ${discovered.ui.panels.length > 0 ? discovered.ui.panels.map((p) => `${p.title} (${p.id})`).join(", ") : "(none declared — editor + WASM CST mode)"}`,
  );
  if (discovered.ui.simulationCards.length > 0) {
    console.log(`  ➜  Sim Cards: ${discovered.ui.simulationCards.map((c) => c.title).join(", ")}`);
  }
  console.log(`  ➜  LSP:       ${lspModulePath ? path.relative(REPO_ROOT, lspModulePath) : "(none)"}`);
  console.log(`  ➜  WASM:      ${discovered.wasmPath ? "ready" : "not built (use Rebuild WASM button)"}`);
  console.log(`  ➜  Samples:   ${samples.length} discovered\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  startLanguageAnsatz(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
