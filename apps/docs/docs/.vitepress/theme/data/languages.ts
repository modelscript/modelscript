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

export type LanguageMaturityTier = "beta" | "alpha" | "pre-alpha";

export const TIER_LABELS: Record<LanguageMaturityTier, string> = {
  beta: "Beta",
  alpha: "Alpha",
  "pre-alpha": "Pre-Alpha",
};

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
  /** Canonical maturity tier from `languages/<slug>/package.json#modelscript.tier`. */
  tier: LanguageMaturityTier;
}

/**
 * Whether the experimental native ModelScript (.msx) language is visible
 * in the documentation, navigation, stats, and sidebar.
 * Controlled by SHOW_MODELSCRIPT_LANG / ENABLE_MODELSCRIPT_LANG env vars. Default: false.
 */
export const isModelScriptLangVisible: boolean = (() => {
  if (typeof process !== "undefined" && process.env) {
    const val =
      process.env["SHOW_MODELSCRIPT_LANG"] ??
      process.env["ENABLE_MODELSCRIPT_LANG"] ??
      process.env["VITE_SHOW_MODELSCRIPT_LANG"] ??
      process.env["FEATURE_FLAG_LANG_MODELSCRIPT"];
    if (val !== undefined) {
      const normalized = val.trim().toLowerCase();
      return normalized === "true" || normalized === "1";
    }
  }
  return false;
})();

const ALL_LANGUAGES: LanguageInfo[] = [
  // ── Core & systems engineering ──────────────────────────────────────────
  {
    slug: "modelscript",
    name: "ModelScript",
    sidebar: "ModelScript (.msx)",
    ext: ".msx",
    role: "Native systems modeling & query language",
    group: "core",
    tier: "beta",
  },
  {
    slug: "modelica",
    name: "Modelica",
    sidebar: "Modelica",
    ext: ".mo",
    role: "Acausal multi-domain physics",
    group: "core",
    tier: "beta",
  },
  {
    slug: "ampl",
    name: "AMPL",
    sidebar: "AMPL Optimization",
    ext: ".mod, .dat, .run, .nl, .mps",
    role: "Mathematical programming & optimization (LP, MILP, NLP)",
    group: "core",
    tier: "beta",
  },
  {
    slug: "sysml2",
    name: "SysML v2 / KerML",
    sidebar: "SysML v2 / KerML",
    ext: ".sysml",
    role: "Systems architecture & requirements",
    group: "core",
    tier: "beta",
  },
  {
    slug: "reqif",
    name: "ReqIF",
    sidebar: "ReqIF Requirements",
    ext: ".reqif",
    role: "Requirements interchange & contract entailment",
    group: "core",
    tier: "beta",
  },
  {
    slug: "magicdraw",
    name: "MagicDraw / Cameo",
    sidebar: "MagicDraw (.mdzip)",
    ext: ".mdzip",
    role: "SysML 1.x / UML 2.x archive inspection, diagrams & SysML v2 migration",
    group: "core",
    tier: "beta",
  },
  {
    slug: "oscal",
    name: "NIST OSCAL",
    sidebar: "NIST OSCAL Security",
    ext: ".oscal.json",
    role: "Cyber-physical security controls & SP 800-53 assessment",
    group: "core",
    tier: "alpha",
  },
  {
    slug: "ssp",
    name: "SSP",
    sidebar: "SSP System Packaging",
    ext: ".ssp",
    role: "FMU system structure & parameterization",
    group: "core",
    tier: "beta",
  },
  {
    slug: "owl2",
    name: "OWL2",
    sidebar: "OWL2 Ontology",
    ext: ".owl",
    role: "Ontologies & description-logic reasoning",
    group: "core",
    tier: "beta",
  },
  {
    slug: "sparql",
    name: "SPARQL 1.1",
    sidebar: "SPARQL Queries",
    ext: ".rq, .sparql",
    role: "RDF knowledge-graph & digital-thread semantic queries",
    group: "core",
    tier: "beta",
  },

  // ── Geometry & continuum ────────────────────────────────────────────────
  {
    slug: "step",
    name: "STEP (ISO 10303)",
    sidebar: "STEP CAD (ISO 10303)",
    ext: ".step",
    role: "B-Rep CAD assemblies & AP242 PMI",
    group: "geometry",
    tier: "beta",
  },
  {
    slug: "qif",
    name: "QIF (ISO 23952)",
    sidebar: "QIF Digital Metrology",
    ext: ".qif",
    role: "ASME Y14.5 / ISO 1101 GD&T metrology & SPC capability",
    group: "geometry",
    tier: "alpha",
  },
  {
    slug: "scad",
    name: "OpenSCAD",
    sidebar: "OpenSCAD CSG",
    ext: ".scad",
    role: "Parametric constructive solid geometry",
    group: "geometry",
    tier: "beta",
  },
  {
    slug: "cfd",
    name: "CFD (SU2 / OpenFOAM)",
    sidebar: "CFD (SU2 / OpenFOAM)",
    ext: ".su2",
    role: "Computational fluid dynamics meshes",
    group: "geometry",
    tier: "alpha",
  },
  {
    slug: "fea",
    name: "FEA (CalculiX / Abaqus / NASTRAN)",
    sidebar: "FEA Structural Analysis",
    ext: ".inp",
    role: "Finite-element structural analysis",
    group: "geometry",
    tier: "alpha",
  },
  {
    slug: "usd",
    name: "OpenUSD",
    sidebar: "OpenUSD (Universal Scene Description)",
    ext: ".usd / .usda / .usdz",
    role: "Universal Scene Description 3D stages & UsdPhysics digital twins",
    group: "geometry",
    tier: "alpha",
  },

  // ── Data & code integration ─────────────────────────────────────────────
  {
    slug: "csv",
    name: "CSV",
    sidebar: "CSV Telemetry",
    ext: ".csv",
    role: "Time-series & sensor logs",
    group: "integration",
    tier: "beta",
  },
  {
    slug: "c",
    name: "C",
    sidebar: "C Integration",
    ext: ".c",
    role: "Numerical & embedded C integration",
    group: "integration",
    tier: "alpha",
  },
  {
    slug: "fortran",
    name: "Fortran",
    sidebar: "Fortran Integration",
    ext: ".f90",
    role: "Legacy scientific subroutines",
    group: "integration",
    tier: "alpha",
  },

  // ── Aerospace & defense ─────────────────────────────────────────────────
  {
    slug: "jsbsim",
    name: "JSBSim",
    sidebar: "JSBSim Flight Dynamics",
    ext: ".xml",
    role: "6-DOF flight dynamics",
    group: "aerospace",
    tier: "alpha",
  },
  {
    slug: "rocets",
    name: "NASA ROCETS",
    sidebar: "NASA ROCETS Propulsion",
    ext: ".roc",
    role: "Liquid rocket engine transients",
    group: "aerospace",
    tier: "beta",
  },
  {
    slug: "ccsds",
    name: "CCSDS",
    sidebar: "CCSDS Space Telemetry",
    ext: ".xtce",
    role: "Astrodynamics & spacecraft telemetry",
    group: "aerospace",
    tier: "beta",
  },
  {
    slug: "easy5",
    name: "EASY5",
    sidebar: "EASY5 Simulation",
    ext: ".ez5",
    role: "Dynamic simulation & linear control",
    group: "aerospace",
    tier: "beta",
  },
  {
    slug: "twentysim",
    name: "20-sim",
    sidebar: "20-sim Bond Graphs",
    ext: ".emx",
    role: "Multi-domain Bond Graphs & SIDOPS simulation",
    group: "aerospace",
    tier: "beta",
  },

  // ── Automotive & mobility ───────────────────────────────────────────────
  {
    slug: "autosar",
    name: "AUTOSAR",
    sidebar: "AUTOSAR Architecture",
    ext: ".arxml",
    role: "Classic & Adaptive software architecture",
    group: "automotive",
    tier: "alpha",
  },
  {
    slug: "simulink",
    name: "MATLAB Simulink",
    sidebar: "MATLAB Simulink",
    ext: ".slx",
    role: "Block diagrams & control systems",
    group: "automotive",
    tier: "beta",
  },
  {
    slug: "gtsuite",
    name: "GT-SUITE",
    sidebar: "GT-SUITE / GT-POWER",
    ext: ".gtm",
    role: "Engine, powertrain & thermal flow",
    group: "automotive",
    tier: "alpha",
  },
  {
    slug: "opendrive",
    name: "ASAM OpenDRIVE",
    sidebar: "OpenDRIVE Roads",
    ext: ".xodr",
    role: "Road network geometry",
    group: "automotive",
    tier: "beta",
  },
  {
    slug: "openscenario",
    name: "ASAM OpenSCENARIO",
    sidebar: "OpenSCENARIO AV Safety",
    ext: ".xosc",
    role: "Driving scenarios & RSS safety margins",
    group: "automotive",
    tier: "alpha",
  },
  {
    slug: "gtfs",
    name: "GTFS",
    sidebar: "GTFS Transit Electrification",
    ext: ".gtfs, .zip",
    role: "Transit schedules & fleet electrification power",
    group: "automotive",
    tier: "alpha",
  },

  // ── Rail ────────────────────────────────────────────────────────────────
  {
    slug: "gensys",
    name: "GENSYS",
    sidebar: "GENSYS Railway Dynamics",
    ext: ".calc",
    role: "Railway vehicle dynamics & track",
    group: "rail",
    tier: "beta",
  },
  {
    slug: "simpack",
    name: "SIMPACK",
    sidebar: "SIMPACK Multibody Dynamics",
    ext: ".spck",
    role: "Spatial multibody dynamics",
    group: "rail",
    tier: "alpha",
  },

  // ── Power systems & grid ────────────────────────────────────────────────
  {
    slug: "pscad",
    name: "PSCAD / EMTDC",
    sidebar: "PSCAD Power Systems",
    ext: ".pscx",
    role: "Electromagnetic transients (EMT)",
    group: "power",
    tier: "beta",
  },
  {
    slug: "psse",
    name: "PSS/E",
    sidebar: "PSS/E Power Flow (.raw)",
    ext: ".raw, .dyr",
    role: "Transmission power flow & transient stability",
    group: "power",
    tier: "beta",
  },
  {
    slug: "powerfactory",
    name: "DIgSILENT PowerFactory",
    sidebar: "DIgSILENT PowerFactory",
    ext: ".dz, .pfd, .dsl",
    role: "Node-breaker power flow, IEC 60909 short-circuit & RMS/EMT",
    group: "power",
    tier: "beta",
  },
  {
    slug: "pslf",
    name: "GE Vernova PSLF",
    sidebar: "GE PSLF WECC Grid",
    ext: ".epc, .dyd",
    role: "WECC bulk transmission power flow & dynamic models",
    group: "power",
    tier: "alpha",
  },
  {
    slug: "cgmes",
    name: "CIM / CGMES",
    sidebar: "CIM / CGMES",
    ext: ".xml, .rdf",
    role: "ENTSO-E IEC 61970 transmission grid exchange & topology",
    group: "power",
    tier: "alpha",
  },
  {
    slug: "opendss",
    name: "OpenDSS",
    sidebar: "OpenDSS Distribution",
    ext: ".dss",
    role: "Unbalanced distribution & DER hosting",
    group: "power",
    tier: "alpha",
  },
  {
    slug: "ocpp",
    name: "OCPP",
    sidebar: "OCPP EV Smart Charging",
    ext: ".ocpp, .json",
    role: "EV smart charging & transformer load management",
    group: "power",
    tier: "alpha",
  },
  {
    slug: "openadr",
    name: "OpenADR",
    sidebar: "OpenADR Demand Response",
    ext: ".oadr, .xml, .json",
    role: "Automated demand response & peak shaving",
    group: "power",
    tier: "alpha",
  },
  {
    slug: "tough",
    name: "LBNL TOUGH",
    sidebar: "TOUGH Geothermal",
    ext: ".tgh, .dat",
    role: "Geothermal reservoir & wellbore flashing thermodynamics",
    group: "power",
    tier: "alpha",
  },
  {
    slug: "matpower",
    name: "MATPOWER",
    sidebar: "MATPOWER Grid (.m)",
    ext: ".m",
    role: "Power flow & optimal power flow (OPF)",
    group: "power",
    tier: "alpha",
  },
  {
    slug: "comtrade",
    name: "IEEE COMTRADE",
    sidebar: "COMTRADE Fault Transients",
    ext: ".cfg, .dat, .cff",
    role: "Digital fault recorder & transient disturbance analysis",
    group: "power",
    tier: "alpha",
  },
  {
    slug: "scl",
    name: "IEC 61850 SCL",
    sidebar: "IEC 61850 Substation SCL",
    ext: ".scd, .cid, .ssd, .xml",
    role: "Substation automation, GOOSE & Sampled Values dataflow",
    group: "power",
    tier: "alpha",
  },
  {
    slug: "atp",
    name: "ATP-EMTP",
    sidebar: "ATP-EMTP Transients",
    ext: ".atp, .dat",
    role: "Electromagnetic transient program card decks",
    group: "power",
    tier: "alpha",
  },
  {
    slug: "dnp3",
    name: "IEEE 1815 / DNP3",
    sidebar: "DNP3 SCADA Telemetry",
    ext: ".xml, .json, .dnp3",
    role: "Utility digital twin & SCADA deadband telemetry",
    group: "power",
    tier: "alpha",
  },
  {
    slug: "oneliner",
    name: "ASPEN OneLiner / CAPE",
    sidebar: "ASPEN OneLiner Protection",
    ext: ".olx, .dxt",
    role: "Short-circuit fault currents & TOC protection coordination",
    group: "power",
    tier: "alpha",
  },
  {
    slug: "sel",
    name: "SEL Relay Settings",
    sidebar: "SEL Protection Settings",
    ext: ".rdb, .rcf, .sel, .txt",
    role: "Schweitzer relay settings, SELogic & 50/51/21 protection",
    group: "power",
    tier: "alpha",
  },
  {
    slug: "c37118",
    name: "IEEE C37.118 Synchrophasor",
    sidebar: "IEEE C37.118 PMU",
    ext: ".c37118, .pmu",
    role: "Synchrophasor PMU streaming telemetry & wide-area monitoring",
    group: "power",
    tier: "alpha",
  },
  {
    slug: "cyme",
    name: "Eaton CYME",
    sidebar: "Eaton CYME Distribution",
    ext: ".sxst, .cyme",
    role: "Distribution network load flow, hosting capacity & protection",
    group: "power",
    tier: "alpha",
  },
  {
    slug: "gridlabd",
    name: "GridLAB-D",
    sidebar: "GridLAB-D (.glm)",
    ext: ".glm",
    role: "Agent-based distribution grid & transactive energy simulation",
    group: "power",
    tier: "alpha",
  },
  {
    slug: "iec104",
    name: "IEC 60870-5-104",
    sidebar: "IEC 60870-5-104 SCADA",
    ext: ".iec104, .104",
    role: "Substation telecontrol & SCADA protocol telemetry",
    group: "power",
    tier: "alpha",
  },
  {
    slug: "plscadd",
    name: "PLS-CADD",
    sidebar: "PLS-CADD Transmission Lines",
    ext: ".pol, .loa, .plscadd",
    role: "Overhead transmission line sag-tension & structure clearances",
    group: "power",
    tier: "alpha",
  },
  {
    slug: "powerworld",
    name: "PowerWorld Simulator",
    sidebar: "PowerWorld (.aux/.cdf)",
    ext: ".aux, .cdf",
    role: "Transmission power flow, contingency screening & OPF",
    group: "power",
    tier: "alpha",
  },
  {
    slug: "pypsa",
    name: "PyPSA",
    sidebar: "PyPSA Energy Systems",
    ext: ".pypsa, .pypsa.json",
    role: "Sector-coupled power & energy system capacity expansion",
    group: "power",
    tier: "alpha",
  },
  {
    slug: "rtds",
    name: "RTDS / RSCAD",
    sidebar: "RTDS / RSCAD (.dft)",
    ext: ".dft, .rtds",
    role: "Real-time digital simulator EMT drafts & HIL models",
    group: "power",
    tier: "alpha",
  },

  // ── Oil, gas & subsurface ───────────────────────────────────────────────
  {
    slug: "olga",
    name: "OLGA",
    sidebar: "OLGA Multiphase Flow",
    ext: ".opi, .genkey",
    role: "Transient multiphase flow assurance",
    group: "oil-gas",
    tier: "beta",
  },
  {
    slug: "lps",
    name: "PipelineStudio",
    sidebar: "PipelineStudio (.lps)",
    ext: ".lps",
    role: "Gas & liquid pipeline hydraulics",
    group: "oil-gas",
    tier: "beta",
  },
  {
    slug: "eclipse",
    name: "ECLIPSE",
    sidebar: "ECLIPSE Reservoir",
    ext: ".data",
    role: "Reservoir engineering",
    group: "oil-gas",
    tier: "alpha",
  },
  {
    slug: "las",
    name: "CWLS LAS Well Logs",
    sidebar: "CWLS LAS Well Logs",
    ext: ".las",
    role: "Petrophysical wireline well-log curves & formation evaluation",
    group: "oil-gas",
    tier: "pre-alpha",
  },

  // ── Nuclear ─────────────────────────────────────────────────────────────
  {
    slug: "relap5",
    name: "RELAP5-3D",
    sidebar: "RELAP5 Nuclear Loops",
    ext: ".r5, .inp",
    role: "Reactor thermal-hydraulics & kinetics",
    group: "nuclear",
    tier: "beta",
  },

  // ── Marine & offshore ───────────────────────────────────────────────────
  {
    slug: "sima",
    name: "SIMA / SIMO / RIFLEX",
    sidebar: "SIMA / SIMO / RIFLEX",
    ext: ".sima",
    role: "Marine operations & riser dynamics",
    group: "marine",
    tier: "alpha",
  },

  // ── Electronics & semiconductors ────────────────────────────────────────
  {
    slug: "spice",
    name: "SPICE",
    sidebar: "SPICE Electronics",
    ext: ".cir",
    role: "Analog circuit simulation",
    group: "electronics",
    tier: "beta",
  },
  {
    slug: "atopile",
    name: "atopile",
    sidebar: "atopile (.ato)",
    ext: ".ato",
    role: "Code-first electronic hardware & PCB design",
    group: "electronics",
    tier: "beta",
  },
  {
    slug: "kicad",
    name: "KiCad ECAD",
    sidebar: "KiCad PCB & Schematics",
    ext: ".kicad_pcb, .kicad_sch, .kicad_sym, .kicad_mod",
    role: "PCB layouts, schematics, footprints & DRC/DFM verification",
    group: "electronics",
    tier: "beta",
  },
  {
    slug: "verilog-a",
    name: "Verilog-A / AMS",
    sidebar: "Verilog-A Devices",
    ext: ".va, .vams",
    role: "Analog compact device models",
    group: "electronics",
    tier: "alpha",
  },
  {
    slug: "ibis",
    name: "IBIS",
    sidebar: "IBIS Buffer Modeling",
    ext: ".ibs",
    role: "I/O buffer behavioral models",
    group: "electronics",
    tier: "alpha",
  },
  {
    slug: "touchstone",
    name: "Touchstone",
    sidebar: "Touchstone RF / SI",
    ext: ".sNp",
    role: "RF & signal-integrity S-parameters",
    group: "electronics",
    tier: "alpha",
  },
  {
    slug: "optical",
    name: "OpenROADM & Telcordia .sor",
    sidebar: "Optical & DWDM (.sor)",
    ext: ".sor",
    role: "OTDR trace analytics & DWDM transmission",
    group: "electronics",
    tier: "alpha",
  },
  {
    slug: "ran",
    name: "NSMA WG16 & Planet Antenna",
    sidebar: "RAN & Microwave (.adf)",
    ext: ".adf, .pat",
    role: "Antenna 3D patterns, RF MPE safety & microwave links",
    group: "electronics",
    tier: "alpha",
  },
  {
    slug: "fiber",
    name: "TIA-598-D Outside Plant",
    sidebar: "Fiber OSP Cadastre",
    ext: ".geojson",
    role: "Fiber strand tracing, NESC pole loading & OTDR GIS fault location",
    group: "electronics",
    tier: "beta",
  },

  // ── Robotics & industrial automation ────────────────────────────────────
  {
    slug: "urdf",
    name: "URDF / Xacro",
    sidebar: "URDF & Xacro Robotics",
    ext: ".urdf",
    role: "Robot kinematics & dynamics",
    group: "robotics",
    tier: "beta",
  },
  {
    slug: "plcopen",
    name: "PLCopen / IEC 61131-3",
    sidebar: "PLCopen Automation",
    ext: ".st",
    role: "PLC control software",
    group: "robotics",
    tier: "alpha",
  },
  {
    slug: "automationml",
    name: "AutomationML (IEC 62714)",
    sidebar: "AutomationML Plant Topology",
    ext: ".aml",
    role: "CAEX mechatronic plant hierarchy & virtual commissioning",
    group: "robotics",
    tier: "alpha",
  },
  {
    slug: "adams",
    name: "MSC Adams",
    sidebar: "MSC Adams MBD",
    ext: ".adm",
    role: "Mechanical system dynamics",
    group: "robotics",
    tier: "beta",
  },

  // ── Buildings & civil infrastructure ────────────────────────────────────
  {
    slug: "energyplus",
    name: "EnergyPlus",
    sidebar: "EnergyPlus Thermal",
    ext: ".idf",
    role: "Building energy & HVAC",
    group: "buildings",
    tier: "alpha",
  },
  {
    slug: "epanet",
    name: "EPANET",
    sidebar: "EPANET Water Networks",
    ext: ".inp",
    role: "Pressurized water distribution",
    group: "buildings",
    tier: "beta",
  },
  {
    slug: "swmm",
    name: "EPA SWMM",
    sidebar: "SWMM Urban Hydrology",
    ext: ".inp",
    role: "Stormwater & urban drainage",
    group: "buildings",
    tier: "beta",
  },
  {
    slug: "hec-ras",
    name: "USACE HEC-RAS",
    sidebar: "HEC-RAS River Hydraulics",
    ext: ".g01, .g02, .rasgeo",
    role: "River basin & open-channel hydraulics",
    group: "buildings",
    tier: "alpha",
  },
  {
    slug: "modflow",
    name: "USGS MODFLOW",
    sidebar: "MODFLOW Groundwater",
    ext: ".dis, .dis6, .npf, .wel",
    role: "Regional groundwater aquifers & 3D Darcy flow",
    group: "buildings",
    tier: "alpha",
  },
  {
    slug: "landgem",
    name: "EPA LandGEM",
    sidebar: "LandGEM Biogas",
    ext: ".landgem, .lfg, .biogas",
    role: "Solid waste methane decay & landfill biogas CHP",
    group: "buildings",
    tier: "alpha",
  },
  {
    slug: "hec-hms",
    name: "USACE HEC-HMS",
    sidebar: "HEC-HMS Watershed Hydrology",
    ext: ".basin, .hms",
    role: "Precipitation runoff, SCS-CN excess & Muskingum routing",
    group: "buildings",
    tier: "alpha",
  },
  {
    slug: "waterml",
    name: "OGC WaterML 2.0",
    sidebar: "WaterML Hydrologic Telemetry",
    ext: ".waterml, .wml2, .xml",
    role: "Streamflow telemetry & stage-discharge rating curves",
    group: "buildings",
    tier: "alpha",
  },
  {
    slug: "asm",
    name: "IWA Activated Sludge Models",
    sidebar: "IWA ASM Wastewater",
    ext: ".asm, .bsm, .wrrf",
    role: "Biokinetics, Petersen matrix & Takács clarifier settling",
    group: "buildings",
    tier: "alpha",
  },

  // ── Chemical & process ──────────────────────────────────────────────────
  {
    slug: "aspen",
    name: "Aspen Plus / HYSYS",
    sidebar: "Aspen Chemical Process",
    ext: ".bkp",
    role: "Chemical process flowsheets",
    group: "process",
    tier: "alpha",
  },
  {
    slug: "gproms",
    name: "gPROMS / PML",
    sidebar: "gPROMS Dynamic Process",
    ext: ".gproms",
    role: "Equation-oriented dynamic process & distributed PDEs",
    group: "process",
    tier: "alpha",
  },
  {
    slug: "cantera",
    name: "Cantera",
    sidebar: "Cantera Kinetics & Thermo",
    ext: ".yaml",
    role: "Gas-phase chemical kinetics & NASA-7 thermochemistry",
    group: "process",
    tier: "beta",
  },
  {
    slug: "phreeqc",
    name: "PHREEQC",
    sidebar: "PHREEQC Geochemistry",
    ext: ".pqi",
    role: "Aqueous geochemistry, speciation & mineral saturation",
    group: "process",
    tier: "alpha",
  },
  {
    slug: "smiles",
    name: "SMILES / SDF",
    sidebar: "SMILES & Molfile Graphs",
    ext: ".smi",
    role: "Molecular graph parsing & Joback property estimation",
    group: "process",
    tier: "alpha",
  },

  // ── Life sciences, healthcare & medical ─────────────────────────────────
  {
    slug: "sbml",
    name: "SBML",
    sidebar: "SBML Systems Biology",
    ext: ".sbml",
    role: "Biochemical reaction networks",
    group: "life-sciences",
    tier: "alpha",
  },
  {
    slug: "antimony",
    name: "Antimony",
    sidebar: "Antimony Modular Bio",
    ext: ".ant",
    role: "Modular human-readable systems biology models",
    group: "life-sciences",
    tier: "alpha",
  },
  {
    slug: "bngl",
    name: "BioNetGen (BNGL)",
    sidebar: "BioNetGen Rule Networks",
    ext: ".bngl",
    role: "Rule-based multiprotein signaling & reaction expansion",
    group: "life-sciences",
    tier: "alpha",
  },
  {
    slug: "sbol",
    name: "SBOL3",
    sidebar: "SBOL3 Genetic Circuits",
    ext: ".sbol",
    role: "Synthetic biology genetic circuits & Hill kinetics",
    group: "life-sciences",
    tier: "alpha",
  },
  {
    slug: "sedml",
    name: "SED-ML",
    sidebar: "SED-ML Bio Experiments",
    ext: ".sedml",
    role: "COMBINE reproducible simulation experiment protocols",
    group: "life-sciences",
    tier: "alpha",
  },
  {
    slug: "nmtran",
    name: "NMTRAN (NONMEM)",
    sidebar: "NMTRAN Pharmacometrics",
    ext: ".ctl",
    role: "Clinical PK/PD compartmental dosing & exposure",
    group: "life-sciences",
    tier: "alpha",
  },
  {
    slug: "mlxtran",
    name: "MLXTRAN (Monolix)",
    sidebar: "MLXTRAN Pharmacometrics",
    ext: ".mlxtran",
    role: "Monolix PK/PD longitudinal & compartmental models",
    group: "life-sciences",
    tier: "alpha",
  },
  {
    slug: "pdb",
    name: "PDB / mmCIF",
    sidebar: "PDB Macromolecular 3D",
    ext: ".pdb",
    role: "3D protein structures, Ramachandran & GNM dynamics",
    group: "life-sciences",
    tier: "alpha",
  },
  {
    slug: "genbank",
    name: "GenBank / FASTA",
    sidebar: "GenBank & FASTA DNA",
    ext: ".gb",
    role: "Annotated nucleotide sequences, ORFs & restriction maps",
    group: "life-sciences",
    tier: "alpha",
  },
  {
    slug: "cellml",
    name: "CellML",
    sidebar: "CellML Electrophysiology",
    ext: ".cellml",
    role: "Cellular electrophysiology & Physiome ODE models",
    group: "life-sciences",
    tier: "alpha",
  },
  {
    slug: "nmodl",
    name: "NMODL (NEURON)",
    sidebar: "NMODL Ion Channels",
    ext: ".mod",
    role: "NEURON ion-channel & Hodgkin-Huxley membrane kinetics",
    group: "life-sciences",
    tier: "alpha",
  },
  {
    slug: "opensim",
    name: "OpenSim",
    sidebar: "OpenSim Biomechanics",
    ext: ".osim",
    role: "Musculoskeletal multibody & Hill-type muscle dynamics",
    group: "life-sciences",
    tier: "alpha",
  },
  {
    slug: "febio",
    name: "FEBio / SOFA",
    sidebar: "FEBio Soft-Tissue FEA",
    ext: ".feb",
    role: "Hyperelastic soft-tissue biomechanics & surgical scenes",
    group: "life-sciences",
    tier: "alpha",
  },
  {
    slug: "dicom-rt",
    name: "DICOM-RT",
    sidebar: "DICOM-RT Radiotherapy",
    ext: ".rtplan",
    role: "Clinical radiotherapy plans, DVH metrics & BED/EQD2",
    group: "life-sciences",
    tier: "alpha",
  },
  {
    slug: "topas",
    name: "TOPAS / GATE",
    sidebar: "TOPAS Proton Therapy",
    ext: ".topas",
    role: "Proton & hadrontherapy nozzles and Bortfeld Bragg peaks",
    group: "life-sciences",
    tier: "alpha",
  },
  {
    slug: "nifti",
    name: "NIfTI / NRRD",
    sidebar: "NIfTI & NRRD Imaging",
    ext: ".nii",
    role: "Volumetric medical imaging, RAS affines & iso-surfacing",
    group: "life-sciences",
    tier: "alpha",
  },
  {
    slug: "three-mf",
    name: "3MF Medical",
    sidebar: "3MF Surgical Guides",
    ext: ".3mf",
    role: "Patient-specific 3D-printed cutting guides & implants",
    group: "life-sciences",
    tier: "alpha",
  },
  {
    slug: "igtl",
    name: "OpenIGTLink / PLUS",
    sidebar: "OpenIGTLink Navigation",
    ext: ".igtl",
    role: "Image-guided surgical tracking, pivot calibration & TRE",
    group: "life-sciences",
    tier: "alpha",
  },

  // ── Heritage 1960s–1980s Simulation, EDA, Nuclear/Aerospace, Optimization & Scientific ──
  { slug: "acsl", name: "ACSL", sidebar: "ACSL Simulation", ext: ".csl", role: "Advanced Continuous Simulation Language (1975) ODE/hybrid solver", group: "core", tier: "beta" },
  { slug: "csmp", name: "CSMP / CSSL-67", sidebar: "CSMP / CSSL-67", ext: ".csmp", role: "IBM System/360 continuous ODE modeling & topological sorting", group: "core", tier: "beta" },
  { slug: "dynamo", name: "DYNAMO", sidebar: "DYNAMO System Dynamics", ext: ".dyn", role: "MIT System Dynamics stock-flow & feedback modeling", group: "core", tier: "beta" },
  { slug: "esl", name: "ESL", sidebar: "ESA ESL Simulation", ext: ".esl", role: "European Space Agency hybrid continuous/discrete simulation", group: "aerospace", tier: "beta" },
  { slug: "gpss", name: "GPSS", sidebar: "GPSS Discrete-Event", ext: ".gps", role: "IBM General Purpose Simulation System transaction-flow DES", group: "core", tier: "beta" },
  { slug: "simscript", name: "SIMSCRIPT II.5", sidebar: "SIMSCRIPT II.5", ext: ".sim", role: "RAND process/entity/resource discrete-event simulation", group: "core", tier: "beta" },
  { slug: "slam", name: "SLAM II", sidebar: "SLAM II Combined DES/ODE", ext: ".slam", role: "Combined discrete-event network & continuous ODE simulation", group: "core", tier: "beta" },
  { slug: "vhdl", name: "VHDL (IEEE 1076)", sidebar: "VHDL (IEEE 1076)", ext: ".vhd", role: "IEEE 1076-1987 9-value std_logic delta-cycle RTL simulation", group: "electronics", tier: "beta" },
  { slug: "verilog", name: "Verilog (IEEE 1364)", sidebar: "Verilog (IEEE 1364)", ext: ".v", role: "IEEE 1364 4-state event-driven RTL & gate-level simulation", group: "electronics", tier: "beta" },
  { slug: "lustre", name: "Lustre", sidebar: "Lustre Synchronous", ext: ".lus", role: "Synchronous dataflow, clock calculus & formal observers", group: "aerospace", tier: "beta" },
  { slug: "esterel", name: "Esterel", sidebar: "Esterel Reactive", ext: ".strl", role: "Synchronous imperative reactive systems & constructive semantics", group: "aerospace", tier: "beta" },
  { slug: "sdl", name: "SDL-88", sidebar: "SDL-88 Telecom EFSM", ext: ".sdl", role: "ITU-T Z.100 communicating Extended Finite State Machines", group: "electronics", tier: "beta" },
  { slug: "edif", name: "EDIF 2.0.0", sidebar: "EDIF 2.0.0 Netlists", ext: ".edf", role: "Electronic Design Interchange Format hierarchical netlists", group: "electronics", tier: "beta" },
  { slug: "gdsii", name: "GDSII", sidebar: "GDSII IC Layout", ext: ".gds", role: "Calma GDSII binary stream & GDT IC mask layout & DRC", group: "electronics", tier: "beta" },
  { slug: "cif", name: "CIF 2.0", sidebar: "CIF 2.0 IC Layout", ext: ".cif", role: "Caltech Intermediate Form IC mask layout & MOSIS SCMOS DRC", group: "electronics", tier: "beta" },
  { slug: "gerber", name: "Gerber RS-274-D/X", sidebar: "Gerber PCB Layout", ext: ".gbr", role: "PCB photoplotter aperture/arc/region geometry & IPC-2221 DFM", group: "electronics", tier: "beta" },
  { slug: "mcnp", name: "MCNP", sidebar: "MCNP Particle Transport", ext: ".mcnp", role: "Los Alamos Monte Carlo N-Particle CSG & k_eff transport", group: "nuclear", tier: "beta" },
  { slug: "melcor", name: "MELCOR", sidebar: "MELCOR Severe Accident", ext: ".mel", role: "Sandia severe accident thermal-hydraulics & core degradation", group: "nuclear", tier: "beta" },
  { slug: "scale", name: "SCALE / KENO / ORIGEN", sidebar: "SCALE / KENO / ORIGEN", ext: ".scale", role: "ORNL Bateman isotope depletion & KENO criticality geometry", group: "nuclear", tier: "beta" },
  { slug: "sinda", name: "SINDA / FLUINT", sidebar: "SINDA Thermal Networks", ext: ".sin", role: "NASA lumped-parameter thermal RC & radiation network solver", group: "aerospace", tier: "beta" },
  { slug: "trasys", name: "TRASYS", sidebar: "TRASYS Orbital Radiation", ext: ".tra", role: "NASA radiative view-factor & orbital solar/albedo/IR flux", group: "aerospace", tier: "beta" },
  { slug: "nec2", name: "NEC-2", sidebar: "NEC-2 Antenna MoM", ext: ".nec", role: "LLNL thin-wire Method-of-Moments antenna impedance & gain", group: "electronics", tier: "beta" },
  { slug: "datcom", name: "USAF Digital DATCOM", sidebar: "USAF Digital DATCOM", ext: ".dcm", role: "Semi-empirical aircraft stability & control derivatives", group: "aerospace", tier: "beta" },
  { slug: "cea", name: "NASA CEA", sidebar: "NASA CEA Equilibrium", ext: ".cea", role: "Gibbs free-energy chemical equilibrium & rocket Isp solver", group: "aerospace", tier: "beta" },
  { slug: "gams", name: "GAMS", sidebar: "GAMS Optimization", ext: ".gms", role: "General Algebraic Modeling System LP/MILP/NLP optimization", group: "core", tier: "beta" },
  { slug: "mps", name: "IBM MPS", sidebar: "IBM MPS LP/MIP", ext: ".mps", role: "Fixed & free Mathematical Programming System LP/MILP/QP", group: "core", tier: "beta" },
  { slug: "cplex-lp", name: "CPLEX LP / LINDO", sidebar: "CPLEX LP / LINDO", ext: ".lp", role: "Algebraic LP/MILP/QP optimization & simplex/B&B solver", group: "core", tier: "beta" },
  { slug: "iges", name: "IGES 5.3", sidebar: "IGES 5.3 CAD", ext: ".igs", role: "Initial Graphics Exchange Specification NURBS & B-Rep CAD", group: "geometry", tier: "beta" },
  { slug: "dxf", name: "AutoCAD DXF", sidebar: "AutoCAD DXF", ext: ".dxf", role: "Drawing Exchange Format 2D/3D CAD entities & INSERT blocks", group: "geometry", tier: "beta" },
  { slug: "gcode", name: "G-code / RS-274", sidebar: "G-code / RS-274 CNC", ext: ".gcode", role: "ISO 6983 CNC toolpath kinematics, canned cycles & cycle time", group: "geometry", tier: "beta" },
  { slug: "apt", name: "APT (ISO 4342)", sidebar: "APT CNC Language", ext: ".apt", role: "Automatically Programmed Tools analytic CLDATA toolpath solver", group: "geometry", tier: "beta" },
  { slug: "lsdyna", name: "LS-DYNA / DYNA3D", sidebar: "LS-DYNA Explicit FEA", ext: ".k", role: "Explicit dynamics finite-element keyword deck & CFL solver", group: "geometry", tier: "beta" },
  { slug: "apdl", name: "ANSYS APDL", sidebar: "ANSYS APDL FEA", ext: ".apdl", role: "Parametric Design Language macro expander & static/modal FEA", group: "geometry", tier: "beta" },
  { slug: "plot3d", name: "NASA PLOT3D", sidebar: "NASA PLOT3D CFD", ext: ".xyz", role: "Multi-block structured CFD grid & conservative solution format", group: "geometry", tier: "beta" },
  { slug: "trnsys", name: "TRNSYS", sidebar: "TRNSYS Solar/Thermal", ext: ".dck", role: "Transient solar, thermal storage & building component decks", group: "buildings", tier: "beta" },
  { slug: "doe2", name: "DOE-2 BDL", sidebar: "DOE-2 BDL Buildings", ext: ".bdl", role: "LBNL Building Description Language envelope & HVAC load solver", group: "buildings", tier: "beta" },
  { slug: "chemkin", name: "CHEMKIN", sidebar: "CHEMKIN Kinetics", ext: ".ck", role: "Sandia gas-phase chemical kinetics & NASA-7 combustion solver", group: "process", tier: "beta" },
  { slug: "molfile", name: "MDL Molfile / SDF", sidebar: "MDL Molfile / SDF", ext: ".mol", role: "V2000/V3000/SDF molecular graphs, SSSR rings & UFF energy", group: "process", tier: "beta" },
  { slug: "gaussian", name: "Gaussian Input", sidebar: "Gaussian Z-Matrix", ext: ".gjf", role: "Quantum chemistry input, NeRF Z-matrix & vibrational modes", group: "process", tier: "beta" },
  { slug: "ieee-cdf", name: "IEEE CDF & BPA IPF", sidebar: "IEEE CDF / BPA IPF", ext: ".cdf", role: "IEEE Common Data Format AC Newton-Raphson power flow", group: "power", tier: "beta" },
  { slug: "hec1", name: "USACE HEC-1", sidebar: "USACE HEC-1 Hydrology", ext: ".hc1", role: "Flood hydrograph SCS CN, unit hydrograph & Muskingum routing", group: "buildings", tier: "beta" },
  { slug: "hec2", name: "USACE HEC-2", sidebar: "USACE HEC-2 Hydraulics", ext: ".hc2", role: "1D Standard Step open-channel water surface profile solver", group: "buildings", tier: "beta" },
  { slug: "segy", name: "SEG-Y", sidebar: "SEG-Y Seismic", ext: ".sgy", role: "Geophysical seismic EBCDIC/IBM-float codec, NMO & FFT solver", group: "oil-gas", tier: "beta" },
  { slug: "fits", name: "FITS 4.0", sidebar: "FITS 4.0 Astrometry", ext: ".fits", role: "NASA/IAU Flexible Image Transport System HDU & WCS astrometry", group: "aerospace", tier: "beta" },

  // ── Heritage 1960s–1980s Engineering & Scientific Data Formats (+ Interactive Viewers) ──
  { slug: "netcdf", name: "NetCDF Classic / CDL", sidebar: "NetCDF Classic / CDL", ext: ".cdl", role: "Unidata self-describing scientific arrays, CF linting & heatmap viewer", group: "core", tier: "beta" },
  { slug: "nasa-cdf", name: "NASA CDF", sidebar: "NASA CDF Telemetry", ext: ".skt", role: "Space-physics binary/skeleton telemetry, ISTP EPOCH & strip-chart viewer", group: "aerospace", tier: "beta" },
  { slug: "grib", name: "WMO GRIB Ed. 1", sidebar: "WMO GRIB Ed. 1", ext: ".grb", role: "Gridded binary meteorology, geostrophic wind & geographic heatmap viewer", group: "buildings", tier: "beta" },
  { slug: "bufr", name: "WMO BUFR", sidebar: "WMO BUFR Soundings", ext: ".bufr", role: "Table-driven synoptic weather bit-streams & upper-air sounding viewer", group: "buildings", tier: "beta" },
  { slug: "usgs-dem", name: "USGS DEM", sidebar: "USGS DEM Terrain", ext: ".dem", role: "Digital Elevation Model slope/aspect, D8 flow & topographic map viewer", group: "geometry", tier: "beta" },
  { slug: "hdf4", name: "NCSA HDF4", sidebar: "NCSA HDF4 Datasets", ext: ".hdf", role: "Hierarchical Data Format v4 Vgroup/SDS binary codec & heatmap viewer", group: "core", tier: "beta" },
  { slug: "arinc429", name: "ARINC 429", sidebar: "ARINC 429 Avionics", ext: ".a429", role: "Commercial avionics 32-bit BNR/BCD bus codec & PFD instrument viewer", group: "aerospace", tier: "beta" },
  { slug: "nmea0183", name: "NMEA 0183", sidebar: "NMEA 0183 GPS/Marine", ext: ".nmea", role: "Marine/GPS ASCII telemetry, WGS-84 geodesy & track/skyplot viewer", group: "marine", tier: "beta" },
  { slug: "rinex", name: "RINEX v2", sidebar: "RINEX v2 GNSS", ext: ".obs", role: "GNSS OBS/NAV Keplerian ephemeris, 3D pseudorange fix & skyplot viewer", group: "aerospace", tier: "beta" },
  { slug: "irig106", name: "IRIG 106 / TMATS", sidebar: "IRIG 106 / TMATS", ext: ".tmats", role: "Flight-test PCM telemetry commutator & major/minor frame grid viewer", group: "aerospace", tier: "beta" },
  { slug: "endf6", name: "ENDF-6", sidebar: "ENDF-6 Nuclear Data", ext: ".endf", role: "Evaluated nuclear cross-sections, Breit-Wigner resonances & log-log plot", group: "nuclear", tier: "beta" },
  { slug: "jcamp-dx", name: "JCAMP-DX", sidebar: "JCAMP-DX Spectroscopy", ext: ".jdx", role: "IUPAC IR/NMR/MS ASDF/DIFDUP spectroscopy & interactive spectrum viewer", group: "process", tier: "beta" },
  { slug: "iucr-cif", name: "IUCr Crystallographic CIF", sidebar: "IUCr Crystal CIF", ext: ".mcif", role: "STAR/CIF crystal structures, powder XRD simulator & 3D lattice viewer", group: "process", tier: "beta" },
  { slug: "stl", name: "3D Systems STL", sidebar: "STL 3D Mesh", ext: ".stl", role: "ASCII/Binary STL meshes, mass/inertia, manifold lints & 3D shaded viewer", group: "geometry", tier: "beta" },
  { slug: "obj", name: "Wavefront OBJ / MTL", sidebar: "Wavefront OBJ / MTL", ext: ".obj", role: "3D polygon meshes, MTL materials, CAD lowering & 3D shaded mesh viewer", group: "geometry", tier: "beta" },
  { slug: "ihex", name: "Intel HEX", sidebar: "Intel HEX Firmware", ext: ".hex", role: "I8/I16/I32HEX ROM images, CRC-32, memory-map & hex/ASCII dump viewer", group: "electronics", tier: "beta" },
  { slug: "srec", name: "Motorola S-Record", sidebar: "Motorola S-Record", ext: ".srec", role: "Motorola S0–S9 firmware images, memory-region & hex/ASCII dump viewer", group: "electronics", tier: "beta" },
  { slug: "jedec", name: "JEDEC JESD3", sidebar: "JEDEC PLD Fuse-Map", ext: ".jed", role: "PAL/GAL fuse-maps, Boolean SOP extractor & fuse-matrix grid viewer", group: "electronics", tier: "beta" },
  { slug: "asn1", name: "ASN.1 (X.208 / X.680)", sidebar: "ASN.1 & BER/DER", ext: ".asn1", role: "ASN.1 schemas, canonical BER/DER TLV codec & type-graph/TLV viewer", group: "electronics", tier: "beta" },
];

export const ALL_POLYGLOT_LANGUAGES: LanguageInfo[] = ALL_LANGUAGES;

export const LANGUAGES: LanguageInfo[] = isModelScriptLangVisible
  ? ALL_LANGUAGES
  : ALL_LANGUAGES.filter((l) => l.slug !== "modelscript");

export const LANGUAGE_BY_SLUG: Record<string, LanguageInfo> = Object.fromEntries(
  ALL_LANGUAGES.map((l) => [l.slug, l]),
);

export const LANGUAGE_COUNT = LANGUAGES.length;

export const TIER_COUNTS: Record<LanguageMaturityTier, number> = {
  beta: LANGUAGES.filter((l) => l.tier === "beta").length,
  alpha: LANGUAGES.filter((l) => l.tier === "alpha").length,
  "pre-alpha": LANGUAGES.filter((l) => l.tier === "pre-alpha").length,
};

/** Non-industry groups shown at the top of the languages sidebar. */
export const PLATFORM_GROUPS: { id: LanguageGroupId; label: string }[] = [
  { id: "core", label: "Core & Systems Engineering" },
  { id: "geometry", label: "Geometry & Continuum" },
  { id: "integration", label: "Data & Code Integration" },
];
