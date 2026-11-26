// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as vscode from "vscode";
import type { ArtifactWorkspaceDescriptor, GeneratedWorkspace, IMemoryFileSystemProvider } from "./types.js";

interface GlobalWithVsCode {
  vscode?: {
    Uri?: {
      joinPath?: (base: vscode.Uri, ...pathSegments: string[]) => vscode.Uri;
    };
  };
}

export function joinPath(base: vscode.Uri, ...pathSegments: string[]): vscode.Uri {
  const globalVsCode = (globalThis as GlobalWithVsCode).vscode;
  if (typeof globalVsCode?.Uri?.joinPath === "function") {
    return globalVsCode.Uri.joinPath(base, ...pathSegments);
  }
  const cleanBase = (base.path || "").replace(/\/+$/, "");
  const relPath = pathSegments.join("/").replace(/^\/+/, "");
  const fullPath = `${cleanBase}/${relPath}`;
  return {
    scheme: base.scheme || "memfs",
    path: fullPath,
    authority: base.authority || "",
    query: base.query || "",
    fragment: base.fragment || "",
    fsPath: fullPath,
    with: (change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }) => ({
      ...base,
      ...change,
    }),
    toJSON: () => ({ scheme: base.scheme, path: fullPath }),
  } as vscode.Uri;
}

const artifactRegistry = new Map<string, ArtifactWorkspaceDescriptor>();
const packageRegistry = new Map<string, ArtifactWorkspaceDescriptor>();

export function registerArtifactDescriptor(descriptor: ArtifactWorkspaceDescriptor): void {
  artifactRegistry.set(String(descriptor.artifactId), descriptor);
}

export function getArtifactDescriptor(artifactId: string | number): ArtifactWorkspaceDescriptor | undefined {
  return artifactRegistry.get(String(artifactId));
}

export function registerPackageDescriptor(packageName: string, descriptor: ArtifactWorkspaceDescriptor): void {
  packageRegistry.set(packageName, descriptor);
}

export function getPackageDescriptor(packageName: string): ArtifactWorkspaceDescriptor | undefined {
  return packageRegistry.get(packageName);
}

export function clearArtifactRegistry(): void {
  artifactRegistry.clear();
  packageRegistry.clear();
}

export function sanitizeModelicaIdentifier(name?: string, fallback = "ArtifactModel"): string {
  if (!name) return fallback;
  let cleaned = name
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");
  if (!cleaned || /^[0-9]/.test(cleaned)) {
    cleaned = "M_" + (cleaned || fallback);
  }
  return cleaned;
}

export function resolveStoredArtifactDescriptor(
  template: string,
  artifactId: string,
): ArtifactWorkspaceDescriptor | undefined {
  let registered = artifactRegistry.get(artifactId);
  if (!registered && typeof sessionStorage !== "undefined") {
    try {
      const raw = sessionStorage.getItem(`modelscript.artifact_${artifactId}`);
      if (raw) registered = JSON.parse(raw);
    } catch {
      // ignore
    }
  }
  if (!registered && typeof localStorage !== "undefined") {
    try {
      const raw =
        localStorage.getItem(`modelscript.artifact_${artifactId}`) ||
        localStorage.getItem(`modelscript:ide:memfs:${artifactId}`) ||
        localStorage.getItem(`modelscript:ide:memfs:artifact-${artifactId}`);
      if (raw) registered = JSON.parse(raw);
    } catch {
      // ignore
    }
  }
  if (!registered && template === "scratch") {
    try {
      const raw =
        (typeof sessionStorage !== "undefined" ? sessionStorage.getItem("modelscript.artifact_scratch") : null) ||
        (typeof localStorage !== "undefined" ? localStorage.getItem("modelscript.artifact_scratch") : null);
      if (raw) registered = JSON.parse(raw);
    } catch {
      // ignore
    }
  }
  return registered;
}

// ── Artifact & Package Workspace Generators ────────────────────────────────

export const POLYGLOT_VIEW_TYPE_EXTENSIONS: Record<string, string> = {
  modelica: ".mo",
  "modelica-code": ".mo",
  "modelica-diagram": ".mo",
  morsel: ".mo",
  "polyglot-morsel": ".mo",
  simulation: ".mo",
  "simulation-plot": ".mo",
  "simulation-result": ".mo",
  sysml: ".sysml",
  sysml2: ".sysml",
  "sysml-architecture-viewer": ".sysml",
  kerml: ".sysml",
  scad: ".scad",
  openscad: ".scad",
  cad: ".step",
  "cad-step": ".step",
  cad_step: ".step",
  "cad-3d-viewer": ".step",
  step: ".step",
  stp: ".step",
  "3d-model": ".step",
  owl: ".owl",
  owl2: ".owl",
  ofn: ".owl",
  turtle: ".ttl",
  csv: ".csv",
  tsv: ".csv",
  dataset: ".csv",
  "dataset-table": ".csv",
  cfd: ".cfg",
  "cfd-config": ".cfg",
  "cfd-su2": ".cfg",
  "cfd-result": ".cfg",
  "cfd-animation": ".cfg",
  su2: ".cfg",
  fea: ".inp",
  "fea-deck": ".inp",
  "fea-inp": ".inp",
  "fea-result": ".inp",
  inp: ".inp",
  ssp: ".ssd",
  ssd: ".ssd",
  pscad: ".pscx",
  pscx: ".pscx",
  pslx: ".pslx",
  psout: ".psout",
  psse: ".raw",
  raw: ".raw",
  gensys: ".calc",
  calc: ".calc",
  run: ".run",
  sub: ".sub",
  tsimf: ".tsimf",
  gpf: ".gpf",
  simpack: ".spck",
  spck: ".spck",
  sim: ".sim",
  mbs: ".mbs",
  modelscript: ".msx",
  msx: ".msx",
  spice: ".sp",
  sp: ".sp",
  cir: ".cir",
  "verilog-a": ".va",
  va: ".va",
  c: ".c",
  h: ".h",
  fortran: ".f90",
  f90: ".f90",
  f: ".f",
  plcopen: ".st",
  st: ".st",
  autosar: ".arxml",
  arxml: ".arxml",
  simulink: ".mdl",
  mdl: ".mdl",
  reqif: ".reqif",
  ccsds: ".oem",
  oem: ".oem",
  opendrive: ".xodr",
  xodr: ".xodr",
  openscenario: ".xosc",
  xosc: ".xosc",
  urdf: ".urdf",
  adams: ".adm",
  adm: ".adm",
  acf: ".acf",
  sima: ".sima",
  sys: ".sys",
  olga: ".opi",
  opi: ".opi",
  key: ".key",
  lps: ".lps",
  pipelinestudio: ".lps",
  tgx: ".tgx",
  swmm: ".swmm",
  epanet: ".inp",
  gtsuite: ".gtm",
  gtm: ".gtm",
  gtd: ".gtd",
  easy5: ".ez5",
  ez5: ".ez5",
  ezm: ".ezm",
  rocets: ".roc",
  roc: ".roc",
  deck: ".deck",
  relap5: ".r5",
  r5: ".r5",
  energyplus: ".idf",
  idf: ".idf",
  aspen: ".aspen",
  eclipse: ".data",
  data: ".data",
  sbml: ".sbml",
  jsbsim: ".jsbsim",
  touchstone: ".s2p",
  s2p: ".s2p",
  s1p: ".s1p",
  ibis: ".ibs",
  ibs: ".ibs",
  opendss: ".dss",
  dss: ".dss",
  gcode: ".gcode",
  "cam-result": ".gcode",
  qif: ".qif",
  oscal: ".oscal.json",
  automationml: ".aml",
  aml: ".aml",
  caex: ".caex",
  "three-mf": ".3mf",
  "3mf": ".3mf",
  gproms: ".gproms",
  cantera: ".cti",
  cti: ".cti",
  phreeqc: ".pqi",
  pqi: ".pqi",
  smiles: ".smi",
  smi: ".smi",
  antimony: ".ant",
  ant: ".ant",
  bngl: ".bngl",
  cellml: ".cellml",
  sedml: ".sedml",
  sbol: ".sbol",
  genbank: ".gb",
  gb: ".gb",
  pdb: ".pdb",
  nmtran: ".ctl",
  ctl: ".ctl",
  opensim: ".osim",
  osim: ".osim",
  febio: ".feb",
  feb: ".feb",
  "dicom-rt": ".dcm.json",
  nifti: ".nii.json",
  topas: ".topas",
  igtl: ".igtl.json",
  "aas-package": ".json",
  "cyber-physical-system": ".json",
  "hardware-project": ".json",
};

export function inferExtensionForArtifact(viewType?: string, dialect?: string, filename?: string): string {
  if (filename) {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".oscal.json")) return ".oscal.json";
    if (lower.endsWith(".oscal.yaml")) return ".oscal.yaml";
    if (lower.endsWith(".oscal.xml")) return ".oscal.xml";
    if (lower.endsWith(".dcm.json")) return ".dcm.json";
    if (lower.endsWith(".nii.json")) return ".nii.json";
    if (lower.endsWith(".igtl.json")) return ".igtl.json";
    const dot = filename.lastIndexOf(".");
    if (dot !== -1) return filename.slice(dot);
  }
  const cleanDialect = (dialect || "").toLowerCase().trim();
  if (cleanDialect && POLYGLOT_VIEW_TYPE_EXTENSIONS[cleanDialect]) {
    return POLYGLOT_VIEW_TYPE_EXTENSIONS[cleanDialect]!;
  }
  const cleanViewType = (viewType || "").toLowerCase().trim();
  if (cleanViewType && POLYGLOT_VIEW_TYPE_EXTENSIONS[cleanViewType]) {
    return POLYGLOT_VIEW_TYPE_EXTENSIONS[cleanViewType]!;
  }
  return ".mo";
}

export function generateArtifactWorkspaceFiles(descriptor: ArtifactWorkspaceDescriptor): GeneratedWorkspace {
  const viewType = (descriptor.viewType || "").toLowerCase();
  const config = descriptor.viewConfig || {};

  // 1. Multi-file workspace payload (e.g. from package, morsel, notebook, or composite artifacts)
  const customFiles =
    descriptor.files && typeof descriptor.files === "object" && Object.keys(descriptor.files).length > 0
      ? descriptor.files
      : config["files"] &&
          typeof config["files"] === "object" &&
          !Array.isArray(config["files"]) &&
          Object.keys(config["files"]).length > 0
        ? (config["files"] as Record<string, string>)
        : undefined;

  if (customFiles || (descriptor.remoteFiles && descriptor.remoteFiles.length > 0)) {
    const files: Record<string, string> = customFiles ? { ...customFiles } : {};
    let primaryFile =
      descriptor.primaryFile ||
      (typeof config["primaryFile"] === "string" ? config["primaryFile"] : "") ||
      (typeof config["filename"] === "string" ? config["filename"] : "") ||
      (typeof config["fileName"] === "string" ? config["fileName"] : "");

    if (!primaryFile || (!files[primaryFile] && !descriptor.remoteFiles?.some((r) => r.path === primaryFile))) {
      const nonReadme = Object.keys(files).find((f) => !f.toLowerCase().startsWith("readme") && f !== "package.json");
      const remoteNonReadme = descriptor.remoteFiles?.find(
        (r) => !r.path.toLowerCase().startsWith("readme") && r.path !== "package.json",
      )?.path;
      primaryFile =
        nonReadme || remoteNonReadme || Object.keys(files)[0] || descriptor.remoteFiles?.[0]?.path || "package.mo";
    }

    return { files, primaryFile };
  }

  // 1b. Package / Library artifact (when files have not yet been fetched from /api/v1/libraries/:name/:version/files)
  if (viewType === "package" || viewType === "library") {
    const rawTitle = (descriptor.title || "").trim();
    const pkgName =
      (typeof config["name"] === "string" && config["name"].trim()) ||
      (typeof config["packageName"] === "string" && config["packageName"].trim()) ||
      (rawTitle.includes("@") ? rawTitle.split("@")[0]!.trim() : rawTitle) ||
      "Package";
    const pkgVersion =
      (typeof config["version"] === "string" && config["version"].trim()) ||
      (typeof config["packageVersion"] === "string" && config["packageVersion"].trim()) ||
      (rawTitle.includes("@") ? rawTitle.split("@")[1]!.trim() : "1.0.0");

    const registeredPkg = packageRegistry.get(pkgName);
    if (
      registeredPkg &&
      ((registeredPkg.files && Object.keys(registeredPkg.files).length > 0) ||
        (registeredPkg.remoteFiles && registeredPkg.remoteFiles.length > 0))
    ) {
      const files = registeredPkg.files ? { ...registeredPkg.files } : {};
      const primaryFile =
        registeredPkg.primaryFile || Object.keys(files)[0] || registeredPkg.remoteFiles?.[0]?.path || "package.mo";
      return { files, primaryFile };
    }

    const safePkgName = sanitizeModelicaIdentifier(pkgName, "Package");
    const descStr =
      (typeof config["description"] === "string" && config["description"]) || rawTitle || `${pkgName}@${pkgVersion}`;
    const primaryFile = "package.mo";
    const files: Record<string, string> = {
      [primaryFile]: [
        `within ;`,
        `package ${safePkgName} "${descStr.replace(/"/g, "'")}"`,
        `  annotation(version = "${pkgVersion}");`,
        `end ${safePkgName};`,
        ``,
      ].join("\n"),
    };
    return { files, primaryFile };
  }

  // 2. Simulation Plot / Result / CFD / FEA Result (when simulation data or overrides exist)
  if (
    (viewType === "simulation-plot" ||
      viewType === "simulation-result" ||
      viewType === "cfd-result" ||
      viewType === "fea-result" ||
      viewType === "cfd-animation") &&
    (config["variables"] || config["csvData"] || config["results"] || config["overrides"] || !config["code"])
  ) {
    const modelName =
      typeof config["model"] === "string" && config["model"]
        ? sanitizeModelicaIdentifier(config["model"])
        : sanitizeModelicaIdentifier(descriptor.title, `Simulation_${descriptor.artifactId}`);
    const primaryFile = `${modelName}.mo`;

    const variables: string[] =
      Array.isArray(config["variables"]) && config["variables"].length > 0
        ? config["variables"].map(String)
        : ["x", "v"];

    const overrides: Record<string, unknown> =
      typeof config["overrides"] === "object" && config["overrides"] !== null
        ? (config["overrides"] as Record<string, unknown>)
        : {};
    const paramLines = Object.entries(overrides).map(([k, v]) => {
      const safeK = sanitizeModelicaIdentifier(k);
      return `  parameter Real ${safeK} = ${String(v)};`;
    });

    const varLines = variables.map((v) => `  Real ${sanitizeModelicaIdentifier(v)}(start = 1.0);`);
    const eqLines =
      variables.length >= 2
        ? [
            `  der(${sanitizeModelicaIdentifier(variables[0])}) = ${sanitizeModelicaIdentifier(variables[1])};`,
            `  der(${sanitizeModelicaIdentifier(variables[1])}) = -${sanitizeModelicaIdentifier(variables[0])};`,
          ]
        : variables.map((v) => `  der(${sanitizeModelicaIdentifier(v)}) = -${sanitizeModelicaIdentifier(v)};`);

    const code =
      (typeof config["code"] === "string" ? config["code"] : "") ||
      [
        `// ModelScript Simulation Experiment: ${descriptor.title || modelName}`,
        `// Generated from Artifact #${descriptor.artifactId}`,
        ``,
        `model ${modelName} "${descriptor.title || "Simulation Model"}"`,
        paramLines.length > 0 ? paramLines.join("\n") : `  parameter Real k = 1.0 "System stiffness";`,
        varLines.join("\n"),
        `equation`,
        eqLines.join("\n"),
        `end ${modelName};`,
        ``,
      ].join("\n");

    const simScript = [
      `// ModelScript Simulation Script for ${modelName}`,
      `simulate(${modelName}, startTime = 0.0, stopTime = 10.0, numberOfIntervals = 500);`,
      `plot({${variables.map((v) => `"${sanitizeModelicaIdentifier(v)}"`).join(", ")}});`,
      ``,
    ].join("\n");

    const files: Record<string, string> = {
      [primaryFile]: code,
      "simulate.mos": simScript,
    };

    if (config["csvData"] || config["data"] || config["results"]) {
      files["trajectory.csv"] =
        typeof config["csvData"] === "string"
          ? config["csvData"]
          : typeof config["data"] === "string"
            ? config["data"]
            : JSON.stringify(config["results"] || config["data"], null, 2);
    }

    return { files, primaryFile };
  }

  // 3. 3D CAD STEP (when viewType is cad-step / cad_step / 3d-model and not a multi-file workspace)
  if (viewType === "cad-step" || viewType === "cad_step" || viewType === "3d-model") {
    const stepContent =
      (typeof config["step"] === "string" ? config["step"] : "") ||
      (typeof config["content"] === "string" ? config["content"] : "") ||
      (typeof config["code"] === "string" ? config["code"] : "") ||
      (typeof config["data"] === "string" ? config["data"] : "") ||
      [
        `ISO-10303-21;`,
        `HEADER;`,
        `FILE_DESCRIPTION(('ModelScript 3D CAD Artifact'), '2;1');`,
        `FILE_NAME('geometry.step', '2026-10-09', ('ModelScript User'), ('ModelScript CAD Engine'), '', '', '');`,
        `FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));`,
        `ENDSEC;`,
        `DATA;`,
        `/* CAD Artifact #${descriptor.artifactId}: ${descriptor.title || "CAD Geometry"} */`,
        `ENDSEC;`,
        `END-ISO-10303-21;`,
      ].join("\n");

    const explicitFilename =
      (typeof config["filename"] === "string" ? config["filename"] : "") ||
      (typeof config["fileName"] === "string" ? config["fileName"] : "");
    const stepFileName =
      explicitFilename.endsWith(".step") || explicitFilename.endsWith(".stp") ? explicitFilename : "geometry.step";

    const primaryFile = stepFileName;
    const files: Record<string, string> = {
      [stepFileName]: stepContent,
    };

    return { files, primaryFile };
  }

  // 4. GCode Toolpath
  if (viewType === "gcode" || viewType === "cam-result") {
    const gcodeContent =
      (typeof config["gcode"] === "string" ? config["gcode"] : "") ||
      (typeof config["content"] === "string" ? config["content"] : "") ||
      (typeof config["code"] === "string" ? config["code"] : "") ||
      [
        `; GCode Toolpath for Artifact #${descriptor.artifactId}: ${descriptor.title || "CNC Job"}`,
        `G21 ; millimeters`,
        `G90 ; absolute coordinates`,
        `G28 ; home all axes`,
        `M104 S200 ; set extruder temp`,
        `M140 S60 ; set bed temp`,
        `G1 Z5 F5000 ; lift nozzle`,
        `G1 X50 Y50 F3000 ; move to start`,
        `G1 Z0.2 F1000 ; layer 1`,
        `G1 X100 Y50 E5 F1500`,
        `G1 X100 Y100 E10 F1500`,
        `G1 X50 Y100 E15 F1500`,
        `G1 X50 Y50 E20 F1500`,
        `M84 ; disable motors`,
      ].join("\n");

    const explicitFilename =
      (typeof config["filename"] === "string" ? config["filename"] : "") ||
      (typeof config["fileName"] === "string" ? config["fileName"] : "");
    const primaryFile = explicitFilename || "toolpath.gcode";
    const files: Record<string, string> = {
      [primaryFile]: gcodeContent,
    };

    return { files, primaryFile };
  }

  // 5. AAS Package / Cyber-Physical System
  if (viewType === "aas-package" || viewType === "cyber-physical-system" || viewType === "hardware-project") {
    const manifest: Record<string, unknown> = (typeof config["manifest"] === "object" && config["manifest"] !== null
      ? (config["manifest"] as Record<string, unknown>)
      : undefined) ||
      (Object.keys(config).length > 0 ? config : undefined) || {
        idShort: sanitizeModelicaIdentifier(descriptor.title, `Asset_${descriptor.artifactId}`),
        assetAdministrationShells: [
          {
            idShort: descriptor.title || `Asset_${descriptor.artifactId}`,
            submodels: [
              { idShort: "TechnicalData", semanticId: "0173-1#01-AHF578#001" },
              { idShort: "OperationalData", semanticId: "0173-1#01-ADN789#001" },
            ],
          },
        ],
      };

    const primaryFile = "aas-manifest.json";
    const files: Record<string, string> = {
      [primaryFile]: JSON.stringify(manifest, null, 2),
    };

    return { files, primaryFile };
  }

  // 5b. Tabular CSV / Dataset (when headers/rows are present in viewConfig)
  if (
    (viewType === "csv" || viewType === "tsv" || viewType === "dataset" || viewType === "dataset-table") &&
    (Array.isArray(config["headers"]) || Array.isArray(config["rows"]) || typeof config["csv"] === "string")
  ) {
    const explicitName =
      (typeof config["filename"] === "string" && config["filename"]) ||
      (typeof config["fileName"] === "string" && config["fileName"]) ||
      "";
    const baseName = sanitizeModelicaIdentifier(descriptor.title, `Dataset_${descriptor.artifactId}`);
    const primaryFile = explicitName || `${baseName}.csv`;
    let csvText = typeof config["csv"] === "string" ? config["csv"] : "";
    if (!csvText) {
      const lines: string[] = [];
      if (Array.isArray(config["headers"]) && config["headers"].length > 0) {
        lines.push(config["headers"].map((h) => String(h ?? "")).join(","));
      }
      if (Array.isArray(config["rows"])) {
        for (const row of config["rows"]) {
          if (Array.isArray(row)) {
            lines.push(row.map((cell) => String(cell ?? "")).join(","));
          } else if (row && typeof row === "object") {
            lines.push(
              Object.values(row as Record<string, unknown>)
                .map((cell) => String(cell ?? ""))
                .join(","),
            );
          }
        }
      }
      csvText = lines.join("\n") + "\n";
    }
    return {
      files: { [primaryFile]: csvText },
      primaryFile,
    };
  }

  // 6. Explicit filename & code provided (e.g. from post artifact seed or single-file upload)
  const explicitFilename =
    (typeof config["filename"] === "string" ? config["filename"] : "") ||
    (typeof config["fileName"] === "string" ? config["fileName"] : "") ||
    (typeof config["primaryFile"] === "string" ? config["primaryFile"] : "") ||
    (typeof descriptor.primaryFile === "string" ? descriptor.primaryFile : "");

  const rawCode =
    (typeof config["code"] === "string" ? config["code"] : "") ||
    (typeof config["content"] === "string" ? config["content"] : "") ||
    (typeof config["source"] === "string" ? config["source"] : "") ||
    (typeof config["modelicaCode"] === "string" ? config["modelicaCode"] : "") ||
    (typeof config["xml"] === "string" ? config["xml"] : "") ||
    (typeof config["svg"] === "string" ? config["svg"] : "") ||
    (typeof config["text"] === "string" ? config["text"] : "");

  const dialect =
    (typeof config["dialect"] === "string" ? config["dialect"] : "") ||
    (typeof config["language"] === "string" ? config["language"] : "") ||
    viewType;

  if (explicitFilename) {
    const primaryFile = explicitFilename;
    const code =
      rawCode || `// ModelScript Workspace for Artifact #${descriptor.artifactId}\n// File: ${primaryFile}\n`;
    const files: Record<string, string> = {
      [primaryFile]: code,
    };

    return { files, primaryFile };
  }

  // 7. Single-file code present without explicit filename
  if (rawCode) {
    const ext = inferExtensionForArtifact(viewType, dialect);
    let modelName = "";
    if (ext === ".mo") {
      const match = rawCode.match(/(?:model|class|block|connector|package)\s+([A-Za-z0-9_]+)/);
      if (match?.[1]) modelName = match[1];
    } else if (ext === ".sysml") {
      const match = rawCode.match(/(?:package|part\s+def|attribute\s+def)\s+([A-Za-z0-9_]+)/);
      if (match?.[1]) modelName = match[1];
    } else if (ext === ".msx") {
      const match = rawCode.match(/(?:model|package|struct)\s+([A-Za-z0-9_]+)/);
      if (match?.[1]) modelName = match[1];
    }
    if (!modelName) {
      modelName = sanitizeModelicaIdentifier(descriptor.title, `Artifact_${descriptor.artifactId}`);
    }
    const primaryFile = `${modelName}${ext}`;
    const files: Record<string, string> = {
      [primaryFile]: rawCode,
    };
    return { files, primaryFile };
  }

  // 8. Generic Default Artifact Fallback (stub when no code or files exist)
  const ext = inferExtensionForArtifact(viewType, dialect);
  const modelName = sanitizeModelicaIdentifier(descriptor.title, `ArtifactModel_${descriptor.artifactId}`);
  const primaryFile = `${modelName}${ext}`;
  let content = "";
  if (ext === ".sysml") {
    content = [
      `package ${modelName} {`,
      `  doc /* ModelScript Architecture for Artifact #${descriptor.artifactId} */`,
      `  part def System {`,
      `    attribute status : String = "Active";`,
      `  }`,
      `}`,
      ``,
    ].join("\n");
  } else if (ext === ".msx") {
    content = [
      `// ModelScript (.msx) for Artifact #${descriptor.artifactId}`,
      `model ${modelName} {`,
      `  Real x(start = 1.0);`,
      `equation`,
      `  der(x) = -x;`,
      `}`,
      ``,
    ].join("\n");
  } else {
    content = [
      `// ModelScript Workspace for Social Artifact #${descriptor.artifactId}`,
      `// Title: ${descriptor.title || "Community Artifact"}`,
      `// Opened from Community Feed & Physical Twin Hub`,
      ``,
      `model ${modelName} "${descriptor.title || "Community Artifact"}"`,
      `  Real x(start = 1.0) "State variable";`,
      `  Real y(start = 0.0) "Coupled variable";`,
      `equation`,
      `  der(x) = -y;`,
      `  der(y) = x;`,
      `end ${modelName};`,
      ``,
    ].join("\n");
  }

  const files: Record<string, string> = {
    [primaryFile]: content,
  };

  return { files, primaryFile };
}

export function generatePackageWorkspaceFiles(
  packageName: string,
  pkgInfo?: Record<string, unknown>,
): GeneratedWorkspace {
  const registeredPkg = packageRegistry.get(packageName);
  if (
    registeredPkg &&
    ((registeredPkg.files && Object.keys(registeredPkg.files).length > 0) ||
      (registeredPkg.remoteFiles && registeredPkg.remoteFiles.length > 0))
  ) {
    const files = registeredPkg.files ? { ...registeredPkg.files } : {};
    const primaryFile =
      registeredPkg.primaryFile || Object.keys(files)[0] || registeredPkg.remoteFiles?.[0]?.path || "package.mo";
    return { files, primaryFile };
  }

  const safeName = sanitizeModelicaIdentifier(packageName, "Package");
  const version = typeof pkgInfo?.["version"] === "string" && pkgInfo["version"] ? pkgInfo["version"] : "1.0.0";
  const description =
    typeof pkgInfo?.["description"] === "string" && pkgInfo["description"]
      ? pkgInfo["description"]
      : `Library package for ${packageName}`;
  const primaryFile = "package.mo";
  const files: Record<string, string> = {
    [primaryFile]: [
      `within ;`,
      `package ${safeName} "${description.replace(/"/g, "'")}"`,
      `  annotation(version = "${version}");`,
      `end ${safeName};`,
      ``,
    ].join("\n"),
  };

  return { files, primaryFile };
}

export function injectArtifactDependencies(
  result: GeneratedWorkspace,
  descriptor: ArtifactWorkspaceDescriptor,
): GeneratedWorkspace {
  const config = descriptor.viewConfig || {};
  const rawDeps =
    descriptor.dependencies ||
    (Array.isArray(config["dependencies"])
      ? (config["dependencies"] as Array<{ name: string; version: string }>)
      : undefined);

  if (Array.isArray(rawDeps) && rawDeps.length > 0) {
    const depMap: Record<string, string> = {};
    for (const d of rawDeps) {
      if (d && typeof d.name === "string" && typeof d.version === "string") {
        depMap[d.name] = d.version;
      }
    }
    if (Object.keys(depMap).length > 0) {
      if (!result.files["package.json"] && !result.files["modelscript.json"]) {
        const pkgName = sanitizeModelicaIdentifier(descriptor.title, `artifact-${descriptor.artifactId}`).toLowerCase();
        result.files["package.json"] =
          JSON.stringify(
            {
              name: pkgName,
              version: "1.0.0",
              description: descriptor.title || `ModelScript artifact workspace #${descriptor.artifactId}`,
              dependencies: depMap,
            },
            null,
            2,
          ) + "\n";
      }

      // If primary file is a Modelica file and doesn't already contain uses(...), inject annotation(uses(...))
      const primary = result.primaryFile;
      if (primary && primary.endsWith(".mo") && result.files[primary] && !result.files[primary]!.includes("uses(")) {
        const usesClauses = Object.entries(depMap)
          .map(([name, ver]) => `${name}(version = "${ver}")`)
          .join(", ");
        const usesAnnotation = `annotation(uses(${usesClauses}));\n`;
        const code = result.files[primary]!;
        const endMatch = /\bend\s+[A-Za-z0-9_]+\s*;[\s\S]*$/.exec(code);
        if (endMatch) {
          const insertIdx = endMatch.index;
          result.files[primary] = `${code.slice(0, insertIdx)}  ${usesAnnotation}${code.slice(insertIdx)}`;
        } else {
          result.files[primary] = `${code}\n${usesAnnotation}`;
        }
      }

      // If primary file is a SysML v2 file (.sysml), inject import clauses if missing
      if (primary && (primary.endsWith(".sysml") || primary.endsWith(".sysml2")) && result.files[primary]) {
        const code = result.files[primary]!;
        const neededImports: string[] = [];
        for (const depName of Object.keys(depMap)) {
          if (!hasSysmlImport(code, depName)) {
            neededImports.push(`  import ${depName}::*;`);
          }
        }
        if (neededImports.length > 0) {
          const pkgOpenMatch = /\bpackage\s+[A-Za-z0-9_]+\s*\{/.exec(code);
          if (pkgOpenMatch) {
            const insertIdx = pkgOpenMatch.index + pkgOpenMatch[0].length;
            result.files[primary] = `${code.slice(0, insertIdx)}\n${neededImports.join("\n")}${code.slice(insertIdx)}`;
          } else {
            result.files[primary] = `${neededImports.join("\n")}\n\n${code}`;
          }
        }
      }

      // If primary file is a SPICE file (.cir, .sp, .spice), inject .include directives if missing
      if (
        primary &&
        (primary.endsWith(".cir") || primary.endsWith(".sp") || primary.endsWith(".spice")) &&
        result.files[primary]
      ) {
        const code = result.files[primary]!;
        const neededIncludes: string[] = [];
        for (const depName of Object.keys(depMap)) {
          if (!hasSpiceInclude(code, depName)) {
            neededIncludes.push(`.include "${depName}.cir"`);
          }
        }
        if (neededIncludes.length > 0) {
          result.files[primary] = `* External library dependencies\n${neededIncludes.join("\n")}\n\n${code}`;
        }
      }
    }
  }

  return result;
}

export function mountArtifactToMemFs(
  memFs: IMemoryFileSystemProvider,
  workspaceUri: vscode.Uri,
  descriptor: ArtifactWorkspaceDescriptor,
): { files: Record<string, string>; primaryFile: string } {
  registerArtifactDescriptor(descriptor);
  const encoder = new TextEncoder();
  const rawGenerated = generateArtifactWorkspaceFiles(descriptor);
  const { files, primaryFile } = injectArtifactDependencies(rawGenerated, descriptor);
  descriptor.primaryFile = primaryFile;
  registerArtifactDescriptor(descriptor);

  // Clean up any previously scaffolded placeholder files in this workspace
  if (typeof memFs.clearDirectory === "function") {
    memFs.clearDirectory(workspaceUri);
  } else if (typeof memFs.delete === "function") {
    try {
      const existing =
        typeof memFs.readDirectory === "function"
          ? (memFs.readDirectory(workspaceUri) as unknown as [string, unknown][])
          : [];
      if (Array.isArray(existing)) {
        for (const [staleName] of existing) {
          if (
            !files[staleName] &&
            (staleName.startsWith("ArtifactModel") ||
              staleName.startsWith("ScratchModel") ||
              staleName === "HelloWorld.mo" ||
              staleName === "README.md")
          ) {
            try {
              memFs.delete(joinPath(workspaceUri, staleName));
            } catch {
              // ignore
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const entries: [vscode.Uri, Uint8Array][] = [];
  for (const [name, fileContent] of Object.entries(files)) {
    const fileUri = joinPath(workspaceUri, name);
    entries.push([fileUri, encoder.encode(fileContent)]);
  }
  if (typeof memFs.writeFiles === "function" && entries.length > 0) {
    memFs.writeFiles(entries);
  } else {
    for (const [fileUri, bytes] of entries) {
      memFs.writeFile(fileUri, bytes);
    }
  }

  if (descriptor.remoteFiles && descriptor.remoteFiles.length > 0 && typeof memFs.registerRemoteFiles === "function") {
    memFs.registerRemoteFiles(workspaceUri, descriptor.remoteFiles);
  }

  return { files, primaryFile };
}

function isWordCharCode(code: number): boolean {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 95 // _
  );
}

function isWhitespaceCode(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function isAsciiAlnum(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    const isDigit = code >= 48 && code <= 57;
    const isLower = code >= 97 && code <= 122;
    const isUpper = code >= 65 && code <= 90;
    if (!isDigit && !isLower && !isUpper) return false;
  }
  return str.length > 0;
}

function hasSysmlImport(code: string, depName: string): boolean {
  if (!depName) return false;
  const lowerCode = code.toLowerCase();
  const target = depName.toLowerCase();
  let pos = 0;

  while (pos < lowerCode.length) {
    const idx = lowerCode.indexOf("import", pos);
    if (idx < 0) return false;

    const leftOk = idx === 0 || !isWordCharCode(lowerCode.charCodeAt(idx - 1));
    let cur = idx + 6;
    if (leftOk && cur < lowerCode.length && isWhitespaceCode(lowerCode.charCodeAt(cur))) {
      while (cur < lowerCode.length && isWhitespaceCode(lowerCode.charCodeAt(cur))) {
        cur++;
      }
      if (lowerCode.startsWith(target, cur)) {
        const end = cur + target.length;
        const rightOk = end === lowerCode.length || !isWordCharCode(lowerCode.charCodeAt(end));
        if (rightOk) return true;
      }
    }
    pos = idx + 6;
  }
  return false;
}

function hasSpiceInclude(code: string, depName: string): boolean {
  if (!depName) return false;
  const target = depName.toLowerCase();

  for (const rawLine of code.split("\n")) {
    const line = rawLine.trim().toLowerCase();
    let rest: string | undefined;
    if (line.startsWith(".include")) {
      rest = line.slice(8);
    } else if (line.startsWith(".lib")) {
      rest = line.slice(4);
    } else {
      continue;
    }

    if (rest.length === 0 || !isWhitespaceCode(rest.charCodeAt(0))) {
      continue;
    }

    let arg = rest.trimStart();
    if (arg.startsWith('"') || arg.startsWith("'")) {
      const quote = arg[0]!;
      const closeIdx = arg.indexOf(quote, 1);
      arg = closeIdx > 0 ? arg.slice(1, closeIdx) : arg.slice(1);
    } else {
      let tokenEnd = 0;
      while (tokenEnd < arg.length && !isWhitespaceCode(arg.charCodeAt(tokenEnd))) {
        tokenEnd++;
      }
      arg = arg.slice(0, tokenEnd);
    }

    if (arg === target) return true;
    if (arg.startsWith(target + ".")) {
      const ext = arg.slice(target.length + 1);
      if (isAsciiAlnum(ext)) return true;
    }
  }
  return false;
}
