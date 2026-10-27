// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { encodeMorselPermalink } from "../components/morsel/util/permalink";
import { safeJsonParse } from "./json";

export const MULTI_FILE_VIEW_TYPES = new Set([
  "repository",
  "repo",
  "package",
  "library",
  "ssp",
  "ssd",
  "fmu",
  "fmu-package",
  "fmu-simulator",
  "fmi",
  "aas-package",
  "hardware-project",
  "cyber-physical-system",
  "solution",
  "engineering-app",
  "app",
]);

export const EXTENSION_TO_DIALECT: Record<string, string> = {
  ".mo": "modelica",
  ".mos": "modelica",
  ".msim": "modelica",
  ".sysml": "sysml2",
  ".sysml2": "sysml2",
  ".kerml": "sysml2",
  ".scad": "scad",
  ".step": "step",
  ".stp": "step",
  ".p21": "step",
  ".owl": "owl2",
  ".owl2": "owl2",
  ".ofn": "owl2",
  ".ttl": "owl2",
  ".csv": "csv",
  ".tsv": "csv",
  ".cfg": "cfd",
  ".cfgt": "cfd",
  ".su2": "cfd",
  ".inp": "fea",
  ".inpt": "fea",
  ".bdf": "fea",
  ".fem": "fea",
  ".ssp": "ssp",
  ".ssd": "ssp",
  ".pscx": "pscad",
  ".pslx": "pscad",
  ".pswx": "pscad",
  ".psmx": "pscad",
  ".raw": "psse",
  ".con": "psse",
  ".inl": "psse",
  ".seq": "psse",
  ".tsimf": "gensys",
  ".gpf": "gensys",
  ".calc": "gensys",
  ".run": "gensys",
  ".sub": "gensys",
  ".spck": "simpack",
  ".sim": "simpack",
  ".mbs": "simpack",
  ".msx": "modelscript",
  ".ms": "modelscript",
  ".sp": "spice",
  ".cir": "spice",
  ".spice": "spice",
  ".net": "spice",
  ".va": "verilog-a",
  ".vams": "verilog-a",
  ".c": "c",
  ".h": "c",
  ".f90": "fortran",
  ".f": "fortran",
  ".for": "fortran",
  ".f95": "fortran",
  ".st": "plcopen",
  ".plc": "plcopen",
  ".arxml": "autosar",
  ".slx": "simulink",
  ".mdl": "simulink",
  ".reqif": "reqif",
  ".ccsds": "ccsds",
  ".oem": "ccsds",
  ".omm": "ccsds",
  ".xodr": "opendrive",
  ".xosc": "openscenario",
  ".osc": "openscenario",
  ".urdf": "urdf",
  ".acf": "adams",
  ".adm": "adams",
  ".cmd": "adams",
  ".sima": "sima",
  ".opi": "olga",
  ".olga": "olga",
  ".genkey": "olga",
  ".lps": "lps",
  ".tgx": "lps",
  ".tlx": "lps",
  ".epanet": "epanet",
  ".swmm": "swmm",
  ".gtm": "gtsuite",
  ".gtd": "gtsuite",
  ".gtx": "gtsuite",
  ".gt": "gtsuite",
  ".ez5": "easy5",
  ".ezm": "easy5",
  ".ezd": "easy5",
  ".eas": "easy5",
  ".roc": "rocets",
  ".deck": "rocets",
  ".r5": "relap5",
  ".relap5": "relap5",
  ".idf": "energyplus",
  ".aspen": "aspen",
  ".bkp": "aspen",
  ".data": "eclipse",
  ".eclipse": "eclipse",
  ".sbml": "sbml",
  ".jsbsim": "jsbsim",
  ".s1p": "touchstone",
  ".s2p": "touchstone",
  ".s3p": "touchstone",
  ".s4p": "touchstone",
  ".ibs": "ibis",
  ".ibis": "ibis",
  ".dss": "opendss",
  ".opendss": "opendss",
};

export const DIALECT_TO_EXTENSION: Record<string, string> = {
  modelica: ".mo",
  sysml2: ".sysml",
  sysml: ".sysml",
  scad: ".scad",
  step: ".step",
  owl2: ".owl",
  owl: ".owl",
  csv: ".csv",
  cfd: ".cfg",
  fea: ".inp",
  ssp: ".ssd",
  pscad: ".pscx",
  psse: ".raw",
  gensys: ".tsimf",
  simpack: ".spck",
  modelscript: ".msx",
  spice: ".sp",
  "verilog-a": ".va",
  c: ".c",
  fortran: ".f90",
  plcopen: ".st",
  autosar: ".arxml",
  simulink: ".mdl",
  reqif: ".reqif",
  ccsds: ".oem",
  opendrive: ".xodr",
  openscenario: ".xosc",
  urdf: ".urdf",
  adams: ".adm",
  sima: ".sima",
  olga: ".opi",
  lps: ".lps",
  epanet: ".inp",
  swmm: ".swmm",
  gtsuite: ".gtm",
  easy5: ".ez5",
  rocets: ".roc",
  relap5: ".r5",
  energyplus: ".idf",
  aspen: ".aspen",
  eclipse: ".data",
  sbml: ".sbml",
  jsbsim: ".jsbsim",
  touchstone: ".s2p",
  ibis: ".ibs",
  opendss: ".dss",
};

export const VIEW_TYPE_TO_DIALECT: Record<string, string> = {
  "modelica-code": "modelica",
  "modelica-diagram": "modelica",
  morsel: "modelica",
  "polyglot-morsel": "modelica",
  simulation: "modelica",
  "simulation-plot": "modelica",
  "simulation-result": "modelica",
  sysml: "sysml2",
  sysml2: "sysml2",
  "sysml-architecture-viewer": "sysml2",
  kerml: "sysml2",
  scad: "scad",
  openscad: "scad",
  cad: "step",
  "cad-step": "step",
  cad_step: "step",
  "cad-3d-viewer": "step",
  step: "step",
  stp: "step",
  owl: "owl2",
  owl2: "owl2",
  csv: "csv",
  tsv: "csv",
  dataset: "csv",
  "dataset-table": "csv",
  "cfd-config": "cfd",
  "cfd-su2": "cfd",
  "cfd-result": "cfd",
  "cfd-animation": "cfd",
  cfd: "cfd",
  "fea-deck": "fea",
  "fea-inp": "fea",
  "fea-result": "fea",
  fea: "fea",
  ssp: "ssp",
  ssd: "ssp",
  pscad: "pscad",
  pscx: "pscad",
  pslx: "pscad",
  psout: "pscad",
  psse: "psse",
  raw: "psse",
  gensys: "gensys",
  calc: "gensys",
  run: "gensys",
  sub: "gensys",
  simpack: "simpack",
  spck: "simpack",
  sim: "simpack",
  mbs: "simpack",
  modelscript: "modelscript",
  msx: "modelscript",
  spice: "spice",
  "verilog-a": "verilog-a",
  c: "c",
  fortran: "fortran",
  plcopen: "plcopen",
  autosar: "autosar",
  simulink: "simulink",
  reqif: "reqif",
  ccsds: "ccsds",
  opendrive: "opendrive",
  openscenario: "openscenario",
  urdf: "urdf",
  adams: "adams",
  sima: "sima",
  olga: "olga",
  opi: "olga",
  lps: "lps",
  pipelinestudio: "lps",
  epanet: "epanet",
  swmm: "swmm",
  gtsuite: "gtsuite",
  gtm: "gtsuite",
  easy5: "easy5",
  ez5: "easy5",
  rocets: "rocets",
  roc: "rocets",
  relap5: "relap5",
  energyplus: "energyplus",
  aspen: "aspen",
  eclipse: "eclipse",
  sbml: "sbml",
  jsbsim: "jsbsim",
  touchstone: "touchstone",
  ibis: "ibis",
  opendss: "opendss",
};

export function getExtensionForDialect(dialect: string): string {
  const normalized = (dialect || "modelica").toLowerCase().trim();
  return DIALECT_TO_EXTENSION[normalized] || ".mo";
}

export function inferDialectFromFilename(filename?: string | null): string | null {
  if (!filename || typeof filename !== "string") return null;
  const clean = filename.split("?")[0]?.split("#")[0]?.trim().toLowerCase() || "";
  const lastDot = clean.lastIndexOf(".");
  if (lastDot === -1) return null;
  const ext = clean.slice(lastDot);
  return EXTENSION_TO_DIALECT[ext] || null;
}

function unwrapViewConfig(artifactOrConfig: any): { viewType: string; viewConfig: any } {
  if (!artifactOrConfig || typeof artifactOrConfig !== "object") {
    return { viewType: "", viewConfig: {} };
  }
  const rawViewConfig =
    artifactOrConfig.view_config !== undefined
      ? typeof artifactOrConfig.view_config === "string"
        ? safeJsonParse(artifactOrConfig.view_config, {})
        : artifactOrConfig.view_config || {}
      : artifactOrConfig.viewConfig !== undefined
        ? typeof artifactOrConfig.viewConfig === "string"
          ? safeJsonParse(artifactOrConfig.viewConfig, {})
          : artifactOrConfig.viewConfig || {}
        : artifactOrConfig;

  const viewType = String(
    artifactOrConfig.view_type ||
      artifactOrConfig.viewType ||
      rawViewConfig?.view_type ||
      rawViewConfig?.viewType ||
      "",
  )
    .toLowerCase()
    .trim();

  return {
    viewType,
    viewConfig: rawViewConfig && typeof rawViewConfig === "object" ? rawViewConfig : {},
  };
}

/**
 * Determines whether an artifact or its viewConfig represents a multi-file workspace
 * that should open in the full VS Code Workbench (/ide) rather than the single-file
 * Simulation Playground (/playground).
 */
export function isMultiFileArtifact(artifactOrConfig: any): boolean {
  const { viewType, viewConfig } = unwrapViewConfig(artifactOrConfig);

  if (viewConfig.isMultiFile === true || artifactOrConfig?.isMultiFile === true) {
    return true;
  }

  const files = viewConfig.files ?? artifactOrConfig?.files;
  if (Array.isArray(files) && files.length > 1) {
    return true;
  }
  if (files && typeof files === "object" && !Array.isArray(files) && Object.keys(files).length > 1) {
    return true;
  }

  if (viewType && MULTI_FILE_VIEW_TYPES.has(viewType)) {
    return true;
  }

  return false;
}

/**
 * Infers the canonical ModelScript language/dialect ID across all 44 supported engineering domains
 * from an artifact record, viewConfig object, or filename/title.
 */
export function inferDialectFromArtifact(artifactOrConfig: any, title?: string): string {
  const { viewType, viewConfig } = unwrapViewConfig(artifactOrConfig);

  // 1. Explicit dialect/language field in viewConfig or top-level object
  const explicitDialect =
    viewConfig.dialect ||
    viewConfig.language ||
    viewConfig.lang ||
    artifactOrConfig?.dialect ||
    artifactOrConfig?.language ||
    artifactOrConfig?.lang;
  if (typeof explicitDialect === "string" && explicitDialect.trim()) {
    const norm = explicitDialect.trim().toLowerCase();
    if (norm === "sysml") return "sysml2";
    if (norm === "owl") return "owl2";
    if (VIEW_TYPE_TO_DIALECT[norm]) return VIEW_TYPE_TO_DIALECT[norm]!;
    if (DIALECT_TO_EXTENSION[norm]) return norm;
    return norm;
  }

  // 2. Check filename / title / primaryFile / url extensions
  const candidateNames = [
    title,
    viewConfig.primaryFile,
    viewConfig.filename,
    viewConfig.fileName,
    viewConfig.title,
    artifactOrConfig?.title,
    artifactOrConfig?.name,
    viewConfig.url,
  ];
  for (const candidate of candidateNames) {
    const fromExt = inferDialectFromFilename(candidate);
    if (fromExt) return fromExt;
  }

  // 3. If files map has keys, check the first file key extension
  const files = viewConfig.files ?? artifactOrConfig?.files;
  if (files && typeof files === "object" && !Array.isArray(files)) {
    for (const filePath of Object.keys(files)) {
      const fromExt = inferDialectFromFilename(filePath);
      if (fromExt) return fromExt;
    }
  } else if (Array.isArray(files)) {
    for (const entry of files) {
      const name = typeof entry === "string" ? entry : entry?.path || entry?.name;
      const fromExt = inferDialectFromFilename(name);
      if (fromExt) return fromExt;
    }
  }

  // 4. Map from view_type
  if (viewType && VIEW_TYPE_TO_DIALECT[viewType]) {
    return VIEW_TYPE_TO_DIALECT[viewType]!;
  }

  return "modelica";
}

export interface BuildEditorUrlOptions {
  artifactId?: number | string | undefined;
  viewType?: string | undefined;
  viewConfig?: any;
  code?: string | undefined;
  title?: string | undefined;
  dialect?: string | undefined;
  mode?: "open" | "fork" | "edit" | "reply" | undefined;
  editPostId?: number | undefined;
  replyToPostId?: number | undefined;
}

/**
 * Builds the canonical URL to open, fork, edit, or reply to an artifact:
 * - Single-file artifacts route to `/playground`
 * - Multi-file artifacts route to `/ide`
 */
export function buildEditorUrlForArtifact(options: BuildEditorUrlOptions): string {
  const parsedViewConfig =
    typeof options.viewConfig === "string"
      ? safeJsonParse(options.viewConfig, {})
      : options.viewConfig && typeof options.viewConfig === "object"
        ? options.viewConfig
        : {};

  const combined = {
    view_type: options.viewType || parsedViewConfig.view_type || parsedViewConfig.viewType,
    view_config: parsedViewConfig,
    title: options.title || parsedViewConfig.title,
  };

  const multiFile = isMultiFileArtifact(combined);
  const dialect = options.dialect || inferDialectFromArtifact(combined, options.title);
  const artifactId = options.artifactId ?? parsedViewConfig.artifactId ?? parsedViewConfig.id;
  const title =
    options.title ||
    parsedViewConfig.title ||
    parsedViewConfig.modelName ||
    parsedViewConfig.projectTitle ||
    parsedViewConfig.networkTitle ||
    parsedViewConfig.engineName ||
    "";

  // Extract single-file source code if available
  let code =
    options.code ??
    parsedViewConfig.code ??
    parsedViewConfig.modelicaCode ??
    parsedViewConfig.source ??
    parsedViewConfig.content ??
    "";

  if (
    !code &&
    parsedViewConfig.files &&
    typeof parsedViewConfig.files === "object" &&
    !Array.isArray(parsedViewConfig.files)
  ) {
    const entries = Object.entries(parsedViewConfig.files);
    if (entries.length === 1 && typeof entries[0]![1] === "string") {
      code = entries[0]![1];
    }
  }

  if (multiFile) {
    const params = new URLSearchParams();
    if (artifactId !== undefined && artifactId !== null && String(artifactId) !== "") {
      params.set("fromArtifact", String(artifactId));
    }
    if (dialect) {
      params.set("lang", dialect);
    }
    if (title) {
      params.set("title", title);
    }
    if (options.editPostId !== undefined) {
      params.set("editPostId", String(options.editPostId));
    }
    if (options.replyToPostId !== undefined) {
      params.set("replyToPostId", String(options.replyToPostId));
    }
    const qs = params.toString();
    const hash =
      artifactId !== undefined && artifactId !== null && String(artifactId) !== ""
        ? `#memfs:artifact-${artifactId}`
        : "";
    return `/ide${qs ? `?${qs}` : ""}${hash}`;
  }

  // Single-file -> /playground
  const params = new URLSearchParams();
  if (artifactId !== undefined && artifactId !== null && String(artifactId) !== "") {
    params.set("fromArtifact", String(artifactId));
  }
  if (dialect) {
    params.set("lang", dialect);
  }
  if (title) {
    params.set("title", title);
  }
  if (options.editPostId !== undefined) {
    params.set("editPostId", String(options.editPostId));
  }
  if (options.replyToPostId !== undefined) {
    params.set("replyToPostId", String(options.replyToPostId));
  }

  let hash = "";
  if (typeof code === "string" && code.trim().length > 0) {
    const encoded = encodeMorselPermalink({
      code,
      title: title || "Shared Model",
      dialect,
      isMultiFile: false,
      ...(artifactId !== undefined && artifactId !== null ? { artifactId: String(artifactId) } : {}),
    });
    hash = `#m=${encoded}`;
  }

  const qs = params.toString();
  return `/playground${qs ? `?${qs}` : ""}${hash}`;
}
