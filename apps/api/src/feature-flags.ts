// SPDX-License-Identifier: AGPL-3.0-or-later

export interface FeatureFlagDefinition {
  key: string;
  name: string;
  description: string;
  defaultValue: boolean;
  category: "core" | "compute" | "financial" | "social" | "iot" | "developer" | "experimental" | "languages";
  maturity: "production" | "beta" | "alpha" | "internal";
  allowedRoles?: ("admin" | "beta_tester" | "user" | "guest")[] | undefined;
}

export interface PolyglotLanguageFlagSpec {
  id: string;
  name: string;
  ext: string;
  defaultValue: boolean;
  maturity: "production" | "beta" | "alpha";
}

export const POLYGLOT_LANGUAGE_SPECS: readonly PolyglotLanguageFlagSpec[] = [
  { id: "modelica", name: "Modelica 3.x", ext: ".mo", defaultValue: true, maturity: "production" },
  { id: "modelscript", name: "ModelScript (.msx)", ext: ".msx", defaultValue: false, maturity: "alpha" },
  { id: "sysml2", name: "SysML v2 / KerML", ext: ".sysml", defaultValue: true, maturity: "production" },
  { id: "step", name: "STEP (ISO 10303)", ext: ".step", defaultValue: true, maturity: "production" },
  { id: "owl2", name: "OWL2 Ontology", ext: ".owl", defaultValue: true, maturity: "production" },
  { id: "scad", name: "OpenSCAD (CSG)", ext: ".scad", defaultValue: true, maturity: "production" },
  { id: "pscad", name: "PSCAD (EMT)", ext: ".pscx", defaultValue: true, maturity: "production" },
  { id: "spice", name: "SPICE Circuit", ext: ".sp", defaultValue: true, maturity: "production" },
  { id: "fea", name: "FEA Deck (CalculiX/Abaqus)", ext: ".inp", defaultValue: true, maturity: "production" },
  { id: "cfd", name: "CFD Config (SU2)", ext: ".cfg", defaultValue: true, maturity: "production" },
  { id: "ssp", name: "SSP Architecture", ext: ".ssd", defaultValue: true, maturity: "production" },
  { id: "psse", name: "PSS/E Power Flow", ext: ".raw", defaultValue: true, maturity: "production" },
  { id: "gensys", name: "GENSYS Railway", ext: ".tsimf", defaultValue: true, maturity: "production" },
  { id: "simpack", name: "SIMPACK Multibody", ext: ".spck", defaultValue: true, maturity: "production" },
  { id: "verilog-a", name: "Verilog-A", ext: ".va", defaultValue: true, maturity: "production" },
  { id: "c", name: "C (Embedded)", ext: ".c", defaultValue: true, maturity: "production" },
  { id: "fortran", name: "Fortran 90", ext: ".f90", defaultValue: true, maturity: "production" },
  { id: "plcopen", name: "PLCopen ST (IEC 61131-3)", ext: ".st", defaultValue: true, maturity: "production" },
  { id: "autosar", name: "AUTOSAR ARXML", ext: ".arxml", defaultValue: true, maturity: "production" },
  { id: "simulink", name: "Simulink Model", ext: ".mdl", defaultValue: true, maturity: "production" },
  { id: "reqif", name: "ReqIF Requirements", ext: ".reqif", defaultValue: true, maturity: "production" },
  { id: "ccsds", name: "CCSDS Orbit Ephemeris", ext: ".oem", defaultValue: true, maturity: "production" },
  { id: "opendrive", name: "OpenDRIVE Road Network", ext: ".xodr", defaultValue: true, maturity: "production" },
  { id: "openscenario", name: "OpenSCENARIO", ext: ".xosc", defaultValue: true, maturity: "production" },
  { id: "urdf", name: "URDF Robotics", ext: ".urdf", defaultValue: true, maturity: "production" },
  { id: "adams", name: "ADAMS Multibody", ext: ".adm", defaultValue: true, maturity: "production" },
  { id: "sima", name: "SIMA Offshore Mooring", ext: ".sima", defaultValue: true, maturity: "production" },
  { id: "olga", name: "OLGA Multiphase Flow", ext: ".opi", defaultValue: true, maturity: "production" },
  { id: "lps", name: "LPS Pipeline", ext: ".lps", defaultValue: true, maturity: "production" },
  { id: "epanet", name: "EPANET Hydraulic", ext: ".inp", defaultValue: true, maturity: "production" },
  { id: "swmm", name: "SWMM Stormwater", ext: ".swmm", defaultValue: true, maturity: "production" },
  { id: "gtsuite", name: "GT-SUITE Powertrain", ext: ".gtm", defaultValue: true, maturity: "production" },
  { id: "easy5", name: "Easy5 Controls", ext: ".ez5", defaultValue: true, maturity: "production" },
  { id: "rocets", name: "ROCETS Rocket Propulsion", ext: ".roc", defaultValue: true, maturity: "production" },
  { id: "relap5", name: "RELAP5 Thermal-Hydraulics", ext: ".r5", defaultValue: true, maturity: "production" },
  { id: "energyplus", name: "EnergyPlus Building HVAC", ext: ".idf", defaultValue: true, maturity: "production" },
  { id: "aspen", name: "Aspen Process Flowsheet", ext: ".aspen", defaultValue: true, maturity: "production" },
  { id: "eclipse", name: "ECLIPSE Reservoir", ext: ".data", defaultValue: true, maturity: "production" },
  { id: "sbml", name: "SBML Systems Biology", ext: ".sbml", defaultValue: true, maturity: "production" },
  { id: "jsbsim", name: "JSBSim Flight Dynamics", ext: ".jsbsim", defaultValue: true, maturity: "production" },
  { id: "touchstone", name: "Touchstone RF S-Params", ext: ".s2p", defaultValue: true, maturity: "production" },
  { id: "ibis", name: "IBIS Signal Integrity", ext: ".ibs", defaultValue: true, maturity: "production" },
  { id: "opendss", name: "OpenDSS Distribution Grid", ext: ".dss", defaultValue: true, maturity: "production" },
  { id: "csv", name: "CSV Tabular Dataset", ext: ".csv", defaultValue: true, maturity: "production" },
];

export function getLanguageFeatureFlagKey(langId: string): string {
  const normalized = langId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  return `lang_${normalized}`;
}

const GENERATED_LANGUAGE_FLAGS: Record<string, FeatureFlagDefinition> = Object.fromEntries(
  POLYGLOT_LANGUAGE_SPECS.map((spec) => {
    const key = getLanguageFeatureFlagKey(spec.id);
    return [
      key,
      {
        key,
        name: `Language: ${spec.name} (${spec.ext})`,
        description: `Enable or hide ${spec.name} (${spec.ext}) across playground, composer, IDE, and study template dialect pickers.`,
        defaultValue: spec.defaultValue,
        category: "languages",
        maturity: spec.maturity,
      } satisfies FeatureFlagDefinition,
    ];
  }),
);

export const FEATURE_FLAGS: Record<string, FeatureFlagDefinition> = {
  // ── Core Features (Production - Enabled by default) ──
  modelica_simulation: {
    key: "modelica_simulation",
    name: "Modelica Wasm Simulation",
    description: "In-browser WebAssembly DAE compilation and simulation engine.",
    defaultValue: true,
    category: "core",
    maturity: "production",
  },
  morsel_playground: {
    key: "morsel_playground",
    name: "Morsel Playground",
    description: "Fast interactive modeling playground with real-time trajectory visualization.",
    defaultValue: true,
    category: "core",
    maturity: "production",
  },
  package_browser: {
    key: "package_browser",
    name: "Package & Library Registry",
    description: "Modelica Standard Library (MSL) and open package exploration and documentation.",
    defaultValue: true,
    category: "core",
    maturity: "production",
  },
  community_social: {
    key: "community_social",
    name: "Community Feed & Posts",
    description: "Platform discussion feeds, comments, and simulation trajectory sharing.",
    defaultValue: true,
    category: "social",
    maturity: "production",
  },
  cad_step_viewer: {
    key: "cad_step_viewer",
    name: "3D CAD STEP Viewer",
    description: "In-browser WebGL/Three.js rendering for CAD STEP and CSG models.",
    defaultValue: true,
    category: "core",
    maturity: "production",
  },

  // ── High-Liability / Heavy Subsystems (Disabled by default for launch) ──
  cae_cloud_solver: {
    key: "cae_cloud_solver",
    name: "Cloud CAE & Slurm HPC Compute",
    description: "Remote OpenFOAM CFD, CalculiX FEA, and Slurm cluster job dispatch.",
    defaultValue: false,
    category: "compute",
    maturity: "alpha",
    allowedRoles: ["admin"],
  },
  billing_stripe_live: {
    key: "billing_stripe_live",
    name: "Stripe Billing & Paid Credits",
    description: "Live Stripe payment intents, credit wallet deduction, and 3DS authentication.",
    defaultValue: false,
    category: "financial",
    maturity: "alpha",
    allowedRoles: ["admin"],
  },
  digital_twins: {
    key: "digital_twins",
    name: "Operational Digital Twins",
    description: "Live telemetry binding, hardware serial tracking, and parameter estimation.",
    defaultValue: false,
    category: "iot",
    maturity: "alpha",
    allowedRoles: ["admin"],
  },
  cosim_mqtt: {
    key: "cosim_mqtt",
    name: "Co-Simulation & MQTT Orchestrator",
    description: "Distributed multi-FMU orchestrator, MQTT discovery, and TimescaleDB historian.",
    defaultValue: false,
    category: "compute",
    maturity: "alpha",
    allowedRoles: ["admin"],
  },
  activitypub_federation: {
    key: "activitypub_federation",
    name: "ActivityPub Social Federation",
    description: "Inter-server Fediverse actor federation, remote inboxes, and cryptographic signatures.",
    defaultValue: false,
    category: "social",
    maturity: "alpha",
    allowedRoles: ["admin"],
  },
  sysml2_omg_api: {
    key: "sysml2_omg_api",
    name: "OMG SysML v2 REST API",
    description: "OMG JSON-LD compliant project, commit, and element query endpoints.",
    defaultValue: false,
    category: "developer",
    maturity: "beta",
    allowedRoles: ["admin"],
  },
  digital_thread_explorer: {
    key: "digital_thread_explorer",
    name: "Digital Thread Hypergraph",
    description: "Multi-domain cross-discipline hypergraph explorer and SMT conflict solver.",
    defaultValue: false,
    category: "developer",
    maturity: "alpha",
    allowedRoles: ["admin"],
  },
  heavy_vscode_ide: {
    key: "heavy_vscode_ide",
    name: "Full VS Code Web Workbench",
    description: "Iframe-based VS Code Web environment for multi-file projects and repositories.",
    defaultValue: true,
    category: "developer",
    maturity: "production",
  },
  experimental_viewers: {
    key: "experimental_viewers",
    name: "Experimental Artifact Viewers",
    description: "TEI XML, WebGPU zero-copy, GCode toolpaths, AAS, and USD 3D viewers.",
    defaultValue: false,
    category: "experimental",
    maturity: "alpha",
    allowedRoles: ["admin"],
  },
  bot_accounts: {
    key: "bot_accounts",
    name: "Autonomous Bot Accounts",
    description: "Automated headless bot tokens (ms_bot_*), scoped permissions, and LLM-powered social agents.",
    defaultValue: true,
    category: "developer",
    maturity: "beta",
    allowedRoles: ["admin", "beta_tester", "user"],
  },
  sparql_rdf_endpoints: {
    key: "sparql_rdf_endpoints",
    name: "SPARQL & RDF Endpoints",
    description: "Direct public SPARQL triplestore querying and RDF graph traversal.",
    defaultValue: false,
    category: "developer",
    maturity: "alpha",
    allowedRoles: ["admin"],
  },
  mcp_gateway_sse: {
    key: "mcp_gateway_sse",
    name: "Hosted MCP AI Agent Gateway",
    description: "Server-Sent Events gateway for autonomous AI coding agents (Claude, Cursor).",
    defaultValue: false,
    category: "developer",
    maturity: "beta",
    allowedRoles: ["admin", "beta_tester"],
  },

  // ── Generic Per-Language Feature Flags (All 44 Languages) ──
  ...GENERATED_LANGUAGE_FLAGS,

  // Alias for backwards compatibility with lang_modelscript_msx
  lang_modelscript_msx: {
    key: "lang_modelscript_msx",
    name: "Language: ModelScript (.msx) [Alias]",
    description:
      "Expose the experimental native ModelScript (.msx) language in playground, composer, and IDE language pickers.",
    defaultValue: false,
    category: "languages",
    maturity: "alpha",
  },
};

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;
