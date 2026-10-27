// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Single source of truth for every language/format documented on modelscript.org.
 *
 * Consumed by:
 *  - `.vitepress/config.ts` (grouped `/languages/` sidebar)
 *  - the Industries mega menu and `/industries/<slug>` pages
 *  - homepage sections (stats, language explorer, format strip)
 *
 * Keep this file free of Vue / browser imports — it is also loaded by the Node-side config.
 */

export type LanguageGroupId =
  | "core"
  | "geometry"
  | "integration"
  | "aerospace"
  | "automotive"
  | "rail"
  | "power"
  | "oil-gas"
  | "nuclear"
  | "marine"
  | "electronics"
  | "robotics"
  | "buildings"
  | "process"
  | "life-sciences";

export interface LanguageInfo {
  /** Doc slug — page lives at `/languages/<slug>`. */
  slug: string;
  /** Display name. */
  name: string;
  /** Short label used in the sidebar. */
  sidebar: string;
  /** Representative file extension(s). */
  ext: string;
  /** One-line role description. */
  role: string;
  /** Primary group (used for sidebar placement). */
  group: LanguageGroupId;
}

export const LANGUAGES: LanguageInfo[] = [
  // ── Core & systems engineering ──────────────────────────────────────────
  {
    slug: "modelscript",
    name: "ModelScript",
    sidebar: "ModelScript (.msx)",
    ext: ".msx",
    role: "Native systems modeling & query language",
    group: "core",
  },
  {
    slug: "modelica",
    name: "Modelica",
    sidebar: "Modelica",
    ext: ".mo",
    role: "Acausal multi-domain physics",
    group: "core",
  },
  {
    slug: "sysml2",
    name: "SysML v2 / KerML",
    sidebar: "SysML v2 / KerML",
    ext: ".sysml",
    role: "Systems architecture & requirements",
    group: "core",
  },
  {
    slug: "reqif",
    name: "ReqIF",
    sidebar: "ReqIF Requirements",
    ext: ".reqif",
    role: "Requirements interchange & contract entailment",
    group: "core",
  },
  {
    slug: "ssp",
    name: "SSP",
    sidebar: "SSP System Packaging",
    ext: ".ssp",
    role: "FMU system structure & parameterization",
    group: "core",
  },
  {
    slug: "owl2",
    name: "OWL2",
    sidebar: "OWL2 Ontology",
    ext: ".owl",
    role: "Ontologies & description-logic reasoning",
    group: "core",
  },

  // ── Geometry & continuum ────────────────────────────────────────────────
  {
    slug: "step",
    name: "STEP (ISO 10303)",
    sidebar: "STEP CAD (ISO 10303)",
    ext: ".step",
    role: "B-Rep CAD assemblies & AP242 PMI",
    group: "geometry",
  },
  {
    slug: "scad",
    name: "OpenSCAD",
    sidebar: "OpenSCAD CSG",
    ext: ".scad",
    role: "Parametric constructive solid geometry",
    group: "geometry",
  },
  {
    slug: "cfd",
    name: "CFD (SU2 / OpenFOAM)",
    sidebar: "CFD (SU2 / OpenFOAM)",
    ext: ".su2",
    role: "Computational fluid dynamics meshes",
    group: "geometry",
  },
  {
    slug: "fea",
    name: "FEA (CalculiX / Abaqus / NASTRAN)",
    sidebar: "FEA Structural Analysis",
    ext: ".inp",
    role: "Finite-element structural analysis",
    group: "geometry",
  },

  // ── Data & code integration ─────────────────────────────────────────────
  {
    slug: "csv",
    name: "CSV",
    sidebar: "CSV Telemetry",
    ext: ".csv",
    role: "Time-series & sensor logs",
    group: "integration",
  },
  {
    slug: "c",
    name: "C",
    sidebar: "C Integration",
    ext: ".c",
    role: "Numerical & embedded C integration",
    group: "integration",
  },
  {
    slug: "fortran",
    name: "Fortran",
    sidebar: "Fortran Integration",
    ext: ".f90",
    role: "Legacy scientific subroutines",
    group: "integration",
  },

  // ── Aerospace & defense ─────────────────────────────────────────────────
  {
    slug: "jsbsim",
    name: "JSBSim",
    sidebar: "JSBSim Flight Dynamics",
    ext: ".xml",
    role: "6-DOF flight dynamics",
    group: "aerospace",
  },
  {
    slug: "rocets",
    name: "NASA ROCETS",
    sidebar: "NASA ROCETS Propulsion",
    ext: ".roc",
    role: "Liquid rocket engine transients",
    group: "aerospace",
  },
  {
    slug: "ccsds",
    name: "CCSDS",
    sidebar: "CCSDS Space Telemetry",
    ext: ".xtce",
    role: "Astrodynamics & spacecraft telemetry",
    group: "aerospace",
  },
  {
    slug: "easy5",
    name: "EASY5",
    sidebar: "EASY5 Simulation",
    ext: ".ez5",
    role: "Dynamic simulation & linear control",
    group: "aerospace",
  },

  // ── Automotive & mobility ───────────────────────────────────────────────
  {
    slug: "autosar",
    name: "AUTOSAR",
    sidebar: "AUTOSAR Architecture",
    ext: ".arxml",
    role: "Classic & Adaptive software architecture",
    group: "automotive",
  },
  {
    slug: "simulink",
    name: "MATLAB Simulink",
    sidebar: "MATLAB Simulink",
    ext: ".slx",
    role: "Block diagrams & control systems",
    group: "automotive",
  },
  {
    slug: "gtsuite",
    name: "GT-SUITE",
    sidebar: "GT-SUITE / GT-POWER",
    ext: ".gtm",
    role: "Engine, powertrain & thermal flow",
    group: "automotive",
  },
  {
    slug: "opendrive",
    name: "ASAM OpenDRIVE",
    sidebar: "OpenDRIVE Roads",
    ext: ".xodr",
    role: "Road network geometry",
    group: "automotive",
  },
  {
    slug: "openscenario",
    name: "ASAM OpenSCENARIO",
    sidebar: "OpenSCENARIO AV Safety",
    ext: ".xosc",
    role: "Driving scenarios & RSS safety margins",
    group: "automotive",
  },

  // ── Rail ────────────────────────────────────────────────────────────────
  {
    slug: "gensys",
    name: "GENSYS",
    sidebar: "GENSYS Railway Dynamics",
    ext: ".calc",
    role: "Railway vehicle dynamics & track",
    group: "rail",
  },
  {
    slug: "simpack",
    name: "SIMPACK",
    sidebar: "SIMPACK Multibody Dynamics",
    ext: ".spck",
    role: "Spatial multibody dynamics",
    group: "rail",
  },

  // ── Power systems & grid ────────────────────────────────────────────────
  {
    slug: "pscad",
    name: "PSCAD / EMTDC",
    sidebar: "PSCAD Power Systems",
    ext: ".pscx",
    role: "Electromagnetic transients (EMT)",
    group: "power",
  },
  {
    slug: "psse",
    name: "PSS/E",
    sidebar: "PSS/E Power Flow (.raw)",
    ext: ".raw",
    role: "Transmission power flow",
    group: "power",
  },
  {
    slug: "opendss",
    name: "OpenDSS",
    sidebar: "OpenDSS Distribution",
    ext: ".dss",
    role: "Unbalanced distribution & DER hosting",
    group: "power",
  },

  // ── Oil, gas & subsurface ───────────────────────────────────────────────
  {
    slug: "olga",
    name: "OLGA",
    sidebar: "OLGA Multiphase Flow",
    ext: ".genkey",
    role: "Transient multiphase flow assurance",
    group: "oil-gas",
  },
  {
    slug: "lps",
    name: "PipelineStudio",
    sidebar: "PipelineStudio (.lps)",
    ext: ".lps",
    role: "Gas & liquid pipeline hydraulics",
    group: "oil-gas",
  },
  {
    slug: "eclipse",
    name: "ECLIPSE",
    sidebar: "ECLIPSE Reservoir",
    ext: ".data",
    role: "Reservoir engineering",
    group: "oil-gas",
  },

  // ── Nuclear ─────────────────────────────────────────────────────────────
  {
    slug: "relap5",
    name: "RELAP5-3D",
    sidebar: "RELAP5 Nuclear Loops",
    ext: ".inp",
    role: "Reactor thermal-hydraulics & kinetics",
    group: "nuclear",
  },

  // ── Marine & offshore ───────────────────────────────────────────────────
  {
    slug: "sima",
    name: "SIMA / SIMO / RIFLEX",
    sidebar: "SIMA / SIMO / RIFLEX",
    ext: ".sima",
    role: "Marine operations & riser dynamics",
    group: "marine",
  },

  // ── Electronics & semiconductors ────────────────────────────────────────
  {
    slug: "spice",
    name: "SPICE",
    sidebar: "SPICE Electronics",
    ext: ".cir",
    role: "Analog circuit simulation",
    group: "electronics",
  },
  {
    slug: "verilog-a",
    name: "Verilog-A / AMS",
    sidebar: "Verilog-A Devices",
    ext: ".va",
    role: "Analog compact device models",
    group: "electronics",
  },
  {
    slug: "ibis",
    name: "IBIS",
    sidebar: "IBIS Buffer Modeling",
    ext: ".ibs",
    role: "I/O buffer behavioral models",
    group: "electronics",
  },
  {
    slug: "touchstone",
    name: "Touchstone",
    sidebar: "Touchstone RF / SI",
    ext: ".sNp",
    role: "RF & signal-integrity S-parameters",
    group: "electronics",
  },

  // ── Robotics & industrial automation ────────────────────────────────────
  {
    slug: "urdf",
    name: "URDF / Xacro",
    sidebar: "URDF & Xacro Robotics",
    ext: ".urdf",
    role: "Robot kinematics & dynamics",
    group: "robotics",
  },
  {
    slug: "plcopen",
    name: "PLCopen / IEC 61131-3",
    sidebar: "PLCopen Automation",
    ext: ".st",
    role: "PLC control software",
    group: "robotics",
  },
  {
    slug: "adams",
    name: "MSC Adams",
    sidebar: "MSC Adams MBD",
    ext: ".adm",
    role: "Mechanical system dynamics",
    group: "robotics",
  },

  // ── Buildings & civil infrastructure ────────────────────────────────────
  {
    slug: "energyplus",
    name: "EnergyPlus",
    sidebar: "EnergyPlus Thermal",
    ext: ".idf",
    role: "Building energy & HVAC",
    group: "buildings",
  },
  {
    slug: "epanet",
    name: "EPANET",
    sidebar: "EPANET Water Networks",
    ext: ".inp",
    role: "Pressurized water distribution",
    group: "buildings",
  },
  {
    slug: "swmm",
    name: "EPA SWMM",
    sidebar: "SWMM Urban Hydrology",
    ext: ".inp",
    role: "Stormwater & urban drainage",
    group: "buildings",
  },

  // ── Chemical & process ──────────────────────────────────────────────────
  {
    slug: "aspen",
    name: "Aspen Plus / HYSYS",
    sidebar: "Aspen Chemical Process",
    ext: ".bkp",
    role: "Chemical process flowsheets",
    group: "process",
  },

  // ── Life sciences ───────────────────────────────────────────────────────
  {
    slug: "sbml",
    name: "SBML",
    sidebar: "SBML Systems Biology",
    ext: ".sbml",
    role: "Biochemical reaction networks",
    group: "life-sciences",
  },
];

export const LANGUAGE_BY_SLUG: Record<string, LanguageInfo> = Object.fromEntries(LANGUAGES.map((l) => [l.slug, l]));

export const LANGUAGE_COUNT = LANGUAGES.length;

/** Non-industry groups shown at the top of the languages sidebar. */
export const PLATFORM_GROUPS: { id: LanguageGroupId; label: string }[] = [
  { id: "core", label: "Core & Systems Engineering" },
  { id: "geometry", label: "Geometry & Continuum" },
  { id: "integration", label: "Data & Code Integration" },
];
