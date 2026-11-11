// SPDX-License-Identifier: AGPL-3.0-or-later

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
  ".usd": "usd",
  ".usda": "usd",
  ".usdz": "usd",
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
  ".plcopen": "plcopen",
  ".iec": "plcopen",
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
  ".qif": "qif",
  ".oscal": "oscal",
  ".aml": "automationml",
  ".caex": "automationml",
  ".3mf": "three-mf",
  ".gproms": "gproms",
  ".gPJ": "gproms",
  ".cti": "cantera",
  ".pqi": "phreeqc",
  ".phrq": "phreeqc",
  ".smi": "smiles",
  ".smiles": "smiles",
  ".ant": "antimony",
  ".bngl": "bngl",
  ".cellml": "cellml",
  ".sedml": "sedml",
  ".sbol": "sbol",
  ".gb": "genbank",
  ".gbk": "genbank",
  ".genbank": "genbank",
  ".pdb": "pdb",
  ".ent": "pdb",
  ".ctl": "nmtran",
  ".mod": "nmtran",
  ".nmtran": "nmtran",
  ".osim": "opensim",
  ".feb": "febio",
  ".dcm": "dicom-rt",
  ".nii": "nifti",
  ".topas": "topas",
  ".igtl": "igtl",
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
  qif: ".qif",
  oscal: ".oscal.json",
  automationml: ".aml",
  aml: ".aml",
  "three-mf": ".3mf",
  gproms: ".gproms",
  cantera: ".cti.yaml",
  phreeqc: ".pqi",
  smiles: ".smi",
  antimony: ".ant",
  bngl: ".bngl",
  cellml: ".cellml",
  sedml: ".sedml",
  sbol: ".sbol",
  genbank: ".gb",
  pdb: ".pdb",
  nmtran: ".ctl",
  opensim: ".osim",
  febio: ".feb",
  "dicom-rt": ".dcm.json",
  nifti: ".nii.json",
  topas: ".topas",
  igtl: ".igtl.json",
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
  usd: "usd",
  usda: "usd",
  usdz: "usd",
  openusd: "usd",
  "usd-stage": "usd",
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
  qif: "qif",
  oscal: "oscal",
  automationml: "automationml",
  aml: "automationml",
  "three-mf": "three-mf",
  "3mf": "three-mf",
  gproms: "gproms",
  cantera: "cantera",
  phreeqc: "phreeqc",
  smiles: "smiles",
  antimony: "antimony",
  bngl: "bngl",
  cellml: "cellml",
  sedml: "sedml",
  sbol: "sbol",
  genbank: "genbank",
  pdb: "pdb",
  nmtran: "nmtran",
  opensim: "opensim",
  febio: "febio",
  "dicom-rt": "dicom-rt",
  nifti: "nifti",
  topas: "topas",
  igtl: "igtl",
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
 * that should open in the full Studio Workbench (/studio) rather than the single-file
 * interactive Morsel (/morsel).
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

export const NON_EDITABLE_MEDIA_VIEW_TYPES = new Set([
  "pdf",
  "picture",
  "image",
  "video",
  "youtube_video",
  "audio",
  "link-preview",
  "package",
  "library",
  "repository",
  "repo",
  "solution",
  "engineering-app",
  "app",
]);

/**
 * Determines whether an artifact represents an editable/simulatable engineering model,
 * code snippet, dataset, or workspace that makes sense to open in Morsel or Studio,
 * vs. static media/document assets (PDFs, images, videos, audio, link previews).
 */
export function isEditableCodeOrModelArtifact(artifactOrConfig: unknown): boolean {
  const { viewType } = unwrapViewConfig(artifactOrConfig);
  if (!viewType) return true;
  return !NON_EDITABLE_MEDIA_VIEW_TYPES.has(viewType);
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
  diagramType?: string | undefined;
  mode?: "open" | "fork" | "edit" | "reply" | undefined;
  editPostId?: number | undefined;
  replyToPostId?: number | undefined;
}

/**
 * Builds the canonical URL to open, fork, edit, or reply to an artifact:
 * - Single-file artifacts route to `/morsel`
 * - Multi-file artifacts route to `/studio`
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
      artifactId !== undefined && artifactId !== null && String(artifactId) !== "" ? `#memfs:${artifactId}` : "";
    return `/studio${qs ? `?${qs}` : ""}${hash}`;
  }

  // Single-file -> /morsel
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

  // Derive target Morsel view from previewMode:
  // - "simulation": split view (code + simulation plot) with auto-simulate
  // - "diagram": split view (code + diagram schematic)
  // - "code": code view
  const previewMode =
    parsedViewConfig.previewMode ||
    (typeof parsedViewConfig.metadata === "object" && parsedViewConfig.metadata !== null
      ? parsedViewConfig.metadata["previewMode"]
      : undefined);

  const simPreview = parsedViewConfig.simulationPreview;
  const simStates: string[] = Array.isArray(simPreview?.states)
    ? simPreview.states
    : Array.isArray(parsedViewConfig.simulationVariables)
      ? parsedViewConfig.simulationVariables
      : Array.isArray(parsedViewConfig.states)
        ? parsedViewConfig.states
        : [];

  if (previewMode === "simulation") {
    params.set("view", "split");
    params.set("subview", "simulation");
    params.set("autoSimulate", "1");
  } else if (previewMode === "code") {
    params.set("view", "code");
  } else if (
    previewMode === "diagram" ||
    (!previewMode && (parsedViewConfig.nodeCount > 0 || parsedViewConfig.diagramSvg))
  ) {
    params.set("view", "split");
    params.set("subview", "diagram");
  }

  if (simStates.length > 0) {
    params.set("simVars", simStates.join(","));
  }
  if (typeof simPreview?.startTime === "number") {
    params.set("startTime", String(simPreview.startTime));
  }
  if (typeof simPreview?.stopTime === "number") {
    params.set("stopTime", String(simPreview.stopTime));
  }

  const explicitDiagramType =
    options.diagramType ||
    parsedViewConfig.diagramType ||
    (parsedViewConfig.diagramMode === "ibd" ? "IBD" : parsedViewConfig.diagramMode === "bdd" ? "BDD" : undefined);
  const targetDiagramType =
    explicitDiagramType ||
    (dialect === "sysml2" &&
    (parsedViewConfig.rootPartDef ||
      (Array.isArray(parsedViewConfig.parts) && parsedViewConfig.parts.length > 0) ||
      !parsedViewConfig.diagramType)
      ? "IBD"
      : undefined);

  if (targetDiagramType) {
    params.set("diagramType", targetDiagramType);
  }

  let hash = "";
  if (typeof code === "string" && code.trim().length > 0) {
    const dependencies =
      Array.isArray(parsedViewConfig.dependencies) && parsedViewConfig.dependencies.length > 0
        ? parsedViewConfig.dependencies
        : undefined;

    const encoded = encodeMorselPermalink({
      code,
      title: title || "Shared Model",
      dialect,
      isMultiFile: false,
      ...(artifactId !== undefined && artifactId !== null ? { artifactId: String(artifactId) } : {}),
      ...(dependencies ? { dependencies } : {}),
      ...(targetDiagramType ? { diagramType: targetDiagramType } : {}),
      ...(simStates.length > 0 || typeof simPreview?.startTime === "number" || typeof simPreview?.stopTime === "number"
        ? {
            sim: {
              ...(simStates.length > 0 ? { variables: simStates } : {}),
              ...(typeof simPreview?.startTime === "number" ? { startTime: simPreview.startTime } : {}),
              ...(typeof simPreview?.stopTime === "number" ? { stopTime: simPreview.stopTime } : {}),
            },
          }
        : {}),
    });
    hash = `#m=${encoded}`;
  }

  const qs = params.toString();
  return `/morsel${qs ? `?${qs}` : ""}${hash}`;
}

/**
 * Builds the standalone VS Code Web Workbench URL (`/vscode/workbench#...`) for an artifact.
 */
export function buildVsCodeWorkbenchUrlForArtifact(options: BuildEditorUrlOptions): string {
  const parsedViewConfig =
    typeof options.viewConfig === "string"
      ? safeJsonParse(options.viewConfig, {})
      : options.viewConfig && typeof options.viewConfig === "object"
        ? options.viewConfig
        : {};

  const artifactId = options.artifactId ?? parsedViewConfig.artifactId ?? parsedViewConfig.id;
  if (artifactId !== undefined && artifactId !== null && String(artifactId) !== "") {
    return `/vscode/workbench#memfs:${artifactId}`;
  }

  const templateId = parsedViewConfig.templateId || parsedViewConfig.template;
  if (typeof templateId === "string" && templateId.trim().length > 0) {
    return `/vscode/workbench#memfs:${templateId.trim()}`;
  }

  return `/vscode/workbench#memfs:scratch`;
}

/**
 * Opens an artifact or workspace directly in a new standalone VS Code window (`/vscode/workbench#...`)
 * and synchronizes any inline artifact payload / theme / auth credentials over `BroadcastChannel`.
 */
export function openArtifactInVsCodeWindow(options: BuildEditorUrlOptions): void {
  if (typeof window === "undefined") return;

  const parsedViewConfig =
    typeof options.viewConfig === "string"
      ? safeJsonParse(options.viewConfig, {})
      : options.viewConfig && typeof options.viewConfig === "object"
        ? options.viewConfig
        : {};

  const artifactId = options.artifactId ?? parsedViewConfig.artifactId ?? parsedViewConfig.id;
  const dialect =
    options.dialect ||
    inferDialectFromArtifact(
      {
        view_type: options.viewType || parsedViewConfig.view_type || parsedViewConfig.viewType,
        view_config: parsedViewConfig,
        title: options.title || parsedViewConfig.title,
      },
      options.title,
    );
  const ext = getExtensionForDialect(dialect);
  const rawTitle =
    options.title ||
    parsedViewConfig.title ||
    parsedViewConfig.modelName ||
    parsedViewConfig.projectTitle ||
    (artifactId ? `Artifact_${artifactId}${ext}` : `ScratchModel${ext}`);

  const viewType =
    options.viewType ||
    parsedViewConfig.view_type ||
    parsedViewConfig.viewType ||
    (dialect === "sysml2" ? "sysml" : "modelica-code");

  const code =
    options.code ??
    parsedViewConfig.code ??
    parsedViewConfig.modelicaCode ??
    parsedViewConfig.source ??
    parsedViewConfig.content;

  const enrichedConfig = {
    ...parsedViewConfig,
    ...(code !== undefined ? { code } : {}),
    dialect,
  };

  const hasInlinePayload = Object.keys(parsedViewConfig).length > 0 || code !== undefined;

  if (hasInlinePayload) {
    try {
      const artifactMeta = {
        id: artifactId || "scratch",
        artifactId: artifactId || "scratch",
        title: rawTitle,
        viewType,
        viewConfig: enrichedConfig,
        files: enrichedConfig.files,
        primaryFile: enrichedConfig.primaryFile || enrichedConfig.filename,
        dependencies: enrichedConfig.dependencies,
      };
      sessionStorage.setItem("modelscript.artifact_scratch", JSON.stringify(artifactMeta));
      localStorage.setItem("modelscript.artifact_scratch", JSON.stringify(artifactMeta));
      if (artifactId !== undefined && artifactId !== null && String(artifactId) !== "") {
        const artKey = `modelscript.artifact_${artifactId}`;
        sessionStorage.setItem(artKey, JSON.stringify(artifactMeta));
        localStorage.setItem(artKey, JSON.stringify(artifactMeta));
        localStorage.setItem(`modelscript:ide:memfs:${artifactId}`, JSON.stringify(artifactMeta));
        localStorage.setItem(`modelscript:ide:memfs:artifact-${artifactId}`, JSON.stringify(artifactMeta));
      }
    } catch {
      // ignore storage quota errors
    }
  }

  const workbenchUrl = buildVsCodeWorkbenchUrlForArtifact(options);
  window.open(workbenchUrl, "_blank", "noopener,noreferrer");

  // Broadcast artifact mount + theme + auth to the newly opened VS Code window when it signals MODELSCRIPT_READY
  try {
    const channel = new BroadcastChannel("modelscript:host-bridge");
    let resolvedPayload: {
      artifactId: number | string;
      title: string;
      viewType: string;
      viewConfig: any;
      files?: Record<string, string>;
      primaryFile?: string;
    } | null =
      Object.keys(parsedViewConfig).length > 0 || code !== undefined
        ? {
            artifactId: artifactId || "scratch",
            title: rawTitle,
            viewType,
            viewConfig: enrichedConfig,
            files: enrichedConfig.files,
            primaryFile: enrichedConfig.primaryFile || enrichedConfig.filename,
          }
        : null;

    const broadcastState = () => {
      try {
        const themeAttr = document.documentElement.getAttribute("data-color-mode");
        channel.postMessage({
          type: "MODELSCRIPT_THEME_SYNC",
          theme: themeAttr === "light" ? "day" : "night",
        });
        if (resolvedPayload) {
          channel.postMessage({
            type: "MODELSCRIPT_MOUNT_ARTIFACT",
            ...resolvedPayload,
          });
        }
      } catch {
        // ignore
      }
    };

    // If we only have artifactId and no inline viewConfig, fetch it in the background so it is ready to broadcast
    if (!resolvedPayload && artifactId !== undefined && artifactId !== null && String(artifactId) !== "") {
      fetch(`/api/v1/social/artifact-views/${encodeURIComponent(String(artifactId))}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          const av = data?.artifactView || data;
          if (!av) return;
          const cfg = typeof av.view_config === "string" ? safeJsonParse(av.view_config, {}) : av.view_config || {};
          resolvedPayload = {
            artifactId: av.id ?? artifactId,
            title: options.title || av.title || av.name || rawTitle,
            viewType: av.view_type || viewType,
            viewConfig: cfg,
            files: cfg.files,
            primaryFile: cfg.primaryFile || cfg.filename,
          };
          try {
            const artKey = `modelscript.artifact_${artifactId}`;
            sessionStorage.setItem(artKey, JSON.stringify(resolvedPayload));
            localStorage.setItem(artKey, JSON.stringify(resolvedPayload));
            localStorage.setItem(`modelscript:ide:memfs:${artifactId}`, JSON.stringify(resolvedPayload));
            localStorage.setItem(`modelscript:ide:memfs:artifact-${artifactId}`, JSON.stringify(resolvedPayload));
          } catch {}
          broadcastState();
        })
        .catch(() => {});
    }

    channel.onmessage = (event) => {
      if (event.data?.type === "MODELSCRIPT_READY") {
        broadcastState();
      }
    };

    const t1 = setTimeout(broadcastState, 700);
    const t2 = setTimeout(broadcastState, 2000);
    setTimeout(() => {
      clearTimeout(t1);
      clearTimeout(t2);
      channel.close();
    }, 15000);
  } catch {
    // BroadcastChannel unavailable
  }
}

/**
 * Builds the standalone VS Code Web Workbench URL (`/vscode/workbench#memfs:package-...`) for a package.
 */
export function buildVsCodeWorkbenchUrlForPackage(name: string, version?: string): string {
  const safeName = name || "model";
  const libSpec = encodeURIComponent(`${safeName}@${version || "latest"}`);
  return `/vscode/workbench#memfs:package-${safeName}?libs=${libSpec}`;
}

/**
 * Opens a package directly in a new standalone VS Code window (`/vscode/workbench#memfs:package-...`).
 */
export function openPackageInVsCodeWindow(name: string, version?: string): void {
  if (typeof window === "undefined") return;
  const workbenchUrl = buildVsCodeWorkbenchUrlForPackage(name, version);
  window.open(workbenchUrl, "_blank", "noopener,noreferrer");
}
