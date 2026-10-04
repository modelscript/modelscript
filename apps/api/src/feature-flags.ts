// SPDX-License-Identifier: AGPL-3.0-or-later

export interface FeatureFlagDefinition {
  key: string;
  name: string;
  description: string;
  defaultValue: boolean;
  category: "core" | "compute" | "financial" | "social" | "iot" | "developer" | "experimental";
  maturity: "production" | "beta" | "alpha" | "internal";
  allowedRoles?: ("admin" | "beta_tester" | "user" | "guest")[];
}

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
    description: "Iframe-based VS Code Web environment (defaults to Morsel Playground).",
    defaultValue: false,
    category: "developer",
    maturity: "beta",
    allowedRoles: ["admin", "beta_tester"],
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
    description: "Automated headless bot tokens (ms_bot_*) and programmatic publishing.",
    defaultValue: false,
    category: "developer",
    maturity: "alpha",
    allowedRoles: ["admin"],
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
};

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;
