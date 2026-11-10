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

export type LanguageMaturityTier = "stable" | "beta" | "preview";

export const TIER_LABELS: Record<LanguageMaturityTier, string> = {
  stable: "Stable",
  beta: "Beta",
  preview: "Preview",
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
    tier: "stable",
  },
  {
    slug: "modelica",
    name: "Modelica",
    sidebar: "Modelica",
    ext: ".mo",
    role: "Acausal multi-domain physics",
    group: "core",
    tier: "stable",
  },
  {
    slug: "ampl",
    name: "AMPL",
    sidebar: "AMPL Optimization",
    ext: ".mod, .dat, .run, .nl, .mps",
    role: "Mathematical programming & optimization (LP, MILP, NLP)",
    group: "core",
    tier: "stable",
  },
  {
    slug: "sysml2",
    name: "SysML v2 / KerML",
    sidebar: "SysML v2 / KerML",
    ext: ".sysml",
    role: "Systems architecture & requirements",
    group: "core",
    tier: "stable",
  },
  {
    slug: "reqif",
    name: "ReqIF",
    sidebar: "ReqIF Requirements",
    ext: ".reqif",
    role: "Requirements interchange & contract entailment",
    group: "core",
    tier: "stable",
  },
  {
    slug: "oscal",
    name: "NIST OSCAL",
    sidebar: "NIST OSCAL Security",
    ext: ".oscal.json",
    role: "Cyber-physical security controls & SP 800-53 assessment",
    group: "core",
    tier: "beta",
  },
  {
    slug: "ssp",
    name: "SSP",
    sidebar: "SSP System Packaging",
    ext: ".ssp",
    role: "FMU system structure & parameterization",
    group: "core",
    tier: "stable",
  },
  {
    slug: "owl2",
    name: "OWL2",
    sidebar: "OWL2 Ontology",
    ext: ".owl",
    role: "Ontologies & description-logic reasoning",
    group: "core",
    tier: "stable",
  },

  // ── Geometry & continuum ────────────────────────────────────────────────
  {
    slug: "step",
    name: "STEP (ISO 10303)",
    sidebar: "STEP CAD (ISO 10303)",
    ext: ".step",
    role: "B-Rep CAD assemblies & AP242 PMI",
    group: "geometry",
    tier: "stable",
  },
  {
    slug: "qif",
    name: "QIF (ISO 23952)",
    sidebar: "QIF Digital Metrology",
    ext: ".qif",
    role: "ASME Y14.5 / ISO 1101 GD&T metrology & SPC capability",
    group: "geometry",
    tier: "beta",
  },
  {
    slug: "scad",
    name: "OpenSCAD",
    sidebar: "OpenSCAD CSG",
    ext: ".scad",
    role: "Parametric constructive solid geometry",
    group: "geometry",
    tier: "stable",
  },
  {
    slug: "cfd",
    name: "CFD (SU2 / OpenFOAM)",
    sidebar: "CFD (SU2 / OpenFOAM)",
    ext: ".su2",
    role: "Computational fluid dynamics meshes",
    group: "geometry",
    tier: "beta",
  },
  {
    slug: "fea",
    name: "FEA (CalculiX / Abaqus / NASTRAN)",
    sidebar: "FEA Structural Analysis",
    ext: ".inp",
    role: "Finite-element structural analysis",
    group: "geometry",
    tier: "beta",
  },
  {
    slug: "usd",
    name: "OpenUSD",
    sidebar: "OpenUSD (Universal Scene Description)",
    ext: ".usd / .usda / .usdz",
    role: "Universal Scene Description 3D stages & UsdPhysics digital twins",
    group: "geometry",
    tier: "stable",
  },

  // ── Data & code integration ─────────────────────────────────────────────
  {
    slug: "csv",
    name: "CSV",
    sidebar: "CSV Telemetry",
    ext: ".csv",
    role: "Time-series & sensor logs",
    group: "integration",
    tier: "stable",
  },
  {
    slug: "c",
    name: "C",
    sidebar: "C Integration",
    ext: ".c",
    role: "Numerical & embedded C integration",
    group: "integration",
    tier: "stable",
  },
  {
    slug: "fortran",
    name: "Fortran",
    sidebar: "Fortran Integration",
    ext: ".f90",
    role: "Legacy scientific subroutines",
    group: "integration",
    tier: "beta",
  },

  // ── Aerospace & defense ─────────────────────────────────────────────────
  {
    slug: "jsbsim",
    name: "JSBSim",
    sidebar: "JSBSim Flight Dynamics",
    ext: ".xml",
    role: "6-DOF flight dynamics",
    group: "aerospace",
    tier: "beta",
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

  // ── Automotive & mobility ───────────────────────────────────────────────
  {
    slug: "autosar",
    name: "AUTOSAR",
    sidebar: "AUTOSAR Architecture",
    ext: ".arxml",
    role: "Classic & Adaptive software architecture",
    group: "automotive",
    tier: "beta",
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
    tier: "beta",
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
    tier: "beta",
  },
  {
    slug: "gtfs",
    name: "GTFS",
    sidebar: "GTFS Transit Electrification",
    ext: ".gtfs, .zip",
    role: "Transit schedules & fleet electrification power",
    group: "automotive",
    tier: "beta",
  },

  // ── Rail ────────────────────────────────────────────────────────────────
  {
    slug: "gensys",
    name: "GENSYS",
    sidebar: "GENSYS Railway Dynamics",
    ext: ".calc",
    role: "Railway vehicle dynamics & track",
    group: "rail",
    tier: "stable",
  },
  {
    slug: "simpack",
    name: "SIMPACK",
    sidebar: "SIMPACK Multibody Dynamics",
    ext: ".spck",
    role: "Spatial multibody dynamics",
    group: "rail",
    tier: "beta",
  },

  // ── Power systems & grid ────────────────────────────────────────────────
  {
    slug: "pscad",
    name: "PSCAD / EMTDC",
    sidebar: "PSCAD Power Systems",
    ext: ".pscx",
    role: "Electromagnetic transients (EMT)",
    group: "power",
    tier: "stable",
  },
  {
    slug: "psse",
    name: "PSS/E",
    sidebar: "PSS/E Power Flow (.raw)",
    ext: ".raw, .dyr",
    role: "Transmission power flow & transient stability",
    group: "power",
    tier: "stable",
  },
  {
    slug: "powerfactory",
    name: "DIgSILENT PowerFactory",
    sidebar: "DIgSILENT PowerFactory",
    ext: ".dgs, .pfd",
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
    tier: "beta",
  },
  {
    slug: "cgmes",
    name: "CIM / CGMES",
    sidebar: "CIM / CGMES",
    ext: ".xml, .rdf",
    role: "ENTSO-E IEC 61970 transmission grid exchange & topology",
    group: "power",
    tier: "beta",
  },
  {
    slug: "opendss",
    name: "OpenDSS",
    sidebar: "OpenDSS Distribution",
    ext: ".dss",
    role: "Unbalanced distribution & DER hosting",
    group: "power",
    tier: "stable",
  },
  {
    slug: "ocpp",
    name: "OCPP",
    sidebar: "OCPP EV Smart Charging",
    ext: ".ocpp, .json",
    role: "EV smart charging & transformer load management",
    group: "power",
    tier: "beta",
  },
  {
    slug: "openadr",
    name: "OpenADR",
    sidebar: "OpenADR Demand Response",
    ext: ".oadr, .xml, .json",
    role: "Automated demand response & peak shaving",
    group: "power",
    tier: "beta",
  },
  {
    slug: "tough",
    name: "LBNL TOUGH",
    sidebar: "TOUGH Geothermal",
    ext: ".tgh, .dat",
    role: "Geothermal reservoir & wellbore flashing thermodynamics",
    group: "power",
    tier: "beta",
  },
  {
    slug: "matpower",
    name: "MATPOWER",
    sidebar: "MATPOWER Grid (.m)",
    ext: ".m",
    role: "Power flow & optimal power flow (OPF)",
    group: "power",
    tier: "beta",
  },
  {
    slug: "comtrade",
    name: "IEEE COMTRADE",
    sidebar: "COMTRADE Fault Transients",
    ext: ".cfg, .dat, .cff",
    role: "Digital fault recorder & transient disturbance analysis",
    group: "power",
    tier: "beta",
  },
  {
    slug: "scl",
    name: "IEC 61850 SCL",
    sidebar: "IEC 61850 Substation SCL",
    ext: ".scd, .cid, .ssd, .xml",
    role: "Substation automation, GOOSE & Sampled Values dataflow",
    group: "power",
    tier: "beta",
  },
  {
    slug: "atp",
    name: "ATP-EMTP",
    sidebar: "ATP-EMTP Transients",
    ext: ".atp, .dat",
    role: "Electromagnetic transient program card decks",
    group: "power",
    tier: "beta",
  },
  {
    slug: "dnp3",
    name: "IEEE 1815 / DNP3",
    sidebar: "DNP3 SCADA Telemetry",
    ext: ".xml, .json, .dnp3",
    role: "Utility digital twin & SCADA deadband telemetry",
    group: "power",
    tier: "beta",
  },
  {
    slug: "oneliner",
    name: "ASPEN OneLiner / CAPE",
    sidebar: "ASPEN OneLiner Protection",
    ext: ".olx, .dxt",
    role: "Short-circuit fault currents & TOC protection coordination",
    group: "power",
    tier: "beta",
  },
  {
    slug: "sel",
    name: "SEL Relay Settings",
    sidebar: "SEL Protection Settings",
    ext: ".rdb, .rcf, .sel, .txt",
    role: "Schweitzer relay settings, SELogic & 50/51/21 protection",
    group: "power",
    tier: "beta",
  },

  // ── Oil, gas & subsurface ───────────────────────────────────────────────
  {
    slug: "olga",
    name: "OLGA",
    sidebar: "OLGA Multiphase Flow",
    ext: ".genkey",
    role: "Transient multiphase flow assurance",
    group: "oil-gas",
    tier: "stable",
  },
  {
    slug: "lps",
    name: "PipelineStudio",
    sidebar: "PipelineStudio (.lps)",
    ext: ".lps",
    role: "Gas & liquid pipeline hydraulics",
    group: "oil-gas",
    tier: "stable",
  },
  {
    slug: "eclipse",
    name: "ECLIPSE",
    sidebar: "ECLIPSE Reservoir",
    ext: ".data",
    role: "Reservoir engineering",
    group: "oil-gas",
    tier: "beta",
  },

  // ── Nuclear ─────────────────────────────────────────────────────────────
  {
    slug: "relap5",
    name: "RELAP5-3D",
    sidebar: "RELAP5 Nuclear Loops",
    ext: ".inp",
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
    tier: "beta",
  },

  // ── Electronics & semiconductors ────────────────────────────────────────
  {
    slug: "spice",
    name: "SPICE",
    sidebar: "SPICE Electronics",
    ext: ".cir",
    role: "Analog circuit simulation",
    group: "electronics",
    tier: "stable",
  },
  {
    slug: "verilog-a",
    name: "Verilog-A / AMS",
    sidebar: "Verilog-A Devices",
    ext: ".va",
    role: "Analog compact device models",
    group: "electronics",
    tier: "beta",
  },
  {
    slug: "ibis",
    name: "IBIS",
    sidebar: "IBIS Buffer Modeling",
    ext: ".ibs",
    role: "I/O buffer behavioral models",
    group: "electronics",
    tier: "beta",
  },
  {
    slug: "touchstone",
    name: "Touchstone",
    sidebar: "Touchstone RF / SI",
    ext: ".sNp",
    role: "RF & signal-integrity S-parameters",
    group: "electronics",
    tier: "beta",
  },
  {
    slug: "optical",
    name: "OpenROADM & Telcordia .sor",
    sidebar: "Optical & DWDM (.sor)",
    ext: ".sor",
    role: "OTDR trace analytics & DWDM transmission",
    group: "electronics",
    tier: "beta",
  },
  {
    slug: "ran",
    name: "NSMA WG16 & Planet Antenna",
    sidebar: "RAN & Microwave (.adf)",
    ext: ".adf, .pat",
    role: "Antenna 3D patterns, RF MPE safety & microwave links",
    group: "electronics",
    tier: "beta",
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
    tier: "stable",
  },
  {
    slug: "plcopen",
    name: "PLCopen / IEC 61131-3",
    sidebar: "PLCopen Automation",
    ext: ".st",
    role: "PLC control software",
    group: "robotics",
    tier: "stable",
  },
  {
    slug: "automationml",
    name: "AutomationML (IEC 62714)",
    sidebar: "AutomationML Plant Topology",
    ext: ".aml",
    role: "CAEX mechatronic plant hierarchy & virtual commissioning",
    group: "robotics",
    tier: "beta",
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
    tier: "stable",
  },
  {
    slug: "epanet",
    name: "EPANET",
    sidebar: "EPANET Water Networks",
    ext: ".inp",
    role: "Pressurized water distribution",
    group: "buildings",
    tier: "stable",
  },
  {
    slug: "swmm",
    name: "EPA SWMM",
    sidebar: "SWMM Urban Hydrology",
    ext: ".inp",
    role: "Stormwater & urban drainage",
    group: "buildings",
    tier: "stable",
  },
  {
    slug: "hec-ras",
    name: "USACE HEC-RAS",
    sidebar: "HEC-RAS River Hydraulics",
    ext: ".g01, .g02, .rasgeo",
    role: "River basin & open-channel hydraulics",
    group: "buildings",
    tier: "beta",
  },
  {
    slug: "modflow",
    name: "USGS MODFLOW",
    sidebar: "MODFLOW Groundwater",
    ext: ".dis, .dis6, .npf, .wel",
    role: "Regional groundwater aquifers & 3D Darcy flow",
    group: "buildings",
    tier: "beta",
  },
  {
    slug: "landgem",
    name: "EPA LandGEM",
    sidebar: "LandGEM Biogas",
    ext: ".landgem, .lfg, .biogas",
    role: "Solid waste methane decay & landfill biogas CHP",
    group: "buildings",
    tier: "beta",
  },
  {
    slug: "hec-hms",
    name: "USACE HEC-HMS",
    sidebar: "HEC-HMS Watershed Hydrology",
    ext: ".basin, .hms",
    role: "Precipitation runoff, SCS-CN excess & Muskingum routing",
    group: "buildings",
    tier: "beta",
  },
  {
    slug: "waterml",
    name: "OGC WaterML 2.0",
    sidebar: "WaterML Hydrologic Telemetry",
    ext: ".waterml, .wml2, .xml",
    role: "Streamflow telemetry & stage-discharge rating curves",
    group: "buildings",
    tier: "beta",
  },
  {
    slug: "asm",
    name: "IWA Activated Sludge Models",
    sidebar: "IWA ASM Wastewater",
    ext: ".asm, .bsm, .wrrf",
    role: "Biokinetics, Petersen matrix & Takács clarifier settling",
    group: "buildings",
    tier: "beta",
  },

  // ── Chemical & process ──────────────────────────────────────────────────
  {
    slug: "aspen",
    name: "Aspen Plus / HYSYS",
    sidebar: "Aspen Chemical Process",
    ext: ".bkp",
    role: "Chemical process flowsheets",
    group: "process",
    tier: "beta",
  },
  {
    slug: "gproms",
    name: "gPROMS / PML",
    sidebar: "gPROMS Dynamic Process",
    ext: ".gproms",
    role: "Equation-oriented dynamic process & distributed PDEs",
    group: "process",
    tier: "beta",
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
    tier: "beta",
  },
  {
    slug: "smiles",
    name: "SMILES / SDF",
    sidebar: "SMILES & Molfile Graphs",
    ext: ".smi",
    role: "Molecular graph parsing & Joback property estimation",
    group: "process",
    tier: "beta",
  },

  // ── Life sciences, healthcare & medical ─────────────────────────────────
  {
    slug: "sbml",
    name: "SBML",
    sidebar: "SBML Systems Biology",
    ext: ".sbml",
    role: "Biochemical reaction networks",
    group: "life-sciences",
    tier: "beta",
  },
  {
    slug: "antimony",
    name: "Antimony",
    sidebar: "Antimony Modular Bio",
    ext: ".ant",
    role: "Modular human-readable systems biology models",
    group: "life-sciences",
    tier: "beta",
  },
  {
    slug: "bngl",
    name: "BioNetGen (BNGL)",
    sidebar: "BioNetGen Rule Networks",
    ext: ".bngl",
    role: "Rule-based multiprotein signaling & reaction expansion",
    group: "life-sciences",
    tier: "beta",
  },
  {
    slug: "sbol",
    name: "SBOL3",
    sidebar: "SBOL3 Genetic Circuits",
    ext: ".sbol",
    role: "Synthetic biology genetic circuits & Hill kinetics",
    group: "life-sciences",
    tier: "beta",
  },
  {
    slug: "sedml",
    name: "SED-ML",
    sidebar: "SED-ML Bio Experiments",
    ext: ".sedml",
    role: "COMBINE reproducible simulation experiment protocols",
    group: "life-sciences",
    tier: "beta",
  },
  {
    slug: "nmtran",
    name: "NMTRAN (NONMEM)",
    sidebar: "NMTRAN Pharmacometrics",
    ext: ".ctl",
    role: "Clinical PK/PD compartmental dosing & exposure",
    group: "life-sciences",
    tier: "beta",
  },
  {
    slug: "pdb",
    name: "PDB / mmCIF",
    sidebar: "PDB Macromolecular 3D",
    ext: ".pdb",
    role: "3D protein structures, Ramachandran & GNM dynamics",
    group: "life-sciences",
    tier: "beta",
  },
  {
    slug: "genbank",
    name: "GenBank / FASTA",
    sidebar: "GenBank & FASTA DNA",
    ext: ".gb",
    role: "Annotated nucleotide sequences, ORFs & restriction maps",
    group: "life-sciences",
    tier: "beta",
  },
  {
    slug: "cellml",
    name: "CellML",
    sidebar: "CellML Electrophysiology",
    ext: ".cellml",
    role: "Cellular electrophysiology & Physiome ODE models",
    group: "life-sciences",
    tier: "beta",
  },
  {
    slug: "opensim",
    name: "OpenSim",
    sidebar: "OpenSim Biomechanics",
    ext: ".osim",
    role: "Musculoskeletal multibody & Hill-type muscle dynamics",
    group: "life-sciences",
    tier: "beta",
  },
  {
    slug: "febio",
    name: "FEBio / SOFA",
    sidebar: "FEBio Soft-Tissue FEA",
    ext: ".feb",
    role: "Hyperelastic soft-tissue biomechanics & surgical scenes",
    group: "life-sciences",
    tier: "beta",
  },
  {
    slug: "dicom-rt",
    name: "DICOM-RT",
    sidebar: "DICOM-RT Radiotherapy",
    ext: ".rtplan",
    role: "Clinical radiotherapy plans, DVH metrics & BED/EQD2",
    group: "life-sciences",
    tier: "beta",
  },
  {
    slug: "topas",
    name: "TOPAS / GATE",
    sidebar: "TOPAS Proton Therapy",
    ext: ".topas",
    role: "Proton & hadrontherapy nozzles and Bortfeld Bragg peaks",
    group: "life-sciences",
    tier: "beta",
  },
  {
    slug: "nifti",
    name: "NIfTI / NRRD",
    sidebar: "NIfTI & NRRD Imaging",
    ext: ".nii",
    role: "Volumetric medical imaging, RAS affines & iso-surfacing",
    group: "life-sciences",
    tier: "beta",
  },
  {
    slug: "three-mf",
    name: "3MF Medical",
    sidebar: "3MF Surgical Guides",
    ext: ".3mf",
    role: "Patient-specific 3D-printed cutting guides & implants",
    group: "life-sciences",
    tier: "beta",
  },
  {
    slug: "igtl",
    name: "OpenIGTLink / PLUS",
    sidebar: "OpenIGTLink Navigation",
    ext: ".igtl",
    role: "Image-guided surgical tracking, pivot calibration & TRE",
    group: "life-sciences",
    tier: "beta",
  },
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
  stable: LANGUAGES.filter((l) => l.tier === "stable").length,
  beta: LANGUAGES.filter((l) => l.tier === "beta").length,
  preview: LANGUAGES.filter((l) => l.tier === "preview").length,
};

/** Non-industry groups shown at the top of the languages sidebar. */
export const PLATFORM_GROUPS: { id: LanguageGroupId; label: string }[] = [
  { id: "core", label: "Core & Systems Engineering" },
  { id: "geometry", label: "Geometry & Continuum" },
  { id: "integration", label: "Data & Code Integration" },
];
