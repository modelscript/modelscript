// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ModelScript IDE 2-Level Tile Landing Page
// Styled with the unified ModelScript Docs design system (Space Grotesk, Plus Jakarta Sans,
// JetBrains Mono, CAD blueprint grid, and domain tone chips).

export interface LandingLanguageGroup {
  id: string;
  label: string;
  tone: "teal" | "indigo" | "amber" | "emerald" | "rose" | "sky";
}

export interface LandingLanguageTile {
  id: string;
  name: string;
  badge: string;
  ext: string;
  group: string;
  tone: "teal" | "indigo" | "amber" | "emerald" | "rose" | "sky";
  role: string;
  summary: string;
  docsUrl: string;
  defaultTemplateId: string;
}

export interface LandingExampleTile {
  id: string;
  languageId: string;
  title: string;
  summary: string;
  badge: string;
  tone: "teal" | "indigo" | "amber" | "emerald" | "rose" | "sky";
  ext: string;
  primaryFile: string;
  fileList: string[];
  capabilities: string[];
}

export const LANDING_LANGUAGE_GROUPS: LandingLanguageGroup[] = [
  { id: "core", label: "Core Systems & Architecture", tone: "teal" },
  { id: "geometry", label: "3D Geometry, FEA & CFD", tone: "indigo" },
  { id: "integration", label: "Embedded, HPC & Telemetry", tone: "sky" },
  { id: "aerospace", label: "Aerospace & Space Systems", tone: "amber" },
  { id: "automotive", label: "Automotive & Autonomy", tone: "emerald" },
  { id: "rail", label: "Rail & Multibody Dynamics", tone: "rose" },
  { id: "power", label: "Power Grids & Energy", tone: "amber" },
  { id: "oil-gas", label: "Oil, Gas & Subsurface", tone: "teal" },
  { id: "nuclear", label: "Nuclear Thermal-Hydraulics", tone: "rose" },
  { id: "marine", label: "Marine & Offshore", tone: "sky" },
  { id: "electronics", label: "Electronics, RF & Semiconductors", tone: "indigo" },
  { id: "robotics", label: "Robotics & Industrial Automation", tone: "emerald" },
  { id: "buildings", label: "Buildings, Water & Civil", tone: "teal" },
  { id: "process", label: "Chemical & Process Engineering", tone: "amber" },
  { id: "life-sciences", label: "Systems Biology & Pharmacology", tone: "rose" },
];

const CAPS = [
  "Syntax & Semantic Tokens",
  "WASM GLR Lints",
  "CodeLens",
  "Interactive Diagram",
  "Verification & Simulation",
];

export const LANDING_LANGUAGE_TILES: LandingLanguageTile[] = [
  {
    id: "modelscript",
    name: "ModelScript",
    badge: "MSX",
    ext: ".msx",
    group: "core",
    tone: "teal",
    role: "Polyglot Kernel & Coordination DSL",
    summary:
      "Typed struct, constant, and functional orchestration kernel coordinating cross-domain physics, contracts, and solvers.",
    docsUrl: "https://modelscript.org/languages/modelscript",
    defaultTemplateId: "modelscript-control",
  },
  {
    id: "modelica",
    name: "Modelica 3.x",
    badge: "MO",
    ext: ".mo",
    group: "core",
    tone: "teal",
    role: "Acausal Multi-Physics DAE Modeling",
    summary:
      "Continuous-time differential-algebraic equation (DAE) modeling with full Modelica Standard Library schematic diagrams and CVODE/IDA solvers.",
    docsUrl: "https://modelscript.org/languages/modelica",
    defaultTemplateId: "bouncing-ball",
  },
  {
    id: "sysml2",
    name: "SysML v2 & KerML",
    badge: "SYS",
    ext: ".sysml",
    group: "core",
    tone: "indigo",
    role: "Systems Architecture & Requirements",
    summary:
      "OMG SysML v2 textual architecture definitions, ports, connections, state machines, and formal requirement satisfaction.",
    docsUrl: "https://modelscript.org/languages/sysml2",
    defaultTemplateId: "sysml2",
  },
  {
    id: "reqif",
    name: "OMG ReqIF",
    badge: "REQ",
    ext: ".reqif",
    group: "core",
    tone: "sky",
    role: "Requirements Interchange & Traceability",
    summary:
      "ISO/IEC 29148 and DO-178C requirements interchange specifications with traceability links, quality lints, and SysML v2 projection.",
    docsUrl: "https://modelscript.org/languages/reqif",
    defaultTemplateId: "reqif-avionics",
  },
  {
    id: "ssp",
    name: "FMI / SSP 1.0 & 2.0",
    badge: "SSP",
    ext: ".ssd",
    group: "core",
    tone: "emerald",
    role: "Co-Simulation Architecture",
    summary:
      "Modelica Association System Structure and Parameterization (SSP) multi-FMU co-simulation topology and master orchestration.",
    docsUrl: "https://modelscript.org/languages/ssp",
    defaultTemplateId: "ssp-microgrid",
  },
  {
    id: "owl2",
    name: "W3C OWL 2",
    badge: "OWL",
    ext: ".owl",
    group: "core",
    tone: "rose",
    role: "Ontological Reasoning & Units",
    summary:
      "W3C OWL 2 Functional-Style ontologies with tableau description logic consistency checking, subsumption, and SI unit verification.",
    docsUrl: "https://modelscript.org/languages/owl2",
    defaultTemplateId: "owl2-units",
  },
  {
    id: "step",
    name: "STEP (ISO 10303-21)",
    badge: "STP",
    ext: ".step",
    group: "geometry",
    tone: "indigo",
    role: "B-Rep Solid CAD & Multibody Extraction",
    summary:
      "ISO 10303-21 AP203/AP214/AP242 boundary-representation CAD assemblies with 3D viewport inspection and multibody inertia extraction.",
    docsUrl: "https://modelscript.org/languages/step",
    defaultTemplateId: "step-pendulum",
  },
  {
    id: "scad",
    name: "OpenSCAD",
    badge: "SCD",
    ext: ".scad",
    group: "geometry",
    tone: "teal",
    role: "Parametric Constructive Solid Geometry",
    summary:
      "Programmatic CSG solid modeling with port tagging for automated FEA structural supports and CFD boundary patches.",
    docsUrl: "https://modelscript.org/languages/scad",
    defaultTemplateId: "scad-airframe",
  },
  {
    id: "cfd",
    name: "SU2 & OpenFOAM CFD",
    badge: "CFD",
    ext: ".cfg",
    group: "geometry",
    tone: "sky",
    role: "Computational Fluid Dynamics",
    summary:
      "RANS/LES aerodynamic and thermal fluid configuration decks with flowfield convergence verification and reduced-order drag polars.",
    docsUrl: "https://modelscript.org/languages/cfd",
    defaultTemplateId: "cfd-aerodynamics",
  },
  {
    id: "fea",
    name: "Abaqus / CalculiX FEA",
    badge: "FEA",
    ext: ".inp",
    group: "geometry",
    tone: "amber",
    role: "Finite Element Structural Analysis",
    summary:
      "3D structural and thermal finite element input decks with nodal mesh inspection, von Mises stress slicing, and safety-margin contracts.",
    docsUrl: "https://modelscript.org/languages/fea",
    defaultTemplateId: "fea-chassis",
  },
  {
    id: "csv",
    name: "CSV Telemetry",
    badge: "CSV",
    ext: ".csv",
    group: "integration",
    tone: "emerald",
    role: "Time-Series & Lookup Table Ingestion",
    summary:
      "Structured experimental time-series trajectories and CombiTimeTable lookup datasets with interactive plotting and schema validation.",
    docsUrl: "https://modelscript.org/languages/csv",
    defaultTemplateId: "csv-telemetry",
  },
  {
    id: "c",
    name: "Embedded C (C99/C11)",
    badge: "C99",
    ext: ".c",
    group: "integration",
    tone: "sky",
    role: "Flight Software & Control Laws",
    summary:
      "MISRA-checked embedded C control algorithms with symbolic execution, formal safety verification, and Modelica external function bindings.",
    docsUrl: "https://modelscript.org/languages/c",
    defaultTemplateId: "c-pid-controller",
  },
  {
    id: "fortran",
    name: "Modern Fortran",
    badge: "F90",
    ext: ".f90",
    group: "integration",
    tone: "indigo",
    role: "Scientific & Legacy Physics Kernels",
    summary:
      "Fortran 90/95/2008 numerical subroutines and scientific physics kernels with automatic DAE lowering and dimensional audits.",
    docsUrl: "https://modelscript.org/languages/fortran",
    defaultTemplateId: "fortran-nozzle",
  },
  {
    id: "jsbsim",
    name: "JSBSim Flight Dynamics",
    badge: "JSB",
    ext: ".jsbsim",
    group: "aerospace",
    tone: "amber",
    role: "6-DOF Flight Dynamics & Trim",
    summary:
      "6-DOF nonlinear aircraft aerodynamics, propulsion, mass balance, and flight control system XML configurations.",
    docsUrl: "https://modelscript.org/languages/jsbsim",
    defaultTemplateId: "jsbsim-c172p",
  },
  {
    id: "rocets",
    name: "NASA ROCETS",
    badge: "ROC",
    ext: ".roc",
    group: "aerospace",
    tone: "rose",
    role: "Liquid Rocket Engine Cycle Balance",
    summary:
      "Cryogenic turbopump, regenerative cooling jacket, preburner, and thrust chamber thermodynamic cycle decks.",
    docsUrl: "https://modelscript.org/languages/rocets",
    defaultTemplateId: "rocets-expander",
  },
  {
    id: "ccsds",
    name: "CCSDS Navigation (ODM)",
    badge: "ODM",
    ext: ".oem",
    group: "aerospace",
    tone: "sky",
    role: "Spacecraft Orbit Ephemeris & Attitude",
    summary:
      "Consultative Committee for Space Data Systems (CCSDS) Orbit Ephemeris Messages (OEM/OPM/OMM) and keplerian trajectory propagation.",
    docsUrl: "https://modelscript.org/languages/ccsds",
    defaultTemplateId: "ccsds-landsat",
  },
  {
    id: "easy5",
    name: "MSC Easy5",
    badge: "EZ5",
    ext: ".ez5",
    group: "aerospace",
    tone: "indigo",
    role: "Aerospace Flight Controls & Hydraulics",
    summary: "Multi-rate aerospace flight control, thermal management, and environmental control block diagrams.",
    docsUrl: "https://modelscript.org/languages/easy5",
    defaultTemplateId: "easy5-flight-control",
  },
  {
    id: "autosar",
    name: "AUTOSAR Classic & Adaptive",
    badge: "ASR",
    ext: ".arxml",
    group: "automotive",
    tone: "emerald",
    role: "Automotive E/E Software Architecture",
    summary:
      "AUTOSAR ARXML software components (SWCs), sender-receiver/client-server ports, periodic timing events, and runnable schedules.",
    docsUrl: "https://modelscript.org/languages/autosar",
    defaultTemplateId: "autosar-powertrain",
  },
  {
    id: "simulink",
    name: "Simulink & Stateflow",
    badge: "SLX",
    ext: ".mdl",
    group: "automotive",
    tone: "teal",
    role: "Causal Control Block Diagrams",
    summary:
      "Hierarchical causal signal-flow block diagrams and state machines with algebraic-loop detection and Modelica block projection.",
    docsUrl: "https://modelscript.org/languages/simulink",
    defaultTemplateId: "simulink-cruise",
  },
  {
    id: "gtsuite",
    name: "GT-SUITE",
    badge: "GTS",
    ext: ".gtm",
    group: "automotive",
    tone: "amber",
    role: "1D Engine, xEV & Thermal Propulsion",
    summary:
      "1D compressible gas dynamics, turbocharged internal combustion cylinders, battery thermal circuits, and crank-angle simulation.",
    docsUrl: "https://modelscript.org/languages/gtsuite",
    defaultTemplateId: "gtsuite-turbo",
  },
  {
    id: "opendrive",
    name: "ASAM OpenDRIVE",
    badge: "ODR",
    ext: ".xodr",
    group: "automotive",
    tone: "sky",
    role: "High-Definition Road Networks",
    summary:
      "ASAM OpenDRIVE clothoid/arc/line road reference geometry, lane topology, elevation profiles, and curvature continuity checks.",
    docsUrl: "https://modelscript.org/languages/opendrive",
    defaultTemplateId: "opendrive-highway",
  },
  {
    id: "openscenario",
    name: "ASAM OpenSCENARIO",
    badge: "OSC",
    ext: ".xosc",
    group: "automotive",
    tone: "rose",
    role: "ADAS & Autonomous Driving Maneuvers",
    summary:
      "Dynamic traffic storyboards, cut-in maneuvers, time-to-collision (TTC) safety verification, and RSS minimum distance envelopes.",
    docsUrl: "https://modelscript.org/languages/openscenario",
    defaultTemplateId: "openscenario-cut-in",
  },
  {
    id: "gensys",
    name: "GENSYS Railway Dynamics",
    badge: "GEN",
    ext: ".calc",
    group: "rail",
    tone: "rose",
    role: "Rail Vehicle-Track Interaction & EN 14363",
    summary:
      "Railway carbody/bogie/wheelset multibody dynamics, FASTSIM wheel-rail creep contact, Nadine Nadal derailment ratio, and EN 14363 ride acceptance.",
    docsUrl: "https://modelscript.org/languages/gensys",
    defaultTemplateId: "gensys-coach",
  },
  {
    id: "simpack",
    name: "SIMPACK Multibody",
    badge: "SPK",
    ext: ".spck",
    group: "rail",
    tone: "indigo",
    role: "Spatial Multibody Kinematics & Dynamics",
    summary:
      "3D rigid/flexible bodies, kinematic joints, force elements, Grübler-Kutzbach mobility analysis, and DAE lowering.",
    docsUrl: "https://modelscript.org/languages/simpack",
    defaultTemplateId: "simpack-suspension",
  },
  {
    id: "pscad",
    name: "PSCAD EMT Power Systems",
    badge: "PSC",
    ext: ".pscx",
    group: "power",
    tone: "amber",
    role: "Electromagnetic Transients & IEEE 2800",
    summary:
      "Dommel companion-circuit EMT solver, Bergeron traveling-wave lines, COMTRADE waveform capture, and IEEE 2800-2022 IBR compliance.",
    docsUrl: "https://modelscript.org/languages/pscad",
    defaultTemplateId: "pscad-microgrid",
  },
  {
    id: "psse",
    name: "Siemens PSS®E",
    badge: "PSE",
    ext: ".raw",
    group: "power",
    tone: "teal",
    role: "Transmission Power Flow & Stability",
    summary:
      "Bulk transmission network buses, generators, branches, transformers, Newton-Raphson AC power flow, and N-1 contingency screening.",
    docsUrl: "https://modelscript.org/languages/psse",
    defaultTemplateId: "psse-ieee14",
  },
  {
    id: "opendss",
    name: "EPRI OpenDSS",
    badge: "DSS",
    ext: ".dss",
    group: "power",
    tone: "emerald",
    role: "Unbalanced Distribution Grids & DERs",
    summary:
      "Multi-phase unbalanced distribution feeders, step voltage regulators, rooftop solar PV inverters, and ANSI C84.1 voltage profile audits.",
    docsUrl: "https://modelscript.org/languages/opendss",
    defaultTemplateId: "opendss-ieee4",
  },
  {
    id: "olga",
    name: "Schlumberger OLGA",
    badge: "OLG",
    ext: ".opi",
    group: "oil-gas",
    tone: "teal",
    role: "Multiphase Subsea Flow Assurance",
    summary:
      "Three-field gas-oil-water transient multiphase flowlines, terrain-induced slugging, hydrate subcooling margins, and API RP 14E erosion.",
    docsUrl: "https://modelscript.org/languages/olga",
    defaultTemplateId: "olga-flowline",
  },
  {
    id: "lps",
    name: "Pipeline Studio (TGNET/TLNET)",
    badge: "LPS",
    ext: ".lps",
    group: "oil-gas",
    tone: "sky",
    role: "Transmission Pipeline Hydraulics",
    summary:
      "High-pressure natural gas and liquid transmission networks, centrifugal compressor stations, linepack inventory, and surge transients.",
    docsUrl: "https://modelscript.org/languages/lps",
    defaultTemplateId: "lps-corridor",
  },
  {
    id: "eclipse",
    name: "SLB ECLIPSE",
    badge: "ECL",
    ext: ".data",
    group: "oil-gas",
    tone: "amber",
    role: "Subsurface Black-Oil & CO₂ Reservoir",
    summary:
      "3D porous-media reservoir grids, PVT black-oil tables, relative permeability curves, Peaceman well models, and waterflood recovery.",
    docsUrl: "https://modelscript.org/languages/eclipse",
    defaultTemplateId: "eclipse-brent",
  },
  {
    id: "relap5",
    name: "RELAP5-3D",
    badge: "R5D",
    ext: ".r5",
    group: "nuclear",
    tone: "rose",
    role: "Nuclear Reactor Thermal-Hydraulics",
    summary:
      "Two-fluid non-equilibrium reactor coolant loops, six-group point reactor kinetics, heat structures, and 10 CFR 50.46 PCT safety limits.",
    docsUrl: "https://modelscript.org/languages/relap5",
    defaultTemplateId: "relap5-pwr",
  },
  {
    id: "sima",
    name: "SINTEF SIMA (SIMO/RIFLEX)",
    badge: "SIM",
    ext: ".sima",
    group: "marine",
    tone: "sky",
    role: "Offshore Hydrodynamics & Mooring",
    summary:
      "6-DOF floating offshore wind platforms, JONSWAP irregular wave spectra, Cummins radiation memory, and DNV-OS-E301 mooring tension checks.",
    docsUrl: "https://modelscript.org/languages/sima",
    defaultTemplateId: "sima-oc4",
  },
  {
    id: "spice",
    name: "SPICE Netlists",
    badge: "SPC",
    ext: ".cir",
    group: "electronics",
    tone: "indigo",
    role: "Analog & Mixed-Signal Circuit Simulation",
    summary:
      "Modified Nodal Analysis (MNA) circuit netlists with DC operating point, AC frequency sweep, transient integration, and floating-node lints.",
    docsUrl: "https://modelscript.org/languages/spice",
    defaultTemplateId: "spice-filter",
  },
  {
    id: "verilog-a",
    name: "Accellera Verilog-A / AMS",
    badge: "VLA",
    ext: ".va",
    group: "electronics",
    tone: "teal",
    role: "Compact Semiconductor Device Modeling",
    summary:
      "Behavioral analog compact device models (V(p,n) <+ ...) with symbolic Jacobian differentiation and Modelica connector lowering.",
    docsUrl: "https://modelscript.org/languages/verilog-a",
    defaultTemplateId: "veriloga-resistor",
  },
  {
    id: "ibis",
    name: "ANSI/EIA-656 IBIS",
    badge: "IBS",
    ext: ".ibs",
    group: "electronics",
    tone: "amber",
    role: "High-Speed SerDes & I/O Buffer Integrity",
    summary:
      "I/O buffer pullup/pulldown I-V curves, rising/falling V-T waveforms, package parasitics, and monotonicity/passivity verification.",
    docsUrl: "https://modelscript.org/languages/ibis",
    defaultTemplateId: "ibis-lvcmos",
  },
  {
    id: "touchstone",
    name: "Touchstone SnP",
    badge: "SNP",
    ext: ".s2p",
    group: "electronics",
    tone: "rose",
    role: "RF & Microwave S-Parameter Networks",
    summary:
      "Multi-port frequency-domain scattering parameters (.s1p–.s4p) with passivity singular-value checks, reciprocity, and rational vector fitting.",
    docsUrl: "https://modelscript.org/languages/touchstone",
    defaultTemplateId: "touchstone-filter",
  },
  {
    id: "urdf",
    name: "ROS URDF / SDF",
    badge: "URD",
    ext: ".urdf",
    group: "robotics",
    tone: "emerald",
    role: "Robotic Manipulator Kinematics & Dynamics",
    summary:
      "Articulated robot links, inertial tensors, revolute/prismatic joints, positive-definite triangle-inequality checks, and multibody lowering.",
    docsUrl: "https://modelscript.org/languages/urdf",
    defaultTemplateId: "urdf-manipulator",
  },
  {
    id: "plcopen",
    name: "IEC 61131-3 & PLCopen",
    badge: "PLC",
    ext: ".st",
    group: "robotics",
    tone: "teal",
    role: "Industrial PLC Control & Structured Text",
    summary:
      "IEC 61131-3 Structured Text programs, Function Block Diagrams, scan-cycle execution, and formal safety interlock verification.",
    docsUrl: "https://modelscript.org/languages/plcopen",
    defaultTemplateId: "plcopen-tank",
  },
  {
    id: "adams",
    name: "MSC Adams Solver (.adm)",
    badge: "ADM",
    ext: ".adm",
    group: "robotics",
    tone: "indigo",
    role: "Mechanical Multibody Mechanisms",
    summary:
      "MSC Adams PARTS, MARKERS, kinematic JOINTS, SFORCE/BUSHING elements, and spatial multibody mechanism simulation.",
    docsUrl: "https://modelscript.org/languages/adams",
    defaultTemplateId: "adams-pendulum",
  },
  {
    id: "energyplus",
    name: "DOE EnergyPlus (.idf)",
    badge: "IDF",
    ext: ".idf",
    group: "buildings",
    tone: "amber",
    role: "Building Envelope & HVAC Energy",
    summary:
      "Multi-zone building thermal envelopes, fenestration, internal gains, HVAC air loops, and ASHRAE 90.1 / 55 comfort verification.",
    docsUrl: "https://modelscript.org/languages/energyplus",
    defaultTemplateId: "energyplus-office",
  },
  {
    id: "epanet",
    name: "US EPA EPANET (.epanet)",
    badge: "EPA",
    ext: ".epanet",
    group: "buildings",
    tone: "sky",
    role: "Pressurized Water Distribution Networks",
    summary:
      "Todini-Pilati Global Gradient Algorithm (GGA) hydraulic head/flow solver, Hazen-Williams pipes, pumps, and chlorine decay.",
    docsUrl: "https://modelscript.org/languages/epanet",
    defaultTemplateId: "epanet-water",
  },
  {
    id: "swmm",
    name: "US EPA SWMM (.swmm)",
    badge: "SWM",
    ext: ".swmm",
    group: "buildings",
    tone: "teal",
    role: "Urban Stormwater & Sanitary Sewer Routing",
    summary:
      "1D Saint-Venant dynamic wave open-channel and conduit routing, Green-Ampt catchment runoff, and node flooding verification.",
    docsUrl: "https://modelscript.org/languages/swmm",
    defaultTemplateId: "swmm-drainage",
  },
  {
    id: "aspen",
    name: "Aspen Plus (.bkp / .inp)",
    badge: "ASP",
    ext: ".bkp",
    group: "process",
    tone: "amber",
    role: "Chemical Process Flowsheets & VLE",
    summary:
      "Flash drums, CSTR/PFR reactors, distillation columns, Peng-Robinson/NRTL vapor-liquid equilibrium, and mass/energy balance checks.",
    docsUrl: "https://modelscript.org/languages/aspen",
    defaultTemplateId: "aspen-methanol",
  },
  {
    id: "sbml",
    name: "SBML Level 3",
    badge: "SBM",
    ext: ".sbml",
    group: "life-sciences",
    tone: "rose",
    role: "Biochemical Reaction Networks & PBPK",
    summary:
      "Compartmental biochemical species, Michaelis-Menten and mass-action reaction kinetics, stoichiometry matrices, and conservation laws.",
    docsUrl: "https://modelscript.org/languages/sbml",
    defaultTemplateId: "sbml-enzyme",
  },
];

export const LANDING_EXAMPLE_TILES: LandingExampleTile[] = [
  {
    id: "modelscript-control",
    languageId: "modelscript",
    title: "Thermal Flight Actuator Kernel",
    summary: "Typed ModelScript struct, physical constants, and closed-loop actuator thermal control law.",
    badge: "MSX",
    tone: "teal",
    ext: ".msx",
    primaryFile: "control_loop.msx",
    fileList: ["control_loop.msx", "README.md"],
    capabilities: CAPS,
  },
  {
    id: "bouncing-ball",
    languageId: "modelica",
    title: "Hybrid Bouncing Ball Dynamics",
    summary:
      "Classic hybrid continuous/discrete contact model with event detection (when h <= 0) and state reinitialization (reinit).",
    badge: "MO",
    tone: "teal",
    ext: ".mo",
    primaryFile: "BouncingBall.mo",
    fileList: ["BouncingBall.mo", "README.md"],
    capabilities: CAPS,
  },
  {
    id: "rlc",
    languageId: "modelica",
    title: "RLC Resonant Electrical Circuit",
    summary:
      "Acausal electrical schematic using Modelica.Electrical.Analog components with full Placement and Line diagram annotations.",
    badge: "MO",
    tone: "teal",
    ext: ".mo",
    primaryFile: "RLC.mo",
    fileList: ["RLC.mo", "modelscript.json"],
    capabilities: CAPS,
  },
  {
    id: "drone-reachability",
    languageId: "modelica",
    title: "Polyglot Drone Reachability Verification",
    summary:
      "End-to-end cyber-physical workspace coupling Modelica DAE, SysML v2 requirements, OpenSCAD CAD, CalculiX FEA, and SU2 CFD.",
    badge: "MO",
    tone: "teal",
    ext: ".mo",
    primaryFile: "modelica/DroneSimulation.mo",
    fileList: [
      "modelica/DroneSimulation.mo",
      "sysml/drone_specs.sysml",
      "cad/drone.scad",
      "cae/drone_chassis.inp",
      "cae/drone_aero.cfg",
      "cad/drone.step",
    ],
    capabilities: CAPS,
  },
  {
    id: "sysml2",
    languageId: "sysml2",
    title: "Hybrid Electric Vehicle Architecture",
    summary:
      "Complete SysML v2 vehicle architecture with port definitions, part decomposition, state machines, and requirement satisfaction.",
    badge: "SYS",
    tone: "indigo",
    ext: ".sysml",
    primaryFile: "VehicleSystem.sysml",
    fileList: ["VehicleSystem.sysml"],
    capabilities: CAPS,
  },
  {
    id: "reqif-avionics",
    languageId: "reqif",
    title: "DO-178C Flight Control Requirements",
    summary:
      "OMG ReqIF 1.2 specification with requirement objects, verification status attributes, and traceability relations.",
    badge: "REQ",
    tone: "sky",
    ext: ".reqif",
    primaryFile: "avionics_safety.reqif",
    fileList: ["avionics_safety.reqif"],
    capabilities: CAPS,
  },
  {
    id: "ssp-microgrid",
    languageId: "ssp",
    title: "Multi-FMU Grid & Inverter Co-Simulation",
    summary:
      "SSP 1.0 SystemStructureDescription coupling a passive AC transmission network FMU with a solar IBR inverter FMU.",
    badge: "SSP",
    tone: "emerald",
    ext: ".ssd",
    primaryFile: "SystemStructure.ssd",
    fileList: ["SystemStructure.ssd"],
    capabilities: CAPS,
  },
  {
    id: "owl2-units",
    languageId: "owl2",
    title: "SI Dimensional Ontology & Unit Reasoning",
    summary:
      "W3C OWL 2 Functional-Style ontology encoding disjoint SI physical quantities and automated tableau consistency checking.",
    badge: "OWL",
    tone: "rose",
    ext: ".owl",
    primaryFile: "unit_ontology.owl",
    fileList: ["unit_ontology.owl"],
    capabilities: CAPS,
  },
  {
    id: "step-pendulum",
    languageId: "step",
    title: "ISO 10303-21 CAD Assembly & Inertia Extraction",
    summary:
      "B-Rep STEP assembly with coordinate axes, product definitions, and automated multibody Modelica lowering.",
    badge: "STP",
    tone: "indigo",
    ext: ".step",
    primaryFile: "SimplePendulum.step",
    fileList: ["SimplePendulum.step"],
    capabilities: CAPS,
  },
  {
    id: "scad-airframe",
    languageId: "scad",
    title: "Parametric Quadcopter Airframe CSG",
    summary: "OpenSCAD parametric carbon-fiber drone hub and rotor shroud geometry with tagged ports for FEA and CFD.",
    badge: "SCD",
    tone: "teal",
    ext: ".scad",
    primaryFile: "drone.scad",
    fileList: ["drone.scad"],
    capabilities: CAPS,
  },
  {
    id: "cfd-aerodynamics",
    languageId: "cfd",
    title: "SU2 Incompressible RANS Rotor Drag Polar",
    summary:
      "SU2 aerodynamic configuration evaluating climb drag polar with SST turbulence model and boundary heat-flux markers.",
    badge: "CFD",
    tone: "sky",
    ext: ".cfg",
    primaryFile: "drone_aero.cfg",
    fileList: ["drone_aero.cfg"],
    capabilities: CAPS,
  },
  {
    id: "fea-chassis",
    languageId: "fea",
    title: "CalculiX / Abaqus Composite Arm Stress Deck",
    summary:
      "3D C3D8R hexahedral finite element mesh with carbon-epoxy elastic material, fixed hub boundary, and tip thrust load.",
    badge: "FEA",
    tone: "amber",
    ext: ".inp",
    primaryFile: "drone_chassis.inp",
    fileList: ["drone_chassis.inp"],
    capabilities: CAPS,
  },
  {
    id: "csv-telemetry",
    languageId: "csv",
    title: "Flight Test Climb Telemetry Dataset",
    summary:
      "Time-series altitude, climb velocity, and motor thrust telemetry for parameter calibration and CombiTimeTable replay.",
    badge: "CSV",
    tone: "emerald",
    ext: ".csv",
    primaryFile: "flight_telemetry.csv",
    fileList: ["flight_telemetry.csv"],
    capabilities: CAPS,
  },
  {
    id: "c-pid-controller",
    languageId: "c",
    title: "Embedded Flight Autopilot PID Controller",
    summary:
      "MISRA-clean C99 altitude hold controller with anti-windup clamping, symbolic verification, and Modelica external C binding.",
    badge: "C99",
    tone: "sky",
    ext: ".c",
    primaryFile: "pid_controller.c",
    fileList: ["pid_controller.c"],
    capabilities: CAPS,
  },
  {
    id: "fortran-nozzle",
    languageId: "fortran",
    title: "Supersonic Isentropic Nozzle Flow Kernel",
    summary:
      "Fortran 90 scientific subroutine computing thrust and exit velocity for a converging-diverging rocket nozzle.",
    badge: "F90",
    tone: "indigo",
    ext: ".f90",
    primaryFile: "nozzle_flow.f90",
    fileList: ["nozzle_flow.f90"],
    capabilities: CAPS,
  },
  {
    id: "jsbsim-c172p",
    languageId: "jsbsim",
    title: "Cessna 172P 6-DOF Flight Dynamics Model",
    summary:
      "JSBSim XML configuration with wing metrics, mass balance, tricycle landing gear, pitch damper FCS, and aero coefficients.",
    badge: "JSB",
    tone: "amber",
    ext: ".jsbsim",
    primaryFile: "c172p.jsbsim",
    fileList: ["c172p.jsbsim"],
    capabilities: CAPS,
  },
  {
    id: "rocets-expander",
    languageId: "rocets",
    title: "LOX/LH2 Expander Cycle Rocket Engine",
    summary:
      "Cryogenic LH2 turbopump, regenerative cooling jacket, turbine, and main combustion chamber cycle balance.",
    badge: "ROC",
    tone: "rose",
    ext: ".roc",
    primaryFile: "expander_engine.roc",
    fileList: ["expander_engine.roc"],
    capabilities: CAPS,
  },
  {
    id: "ccsds-landsat",
    languageId: "ccsds",
    title: "Landsat-9 Sun-Synchronous Orbit Ephemeris",
    summary:
      "CCSDS OEM 2.0 spacecraft ephemeris with EME2000 state vectors, orbital period analysis, and RK4 propagation.",
    badge: "ODM",
    tone: "sky",
    ext: ".oem",
    primaryFile: "landsat9_orbit.oem",
    fileList: ["landsat9_orbit.oem"],
    capabilities: CAPS,
  },
  {
    id: "easy5-flight-control",
    languageId: "easy5",
    title: "Multi-Rate Pitch Electro-Hydrostatic Actuator",
    summary:
      "Easy5 aerospace schematic combining digital pitch command filtering with continuous hydraulic servo-valve dynamics.",
    badge: "EZ5",
    tone: "indigo",
    ext: ".ez5",
    primaryFile: "flight_control.ez5",
    fileList: ["flight_control.ez5"],
    capabilities: CAPS,
  },
  {
    id: "autosar-powertrain",
    languageId: "autosar",
    title: "AUTOSAR Traction Inverter Torque SWC",
    summary:
      "AUTOSAR 4.x application software component with sender-receiver ports, internal behavior, 10 ms timing event, and runnable.",
    badge: "ASR",
    tone: "emerald",
    ext: ".arxml",
    primaryFile: "torque_controller.arxml",
    fileList: ["torque_controller.arxml"],
    capabilities: CAPS,
  },
  {
    id: "simulink-cruise",
    languageId: "simulink",
    title: "Adaptive Cruise Control Block Diagram",
    summary:
      "Simulink ASCII .mdl control loop with Constant setpoint, Sum junction, proportional-integral Gain, and vehicle plant Integrator.",
    badge: "SLX",
    tone: "teal",
    ext: ".mdl",
    primaryFile: "cruise_control.mdl",
    fileList: ["cruise_control.mdl"],
    capabilities: CAPS,
  },
  {
    id: "gtsuite-turbo",
    languageId: "gtsuite",
    title: "Turbocharged Inline-4 Engine & Gas Path",
    summary:
      "GT-SUITE 1D engine model with ambient inlet, intake manifold, Wiebe combustion cylinder, and exhaust boundary.",
    badge: "GTS",
    tone: "amber",
    ext: ".gtm",
    primaryFile: "turbo_inline4.gtm",
    fileList: ["turbo_inline4.gtm"],
    capabilities: CAPS,
  },
  {
    id: "opendrive-highway",
    languageId: "opendrive",
    title: "ASAM OpenDRIVE Highway Corridor Geometry",
    summary:
      "High-definition multi-lane highway geometry with reference planView lines, driving lanes, and width polynomials.",
    badge: "ODR",
    tone: "sky",
    ext: ".xodr",
    primaryFile: "highway_corridor.xodr",
    fileList: ["highway_corridor.xodr"],
    capabilities: CAPS,
  },
  {
    id: "openscenario-cut-in",
    languageId: "openscenario",
    title: "Highway Cut-In & Emergency Braking Scenario",
    summary:
      "ASAM OpenSCENARIO 1.2 storyboard with Ego and Adversary vehicles, lane-change maneuver, and TTC / RSS safety verification.",
    badge: "OSC",
    tone: "rose",
    ext: ".xosc",
    primaryFile: "highway_cut_in.xosc",
    fileList: ["highway_cut_in.xosc"],
    capabilities: CAPS,
  },
  {
    id: "gensys-coach",
    languageId: "gensys",
    title: "High-Speed Passenger Coach & EN 14363 Acceptance",
    summary:
      "GENSYS railway vehicle model with carbody, 2 bogies, 4 wheelsets, primary/secondary suspension, and FASTSIM contact.",
    badge: "GEN",
    tone: "rose",
    ext: ".calc",
    primaryFile: "passenger_coach.calc",
    fileList: ["passenger_coach.calc"],
    capabilities: CAPS,
  },
  {
    id: "simpack-suspension",
    languageId: "simpack",
    title: "Double-Wishbone Automotive Suspension Mechanism",
    summary:
      "SIMPACK spatial multibody deck with chassis, knuckle, revolute joints, coilover spring-damper, and Grübler mobility check.",
    badge: "SPK",
    tone: "indigo",
    ext: ".spck",
    primaryFile: "wishbone_suspension.spck",
    fileList: ["wishbone_suspension.spck"],
    capabilities: CAPS,
  },
  {
    id: "pscad-microgrid",
    languageId: "pscad",
    title: "230 kV Inverter-Based Resource (IBR) Microgrid",
    summary:
      "PSCAD EMT schematic with 16.5/230 kV substation, 50 km Bergeron transmission line, solar BESS IBR, and IEEE 2800-2022 audit.",
    badge: "PSC",
    tone: "amber",
    ext: ".pscx",
    primaryFile: "Microgrid_IBR.pscx",
    fileList: ["Microgrid_IBR.pscx"],
    capabilities: CAPS,
  },
  {
    id: "psse-ieee14",
    languageId: "psse",
    title: "IEEE 14-Bus Transmission Network Power Flow",
    summary:
      "PSS®E v33 .raw transmission network with slack/PV/PQ buses, loads, generators, branches, and Newton-Raphson AC power flow.",
    badge: "PSE",
    tone: "teal",
    ext: ".raw",
    primaryFile: "ieee14.raw",
    fileList: ["ieee14.raw"],
    capabilities: CAPS,
  },
  {
    id: "opendss-ieee4",
    languageId: "opendss",
    title: "IEEE 4-Bus Unbalanced Distribution Feeder & PV",
    summary:
      "OpenDSS distribution feeder with 12.47/4.16 kV step-down transformer, 3-phase lines, unbalanced load, and solar PVSystem.",
    badge: "DSS",
    tone: "emerald",
    ext: ".dss",
    primaryFile: "ieee4_feeder.dss",
    fileList: ["ieee4_feeder.dss"],
    capabilities: CAPS,
  },
  {
    id: "olga-flowline",
    languageId: "olga",
    title: "Subsea Multiphase Tieback & Slug Riser",
    summary:
      "OLGA .opi subsea tieback from wellhead source through seabed flowline and vertical riser to topside separator.",
    badge: "OLG",
    tone: "teal",
    ext: ".opi",
    primaryFile: "subsea_flowline.opi",
    fileList: ["subsea_flowline.opi"],
    capabilities: CAPS,
  },
  {
    id: "lps-corridor",
    languageId: "lps",
    title: "High-Pressure Gas Transmission Corridor (TGNET)",
    summary:
      "Pipeline Studio .lps natural gas corridor with supply receipt, centrifugal compressor station, and delivery sales node.",
    badge: "LPS",
    tone: "sky",
    ext: ".lps",
    primaryFile: "gas_corridor.lps",
    fileList: ["gas_corridor.lps"],
    capabilities: CAPS,
  },
  {
    id: "eclipse-brent",
    languageId: "eclipse",
    title: "North Sea Black-Oil Waterflood Reservoir Deck",
    summary:
      "SLB ECLIPSE 100 .data deck with 3D corner-point grid, PVDO/SWOF tables, producer/injector wells, and waterflood schedule.",
    badge: "ECL",
    tone: "amber",
    ext: ".data",
    primaryFile: "brent_reservoir.data",
    fileList: ["brent_reservoir.data"],
    capabilities: CAPS,
  },
  {
    id: "relap5-pwr",
    languageId: "relap5",
    title: "PWR Primary Coolant Loop & Point Reactor Kinetics",
    summary:
      "RELAP5-3D nuclear thermal-hydraulics deck with reactor core pipe, pressurizer, pump, heat structure, and 10 CFR 50.46 PCT checks.",
    badge: "R5D",
    tone: "rose",
    ext: ".r5",
    primaryFile: "pwr_loop.r5",
    fileList: ["pwr_loop.r5"],
    capabilities: CAPS,
  },
  {
    id: "sima-oc4",
    languageId: "sima",
    title: "OC4 DeepCwind Semi-Submersible Floating Wind Platform",
    summary:
      "SIMA (SIMO/RIFLEX) offshore deck with 6-DOF semi-submersible hull, 3 catenary mooring lines, and JONSWAP wave spectrum.",
    badge: "SIM",
    tone: "sky",
    ext: ".sima",
    primaryFile: "oc4_semisub.sima",
    fileList: ["oc4_semisub.sima"],
    capabilities: CAPS,
  },
  {
    id: "spice-filter",
    languageId: "spice",
    title: "Second-Order RLC Low-Pass Analog Filter",
    summary:
      "SPICE circuit netlist with sinusoidal voltage source, series resistor/inductor, shunt capacitor, and .tran MNA analysis.",
    badge: "SPC",
    tone: "indigo",
    ext: ".cir",
    primaryFile: "lowpass_filter.cir",
    fileList: ["lowpass_filter.cir"],
    capabilities: CAPS,
  },
  {
    id: "veriloga-resistor",
    languageId: "verilog-a",
    title: "Nonlinear Thermal-Electrical Semiconductor Resistor",
    summary:
      "Accellera Verilog-A behavioral compact device module with electrical ports, parameter declarations, and analog branch contributions.",
    badge: "VLA",
    tone: "teal",
    ext: ".va",
    primaryFile: "analog_resistor.va",
    fileList: ["analog_resistor.va"],
    capabilities: CAPS,
  },
  {
    id: "ibis-lvcmos",
    languageId: "ibis",
    title: "1.8V High-Speed LVCMOS I/O Buffer Model",
    summary:
      "ANSI/EIA-656 IBIS v5.0 buffer specification with package RLC parasitics, Pulldown/Pullup I-V curves, and Rising/Falling V-T waveforms.",
    badge: "IBS",
    tone: "amber",
    ext: ".ibs",
    primaryFile: "lvcmos_io.ibs",
    fileList: ["lvcmos_io.ibs"],
    capabilities: CAPS,
  },
  {
    id: "touchstone-filter",
    languageId: "touchstone",
    title: "2.4 GHz RF Bandpass Filter 2-Port S-Parameters",
    summary:
      "Touchstone .s2p 2-port scattering matrix with passivity singular-value verification, reciprocity checks, and rational vector fitting.",
    badge: "SNP",
    tone: "rose",
    ext: ".s2p",
    primaryFile: "bandpass_filter.s2p",
    fileList: ["bandpass_filter.s2p"],
    capabilities: CAPS,
  },
  {
    id: "urdf-manipulator",
    languageId: "urdf",
    title: "2-DOF Robotic Manipulator Arm (ROS URDF)",
    summary:
      "Unified Robot Description Format with base/shoulder/forearm links, positive-definite inertia tensors, and revolute joint limits.",
    badge: "URD",
    tone: "emerald",
    ext: ".urdf",
    primaryFile: "manipulator_2dof.urdf",
    fileList: ["manipulator_2dof.urdf"],
    capabilities: CAPS,
  },
  {
    id: "plcopen-tank",
    languageId: "plcopen",
    title: "Industrial Tank Level & High-Level Interlock PLC",
    summary:
      "IEC 61131-3 Structured Text program regulating tank level with proportional control and overflow safety trip.",
    badge: "PLC",
    tone: "teal",
    ext: ".st",
    primaryFile: "tank_level.st",
    fileList: ["tank_level.st"],
    capabilities: CAPS,
  },
  {
    id: "adams-pendulum",
    languageId: "adams",
    title: "MSC Adams Damped Pendulum Mechanism",
    summary:
      "MSC Adams/Solver .adm dataset with ground PART, pendulum link PART, coordinate MARKERS, REVOLUTE joint, and gravity.",
    badge: "ADM",
    tone: "indigo",
    ext: ".adm",
    primaryFile: "pendulum_mechanism.adm",
    fileList: ["pendulum_mechanism.adm"],
    capabilities: CAPS,
  },
  {
    id: "energyplus-office",
    languageId: "energyplus",
    title: "Commercial Office Thermal Zone & Envelope (ASHRAE 90.1)",
    summary:
      "EnergyPlus .idf building thermal model with concrete envelope material, wall construction, conditioned office zone, and thermostat.",
    badge: "IDF",
    tone: "amber",
    ext: ".idf",
    primaryFile: "office_zone.idf",
    fileList: ["office_zone.idf"],
    capabilities: CAPS,
  },
  {
    id: "epanet-water",
    languageId: "epanet",
    title: "Municipal Pressurized Water Distribution Loop",
    summary:
      "EPANET hydraulic network with elevated supply reservoir, looped Hazen-Williams mains, demand junctions, and GGA pressure solver.",
    badge: "EPA",
    tone: "sky",
    ext: ".epanet",
    primaryFile: "municipal_water.epanet",
    fileList: ["municipal_water.epanet"],
    capabilities: CAPS,
  },
  {
    id: "swmm-drainage",
    languageId: "swmm",
    title: "Urban Stormwater Catchment & Conduit Routing",
    summary:
      "EPA SWMM .swmm model with design storm rain gage, 2 urban subcatchments, circular storm sewer conduits, and dynamic wave routing.",
    badge: "SWM",
    tone: "teal",
    ext: ".swmm",
    primaryFile: "urban_drainage.swmm",
    fileList: ["urban_drainage.swmm"],
    capabilities: CAPS,
  },
  {
    id: "aspen-methanol",
    languageId: "aspen",
    title: "Methanol-Water Flash Separation Flowsheet",
    summary:
      "Aspen Plus process flowsheet with NRTL activity coefficient model, feed heater, vapor-liquid flash drum, and mass/energy balance.",
    badge: "ASP",
    tone: "amber",
    ext: ".bkp",
    primaryFile: "methanol_flash.bkp",
    fileList: ["methanol_flash.bkp"],
    capabilities: CAPS,
  },
  {
    id: "sbml-enzyme",
    languageId: "sbml",
    title: "Michaelis-Menten Enzyme Catalysis Network",
    summary:
      "SBML Level 3 Version 2 biochemical reaction network (E + S <-> ES -> E + P) with conservation-law analysis.",
    badge: "SBM",
    tone: "rose",
    ext: ".sbml",
    primaryFile: "enzyme_kinetics.sbml",
    fileList: ["enzyme_kinetics.sbml"],
    capabilities: CAPS,
  },
];

export function renderLandingPageHtml(): string {
  const catalogPayload = JSON.stringify({
    groups: LANDING_LANGUAGE_GROUPS,
    languages: LANDING_LANGUAGE_TILES,
    examples: LANDING_EXAMPLE_TILES,
  });

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <title>ModelScript IDE — 44-Language Polyglot Engineering &amp; Simulation Environment</title>
  <link rel="icon" href="/favicon.ico" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --ms-bg-canvas: #060913;
      --ms-bg-elevated: #0b1020;
      --ms-bg-surface: #0f1629;
      --ms-bg-surface-hover: #151e36;
      --ms-bg-glass: rgba(11, 16, 32, 0.78);
      --ms-border-subtle: rgba(148, 163, 184, 0.12);
      --ms-border-strong: rgba(56, 189, 248, 0.34);
      --ms-text-primary: #f8fafc;
      --ms-text-secondary: #94a3b8;
      --ms-text-muted: #64748b;
      --ms-accent: #14b8a6;
      --ms-accent-bright: #2dd4bf;
      --ms-accent-secondary: #38bdf8;
      --ms-accent-tertiary: #818cf8;
      --ms-grid-minor: rgba(56, 189, 248, 0.045);
      --ms-grid-major: rgba(20, 184, 166, 0.085);
      --ms-glow-hero: radial-gradient(ellipse 80% 55% at 50% -10%, rgba(20, 184, 166, 0.22), rgba(56, 189, 248, 0.12) 45%, transparent 75%);
      --ms-glow-secondary: radial-gradient(circle at 85% 20%, rgba(129, 140, 248, 0.14), transparent 55%);
      --ms-shadow-card: 0 18px 42px -16px rgba(2, 6, 23, 0.72), 0 0 0 1px rgba(148, 163, 184, 0.09);
      --ms-shadow-card-hover: 0 24px 54px -14px rgba(13, 148, 136, 0.28), 0 0 0 1px rgba(45, 212, 191, 0.38);
      --ms-font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --ms-font-display: 'Space Grotesk', 'Plus Jakarta Sans', sans-serif;
      --ms-font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    }

    html.light {
      --ms-bg-canvas: #f8fafc;
      --ms-bg-elevated: #ffffff;
      --ms-bg-surface: #f1f5f9;
      --ms-bg-surface-hover: #e2e8f0;
      --ms-bg-glass: rgba(255, 255, 255, 0.84);
      --ms-border-subtle: rgba(15, 23, 42, 0.09);
      --ms-border-strong: rgba(13, 148, 136, 0.35);
      --ms-text-primary: #0f172a;
      --ms-text-secondary: #475569;
      --ms-text-muted: #64748b;
      --ms-accent: #0d9488;
      --ms-accent-bright: #0f766e;
      --ms-accent-secondary: #0284c7;
      --ms-accent-tertiary: #4f46e5;
      --ms-grid-minor: rgba(15, 23, 42, 0.035);
      --ms-grid-major: rgba(13, 148, 136, 0.075);
      --ms-glow-hero: radial-gradient(ellipse 80% 55% at 50% -10%, rgba(13, 148, 136, 0.14), rgba(2, 132, 199, 0.08) 45%, transparent 75%);
      --ms-glow-secondary: radial-gradient(circle at 85% 20%, rgba(79, 70, 229, 0.08), transparent 55%);
      --ms-shadow-card: 0 12px 32px -12px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(15, 23, 42, 0.06);
      --ms-shadow-card-hover: 0 20px 44px -14px rgba(13, 148, 136, 0.18), 0 0 0 1px rgba(13, 148, 136, 0.35);
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: var(--ms-font-sans);
      background-color: var(--ms-bg-canvas);
      color: var(--ms-text-primary);
      min-height: 100vh;
      background-image:
        var(--ms-glow-hero),
        var(--ms-glow-secondary),
        linear-gradient(to right, var(--ms-grid-minor) 1px, transparent 1px),
        linear-gradient(to bottom, var(--ms-grid-minor) 1px, transparent 1px),
        linear-gradient(to right, var(--ms-grid-major) 1px, transparent 1px),
        linear-gradient(to bottom, var(--ms-grid-major) 1px, transparent 1px);
      background-size: 100% 100%, 100% 100%, 28px 28px, 28px 28px, 140px 140px, 140px 140px;
      background-position: 0 0, 0 0, -1px -1px, -1px -1px, -1px -1px, -1px -1px;
      -webkit-font-smoothing: antialiased;
    }

    /* ── Top Navigation Bar (Matches Docs VitePress Nav) ── */
    .ms-navbar {
      position: sticky;
      top: 0;
      z-index: 40;
      height: 64px;
      backdrop-filter: blur(18px) saturate(160%);
      -webkit-backdrop-filter: blur(18px) saturate(160%);
      background: var(--ms-bg-glass);
      border-bottom: 1px solid var(--ms-border-subtle);
    }

    .ms-navbar-inner {
      max-width: 1400px;
      height: 100%;
      margin: 0 auto;
      padding: 0 1.75rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .ms-brand {
      display: inline-flex;
      align-items: center;
      gap: 0.7rem;
      text-decoration: none;
      color: var(--ms-text-primary);
      font-family: var(--ms-font-display);
      font-weight: 700;
      font-size: 1.08rem;
      letter-spacing: -0.02em;
    }

    .ms-brand-mark {
      width: 32px;
      height: 32px;
      border-radius: 9px;
      background: linear-gradient(135deg, rgba(20, 184, 166, 0.2), rgba(56, 189, 248, 0.16));
      border: 1px solid var(--ms-border-strong);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--ms-accent-bright);
      font-family: var(--ms-font-mono);
      font-size: 0.8rem;
      font-weight: 700;
    }

    .ms-brand-pill {
      font-family: var(--ms-font-mono);
      font-size: 0.68rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 0.18rem 0.55rem;
      border-radius: 999px;
      background: rgba(20, 184, 166, 0.14);
      border: 1px solid rgba(45, 212, 191, 0.32);
      color: var(--ms-accent-bright);
    }

    .ms-nav-actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .ms-nav-link {
      color: var(--ms-text-secondary);
      text-decoration: none;
      font-size: 0.88rem;
      font-weight: 500;
      padding: 0.4rem 0.7rem;
      border-radius: 8px;
      transition: color 0.15s, background 0.15s;
    }

    .ms-nav-link:hover {
      color: var(--ms-text-primary);
      background: var(--ms-bg-surface);
    }

    .ms-theme-toggle {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.4rem 0.75rem;
      border-radius: 9px;
      border: 1px solid var(--ms-border-subtle);
      background: var(--ms-bg-surface);
      color: var(--ms-text-secondary);
      font-family: var(--ms-font-mono);
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.18s ease;
    }

    .ms-theme-toggle:hover {
      color: var(--ms-text-primary);
      border-color: var(--ms-border-strong);
    }

    /* ── Main Layout Container ── */
    .ms-page {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2.5rem 1.75rem 5rem;
    }

    .ms-hero-header {
      text-align: center;
      max-width: 860px;
      margin: 0 auto 2rem;
    }

    .ms-eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.32rem 0.85rem;
      border-radius: 999px;
      font-family: var(--ms-font-mono);
      font-size: 0.74rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--ms-accent-bright);
      background: rgba(20, 184, 166, 0.1);
      border: 1px solid rgba(45, 212, 191, 0.28);
      margin-bottom: 1rem;
    }

    .ms-eyebrow-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--ms-accent-bright);
      box-shadow: 0 0 10px var(--ms-accent-bright);
    }

    .ms-title {
      font-family: var(--ms-font-display);
      font-size: clamp(2rem, 3.8vw, 3.1rem);
      font-weight: 700;
      line-height: 1.1;
      letter-spacing: -0.035em;
      margin-bottom: 0.85rem;
      background: linear-gradient(135deg, var(--ms-text-primary) 20%, var(--ms-accent-bright) 62%, var(--ms-accent-secondary) 98%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .ms-subtitle {
      font-size: 1.04rem;
      line-height: 1.65;
      color: var(--ms-text-secondary);
    }

    /* ── Main Tile: Empty Workspace + GitHub Quick-Open ── */
    .ms-main-tile-grid {
      display: grid;
      grid-template-columns: 1.65fr 1fr;
      gap: 1.25rem;
      margin-bottom: 2.75rem;
    }

    @media (max-width: 960px) {
      .ms-main-tile-grid {
        grid-template-columns: 1fr;
      }
    }

    .ms-empty-workspace-tile {
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 1.75rem 2rem;
      border-radius: 18px;
      background:
        radial-gradient(circle at 90% 10%, rgba(20, 184, 166, 0.16), transparent 55%),
        linear-gradient(180deg, var(--ms-bg-surface) 0%, var(--ms-bg-elevated) 100%);
      border: 1px solid var(--ms-border-strong);
      box-shadow: var(--ms-shadow-card);
      text-decoration: none;
      color: var(--ms-text-primary);
      transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.22s ease, border-color 0.22s ease;
      overflow: hidden;
    }

    .ms-empty-workspace-tile::before {
      content: "";
      position: absolute;
      inset: 0 0 auto 0;
      height: 3px;
      background: linear-gradient(90deg, var(--ms-accent), var(--ms-accent-secondary), var(--ms-accent-tertiary));
    }

    .ms-empty-workspace-tile:hover {
      transform: translateY(-3px);
      box-shadow: var(--ms-shadow-card-hover);
      border-color: var(--ms-accent-bright);
    }

    .ms-empty-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1.25rem;
      margin-bottom: 1.15rem;
    }

    .ms-empty-left {
      display: flex;
      align-items: flex-start;
      gap: 1.1rem;
    }

    .ms-empty-icon {
      width: 52px;
      height: 52px;
      border-radius: 14px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(20, 184, 166, 0.14);
      border: 1px solid rgba(45, 212, 191, 0.36);
      color: var(--ms-accent-bright);
      font-family: var(--ms-font-mono);
      font-size: 1.35rem;
      font-weight: 700;
    }

    .ms-empty-heading {
      font-family: var(--ms-font-display);
      font-size: 1.35rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 0.35rem;
    }

    .ms-empty-desc {
      font-size: 0.93rem;
      line-height: 1.58;
      color: var(--ms-text-secondary);
    }

    .ms-empty-bottom {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 0.85rem;
      padding-top: 1rem;
      border-top: 1px solid var(--ms-border-subtle);
    }

    .ms-cap-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }

    .ms-cap-pill {
      font-family: var(--ms-font-mono);
      font-size: 0.68rem;
      font-weight: 600;
      padding: 0.22rem 0.55rem;
      border-radius: 6px;
      background: rgba(148, 163, 184, 0.1);
      border: 1px solid var(--ms-border-subtle);
      color: var(--ms-text-secondary);
    }

    .ms-cta-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.6rem 1.15rem;
      border-radius: 10px;
      background: linear-gradient(135deg, #0d9488 0%, #0284c7 100%);
      color: #ffffff;
      font-family: var(--ms-font-display);
      font-size: 0.86rem;
      font-weight: 600;
      border: 1px solid rgba(45, 212, 191, 0.45);
      box-shadow: 0 8px 22px -6px rgba(20, 184, 166, 0.45);
      white-space: nowrap;
      text-decoration: none;
    }

    .ms-repo-card {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 1.6rem 1.65rem;
      border-radius: 18px;
      background: linear-gradient(180deg, var(--ms-bg-surface) 0%, var(--ms-bg-elevated) 100%);
      border: 1px solid var(--ms-border-subtle);
      box-shadow: var(--ms-shadow-card);
    }

    .ms-repo-title {
      font-family: var(--ms-font-display);
      font-size: 1.05rem;
      font-weight: 700;
      margin-bottom: 0.35rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .ms-repo-desc {
      font-size: 0.86rem;
      color: var(--ms-text-secondary);
      line-height: 1.5;
      margin-bottom: 1rem;
    }

    .ms-repo-form {
      display: flex;
      gap: 0.55rem;
    }

    .ms-input {
      flex: 1;
      padding: 0.68rem 0.95rem;
      border-radius: 10px;
      border: 1px solid var(--ms-border-subtle);
      background: var(--ms-bg-canvas);
      color: var(--ms-text-primary);
      font-family: var(--ms-font-mono);
      font-size: 0.83rem;
      outline: none;
      transition: border-color 0.18s, box-shadow 0.18s;
    }

    .ms-input:focus {
      border-color: var(--ms-accent);
      box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.18);
    }

    .ms-repo-submit {
      padding: 0.68rem 1rem;
      border-radius: 10px;
      border: 1px solid var(--ms-border-strong);
      background: rgba(20, 184, 166, 0.14);
      color: var(--ms-accent-bright);
      font-family: var(--ms-font-display);
      font-weight: 600;
      font-size: 0.83rem;
      cursor: pointer;
      transition: all 0.18s;
    }

    .ms-repo-submit:hover {
      background: rgba(20, 184, 166, 0.24);
    }

    /* ── Tone Chips (Exact Match with Docs Site) ── */
    .tone-teal {
      background: rgba(20, 184, 166, 0.14);
      color: #2dd4bf;
      border: 1px solid rgba(45, 212, 191, 0.32);
    }
    .tone-indigo {
      background: rgba(99, 102, 241, 0.15);
      color: #818cf8;
      border: 1px solid rgba(129, 140, 248, 0.32);
    }
    .tone-amber {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(251, 191, 36, 0.32);
    }
    .tone-emerald {
      background: rgba(16, 185, 129, 0.14);
      color: #34d399;
      border: 1px solid rgba(52, 211, 153, 0.32);
    }
    .tone-rose {
      background: rgba(244, 63, 94, 0.14);
      color: #fb7185;
      border: 1px solid rgba(251, 113, 133, 0.32);
    }
    .tone-sky {
      background: rgba(14, 165, 233, 0.14);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.32);
    }

    html.light .tone-teal { color: #0f766e; }
    html.light .tone-indigo { color: #4338ca; }
    html.light .tone-amber { color: #b45309; }
    html.light .tone-emerald { color: #047857; }
    html.light .tone-rose { color: #be123c; }
    html.light .tone-sky { color: #0369a1; }

    /* ── Level 1 Controls: Search & Domain Filter Pills ── */
    .ms-section-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 1rem;
      margin-bottom: 1.1rem;
    }

    .ms-section-heading {
      font-family: var(--ms-font-display);
      font-size: 1.35rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      display: flex;
      align-items: center;
      gap: 0.65rem;
    }

    .ms-count-badge {
      font-family: var(--ms-font-mono);
      font-size: 0.74rem;
      padding: 0.2rem 0.6rem;
      border-radius: 999px;
      background: rgba(56, 189, 248, 0.12);
      border: 1px solid rgba(56, 189, 248, 0.28);
      color: var(--ms-accent-secondary);
    }

    .ms-search-wrap {
      min-width: 320px;
      flex: 1;
      max-width: 460px;
    }

    .ms-filter-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
      margin-bottom: 1.65rem;
    }

    .ms-filter-pill {
      padding: 0.38rem 0.78rem;
      border-radius: 999px;
      border: 1px solid var(--ms-border-subtle);
      background: var(--ms-bg-surface);
      color: var(--ms-text-secondary);
      font-family: var(--ms-font-sans);
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.16s ease;
    }

    .ms-filter-pill:hover {
      color: var(--ms-text-primary);
      border-color: var(--ms-border-strong);
    }

    .ms-filter-pill.active {
      background: linear-gradient(135deg, rgba(20, 184, 166, 0.22), rgba(56, 189, 248, 0.18));
      color: var(--ms-accent-bright);
      border-color: var(--ms-accent-bright);
    }

    /* ── Tile Grid (Level 1 Languages & Level 2 Examples) ── */
    .ms-tile-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
      gap: 1.15rem;
    }

    .ms-tile {
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 1.35rem 1.45rem;
      border-radius: 16px;
      background: linear-gradient(180deg, var(--ms-bg-surface) 0%, var(--ms-bg-elevated) 100%);
      border: 1px solid var(--ms-border-subtle);
      box-shadow: var(--ms-shadow-card);
      text-decoration: none;
      color: var(--ms-text-primary);
      cursor: pointer;
      transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.22s ease, box-shadow 0.22s ease;
      overflow: hidden;
      text-align: left;
    }

    .ms-tile::before {
      content: "";
      position: absolute;
      inset: 0 0 auto 0;
      height: 2px;
      background: linear-gradient(90deg, transparent, var(--ms-accent), var(--ms-accent-secondary), transparent);
      opacity: 0;
      transition: opacity 0.22s ease;
    }

    .ms-tile:hover {
      transform: translateY(-4px);
      border-color: var(--ms-border-strong);
      box-shadow: var(--ms-shadow-card-hover);
    }

    .ms-tile:hover::before {
      opacity: 1;
    }

    .ms-tile-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 0.85rem;
    }

    .ms-tile-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 44px;
      height: 32px;
      padding: 0 0.55rem;
      border-radius: 8px;
      font-family: var(--ms-font-mono);
      font-size: 0.76rem;
      font-weight: 700;
      letter-spacing: 0.04em;
    }

    .ms-tile-ext {
      font-family: var(--ms-font-mono);
      font-size: 0.74rem;
      font-weight: 600;
      padding: 0.18rem 0.55rem;
      border-radius: 6px;
      background: var(--ms-bg-canvas);
      border: 1px solid var(--ms-border-subtle);
      color: var(--ms-text-secondary);
    }

    .ms-tile-title {
      font-family: var(--ms-font-display);
      font-size: 1.08rem;
      font-weight: 700;
      letter-spacing: -0.015em;
      margin-bottom: 0.22rem;
    }

    .ms-tile-role {
      font-family: var(--ms-font-mono);
      font-size: 0.73rem;
      color: var(--ms-accent-secondary);
      margin-bottom: 0.55rem;
    }

    .ms-tile-summary {
      font-size: 0.86rem;
      line-height: 1.55;
      color: var(--ms-text-secondary);
      margin-bottom: 1rem;
    }

    .ms-tile-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding-top: 0.85rem;
      border-top: 1px solid var(--ms-border-subtle);
      font-family: var(--ms-font-mono);
      font-size: 0.74rem;
      font-weight: 600;
      color: var(--ms-accent-bright);
    }

    /* ── Level 2 Header & Breadcrumb ── */
    .ms-level2-header {
      padding: 1.5rem 1.75rem;
      border-radius: 16px;
      background: linear-gradient(180deg, var(--ms-bg-surface) 0%, var(--ms-bg-elevated) 100%);
      border: 1px solid var(--ms-border-strong);
      margin-bottom: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .ms-breadcrumb-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 0.85rem;
    }

    .ms-back-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.45rem 0.9rem;
      border-radius: 9px;
      border: 1px solid var(--ms-border-strong);
      background: rgba(20, 184, 166, 0.12);
      color: var(--ms-accent-bright);
      font-family: var(--ms-font-display);
      font-size: 0.84rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.16s ease;
    }

    .ms-back-btn:hover {
      background: rgba(20, 184, 166, 0.22);
    }

    .ms-file-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.38rem;
      margin-bottom: 0.95rem;
    }

    .ms-file-chip {
      font-family: var(--ms-font-mono);
      font-size: 0.71rem;
      padding: 0.18rem 0.5rem;
      border-radius: 6px;
      background: var(--ms-bg-canvas);
      border: 1px solid var(--ms-border-subtle);
      color: var(--ms-text-secondary);
    }

    .hidden {
      display: none !important;
    }
  </style>
</head>
<body>
  <header class="ms-navbar">
    <div class="ms-navbar-inner">
      <a href="/" class="ms-brand" onclick="if (window.showAllLanguages) { event.preventDefault(); window.showAllLanguages(); }">
        <span class="ms-brand-mark">MSX</span>
        <span>ModelScript</span>
        <span class="ms-brand-pill">Polyglot IDE</span>
      </a>
      <div class="ms-nav-actions">
        <a href="https://modelscript.org/languages/" target="_blank" rel="noopener" class="ms-nav-link">44 Languages Docs</a>
        <a href="https://github.com/modelscript/modelscript" target="_blank" rel="noopener" class="ms-nav-link">GitHub</a>
        <button id="theme-toggle" type="button" class="ms-theme-toggle" aria-label="Toggle color theme">
          <span id="theme-label">Dark Blueprint</span>
        </button>
      </div>
    </div>
  </header>

  <main class="ms-page">
    <section class="ms-hero-header">
      <div class="ms-eyebrow">
        <span class="ms-eyebrow-dot"></span>
        <span>44 Polyglot Engineering Languages &bull; WebAssembly GLR &bull; Zero-Glue Simulation</span>
      </div>
      <h1 class="ms-title">ModelScript Polyglot Engineering IDE</h1>
      <p class="ms-subtitle">
        Start with a clean empty workspace or explore verified examples across all 44 systems, multi-physics, CAD/FEA/CFD, aerospace, automotive, power grid, subsurface, semiconductor, and biological languages.
      </p>
    </section>

    <!-- Main Tile Row: Empty Workspace + Remote GitHub Repo -->
    <section class="ms-main-tile-grid" aria-label="Primary Workspace Launcher">
      <a href="/vscode/workbench/#memfs:empty" class="ms-empty-workspace-tile" id="main-empty-workspace-tile">
        <div class="ms-empty-top">
          <div class="ms-empty-left">
            <div class="ms-empty-icon">+</div>
            <div>
              <div class="ms-empty-heading">Empty Polyglot Workspace</div>
              <p class="ms-empty-desc">
                Launch a clean in-memory workspace with all 44 language grammars, WebAssembly GLR parsers, real-time linters, CodeLens actions, interactive schematics, and numerical solvers ready out of the box.
              </p>
            </div>
          </div>
          <span class="ms-tile-ext">memfs://empty</span>
        </div>
        <div class="ms-empty-bottom">
          <div class="ms-cap-pills">
            <span class="ms-cap-pill">Syntax &amp; Semantic Tokens</span>
            <span class="ms-cap-pill">WASM GLR Lints</span>
            <span class="ms-cap-pill">CodeLens</span>
            <span class="ms-cap-pill">Interactive Diagrams</span>
            <span class="ms-cap-pill">Simulation &amp; Verification</span>
          </div>
          <span class="ms-cta-btn">Launch Empty Workspace &rarr;</span>
        </div>
      </a>

      <div class="ms-repo-card">
        <div>
          <div class="ms-repo-title">
            <span>Open GitHub Repository</span>
          </div>
          <p class="ms-repo-desc">
            Mount any public GitHub repository directly into the browser virtual filesystem.
          </p>
        </div>
        <form class="ms-repo-form" onsubmit="event.preventDefault(); window.openGitHubRepo();">
          <input id="repo-url-input" class="ms-input" type="text" placeholder="owner/repo (e.g. modelscript/modelscript)" />
          <button type="submit" class="ms-repo-submit">Open &rarr;</button>
        </form>
      </div>
    </section>

    <!-- LEVEL 1: 44 Language Tiles -->
    <section id="level-1-view" aria-label="Level 1 Language Catalog">
      <div class="ms-section-bar">
        <div class="ms-section-heading">
          <span>Step 1 &mdash; Select a Language</span>
          <span id="lang-count-badge" class="ms-count-badge">44 Languages</span>
        </div>
        <div class="ms-search-wrap">
          <input
            id="lang-search-input"
            class="ms-input"
            style="width: 100%;"
            type="search"
            placeholder="Filter languages by name, extension (.mo, .sysml, .pscx...), or domain..."
          />
        </div>
      </div>

      <div id="domain-filter-pills" class="ms-filter-pills"></div>
      <div id="language-tiles-grid" class="ms-tile-grid"></div>
    </section>

    <!-- LEVEL 2: Verified Examples for Selected Language -->
    <section id="level-2-view" class="hidden" aria-label="Level 2 Verified Language Examples">
      <div class="ms-level2-header">
        <div class="ms-breadcrumb-row">
          <button type="button" class="ms-back-btn" onclick="window.showAllLanguages()">
            &larr; All 44 Languages
          </button>
          <div style="display: flex; gap: 0.65rem; align-items: center;">
            <a id="level2-docs-link" href="https://modelscript.org/languages/" target="_blank" rel="noopener" class="ms-nav-link">
              Language Specification Docs &nearr;
            </a>
            <a href="/vscode/workbench/#memfs:empty" class="ms-cta-btn">
              + Empty Workspace
            </a>
          </div>
        </div>
        <div>
          <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.4rem;">
            <span id="level2-badge" class="ms-tile-badge tone-teal">MO</span>
            <h2 id="level2-title" class="ms-section-heading">Modelica 3.x</h2>
            <span id="level2-ext" class="ms-tile-ext">.mo</span>
          </div>
          <p id="level2-summary" class="ms-empty-desc"></p>
        </div>
      </div>

      <div class="ms-section-bar">
        <div class="ms-section-heading">
          <span>Step 2 &mdash; Launch a Verified Example Workspace</span>
          <span id="example-count-badge" class="ms-count-badge">1 Verified Example</span>
        </div>
      </div>

      <div id="example-tiles-grid" class="ms-tile-grid"></div>
    </section>
  </main>

  <script>
    (function() {
      var CATALOG = ${catalogPayload};
      var activeGroup = 'all';
      var searchQuery = '';

      // Theme persistence synced with docs preference
      var rootEl = document.documentElement;
      var themeBtn = document.getElementById('theme-toggle');
      var themeLabel = document.getElementById('theme-label');

      function applyTheme(mode) {
        if (mode === 'light') {
          rootEl.classList.remove('dark');
          rootEl.classList.add('light');
          if (themeLabel) themeLabel.textContent = 'Light Paper';
        } else {
          rootEl.classList.remove('light');
          rootEl.classList.add('dark');
          if (themeLabel) themeLabel.textContent = 'Dark Blueprint';
        }
        try {
          localStorage.setItem('vitepress-theme-appearance', mode);
        } catch (e) {}
      }

      try {
        var saved = localStorage.getItem('vitepress-theme-appearance');
        if (saved === 'light') applyTheme('light');
      } catch (e) {}

      if (themeBtn) {
        themeBtn.addEventListener('click', function() {
          var isLight = rootEl.classList.contains('light');
          applyTheme(isLight ? 'dark' : 'light');
        });
      }

      window.openGitHubRepo = function() {
        var input = document.getElementById('repo-url-input');
        if (!input) return;
        var val = input.value.trim();
        if (!val) val = 'modelscript/modelscript';
        val = val.replace(/^https?:\\/\\//, '').replace(/^github\\.com\\//, '');
        window.location.href = '/vscode/workbench/#' + val;
      };

      function getExamplesForLanguage(langId) {
        return CATALOG.examples.filter(function(ex) {
          return ex.languageId === langId;
        });
      }

      function renderFilterPills() {
        var container = document.getElementById('domain-filter-pills');
        if (!container) return;
        var html = '<button type="button" class="ms-filter-pill ' + (activeGroup === 'all' ? 'active' : '') + '" data-group="all">All 44 Languages</button>';
        for (var i = 0; i < CATALOG.groups.length; i++) {
          var g = CATALOG.groups[i];
          var cls = activeGroup === g.id ? 'ms-filter-pill active' : 'ms-filter-pill';
          html += '<button type="button" class="' + cls + '" data-group="' + g.id + '">' + g.label + '</button>';
        }
        container.innerHTML = html;
        var buttons = container.querySelectorAll('button[data-group]');
        for (var j = 0; j < buttons.length; j++) {
          buttons[j].addEventListener('click', function(ev) {
            activeGroup = ev.currentTarget.getAttribute('data-group') || 'all';
            renderFilterPills();
            renderLanguageTiles();
          });
        }
      }

      function renderLanguageTiles() {
        var grid = document.getElementById('language-tiles-grid');
        var countBadge = document.getElementById('lang-count-badge');
        if (!grid) return;

        var q = searchQuery.toLowerCase().trim();
        var filtered = CATALOG.languages.filter(function(lang) {
          if (activeGroup !== 'all' && lang.group !== activeGroup) return false;
          if (!q) return true;
          return (
            lang.name.toLowerCase().indexOf(q) !== -1 ||
            lang.id.toLowerCase().indexOf(q) !== -1 ||
            lang.ext.toLowerCase().indexOf(q) !== -1 ||
            lang.role.toLowerCase().indexOf(q) !== -1 ||
            lang.summary.toLowerCase().indexOf(q) !== -1
          );
        });

        if (countBadge) {
          countBadge.textContent = filtered.length + (filtered.length === 1 ? ' Language' : ' Languages');
        }

        var html = '';
        for (var i = 0; i < filtered.length; i++) {
          var lang = filtered[i];
          var exList = getExamplesForLanguage(lang.id);
          var exCountLabel = exList.length + (exList.length === 1 ? ' Verified Example' : ' Verified Examples');
          html +=
            '<button type="button" class="ms-tile" data-lang-id="' + lang.id + '">' +
              '<div>' +
                '<div class="ms-tile-top">' +
                  '<span class="ms-tile-badge tone-' + lang.tone + '">' + lang.badge + '</span>' +
                  '<span class="ms-tile-ext">' + lang.ext + '</span>' +
                '</div>' +
                '<div class="ms-tile-title">' + lang.name + '</div>' +
                '<div class="ms-tile-role">' + lang.role + '</div>' +
                '<div class="ms-tile-summary">' + lang.summary + '</div>' +
              '</div>' +
              '<div>' +
                '<div class="ms-cap-pills" style="margin-bottom: 0.75rem;">' +
                  '<span class="ms-cap-pill">Syntax</span>' +
                  '<span class="ms-cap-pill">Lints</span>' +
                  '<span class="ms-cap-pill">CodeLens</span>' +
                  '<span class="ms-cap-pill">Diagram</span>' +
                  '<span class="ms-cap-pill">Sim &amp; Verify</span>' +
                '</div>' +
                '<div class="ms-tile-footer">' +
                  '<span>' + exCountLabel + '</span>' +
                  '<span>Explore Examples &rarr;</span>' +
                '</div>' +
              '</div>' +
            '</button>';
        }
        grid.innerHTML = html;

        var cards = grid.querySelectorAll('[data-lang-id]');
        for (var k = 0; k < cards.length; k++) {
          cards[k].addEventListener('click', function(ev) {
            var langId = ev.currentTarget.getAttribute('data-lang-id');
            if (langId) window.selectLanguage(langId, true);
          });
        }
      }

      window.selectLanguage = function(langId, pushHistory) {
        var lang = null;
        for (var i = 0; i < CATALOG.languages.length; i++) {
          if (CATALOG.languages[i].id === langId) {
            lang = CATALOG.languages[i];
            break;
          }
        }
        if (!lang) return;

        if (pushHistory && window.history && window.history.pushState) {
          window.history.pushState({ lang: langId }, '', '?lang=' + encodeURIComponent(langId));
        }

        var l1 = document.getElementById('level-1-view');
        var l2 = document.getElementById('level-2-view');
        if (l1) l1.classList.add('hidden');
        if (l2) l2.classList.remove('hidden');

        var badgeEl = document.getElementById('level2-badge');
        var titleEl = document.getElementById('level2-title');
        var extEl = document.getElementById('level2-ext');
        var sumEl = document.getElementById('level2-summary');
        var docsEl = document.getElementById('level2-docs-link');
        var exCountEl = document.getElementById('example-count-badge');
        var exGrid = document.getElementById('example-tiles-grid');

        if (badgeEl) {
          badgeEl.className = 'ms-tile-badge tone-' + lang.tone;
          badgeEl.textContent = lang.badge;
        }
        if (titleEl) titleEl.textContent = lang.name + ' — ' + lang.role;
        if (extEl) extEl.textContent = lang.ext;
        if (sumEl) sumEl.textContent = lang.summary;
        if (docsEl) docsEl.setAttribute('href', lang.docsUrl);

        var examples = getExamplesForLanguage(lang.id);
        if (exCountEl) {
          exCountEl.textContent = examples.length + (examples.length === 1 ? ' Verified Example' : ' Verified Examples');
        }

        if (exGrid) {
          var html = '';
          for (var j = 0; j < examples.length; j++) {
            var ex = examples[j];
            var filesHtml = '';
            for (var f = 0; f < ex.fileList.length; f++) {
              filesHtml += '<span class="ms-file-chip">' + ex.fileList[f] + '</span>';
            }
            var capsHtml = '';
            for (var c = 0; c < ex.capabilities.length; c++) {
              capsHtml += '<span class="ms-cap-pill">&check; ' + ex.capabilities[c] + '</span>';
            }
            html +=
              '<a href="/vscode/workbench/#memfs:' + ex.id + '" class="ms-tile" data-example-id="' + ex.id + '">' +
                '<div>' +
                  '<div class="ms-tile-top">' +
                    '<span class="ms-tile-badge tone-' + ex.tone + '">' + ex.badge + '</span>' +
                    '<span class="ms-tile-ext">' + ex.primaryFile + '</span>' +
                  '</div>' +
                  '<div class="ms-tile-title">' + ex.title + '</div>' +
                  '<div class="ms-tile-summary">' + ex.summary + '</div>' +
                  '<div class="ms-file-list">' + filesHtml + '</div>' +
                '</div>' +
                '<div>' +
                  '<div class="ms-cap-pills" style="margin-bottom: 0.85rem;">' + capsHtml + '</div>' +
                  '<div class="ms-tile-footer">' +
                    '<span>memfs://' + ex.id + '</span>' +
                    '<span>Open in IDE &rarr;</span>' +
                  '</div>' +
                '</div>' +
              '</a>';
          }
          exGrid.innerHTML = html;
        }
      };

      window.showAllLanguages = function() {
        if (window.history && window.history.pushState) {
          window.history.pushState({}, '', window.location.pathname);
        }
        var l1 = document.getElementById('level-1-view');
        var l2 = document.getElementById('level-2-view');
        if (l2) l2.classList.add('hidden');
        if (l1) l1.classList.remove('hidden');
      };

      var searchEl = document.getElementById('lang-search-input');
      if (searchEl) {
        searchEl.addEventListener('input', function(ev) {
          searchQuery = ev.target.value || '';
          renderLanguageTiles();
        });
      }

      window.addEventListener('popstate', function() {
        var params = new URLSearchParams(window.location.search);
        var langParam = params.get('lang');
        if (langParam) {
          window.selectLanguage(langParam, false);
        } else {
          var l1 = document.getElementById('level-1-view');
          var l2 = document.getElementById('level-2-view');
          if (l2) l2.classList.add('hidden');
          if (l1) l1.classList.remove('hidden');
        }
      });

      renderFilterPills();
      renderLanguageTiles();

      var initParams = new URLSearchParams(window.location.search);
      var initLang = initParams.get('lang');
      if (initLang) {
        window.selectLanguage(initLang, false);
      }
    })();
  </script>
</body>
</html>`;
}
