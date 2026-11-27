// SPDX-License-Identifier: AGPL-3.0-or-later

import csvLangFallback from "@modelscript/csv/language";
import lasLangFallback from "@modelscript/las/language";
import {
  formatModelicaTree,
  getModelicaCodeLenses,
  modelicaActionHandlers,
  modelicaLanguage,
} from "@modelscript/modelica";
import { createModelicaQueryEngine } from "@modelscript/modelica/factory";
import modelicaLangFallback from "@modelscript/modelica/language";
import modelscriptLangFallback from "@modelscript/modelscript/language";
import { computeOwl2SemanticTokensData } from "@modelscript/owl2";
import { createOWL2QueryEngine } from "@modelscript/owl2/factory";
import owl2LangFallback from "@modelscript/owl2/language";
import type { QueryEngine } from "@modelscript/runtime";
import { getScadCodeLenses, getScadDefinition, getScadReferences } from "@modelscript/scad";
import scadLangFallback from "@modelscript/scad/language";
import {
  computeStepSemanticTokensData,
  formatStepDocument,
  getStepCodeLenses,
  getStepDefinition,
  getStepHover,
  getStepReferences,
  getStepSignatureHelp,
  stepLanguage,
} from "@modelscript/step";
import { formatSysmlSource, getSysml2CodeLenses } from "@modelscript/sysml2";
import { createSysML2QueryEngine } from "@modelscript/sysml2/factory";
import sysml2LangFallback from "@modelscript/sysml2/language";
import { semanticLegend as sysml2SemanticLegend } from "@modelscript/sysml2/parser";
import type { CodeLens, Position, Range } from "vscode-languageserver";
import type { ParserService } from "../services/parser-service.js";
import type { WorkspaceManager } from "../services/workspace-manager.js";
import {
  globalLanguageRegistry,
  type LanguagePlugin,
  type PluginCodeLensContext,
  type PluginDocumentLike,
  type PluginFormatContext,
  type PluginFormattingOptions,
  type WasmFacadeInstance,
  type WasmParserInstance,
} from "./LanguageRegistry.js";

export interface CorePluginsOptions {
  workspaceManager: WorkspaceManager;
  parserService?: ParserService | undefined;
  connection?:
    | {
        console: {
          info: (msg: string) => void;
          warn: (msg: string) => void;
          error?: (msg: string) => void;
        };
      }
    | undefined;
}

type DocInput = PluginDocumentLike | null | undefined;

interface FullTextDocumentLike {
  uri: string;
  lineCount: number;
  getText(): string;
  offsetAt(position: Position): number;
  positionAt(offset: number): Position;
}

function docText(doc: DocInput): string {
  return typeof doc === "string" ? doc : typeof doc?.getText === "function" ? doc.getText() : String(doc ?? "");
}

function docUri(doc: DocInput): string {
  return typeof doc === "object" && doc !== null && typeof doc.uri === "string" ? doc.uri : "";
}

export const CORE_LANGUAGE_IDS: ReadonlySet<string> = new Set([
  "modelica",
  "sysml",
  "sysml2",
  "step",
  "owl2",
  "csv",
  "las",
  "scad",
  "modelscript",
]);

export const CORE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".mo",
  ".mos",
  ".msim",
  ".sysml",
  ".sysml2",
  ".kerml",
  ".stp",
  ".step",
  ".p21",
  ".owl",
  ".owl2",
  ".ofn",
  ".omn",
  ".ttl",
  ".fss",
  ".owx",
  ".csv",
  ".tsv",
  ".las",
  ".scad",
  ".modelscript",
  ".msx",
]);

/**
 * Lightweight static routing table of all 63 heritage 1960s–1980s engineering
 * language & data-format IDs handled by `./heritage-plugins.js`.
 */
export const HERITAGE_LANGUAGE_IDS: ReadonlySet<string> = new Set([
  "acsl",
  "csmp",
  "dynamo",
  "esl",
  "gpss",
  "simscript",
  "slam",
  "vhdl",
  "verilog",
  "lustre",
  "esterel",
  "sdl",
  "edif",
  "gdsii",
  "cif",
  "gerber",
  "mcnp",
  "melcor",
  "scale",
  "sinda",
  "trasys",
  "nec2",
  "datcom",
  "cea",
  "gams",
  "mps",
  "cplex-lp",
  "iges",
  "dxf",
  "gcode",
  "apt",
  "lsdyna",
  "apdl",
  "plot3d",
  "trnsys",
  "doe2",
  "chemkin",
  "molfile",
  "gaussian",
  "ieee-cdf",
  "hec1",
  "hec2",
  "segy",
  "fits",
  "netcdf",
  "nasa-cdf",
  "grib",
  "bufr",
  "usgs-dem",
  "hdf4",
  "arinc429",
  "nmea0183",
  "rinex",
  "irig106",
  "endf6",
  "jcamp-dx",
  "iucr-cif",
  "stl",
  "obj",
  "ihex",
  "srec",
  "jedec",
  "asn1",
]);

/**
 * Unambiguous file extensions handled exclusively by `./heritage-plugins.js`.
 */
export const HERITAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".csl",
  ".acsl",
  ".csmp",
  ".cssl",
  ".dyn",
  ".dy",
  ".esl",
  ".gps",
  ".gpss",
  ".simscript",
  ".slam",
  ".slm",
  ".vhd",
  ".vhdl",
  ".v",
  ".vh",
  ".lus",
  ".ec",
  ".strl",
  ".sdl",
  ".pr",
  ".edf",
  ".edif",
  ".edn",
  ".gds",
  ".gdsii",
  ".gdt",
  ".cif",
  ".gbr",
  ".ger",
  ".gtl",
  ".gbl",
  ".mcnp",
  ".mel",
  ".melcor",
  ".scale",
  ".sin",
  ".sinda",
  ".tra",
  ".trasys",
  ".nec",
  ".dcm",
  ".datcom",
  ".cea",
  ".gms",
  ".mps",
  ".qps",
  ".lp",
  ".ltx",
  ".igs",
  ".iges",
  ".dxf",
  ".gcode",
  ".nc",
  ".ngc",
  ".tap",
  ".apt",
  ".aptsource",
  ".cls",
  ".k",
  ".apdl",
  ".mac",
  ".ans",
  ".xyz",
  ".p3d",
  ".q",
  ".dck",
  ".trd",
  ".bdl",
  ".ck",
  ".therm",
  ".mol",
  ".gjf",
  ".com",
  ".cdf",
  ".ipf",
  ".hc1",
  ".hec1",
  ".hc2",
  ".hec2",
  ".sgy",
  ".segy",
  ".fits",
  ".fit",
  ".fts",
  ".cdl",
  ".skt",
  ".grb",
  ".grib",
  ".grib1",
  ".bufr",
  ".bfr",
  ".dem",
  ".hdf",
  ".h4",
  ".hdf4",
  ".eos",
  ".a429",
  ".arinc429",
  ".nmea",
  ".nma",
  ".obs",
  ".nav",
  ".rnx",
  ".tmats",
  ".tmt",
  ".irig106",
  ".endf",
  ".endf6",
  ".pendf",
  ".jdx",
  ".dx",
  ".jcm",
  ".mcif",
  ".icif",
  ".star",
  ".stl",
  ".obj",
  ".mtl",
  ".hex",
  ".ihx",
  ".ihex",
  ".srec",
  ".s19",
  ".s28",
  ".s37",
  ".jed",
  ".jedec",
  ".asn",
  ".asn1",
]);

export type DomainPluginCluster =
  | "power-electronics"
  | "fluid-process-nuclear"
  | "multibody-robotics"
  | "aerospace-controls"
  | "cad-continuum"
  | "bio-chem-medical"
  | "systems-scientific";

export type LoadablePluginCluster = "heritage" | DomainPluginCluster;

export type LazyPluginCluster = "core" | LoadablePluginCluster | "all";

export const ALL_LOADABLE_CLUSTERS: readonly LoadablePluginCluster[] = [
  "heritage",
  "power-electronics",
  "fluid-process-nuclear",
  "multibody-robotics",
  "aerospace-controls",
  "cad-continuum",
  "bio-chem-medical",
  "systems-scientific",
];

/**
 * Lightweight static routing tables mapping each of the 7 domain clusters
 * to its exact set of language IDs.
 */
export const DOMAIN_CLUSTER_LANGUAGE_IDS: Readonly<Record<DomainPluginCluster, ReadonlySet<string>>> = {
  "power-electronics": new Set([
    "pscad",
    "psse",
    "cgmes",
    "opendss",
    "powerfactory",
    "pslf",
    "ocpp",
    "openadr",
    "spice",
    "atopile",
    "kicad",
    "verilog-a",
    "ibis",
    "touchstone",
    "optical",
    "ran",
    "fiber",
    "matpower",
    "comtrade",
    "scl",
    "atp",
    "dnp3",
    "oneliner",
    "sel",
    "c37118",
    "cyme",
    "gridlabd",
    "iec104",
    "plscadd",
    "powerworld",
    "pypsa",
    "rtds",
  ]),
  "fluid-process-nuclear": new Set([
    "olga",
    "lps",
    "aspen",
    "eclipse",
    "epanet",
    "swmm",
    "relap5",
    "energyplus",
    "hec-ras",
    "tough",
    "modflow",
    "landgem",
    "hec-hms",
    "waterml",
    "asm",
  ]),
  "multibody-robotics": new Set([
    "adams",
    "simpack",
    "gensys",
    "gtsuite",
    "sima",
    "urdf",
    "opendrive",
    "openscenario",
    "autosar",
    "gtfs",
  ]),
  "aerospace-controls": new Set([
    "simulink",
    "easy5",
    "jsbsim",
    "rocets",
    "ccsds",
    "plcopen",
    "automationml",
    "twentysim",
  ]),
  "cad-continuum": new Set(["qif", "usd", "fea", "cfd", "three-mf"]),
  "bio-chem-medical": new Set([
    "sbml",
    "antimony",
    "cantera",
    "smiles",
    "nmtran",
    "mlxtran",
    "nmodl",
    "sbol",
    "bngl",
    "sedml",
    "pdb",
    "genbank",
    "gproms",
    "phreeqc",
    "opensim",
    "dicom-rt",
    "cellml",
    "febio",
    "nifti",
    "topas",
    "igtl",
  ]),
  "systems-scientific": new Set(["ampl", "magicdraw", "ssp", "reqif", "oscal", "sparql", "fortran", "c"]),
};

/**
 * Unambiguous file extensions handled exclusively by each of the 7 domain clusters.
 */
export const DOMAIN_CLUSTER_EXTENSIONS: Readonly<Record<DomainPluginCluster, ReadonlySet<string>>> = {
  "power-electronics": new Set([
    ".pscx",
    ".pslx",
    ".pswx",
    ".psmx",
    ".raw",
    ".dyr",
    ".seq",
    ".con",
    ".mon",
    ".sav",
    ".out",
    ".cgmes",
    ".cim",
    ".rdf",
    ".dss",
    ".pfd",
    ".dz",
    ".dsl",
    ".epc",
    ".dyd",
    ".ocpp",
    ".ocpp.json",
    ".cpo",
    ".evse",
    ".oadr",
    ".oadr.xml",
    ".oadr.json",
    ".oadr.yaml",
    ".cir",
    ".sp",
    ".net",
    ".lib",
    ".ato",
    ".kicad_pcb",
    ".kicad_sch",
    ".kicad_sym",
    ".kicad_mod",
    ".va",
    ".vams",
    ".ibs",
    ".s1p",
    ".s2p",
    ".s3p",
    ".s4p",
    ".s5p",
    ".s6p",
    ".s7p",
    ".s8p",
    ".s9p",
    ".s10p",
    ".s12p",
    ".s16p",
    ".s24p",
    ".s32p",
    ".ts2",
    ".sor",
    ".openroadm.json",
    ".adf",
    ".nsma",
    ".msi",
    ".planet",
    ".fiber.geojson",
    ".osp.json",
    ".m",
    ".matpower",
    ".cff",
    ".scd",
    ".cid",
    ".icd",
    ".iid",
    ".scl",
    ".atp",
    ".dnp3",
    ".olx",
    ".dxt",
    ".rcf",
    ".rdb",
    ".sel",
    ".txt",
    ".c37118",
    ".pmu",
    ".sxst",
    ".cyme",
    ".glm",
    ".iec104",
    ".104",
    ".pol",
    ".loa",
    ".plscadd",
    ".aux",
    ".pypsa",
    ".pypsa.json",
    ".dft",
    ".rtds",
  ]),
  "fluid-process-nuclear": new Set([
    ".genkey",
    ".opi",
    ".olga",
    ".pvt",
    ".tab",
    ".lps",
    ".tgx",
    ".tlx",
    ".tgn",
    ".tln",
    ".psg",
    ".psl",
    ".in",
    ".bkp",
    ".data",
    ".inc",
    ".r5",
    ".idf",
    ".epjson",
    ".g01",
    ".g02",
    ".g03",
    ".rasgeo",
    ".u01",
    ".f01",
    ".prj",
    ".tough",
    ".tgh",
    ".dis",
    ".dis6",
    ".npf",
    ".npf6",
    ".wel",
    ".wel6",
    ".riv",
    ".riv6",
    ".chd",
    ".chd6",
    ".landgem",
    ".lfg",
    ".biogas",
    ".basin",
    ".hms",
    ".met",
    ".control",
    ".waterml",
    ".wml2",
    ".asm",
    ".bsm",
    ".wrrf",
  ]),
  "multibody-robotics": new Set([
    ".adm",
    ".cmd",
    ".acf",
    ".spck",
    ".mbs",
    ".calc",
    ".run",
    ".geom",
    ".trax",
    ".wheel",
    ".ins",
    ".gtm",
    ".gtd",
    ".gtx",
    ".gt",
    ".sima",
    ".sys",
    ".hyd",
    ".urdf",
    ".xacro",
    ".xodr",
    ".xosc",
    ".osc",
    ".arxml",
    ".gtfs",
    ".gtfs.txt",
    ".gtfs-rt",
  ]),
  "aerospace-controls": new Set([
    ".slx",
    ".mdl",
    ".ez5",
    ".ezm",
    ".ezd",
    ".eas",
    ".roc",
    ".deck",
    ".ccsds",
    ".oem",
    ".opm",
    ".omm",
    ".xtce",
    ".plcopen",
    ".st",
    ".aml",
    ".amlx",
    ".emx",
    ".emxz",
    ".sid",
  ]),
  "cad-continuum": new Set([
    ".qif",
    ".qif.xml",
    ".qif.json",
    ".usda",
    ".usd",
    ".usdc",
    ".usdz",
    ".fea",
    ".inpt",
    ".bdf",
    ".cfd",
    ".cfgt",
    ".su2",
    ".foam",
    ".3mf",
    ".3mf.model",
  ]),
  "bio-chem-medical": new Set([
    ".sbml",
    ".ant",
    ".cti",
    ".ctml",
    ".smi",
    ".smiles",
    ".ctl",
    ".nmtran",
    ".mlxtran",
    ".nmodl",
    ".sbol",
    ".sbol.xml",
    ".bngl",
    ".sedml",
    ".pdb",
    ".ent",
    ".gb",
    ".gbk",
    ".genbank",
    ".gproms",
    ".pqi",
    ".phreeqc",
    ".osim",
    ".dcm.json",
    ".dicom-rt",
    ".rtplan.json",
    ".rtdose.json",
    ".rtstruct.json",
    ".cellml",
    ".feb",
    ".nii",
    ".nii.json",
    ".topas",
    ".tps",
    ".igtl",
    ".igtl.json",
  ]),
  "systems-scientific": new Set([
    ".ampl",
    ".mdzip",
    ".mdxml",
    ".xmi",
    ".ssv",
    ".ssm",
    ".ssp",
    ".reqif",
    ".reqifz",
    ".oscal",
    ".oscal.json",
    ".oscal.yaml",
    ".oscal.xml",
    ".rq",
    ".sparql",
    ".f",
    ".for",
    ".f77",
    ".f90",
    ".f95",
    ".f03",
    ".f08",
    ".c",
    ".h",
  ]),
};

/**
 * Extensions shared across multiple clusters (disambiguated via content sniffing
 * in `LanguageRegistry.getPluginForUri`). Opening one of these extensions loads
 * only the matching clusters listed here.
 */
export const AMBIGUOUS_EXTENSION_CLUSTERS: Readonly<Record<string, readonly LoadablePluginCluster[]>> = {
  ".i": ["heritage", "fluid-process-nuclear"],
  ".key": ["heritage", "fluid-process-nuclear"],
  ".sdf": ["heritage", "multibody-robotics"],
  ".sim": ["heritage", "multibody-robotics"],
  ".inp": ["cad-continuum", "fluid-process-nuclear", "multibody-robotics"],
  ".dat": ["cad-continuum", "fluid-process-nuclear", "power-electronics", "systems-scientific"],
  ".cfg": ["cad-continuum", "power-electronics"],
  ".sub": ["power-electronics", "multibody-robotics"],
  ".mod": ["systems-scientific", "bio-chem-medical"],
  ".ssd": ["systems-scientific", "power-electronics"],
  ".xml": [
    "aerospace-controls",
    "bio-chem-medical",
    "fluid-process-nuclear",
    "multibody-robotics",
    "power-electronics",
  ],
  ".json": ["fluid-process-nuclear", "power-electronics"],
};

/**
 * Set of all ambiguous extensions shared across clusters.
 */
export const AMBIGUOUS_SHARED_EXTENSIONS: ReadonlySet<string> = new Set(Object.keys(AMBIGUOUS_EXTENSION_CLUSTERS));

const LANGUAGE_ID_TO_CLUSTER: ReadonlyMap<string, LoadablePluginCluster> = (() => {
  const map = new Map<string, LoadablePluginCluster>();
  for (const id of HERITAGE_LANGUAGE_IDS) {
    map.set(id, "heritage");
  }
  for (const [cluster, ids] of Object.entries(DOMAIN_CLUSTER_LANGUAGE_IDS) as Array<
    [DomainPluginCluster, ReadonlySet<string>]
  >) {
    for (const id of ids) {
      map.set(id, cluster);
    }
  }
  return map;
})();

const EXTENSION_TO_CLUSTER: ReadonlyMap<string, LoadablePluginCluster> = (() => {
  const map = new Map<string, LoadablePluginCluster>();
  for (const ext of HERITAGE_EXTENSIONS) {
    map.set(ext, "heritage");
  }
  for (const [cluster, exts] of Object.entries(DOMAIN_CLUSTER_EXTENSIONS) as Array<
    [DomainPluginCluster, ReadonlySet<string>]
  >) {
    for (const ext of exts) {
      map.set(ext, cluster);
    }
  }
  return map;
})();

export type LazyClusterLoaders = Record<LoadablePluginCluster, (options: CorePluginsOptions) => Promise<void>>;

const DEFAULT_CLUSTER_LOADERS: LazyClusterLoaders = {
  heritage: async (options: CorePluginsOptions) => {
    const { registerHeritageLanguagePlugins } = await import("./heritage-plugins.js");
    registerHeritageLanguagePlugins(undefined, options.workspaceManager);
    if (options.connection) {
      options.connection.console.info("[lsp] Heritage language plugins registered.");
    }
  },
  "power-electronics": async (options: CorePluginsOptions) => {
    const { registerPowerElectronicsPlugins } = await import("./clusters/power-electronics-plugins.js");
    registerPowerElectronicsPlugins(options.workspaceManager);
    if (options.connection) {
      options.connection.console.info("[lsp] Power & electronics language plugins registered.");
    }
  },
  "fluid-process-nuclear": async (options: CorePluginsOptions) => {
    const { registerFluidProcessNuclearPlugins } = await import("./clusters/fluid-process-nuclear-plugins.js");
    registerFluidProcessNuclearPlugins(options.workspaceManager);
    if (options.connection) {
      options.connection.console.info("[lsp] Fluid, process & nuclear language plugins registered.");
    }
  },
  "multibody-robotics": async (options: CorePluginsOptions) => {
    const { registerMultibodyRoboticsPlugins } = await import("./clusters/multibody-robotics-plugins.js");
    registerMultibodyRoboticsPlugins(options.workspaceManager);
    if (options.connection) {
      options.connection.console.info("[lsp] Multibody & robotics language plugins registered.");
    }
  },
  "aerospace-controls": async (options: CorePluginsOptions) => {
    const { registerAerospaceControlsPlugins } = await import("./clusters/aerospace-controls-plugins.js");
    registerAerospaceControlsPlugins(options.workspaceManager);
    if (options.connection) {
      options.connection.console.info("[lsp] Aerospace & controls language plugins registered.");
    }
  },
  "cad-continuum": async (options: CorePluginsOptions) => {
    const { registerCadContinuumPlugins } = await import("./clusters/cad-continuum-plugins.js");
    registerCadContinuumPlugins(options.workspaceManager);
    if (options.connection) {
      options.connection.console.info("[lsp] CAD & continuum physics language plugins registered.");
    }
  },
  "bio-chem-medical": async (options: CorePluginsOptions) => {
    const { registerBioChemMedicalPlugins } = await import("./clusters/bio-chem-medical-plugins.js");
    registerBioChemMedicalPlugins(options.workspaceManager);
    if (options.connection) {
      options.connection.console.info("[lsp] Bio, chemistry & medical language plugins registered.");
    }
  },
  "systems-scientific": async (options: CorePluginsOptions) => {
    const { registerSystemsScientificPlugins } = await import("./clusters/systems-scientific-plugins.js");
    registerSystemsScientificPlugins(options.workspaceManager);
    if (options.connection) {
      options.connection.console.info("[lsp] Systems & scientific language plugins registered.");
    }
  },
};

const registeredCoreWorkspaces = new WeakSet<WorkspaceManager>();
let activeClusterLoaders: LazyClusterLoaders = DEFAULT_CLUSTER_LOADERS;
const lazyClusterPromises = new Map<LoadablePluginCluster, Promise<void>>();

/**
 * Extracts normalized candidate extensions (compound double-extension first, then
 * single extension) from a file extension, filename, or document URI.
 */
function extractNormalizedExtensions(langIdOrExt: string): string[] {
  const trimmed = langIdOrExt.trim().toLowerCase();
  if (!trimmed) return [];
  // Strip query/fragment if a URI was supplied
  const clean = trimmed.split(/[?#]/, 1)[0] ?? trimmed;
  const lastSlash = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  const base = lastSlash >= 0 ? clean.slice(lastSlash + 1) : clean;
  const lastDot = base.lastIndexOf(".");
  if (lastDot < 0) return [];
  const singleExt = base.slice(lastDot);
  const prevDot = lastDot > 0 ? base.lastIndexOf(".", lastDot - 1) : -1;
  if (prevDot >= 0) {
    const compoundExt = base.slice(prevDot);
    return [compoundExt, singleExt];
  }
  return [singleExt];
}

/**
 * Resolves a language ID, file extension, or document URI to the exact list of
 * lazy-loadable plugin clusters required to serve it. Returns an empty array for
 * core languages.
 */
export function resolveLazyPluginClusters(langIdOrExt: string): readonly LoadablePluginCluster[] {
  const norm = langIdOrExt.trim().toLowerCase();
  if (!norm) return [];
  if (norm === "__all__" || norm === "all") {
    return ALL_LOADABLE_CLUSTERS;
  }
  if (CORE_LANGUAGE_IDS.has(norm)) {
    return [];
  }
  const directCluster = LANGUAGE_ID_TO_CLUSTER.get(norm);
  if (directCluster) {
    return [directCluster];
  }
  const exts = extractNormalizedExtensions(norm);
  for (const ext of exts) {
    if (CORE_EXTENSIONS.has(ext)) {
      return [];
    }
    const exactCluster = EXTENSION_TO_CLUSTER.get(ext);
    if (exactCluster) {
      return [exactCluster];
    }
    const ambiguous = AMBIGUOUS_EXTENSION_CLUSTERS[ext];
    if (ambiguous) {
      return ambiguous;
    }
  }
  return ALL_LOADABLE_CLUSTERS;
}

/**
 * Classifies a language ID, file extension, or document URI into the minimal
 * lazy-loading plugin cluster required to serve it.
 */
export function resolveLazyPluginCluster(langIdOrExt: string): LazyPluginCluster {
  const clusters = resolveLazyPluginClusters(langIdOrExt);
  if (clusters.length === 0) return "core";
  if (clusters.length === 1) return clusters[0]!;
  return "all";
}

/**
 * Overrides lazy cluster loaders in unit tests. Pass `null` to restore defaults.
 * @internal
 */
export function setLazyClusterLoadersForTest(loaders: Partial<LazyClusterLoaders> | null): void {
  activeClusterLoaders = loaders ? { ...DEFAULT_CLUSTER_LOADERS, ...loaders } : DEFAULT_CLUSTER_LOADERS;
  lazyClusterPromises.clear();
}

/**
 * Resets cached lazy-loading promises in unit tests.
 * @internal
 */
export function resetLazyPluginLoaderStateForTest(): void {
  lazyClusterPromises.clear();
}

/**
 * Registers the 9 core parser-backed language plugins (`modelica`, `sysml2`, `sysml`,
 * `step`, `owl2`, `csv`, `las`, `scad`, `modelscript`) without statically importing
 * the remaining ~160 domain & heritage language packages.
 *
 * Used by `browserServerMain.ts` so the ESM worker bundle stays small and loads
 * non-core language plugins lazily on demand via `ensureLazyLanguagePluginLoaded()`.
 */
export function registerCoreLanguagePlugins(options: CorePluginsOptions): void {
  const { workspaceManager, parserService, connection } = options;

  if (registeredCoreWorkspaces.has(workspaceManager)) {
    for (const [id, wsKey] of [
      ["modelica", "modelica"],
      ["sysml2", "sysml2"],
      ["sysml", "sysml2"],
      ["owl2", "owl2"],
    ] as const) {
      const ws = workspaceManager.getWorkspaceIndex(wsKey);
      const plugin = globalLanguageRegistry.getPluginById(id);
      if (ws && plugin && !plugin.workspaceIndex) {
        plugin.workspaceIndex = ws;
      }
    }
    return;
  }
  registeredCoreWorkspaces.add(workspaceManager);

  function ensureWorkspaceIndex<T>(
    id: string,
    factory: () => T,
    langFallback?: Parameters<typeof workspaceManager.unifiedWorkspace.registerWorkspace>[2],
  ): T {
    let ws = workspaceManager.getWorkspaceIndex(id);
    if (!ws) {
      ws = factory() as unknown as NonNullable<ReturnType<typeof workspaceManager.getWorkspaceIndex>>;
      workspaceManager.setWorkspaceIndex(id, ws);
    }
    workspaceManager.unifiedWorkspace.registerWorkspace(
      id,
      ws as Parameters<typeof workspaceManager.unifiedWorkspace.registerWorkspace>[1],
      langFallback ?? { priority: 2 },
    );
    return ws as unknown as T;
  }

  function registerParserBackedPlugin(
    plugin: LanguagePlugin,
    opts?: { parserKey?: string; queryEngineKey?: string | false },
  ): void {
    const parserKey = opts?.parserKey ?? plugin.id;
    const descriptors: PropertyDescriptorMap = {
      parser: {
        enumerable: true,
        configurable: true,
        get() {
          return parserService?.getParser(parserKey);
        },
        set(val: WasmParserInstance | null | undefined) {
          if (parserService && parserService.getParser(parserKey) !== val) {
            parserService.registerParser(parserKey, val);
          }
        },
      },
      facade: {
        enumerable: true,
        configurable: true,
        get() {
          return parserService?.getFacade(parserKey);
        },
        set(val: WasmFacadeInstance | null | undefined) {
          if (parserService && parserService.getFacade(parserKey) !== val) {
            parserService.registerParser(parserKey, parserService.getParser(parserKey), val);
          }
        },
      },
    };
    if (opts?.queryEngineKey !== false && opts?.queryEngineKey !== undefined) {
      const qeKey = opts.queryEngineKey;
      descriptors["queryEngine"] = {
        enumerable: true,
        configurable: true,
        get() {
          return workspaceManager.getQueryEngine(qeKey) ?? undefined;
        },
        set(val: QueryEngine | null | undefined) {
          workspaceManager.setQueryEngine(qeKey, val ?? null);
        },
      };
    }
    Object.defineProperties(plugin, descriptors);
    globalLanguageRegistry.register(plugin);
  }

  ensureWorkspaceIndex("modelica", () => workspaceManager.getWorkspaceIndex("modelica"), modelicaLangFallback);
  ensureWorkspaceIndex("sysml2", () => workspaceManager.getWorkspaceIndex("sysml2"), sysml2LangFallback);
  ensureWorkspaceIndex("sysml", () => workspaceManager.getWorkspaceIndex("sysml2"), sysml2LangFallback);
  ensureWorkspaceIndex("owl2", () => workspaceManager.getWorkspaceIndex("owl2"), owl2LangFallback);

  const fullDocReplaceEdit = (doc: FullTextDocumentLike, newText: string) => {
    const lastLine = doc.lineCount - 1;
    const lastChar = doc.getText().length - doc.offsetAt({ line: lastLine, character: 0 });
    return [{ range: { start: { line: 0, character: 0 }, end: { line: lastLine, character: lastChar } }, newText }];
  };

  registerParserBackedPlugin(
    {
      id: "modelica",
      name: "Modelica",
      extensions: [".mo", ".mos", ".msim"],
      workspaceIndex: workspaceManager.getWorkspaceIndex("modelica"),
      createQueryEngine: (
        idx: Parameters<typeof createModelicaQueryEngine>[0],
        tree?: Parameters<typeof createModelicaQueryEngine>[1],
      ) => createModelicaQueryEngine(idx, tree),
      languageDef: modelicaLanguage,
      handlers: modelicaLanguage.lsp?.handlers,
      customHandlers: {
        codeLens: (doc, ctx) =>
          getModelicaCodeLenses(
            doc as Parameters<typeof getModelicaCodeLenses>[0],
            ctx as Parameters<typeof getModelicaCodeLenses>[1],
          ),
        format: (doc: FullTextDocumentLike, _options?: PluginFormattingOptions, ctx?: PluginFormatContext) => {
          if (ctx?.isParserReady && !ctx.isParserReady()) return [];
          const tree = ctx?.getDocumentTree?.(doc.uri);
          if (!tree) return [];
          return fullDocReplaceEdit(
            doc,
            formatModelicaTree(tree as Parameters<typeof formatModelicaTree>[0], doc.getText()),
          );
        },
      },
      actionHandlers: modelicaActionHandlers,
    },
    { queryEngineKey: "modelica" },
  );

  for (const sysmlId of ["sysml", "sysml2"] as const) {
    registerParserBackedPlugin(
      {
        id: sysmlId,
        name: "SysML v2",
        extensions: [".sysml", ".sysml2", ".kerml"],
        workspaceIndex: workspaceManager.getWorkspaceIndex("sysml2"),
        createQueryEngine: (
          idx: Parameters<typeof createSysML2QueryEngine>[0],
          tree?: Parameters<typeof createSysML2QueryEngine>[1],
        ) => createSysML2QueryEngine(idx, tree),
        languageDef: sysml2LangFallback,
        customHandlers: {
          codeLens: (doc: DocInput, ctx?: PluginCodeLensContext) =>
            getSysml2CodeLenses(
              ctx?.text ?? docText(doc),
              ctx?.uri ?? docUri(doc),
              ctx as Parameters<typeof getSysml2CodeLenses>[2],
            ),
          format: (doc: FullTextDocumentLike, options?: PluginFormattingOptions) =>
            fullDocReplaceEdit(
              doc,
              formatSysmlSource(doc.getText(), {
                tabSize: options?.tabSize,
                insertSpaces: options?.insertSpaces,
              }),
            ),
          rangeFormat: (doc: FullTextDocumentLike, range: Range, options?: PluginFormattingOptions) =>
            fullDocReplaceEdit(
              doc,
              formatSysmlSource(doc.getText(), {
                tabSize: options?.tabSize,
                insertSpaces: options?.insertSpaces,
                startLine: range?.start?.line,
                endLine: range?.end?.line,
              }),
            ),
        },
        semanticLegend: sysml2SemanticLegend,
      },
      { parserKey: "sysml2", queryEngineKey: "sysml2" },
    );
  }

  registerParserBackedPlugin(
    {
      id: "step",
      name: "STEP",
      extensions: [".step", ".stp", ".p21"],
      languageDef: stepLanguage,
      handlers: stepLanguage.lsp?.handlers,
      customHandlers: {
        definition: (offset: number, text: string, uri?: string) =>
          getStepDefinition(text, offset, uri ?? "", workspaceManager.unifiedWorkspace),
        references: (offset: number, text: string, uri?: string) =>
          getStepReferences(text, offset, uri ?? "", workspaceManager.unifiedWorkspace),
        hover: (offset: number, text: string, uri?: string) => getStepHover(offset, text, uri),
        signatureHelp: (doc: Parameters<typeof getStepSignatureHelp>[0], position: Position) =>
          getStepSignatureHelp(doc, position),
        format: (doc: Parameters<typeof formatStepDocument>[0]) => formatStepDocument(doc),
        codeLens: (doc: DocInput, ctx?: PluginCodeLensContext) =>
          getStepCodeLenses(
            ctx?.text ?? docText(doc),
            ctx?.uri ?? docUri(doc),
            ctx as Parameters<typeof getStepCodeLenses>[2],
          ),
        semanticTokens: (doc: DocInput, tree?: unknown) =>
          computeStepSemanticTokensData(docText(doc), tree as Parameters<typeof computeStepSemanticTokensData>[1]),
      },
    },
    { queryEngineKey: "step" },
  );

  registerParserBackedPlugin(
    {
      id: "owl2",
      name: "OWL2",
      extensions: [".owl", ".owl2", ".ttl", ".ofn", ".fss", ".owx"],
      get workspaceIndex() {
        return workspaceManager.getWorkspaceIndex("owl2");
      },
      createQueryEngine: (
        idx: Parameters<typeof createOWL2QueryEngine>[0],
        tree?: Parameters<typeof createOWL2QueryEngine>[1],
      ) => createOWL2QueryEngine(idx, tree),
      languageDef: owl2LangFallback,
      customHandlers: {
        codeLens: (_doc: DocInput, ctx?: PluginCodeLensContext) => ({
          appendUniversal: true,
          lenses: ctx?.flags?.["showVerification"]
            ? [
                {
                  range: ctx.headerRange ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                  command: {
                    title: "✓ Verify Ontology Consistency (Description Logic Tableau)",
                    command: "modelscript.openContractExplorer",
                    arguments: [ctx?.uri ?? ""],
                  },
                },
              ]
            : [],
        }),
        semanticTokens: (doc: DocInput, tree?: unknown) =>
          computeOwl2SemanticTokensData(
            docText(doc),
            tree as Parameters<typeof computeOwl2SemanticTokensData>[1],
            docUri(doc) || undefined,
          ),
      },
    },
    { queryEngineKey: "owl2" },
  );

  registerParserBackedPlugin({
    id: "csv",
    name: "CSV",
    extensions: [".csv"],
    languageDef: csvLangFallback,
    customHandlers: {
      codeLens: (_doc: DocInput, ctx?: PluginCodeLensContext) => ({
        appendUniversal: true,
        lenses: ctx?.flags?.["showSimulate"]
          ? [
              {
                range: ctx.headerRange ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                command: {
                  title: "📊 Plot CSV Telemetry Series",
                  command: "modelscript.openSimulationView",
                  arguments: [ctx?.uri ?? ""],
                },
              },
            ]
          : [],
      }),
      validate: async (doc: DocInput) => {
        const { lintCsv } = await import("@modelscript/csv/csv-parser");
        return lintCsv(docText(doc));
      },
    },
  });

  registerParserBackedPlugin({
    id: "las",
    name: "LAS Well Log",
    extensions: [".las"],
    languageDef: lasLangFallback,
    customHandlers: {
      validate: async (doc: { getText?(): string } | string) => {
        const { lintLas } = await import("@modelscript/las/las-parser");
        return lintLas(docText(doc));
      },
    },
  });

  registerParserBackedPlugin({
    id: "scad",
    name: "OpenSCAD",
    extensions: [".scad"],
    languageDef: scadLangFallback,
    customHandlers: {
      definition: (offset: number, text: string, uri?: string) =>
        getScadDefinition(text, offset, uri ?? "", workspaceManager.unifiedWorkspace),
      references: (offset: number, text: string, uri?: string) =>
        getScadReferences(text, offset, uri ?? "", workspaceManager.unifiedWorkspace),
      codeLens: (doc: DocInput, ctx?: PluginCodeLensContext) =>
        getScadCodeLenses(
          ctx?.text ?? docText(doc),
          ctx?.uri ?? docUri(doc),
          ctx as Parameters<typeof getScadCodeLenses>[2],
        ),
    },
  });

  registerParserBackedPlugin(
    {
      id: "modelscript",
      name: "ModelScript",
      extensions: [".modelscript", ".msx"],
      workspaceIndex: workspaceManager.getWorkspaceIndex("modelscript"),
      languageDef: modelscriptLangFallback,
      handlers: modelscriptLangFallback.lsp?.handlers,
      customHandlers: {
        codeLens: (_doc: DocInput, ctx?: PluginCodeLensContext) => {
          const range = ctx?.headerRange ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
          const uri = ctx?.uri ?? "";
          const out: CodeLens[] = [];
          if (ctx?.flags?.["showSimulate"]) {
            out.push({
              range,
              command: {
                title: "▶ Simulate ModelScript Study",
                command: "modelscript.action.simulate",
                arguments: [uri],
              },
            });
          }
          if (ctx?.flags?.["showVerification"]) {
            out.push({
              range,
              command: {
                title: "✓ Verify Formal Contracts",
                command: "modelscript.openContractExplorer",
                arguments: [uri],
              },
            });
          }
          return { appendUniversal: true, lenses: out };
        },
      },
    },
    { queryEngineKey: "modelscript" },
  );

  if (
    workspaceManager?.unifiedWorkspace &&
    typeof workspaceManager.unifiedWorkspace.registerLanguageDef === "function"
  ) {
    for (const plugin of globalLanguageRegistry.getAllPlugins()) {
      if (plugin.languageDef) {
        workspaceManager.unifiedWorkspace.registerLanguageDef(plugin.id, plugin.languageDef);
      }
    }
  }

  if (connection) {
    connection.console.info("[lsp] Core language plugins registered.");
  }
}

function ensureClusterLoaded(cluster: LoadablePluginCluster, options: CorePluginsOptions): Promise<void> {
  const existing = lazyClusterPromises.get(cluster);
  if (existing) {
    return existing;
  }
  const promise = activeClusterLoaders[cluster](options).catch((err: unknown) => {
    lazyClusterPromises.delete(cluster);
    throw err;
  });
  lazyClusterPromises.set(cluster, promise);
  return promise;
}

/**
 * Lazily loads and registers only the minimal non-core plugin cluster(s) required
 * for `langIdOrExt` (one of the 7 domain clusters, `heritage`, the matching subset
 * for an ambiguous shared extension, or all 8 clusters for `"__all__"`).
 *
 * In an ESM code-split browser worker, this ensures opening a single file loads only
 * its ~5–32 language domain cluster instead of all ~160 non-core language packages.
 */
export async function ensureLazyLanguagePluginLoaded(langIdOrExt: string, options: CorePluginsOptions): Promise<void> {
  const clusters = resolveLazyPluginClusters(langIdOrExt);
  if (clusters.length === 0) {
    return;
  }

  if (clusters.length === 1) {
    const norm = langIdOrExt.trim().toLowerCase();
    if (globalLanguageRegistry.getPluginById(norm)) {
      return;
    }
    await ensureClusterLoaded(clusters[0]!, options);
    return;
  }

  await Promise.all(clusters.map((cluster) => ensureClusterLoaded(cluster, options)));
}
