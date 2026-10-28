// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as vscode from "vscode";
import { droneStepContent } from "./assets/drone-step-content.js";

interface GlobalWithVsCode {
  vscode?: {
    Uri?: {
      joinPath?: (base: vscode.Uri, ...pathSegments: string[]) => vscode.Uri;
    };
  };
}

function joinPath(base: vscode.Uri, ...pathSegments: string[]): vscode.Uri {
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

export interface IMemoryFileSystemProvider {
  writeFile(uri: vscode.Uri, content: Uint8Array): void;
  writeFiles?(entries: [vscode.Uri, Uint8Array][]): void;
}

export interface ArtifactWorkspaceDescriptor {
  artifactId: string | number;
  title?: string | undefined;
  viewType?: string | undefined;
  viewConfig?: Record<string, unknown> | undefined;
}

export interface GeneratedWorkspace {
  files: Record<string, string>;
  primaryFile: string;
}

export type CatalogTone = "teal" | "indigo" | "amber" | "emerald" | "rose" | "sky";

export interface LanguageGroupDescriptor {
  id: string;
  label: string;
  tone: CatalogTone;
}

export interface LanguageTileDescriptor {
  id: string;
  name: string;
  badge: string;
  ext: string;
  group: string;
  tone: CatalogTone;
  role: string;
  summary: string;
  capabilities: string[];
  docsUrl: string;
  defaultTemplateId: string;
}

export interface ExampleWorkspaceDescriptor {
  id: string;
  languageId: string;
  title: string;
  summary: string;
  badge: string;
  tone: CatalogTone;
  ext: string;
  primaryFile: string;
  capabilities: string[];
  files: Record<string, string>;
}

const artifactRegistry = new Map<string, ArtifactWorkspaceDescriptor>();

export function registerArtifactDescriptor(descriptor: ArtifactWorkspaceDescriptor): void {
  artifactRegistry.set(String(descriptor.artifactId), descriptor);
}

export function getArtifactDescriptor(artifactId: string | number): ArtifactWorkspaceDescriptor | undefined {
  return artifactRegistry.get(String(artifactId));
}

export function clearArtifactRegistry(): void {
  artifactRegistry.clear();
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

// ── 15 Domain Categories (Matching Docs Site) ──────────────────────────────

export const LANGUAGE_GROUPS: LanguageGroupDescriptor[] = [
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

const STANDARD_CAPABILITIES = [
  "Syntax & Semantic Tokens",
  "WASM GLR Lints",
  "CodeLens",
  "Interactive Diagram",
  "Verification & Simulation",
];

// ── Level 1: 44 Polyglot Language Tiles ────────────────────────────────────

export const LANGUAGE_TILES: LanguageTileDescriptor[] = [
  // 1. Core Systems & Architecture
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
    docsUrl: "https://modelscript.org/languages/owl2",
    defaultTemplateId: "owl2-units",
  },

  // 2. 3D Geometry, FEA & CFD
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
    docsUrl: "https://modelscript.org/languages/fea",
    defaultTemplateId: "fea-chassis",
  },

  // 3. Embedded, HPC & Telemetry
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
    docsUrl: "https://modelscript.org/languages/fortran",
    defaultTemplateId: "fortran-nozzle",
  },

  // 4. Aerospace & Space Systems
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
    docsUrl: "https://modelscript.org/languages/easy5",
    defaultTemplateId: "easy5-flight-control",
  },

  // 5. Automotive & Autonomy
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
    docsUrl: "https://modelscript.org/languages/openscenario",
    defaultTemplateId: "openscenario-cut-in",
  },

  // 6. Rail & Multibody Dynamics
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
    docsUrl: "https://modelscript.org/languages/simpack",
    defaultTemplateId: "simpack-suspension",
  },

  // 7. Power Grids & Energy
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
    docsUrl: "https://modelscript.org/languages/opendss",
    defaultTemplateId: "opendss-ieee4",
  },

  // 8. Oil, Gas & Subsurface
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
    docsUrl: "https://modelscript.org/languages/eclipse",
    defaultTemplateId: "eclipse-brent",
  },

  // 9. Nuclear Thermal-Hydraulics
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
    capabilities: STANDARD_CAPABILITIES,
    docsUrl: "https://modelscript.org/languages/relap5",
    defaultTemplateId: "relap5-pwr",
  },

  // 10. Marine & Offshore
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
    capabilities: STANDARD_CAPABILITIES,
    docsUrl: "https://modelscript.org/languages/sima",
    defaultTemplateId: "sima-oc4",
  },

  // 11. Electronics, RF & Semiconductors
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
    capabilities: STANDARD_CAPABILITIES,
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
      "Behavioral analog compact device models (`V(p,n) <+ ...`) with symbolic Jacobian differentiation and Modelica connector lowering.",
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
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
      "Multi-port frequency-domain scattering parameters (`.s1p`–`.s4p`) with passivity singular-value checks, reciprocity, and rational vector fitting.",
    capabilities: STANDARD_CAPABILITIES,
    docsUrl: "https://modelscript.org/languages/touchstone",
    defaultTemplateId: "touchstone-filter",
  },

  // 12. Robotics & Industrial Automation
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
    docsUrl: "https://modelscript.org/languages/adams",
    defaultTemplateId: "adams-pendulum",
  },

  // 13. Buildings, Water & Civil
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
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
    capabilities: STANDARD_CAPABILITIES,
    docsUrl: "https://modelscript.org/languages/swmm",
    defaultTemplateId: "swmm-drainage",
  },

  // 14. Chemical & Process Engineering
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
    capabilities: STANDARD_CAPABILITIES,
    docsUrl: "https://modelscript.org/languages/aspen",
    defaultTemplateId: "aspen-methanol",
  },

  // 15. Systems Biology & Pharmacology
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
    capabilities: STANDARD_CAPABILITIES,
    docsUrl: "https://modelscript.org/languages/sbml",
    defaultTemplateId: "sbml-enzyme",
  },
];

// ── Level 2: Verified Example Workspaces Across All 44 Languages ───────────

export const EXAMPLE_TEMPLATES: ExampleWorkspaceDescriptor[] = [
  // 1. ModelScript (.msx)
  {
    id: "modelscript-control",
    languageId: "modelscript",
    title: "Thermal Flight Actuator Kernel",
    summary: "Typed ModelScript struct, physical constants, and closed-loop actuator thermal control law.",
    badge: "MSX",
    tone: "teal",
    ext: ".msx",
    primaryFile: "control_loop.msx",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "control_loop.msx": [
        "struct ActuatorState {",
        "  position: f64;",
        "  velocity: f64;",
        "  temperature: f64;",
        "}",
        "",
        "const MAX_THRUST: f64 = 120.0;",
        "const AMBIENT_TEMP: f64 = 293.15;",
        "const GAIN_KP: f64 = 18.5;",
        "const GAIN_KD: f64 = 4.2;",
        "",
        "function computeCommand(target: f64, pos: f64, vel: f64): f64 {",
        "  let err: f64 = target - pos;",
        "  let cmd: f64 = GAIN_KP * err - GAIN_KD * vel;",
        "  return cmd;",
        "}",
        "",
        "function thermalStep(temp: f64, power: f64, dt: f64): f64 {",
        "  let cooling: f64 = 0.15 * (temp - AMBIENT_TEMP);",
        "  let nextTemp: f64 = temp + dt * (0.08 * power - cooling);",
        "  return nextTemp;",
        "}",
        "",
      ].join("\n"),
      "README.md":
        "# Thermal Flight Actuator Kernel (`.msx`)\n\nVerified native ModelScript workspace with struct declarations, typed constants, and control functions.\n",
    },
  },

  // 2. Modelica (.mo) — 3 Verified Examples
  {
    id: "bouncing-ball",
    languageId: "modelica",
    title: "Hybrid Bouncing Ball Dynamics",
    summary:
      "Classic hybrid continuous/discrete contact model with event detection (`when h <= 0`) and state reinitialization (`reinit`).",
    badge: "MO",
    tone: "teal",
    ext: ".mo",
    primaryFile: "BouncingBall.mo",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "BouncingBall.mo": [
        'model BouncingBall "Hybrid bouncing ball with restitution coefficient"',
        '  parameter Real e = 0.8 "Coefficient of restitution";',
        '  parameter Real g = 9.81 "Gravitational acceleration [m/s2]";',
        '  Real h(start = 10.0, fixed = true) "Altitude above ground [m]";',
        '  Real v(start = 0.0, fixed = true) "Vertical velocity [m/s]";',
        "equation",
        "  der(h) = v;",
        "  der(v) = -g;",
        "  when h <= 0.0 then",
        "    reinit(v, -e * pre(v));",
        "  end when;",
        "end BouncingBall;",
        "",
      ].join("\n"),
      "README.md":
        "# Hybrid Bouncing Ball (`.mo`)\n\nDemonstrates Modelica hybrid DAE simulation, zero-crossing event detection, and interactive diagram inspection.\n",
    },
  },
  {
    id: "rlc",
    languageId: "modelica",
    title: "RLC Resonant Electrical Circuit",
    summary:
      "Acausal electrical schematic using `Modelica.Electrical.Analog` components with full `Placement` and `Line` diagram annotations.",
    badge: "MO",
    tone: "teal",
    ext: ".mo",
    primaryFile: "RLC.mo",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "RLC.mo": [
        'model RLC "RLC circuit with MSL components"',
        "  Modelica.Electrical.Analog.Sources.SineVoltage Vb(V = 10, f = 50)",
        "    annotation(Placement(transformation(origin = {-70, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));",
        "  Modelica.Electrical.Analog.Basic.Inductor L(L = 0.5)",
        "    annotation(Placement(transformation(origin = {0, 40}, extent = {{-10, -10}, {10, 10}})));",
        "  Modelica.Electrical.Analog.Basic.Capacitor C(C = 1e-4)",
        "    annotation(Placement(transformation(origin = {20, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));",
        "  Modelica.Electrical.Analog.Basic.Resistor R(R = 100)",
        "    annotation(Placement(transformation(origin = {60, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));",
        "  Modelica.Electrical.Analog.Basic.Ground ground",
        "    annotation(Placement(transformation(origin = {-70, -40}, extent = {{-10, -10}, {10, 10}})));",
        "equation",
        "  connect(Vb.p, L.p)",
        "    annotation(Line(points = {{-70, 10}, {-70, 40}, {-10, 40}}, color = {0, 0, 255}));",
        "  connect(L.n, C.p)",
        "    annotation(Line(points = {{10, 40}, {20, 40}, {20, 10}}, color = {0, 0, 255}));",
        "  connect(L.n, R.p)",
        "    annotation(Line(points = {{10, 40}, {60, 40}, {60, 10}}, color = {0, 0, 255}));",
        "  connect(R.n, Vb.n)",
        "    annotation(Line(points = {{60, -10}, {60, -30}, {-70, -30}, {-70, -10}}, color = {0, 0, 255}));",
        "  connect(C.n, Vb.n)",
        "    annotation(Line(points = {{20, -10}, {20, -30}, {-70, -30}, {-70, -10}}, color = {0, 0, 255}));",
        "  connect(Vb.n, ground.p)",
        "    annotation(Line(points = {{-70, -10}, {-70, -30}}, color = {0, 0, 255}));",
        "end RLC;",
        "",
      ].join("\n"),
      "modelscript.json": JSON.stringify(
        {
          name: "@modelscript/example-rlc",
          version: "1.0.0",
          title: "RLC Circuit",
          description: "RLC circuit with Modelica Standard Library components",
          dependencies: { Modelica: "4.1.0" },
        },
        null,
        2,
      ),
    },
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "cad/drone.step": droneStepContent,
      "cad/drone.scad": [
        "// Parametric Drone Airframe with Winglets & Aerodynamic Rotor Shrouds",
        "arm_length = 180.0;",
        "arm_width = 24.0;",
        "arm_thickness = 4.2;",
        "rotor_radius = 65.0;",
        "winglet_chord = 25.0;",
        "hub_radius = 35.0;",
        "hub_height = 28.0;",
        "",
        "module rotor_shroud(r = rotor_radius, chord = winglet_chord) {",
        "  difference() {",
        "    cylinder(r = r + 4.0, h = chord, center = true);",
        "    cylinder(r = r, h = chord + 1.0, center = true);",
        "  }",
        "}",
        "",
        "cylinder(r = hub_radius, h = hub_height, center = true);",
        "",
      ].join("\n"),
      "cae/drone_chassis.inp": [
        "*HEADING",
        "ModelScript Drone Chassis Carbon-Composite Arm Stress",
        "*NODE, NSET=NALL",
        "1,  0.000,  0.000,  0.000",
        "2,  0.035,  0.000,  0.000",
        "3,  0.180,  0.012,  0.002",
        "4,  0.180, -0.012,  0.002",
        "5,  0.195,  0.000,  0.003",
        "101, -0.035, 0.000, 0.000",
        "102, -0.180, 0.012, 0.002",
        "103, -0.195, 0.000, 0.003",
        "*ELEMENT, TYPE=C3D8R, ELSET=ECHASSIS",
        "1, 1, 2, 3, 4, 101, 102, 103, 5",
        "*MATERIAL, NAME=CARBON_EPOXY",
        "*ELASTIC",
        " 7.000000e+10, 0.330",
        "*DENSITY",
        " 2.700000e+03",
        "*BOUNDARY",
        "1, 1, 6, 0.0",
        "*SOLID SECTION, ELSET=ECHASSIS, MATERIAL=CARBON_EPOXY",
        "*STEP",
        "*STATIC",
        "*CLOAD",
        "5, 3, 8.500",
        "*END STEP",
        "",
      ].join("\n"),
      "cae/drone_aero.cfg": [
        "SOLVER= INC_RANS",
        "KIND_TURB_MODEL= SST",
        "MATH_PROBLEM= DIRECT",
        "RESTART_SOL= NO",
        "INC_DENSITY_MODEL= CONSTANT",
        "INC_DENSITY_INIT= 1.225",
        "INC_VELOCITY_INIT= ( 0.0, 0.0, 10.0 )",
        "INC_TEMPERATURE_INIT= 288.15",
        "VISCOSITY_MODEL= CONSTANT_VISCOSITY",
        "MU_CONSTANT= 1.81e-5",
        "REF_LENGTH= 0.360",
        "REF_AREA= 0.030",
        "ITER= 250",
        "",
      ].join("\n"),
      "sysml/drone_specs.sysml": [
        "package DroneReachabilitySystem {",
        "  import ScalarValues::*;",
        "  port def MechanicalFlange;",
        "  part def AvionicsHub {",
        "    attribute mass : Real = 37.0;",
        "    port hubMount : MechanicalFlange;",
        "  }",
        "  part def QuadArm {",
        "    attribute length : Real = 750.0;",
        "    attribute thickness : Real = 12.0;",
        "    attribute mass : Real = 2.0;",
        "    port baseFlange : MechanicalFlange;",
        "    port motorMount : MechanicalFlange;",
        "  }",
        "  part def DroneAssembly {",
        "    attribute totalMass : Real = 45.0;",
        "    attribute totalFrontalArea : Real = 0.600;",
        "    attribute aeroDragCoeff : Real = 0.80;",
        "    part hub : AvionicsHub;",
        "    part arms : QuadArm[4];",
        "  }",
        "  requirement def FlightCeilingRequirement {",
        "    attribute v_climb : Real;",
        "    attribute v_climb_max : Real = 4.0;",
        "    attribute z_target : Real = 11.0;",
        "    subject drone : DroneAssembly;",
        "    require constraint {",
        "      v_climb <= v_climb_max",
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
      "modelica/DroneSimulation.mo": [
        'model DroneSimulation "Drone flight dynamics linked to SysML v2, CAD, FEA, and CFD"',
        '  parameter Real m = 1.2 "Total mass [kg]";',
        '  parameter Real A = 0.60 "Frontal area [m2]";',
        '  parameter Real Cd = 0.80 "Drag coefficient";',
        '  parameter Real rho = 1.225 "Air density [kg/m3]";',
        '  parameter Real z_target = 10.0 "Ceiling altitude setpoint [m]";',
        '  parameter Real kz = 24.0 "Altitude feedback gain [N/m]";',
        '  parameter Real kv = 44.0 "Velocity damping gain [N/(m/s)]";',
        '  Real z(start = 0.0, fixed = true) "Altitude [m]";',
        '  Real v(start = 0.0, fixed = true) "Vertical climb velocity [m/s]";',
        '  input Real w(min = -0.50, max = 0.50, start = 0.0) "Wind gust disturbance [N]";',
        "equation",
        "  der(z) = v;",
        "  der(v) = (kz * (z_target - z) - kv * v - 0.5 * Cd * rho * A * v * abs(v) + w) / m;",
        "end DroneSimulation;",
        "",
      ].join("\n"),
      "modelscript.json": JSON.stringify(
        {
          name: "@modelscript/example-drone-reachability",
          version: "1.0.0",
          title: "Polyglot Drone Reachability Verification",
          workspace: {
            cad: "cad/drone.scad",
            fea: "cae/drone_chassis.inp",
            cfd: "cae/drone_aero.cfg",
            sysml: "sysml/drone_specs.sysml",
            modelica: "modelica/DroneSimulation.mo",
          },
        },
        null,
        2,
      ),
    },
  },

  // 3. SysML v2 (.sysml)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "VehicleSystem.sysml": [
        "package VehicleSystem {",
        "  port def TorquePort {",
        "    attribute torqueValue : Real;",
        "  }",
        "  port def ElectricalPort {",
        "    attribute voltage : Real;",
        "    attribute current : Real;",
        "  }",
        "  port def FuelPort {",
        "    attribute flowRate : Real;",
        "  }",
        "  part def Engine {",
        "    attribute horsePower : Real = 220.0;",
        "    attribute displacement : Real = 2.0;",
        "    port torqueOut : TorquePort;",
        "    port fuelIn : FuelPort;",
        "  }",
        "  part def Transmission {",
        "    attribute gearRatio : Real = 3.42;",
        "    attribute numberOfGears : Integer = 8;",
        "    port torqueIn : TorquePort;",
        "    port torqueOut : TorquePort;",
        "  }",
        "  part def Battery {",
        "    attribute capacity : Real = 75.0;",
        "    attribute voltage : Real = 400.0;",
        "    port electricalOut : ElectricalPort;",
        "  }",
        "  part def FuelTank {",
        "    attribute capacity : Real = 55.0;",
        "    port fuelOut : FuelPort;",
        "  }",
        "  part def Vehicle {",
        "    attribute mass : Real = 1680.0;",
        "    attribute topSpeed : Real = 210.0;",
        "    part engine : Engine;",
        "    part transmission : Transmission;",
        "    part battery : Battery;",
        "    part fuelTank : FuelTank;",
        "    connect engine.torqueOut to transmission.torqueIn;",
        "    connect fuelTank.fuelOut to engine.fuelIn;",
        "  }",
        "}",
        "",
      ].join("\n"),
    },
  },

  // 4. ReqIF (.reqif)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "avionics_safety.reqif": [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">',
        "  <THE-HEADER>",
        '    <REQ-IF-HEADER IDENTIFIER="HDR-FCS-001">',
        "      <CREATION-TIME>2026-10-26T00:00:00Z</CREATION-TIME>",
        "      <REQ-IF-TOOL-ID>ModelScript ReqIF Studio</REQ-IF-TOOL-ID>",
        "      <REQ-IF-VERSION>1.2</REQ-IF-VERSION>",
        "      <SOURCE-TOOL-ID>ModelScript</SOURCE-TOOL-ID>",
        "      <TITLE>Primary Flight Control System Safety Requirements</TITLE>",
        "    </REQ-IF-HEADER>",
        "  </THE-HEADER>",
        "  <CORE-CONTENT>",
        "    <REQ-IF-CONTENT>",
        "      <DATATYPES>",
        '        <DATATYPE-DEFINITION-STRING IDENTIFIER="DT-STR" LONG-NAME="String" MAX-LENGTH="4096"/>',
        "      </DATATYPES>",
        "      <SPEC-TYPES>",
        '        <SPEC-OBJECT-TYPE IDENTIFIER="SOT-REQ" LONG-NAME="SafetyRequirement">',
        "          <SPEC-ATTRIBUTES>",
        '            <ATTRIBUTE-DEFINITION-STRING IDENTIFIER="AD-TEXT" LONG-NAME="ReqIF.Text">',
        "              <TYPE><DATATYPE-DEFINITION-STRING-REF>DT-STR</DATATYPE-DEFINITION-STRING-REF></TYPE>",
        "            </ATTRIBUTE-DEFINITION-STRING>",
        "          </SPEC-ATTRIBUTES>",
        "        </SPEC-OBJECT-TYPE>",
        '        <SPEC-RELATION-TYPE IDENTIFIER="SRT-DERIVES" LONG-NAME="DerivesFrom"/>',
        '        <SPECIFICATION-TYPE IDENTIFIER="ST-DOC" LONG-NAME="RequirementSpecification"/>',
        "      </SPEC-TYPES>",
        "      <SPEC-OBJECTS>",
        '        <SPEC-OBJECT IDENTIFIER="REQ-FCS-101" LONG-NAME="PitchRateDampingLimit">',
        "          <VALUES>",
        '            <ATTRIBUTE-VALUE-STRING THE-VALUE="The flight control system shall maintain pitch rate damping ratio >= 0.65 across the flight envelope.">',
        "              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>AD-TEXT</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>",
        "            </ATTRIBUTE-VALUE-STRING>",
        "          </VALUES>",
        "          <TYPE><SPEC-OBJECT-TYPE-REF>SOT-REQ</SPEC-OBJECT-TYPE-REF></TYPE>",
        "        </SPEC-OBJECT>",
        '        <SPEC-OBJECT IDENTIFIER="REQ-FCS-102" LONG-NAME="ActuatorSlewRateLimit">',
        "          <VALUES>",
        '            <ATTRIBUTE-VALUE-STRING THE-VALUE="The elevator actuator command rate shall not exceed 45.0 deg/s under gust recovery.">',
        "              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>AD-TEXT</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>",
        "            </ATTRIBUTE-VALUE-STRING>",
        "          </VALUES>",
        "          <TYPE><SPEC-OBJECT-TYPE-REF>SOT-REQ</SPEC-OBJECT-TYPE-REF></TYPE>",
        "        </SPEC-OBJECT>",
        "      </SPEC-OBJECTS>",
        "      <SPEC-RELATIONS>",
        '        <SPEC-RELATION IDENTIFIER="REL-001" LONG-NAME="ActuatorDerivesFromPitch">',
        "          <SOURCE><SPEC-OBJECT-REF>REQ-FCS-102</SPEC-OBJECT-REF></SOURCE>",
        "          <TARGET><SPEC-OBJECT-REF>REQ-FCS-101</SPEC-OBJECT-REF></TARGET>",
        "          <TYPE><SPEC-RELATION-TYPE-REF>SRT-DERIVES</SPEC-RELATION-TYPE-REF></TYPE>",
        "        </SPEC-RELATION>",
        "      </SPEC-RELATIONS>",
        "      <SPECIFICATIONS>",
        '        <SPECIFICATION IDENTIFIER="SPEC-FCS" LONG-NAME="Flight Control SRS">',
        "          <TYPE><SPECIFICATION-TYPE-REF>ST-DOC</SPECIFICATION-TYPE-REF></TYPE>",
        "          <CHILDREN>",
        '            <SPEC-HIERARCHY IDENTIFIER="SH-101"><OBJECT><SPEC-OBJECT-REF>REQ-FCS-101</SPEC-OBJECT-REF></OBJECT></SPEC-HIERARCHY>',
        '            <SPEC-HIERARCHY IDENTIFIER="SH-102"><OBJECT><SPEC-OBJECT-REF>REQ-FCS-102</SPEC-OBJECT-REF></OBJECT></SPEC-HIERARCHY>',
        "          </CHILDREN>",
        "        </SPECIFICATION>",
        "      </SPECIFICATIONS>",
        "    </REQ-IF-CONTENT>",
        "  </CORE-CONTENT>",
        "</REQ-IF>",
        "",
      ].join("\n"),
    },
  },

  // 5. SSP (.ssd)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "SystemStructure.ssd": [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription"',
        '                                xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"',
        '                                name="Microgrid_IBR"',
        '                                version="1.0">',
        '  <ssd:System name="Microgrid_IBR">',
        "    <ssd:Elements>",
        '      <ssd:Component name="GridPassiveNetwork" source="resources/GridNetwork.fmu">',
        "        <ssd:Connectors>",
        '          <ssd:Connector name="B3_v" kind="output"><ssc:Real unit="kV" /></ssd:Connector>',
        '          <ssd:Connector name="B3_i" kind="input"><ssc:Real unit="A" /></ssd:Connector>',
        "        </ssd:Connectors>",
        "      </ssd:Component>",
        '      <ssd:Component name="Solar_BESS_IBR_100MVA" source="resources/SolarInverter.fmu">',
        "        <ssd:Connectors>",
        '          <ssd:Connector name="v_poi" kind="input"><ssc:Real unit="kV" /></ssd:Connector>',
        '          <ssd:Connector name="i_inj" kind="output"><ssc:Real unit="A" /></ssd:Connector>',
        '          <ssd:Connector name="p_mw" kind="parameter"><ssc:Real value="90" /></ssd:Connector>',
        "        </ssd:Connectors>",
        "      </ssd:Component>",
        "    </ssd:Elements>",
        "    <ssd:Connections>",
        '      <ssd:Connection startElement="GridPassiveNetwork" startConnector="B3_v" endElement="Solar_BESS_IBR_100MVA" endConnector="v_poi" />',
        '      <ssd:Connection startElement="Solar_BESS_IBR_100MVA" startConnector="i_inj" endElement="GridPassiveNetwork" endConnector="B3_i" />',
        "    </ssd:Connections>",
        "  </ssd:System>",
        "</ssd:SystemStructureDescription>",
        "",
      ].join("\n"),
    },
  },

  // 6. OWL 2 (.owl)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "unit_ontology.owl": [
        "Prefix(mo: = <http://modelscript.org/modelica#>)",
        "Prefix(unit: = <http://modelscript.org/units#>)",
        "Ontology(<http://modelscript.org/examples/units>",
        "  Declaration(Class(unit:SIUnit))",
        "  Declaration(Class(unit:PressureUnit))",
        "  Declaration(Class(unit:TemperatureUnit))",
        "  Declaration(Class(unit:ForceUnit))",
        "  SubClassOf(unit:PressureUnit unit:SIUnit)",
        "  SubClassOf(unit:TemperatureUnit unit:SIUnit)",
        "  SubClassOf(unit:ForceUnit unit:SIUnit)",
        "  DisjointClasses(unit:PressureUnit unit:TemperatureUnit)",
        "  DisjointClasses(unit:PressureUnit unit:ForceUnit)",
        "  Declaration(NamedIndividual(unit:Pascal))",
        "  Declaration(NamedIndividual(unit:Kelvin))",
        "  Declaration(NamedIndividual(unit:Newton))",
        "  ClassAssertion(unit:PressureUnit unit:Pascal)",
        "  ClassAssertion(unit:TemperatureUnit unit:Kelvin)",
        "  ClassAssertion(unit:ForceUnit unit:Newton)",
        ")",
        "",
      ].join("\n"),
    },
  },

  // 7. STEP (.step)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "SimplePendulum.step": droneStepContent,
    },
  },

  // 8. OpenSCAD (.scad)
  {
    id: "scad-airframe",
    languageId: "scad",
    title: "Parametric Quadcopter Airframe CSG",
    summary: "OpenSCAD parametric carbon-fiber drone hub and rotor shroud geometry with tagged ports for FEA and CFD.",
    badge: "SCD",
    tone: "teal",
    ext: ".scad",
    primaryFile: "drone.scad",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "drone.scad": [
        "arm_length = 180.0;",
        "arm_width = 24.0;",
        "arm_thickness = 4.2;",
        "rotor_radius = 65.0;",
        "winglet_chord = 25.0;",
        "hub_radius = 35.0;",
        "hub_height = 28.0;",
        "",
        "module rotor_shroud(r = rotor_radius, chord = winglet_chord) {",
        "  difference() {",
        "    cylinder(r = r + 4.0, h = chord, center = true);",
        "    cylinder(r = r, h = chord + 1.0, center = true);",
        "  }",
        "}",
        "",
        "difference() {",
        "  cylinder(r = hub_radius, h = hub_height, center = true);",
        "  cylinder(r = hub_radius - 3.5, h = hub_height + 2.0, center = true);",
        "}",
        "",
      ].join("\n"),
    },
  },

  // 9. CFD (.cfg)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "drone_aero.cfg": [
        "SOLVER= INC_RANS",
        "KIND_TURB_MODEL= SST",
        "MATH_PROBLEM= DIRECT",
        "RESTART_SOL= NO",
        "INC_DENSITY_MODEL= CONSTANT",
        "INC_DENSITY_INIT= 1.225",
        "INC_VELOCITY_INIT= ( 0.0, 0.0, 10.0 )",
        "INC_TEMPERATURE_INIT= 288.15",
        "VISCOSITY_MODEL= CONSTANT_VISCOSITY",
        "MU_CONSTANT= 1.81e-5",
        "REF_LENGTH= 0.360",
        "REF_AREA= 0.030",
        "MARKER_HEATFLUX= ( chassis_wall, 0.0 )",
        "MARKER_INLET= ( rotor_stream, 293.15, 12.0, 0.0, 0.0, -1.0 )",
        "MARKER_OUTLET= ( farfield_boundary, 101325.0 )",
        "CONV_FIELD= RMS_PRESSURE",
        "CONV_RESIDUAL_MINVAL= -8",
        "ITER= 250",
        "",
      ].join("\n"),
    },
  },

  // 10. FEA (.inp)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "drone_chassis.inp": [
        "*HEADING",
        "ModelScript Drone Chassis Carbon-Composite Arm Stress",
        "*NODE, NSET=NALL",
        "1,  0.000,  0.000,  0.000",
        "2,  0.035,  0.000,  0.000",
        "3,  0.180,  0.012,  0.002",
        "4,  0.180, -0.012,  0.002",
        "5,  0.195,  0.000,  0.003",
        "101, -0.035, 0.000, 0.000",
        "102, -0.180, 0.012, 0.002",
        "103, -0.195, 0.000, 0.003",
        "*ELEMENT, TYPE=C3D8R, ELSET=ECHASSIS",
        "1, 1, 2, 3, 4, 101, 102, 103, 5",
        "*MATERIAL, NAME=CARBON_EPOXY",
        "*ELASTIC",
        " 7.000000e+10, 0.330",
        "*DENSITY",
        " 2.700000e+03",
        "*BOUNDARY",
        "1, 1, 6, 0.0",
        "*SOLID SECTION, ELSET=ECHASSIS, MATERIAL=CARBON_EPOXY",
        "*STEP",
        "*STATIC",
        "*CLOAD",
        "5, 3, 8.500",
        "*END STEP",
        "",
      ].join("\n"),
    },
  },

  // 11. CSV (.csv)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "flight_telemetry.csv": [
        "time,altitude,velocity,thrust",
        "0.0,0.00,0.00,18.4",
        "0.5,0.62,2.15,17.8",
        "1.0,1.95,3.10,16.2",
        "1.5,3.58,3.41,14.9",
        "2.0,5.24,3.22,13.5",
        "2.5,6.75,2.78,12.4",
        "3.0,7.98,2.14,11.9",
        "3.5,8.89,1.48,11.8",
        "4.0,9.48,0.92,11.7",
        "",
      ].join("\n"),
    },
  },

  // 12. Embedded C (.c)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "pid_controller.c": [
        "// Embedded Flight Autopilot Altitude Controller",
        "double clamp_cmd(double u, double u_min, double u_max) {",
        "  if (u > u_max) {",
        "    return u_max;",
        "  }",
        "  if (u < u_min) {",
        "    return u_min;",
        "  }",
        "  return u;",
        "}",
        "",
        "double compute_altitude_pid(double z_ref, double z_meas, double v_meas) {",
        "  double kp = 24.0;",
        "  double kv = 44.0;",
        "  double err = z_ref - z_meas;",
        "  double thrust_cmd = kp * err - kv * v_meas;",
        "  return clamp_cmd(thrust_cmd, -120.0, 120.0);",
        "}",
        "",
      ].join("\n"),
    },
  },

  // 13. Modern Fortran (.f90)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "nozzle_flow.f90": [
        "subroutine nozzle_thrust(pc, at, cf, p_amb, ae, thrust)",
        "  implicit none",
        "  real(8), intent(in) :: pc, at, cf, p_amb, ae",
        "  real(8), intent(out) :: thrust",
        "  real(8) :: momentum_term, pressure_term",
        "  momentum_term = cf * pc * at",
        "  pressure_term = p_amb * ae",
        "  thrust = momentum_term - pressure_term",
        "end subroutine nozzle_thrust",
        "",
      ].join("\n"),
    },
  },

  // 14. JSBSim (.jsbsim)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "c172p.jsbsim": [
        '<?xml version="1.0"?>',
        '<fdm_config name="c172p" version="2.0" release="BETA">',
        "  <fileheader>",
        "    <author>ModelScript Aerospace</author>",
        "    <description>Cessna 172P Skyhawk 6-DOF Flight Dynamics Model</description>",
        "  </fileheader>",
        "  <metrics>",
        '    <wingarea unit="FT2"> 174.0 </wingarea>',
        '    <wingspan unit="FT"> 35.8 </wingspan>',
        '    <chord unit="FT"> 4.9 </chord>',
        '    <location name="AERORP" unit="IN"><x> 43.2 </x><y> 0.0 </y><z> 59.4 </z></location>',
        "  </metrics>",
        "  <mass_balance>",
        '    <ixx unit="SLUG*FT2"> 948.0 </ixx>',
        '    <iyy unit="SLUG*FT2"> 1346.0 </iyy>',
        '    <izz unit="SLUG*FT2"> 1967.0 </izz>',
        '    <emptywt unit="LBS"> 1620.0 </emptywt>',
        '    <location name="CG" unit="IN"><x> 41.0 </x><y> 0.0 </y><z> 36.5 </z></location>',
        "  </mass_balance>",
        "  <ground_reactions>",
        '    <contact type="BOGEY" name="NOSE">',
        '      <location unit="IN"><x> -6.8 </x><y> 0.0 </y><z> -19.8 </z></location>',
        '      <spring_coeff unit="LBS/FT"> 1800.0 </spring_coeff>',
        '      <damping_coeff unit="LBS/FT/SEC"> 600.0 </damping_coeff>',
        "    </contact>",
        "  </ground_reactions>",
        "  <propulsion>",
        '    <engine file="eng_io320">',
        '      <thruster file="prop_clark_y">',
        '        <location unit="IN"><x> -37.0 </x><y> 0.0 </y><z> 26.0 </z></location>',
        "      </thruster>",
        "    </engine>",
        "  </propulsion>",
        '  <flight_control name="FGFCS">',
        '    <channel name="Pitch">',
        '      <summer name="Pitch Trim Sum">',
        "        <input>fcs/elevator-cmd-norm</input>",
        "        <input>fcs/pitch-trim-cmd-norm</input>",
        "        <clipto><min>-1.0</min><max>1.0</max></clipto>",
        "      </summer>",
        '      <pure_gain name="Elevator Gain">',
        "        <input>fcs/pitch-trim-sum</input>",
        "        <gain>-0.45</gain>",
        "        <output>fcs/elevator-pos-rad</output>",
        "      </pure_gain>",
        "    </channel>",
        "  </flight_control>",
        "  <aerodynamics>",
        '    <axis name="LIFT">',
        '      <function name="aero/force/Lift_alpha">',
        "        <description>Lift due to alpha</description>",
        "        <product>",
        "          <property>aero/qbar-psf</property>",
        "          <property>metrics/Sw-sqft</property>",
        "          <value>4.85</value>",
        "        </product>",
        "      </function>",
        "    </axis>",
        "  </aerodynamics>",
        "</fdm_config>",
        "",
      ].join("\n"),
    },
  },

  // 15. NASA ROCETS (.roc)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "expander_engine.roc": [
        "DECK: ExpanderRocketEngine",
        'TITLE: "LOX/LH2 Upper Stage Expander Cycle Engine"',
        "",
        "COMPONENTS:",
        '  LH2_PUMP TYPE=PUMP TITLE="LH2 Main Turbopump"',
        "    PARAMS: PR=4.2, EFF=0.76, SPEED=42000.0, MDOT=7.2",
        "    PORTS: IN=lh2_inlet, OUT=lh2_discharge",
        "",
        '  REGEN_JACKET TYPE=DUCT TITLE="Regenerative Cooling Channels"',
        "    PARAMS: DP=0.8E6, QDOT=28.5E6, AREA=0.012",
        "    PORTS: IN=lh2_discharge, OUT=heated_lh2",
        "",
        '  TURBINE TYPE=TURBINE TITLE="Expander Drive Turbine"',
        "    PARAMS: PR=1.85, EFF=0.82, SPEED=42000.0",
        "    PORTS: IN=heated_lh2, OUT=turbine_exhaust",
        "",
        '  CHAMBER TYPE=CHAMBER TITLE="Main Combustion Chamber"',
        "    PARAMS: PC=5.8E6, MR=5.8, AT=0.022, EPS=60.0, CSTAR=2340.0",
        "    PORTS: IN=turbine_exhaust, OUT=nozzle_exit",
        "",
        "STREAMS:",
        "  S1 FROM=LH2_PUMP.lh2_discharge TO=REGEN_JACKET.lh2_discharge FLUID=LH2",
        "  S2 FROM=REGEN_JACKET.heated_lh2 TO=TURBINE.heated_lh2 FLUID=GH2",
        "  S3 FROM=TURBINE.turbine_exhaust TO=CHAMBER.turbine_exhaust FLUID=GH2",
        "",
      ].join("\n"),
    },
  },

  // 16. CCSDS (.oem)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "landsat9_orbit.oem": [
        "CCSDS_OEM_VERS = 2.0",
        "CREATION_DATE = 2026-10-26T00:00:00",
        "ORIGINATOR = NASA_GSFC_FDSS",
        "",
        "META_START",
        "OBJECT_NAME = LANDSAT_9",
        "OBJECT_ID = 2021-088A",
        "CENTER_NAME = EARTH",
        "REF_FRAME = EME2000",
        "TIME_SYSTEM = UTC",
        "START_TIME = 2026-10-26T00:00:00.000",
        "STOP_TIME = 2026-10-26T00:04:00.000",
        "META_STOP",
        "",
        "2026-10-26T00:00:00.000  7083.14  0.00     0.00      0.000   -1.312   7.382",
        "2026-10-26T00:01:00.000  7070.62  -78.68   442.52   -0.416   -1.309   7.369",
        "2026-10-26T00:02:00.000  7033.11  -157.05  883.28   -0.831   -1.301   7.329",
        "2026-10-26T00:03:00.000  6970.75  -234.81  1320.54  -1.243   -1.288   7.263",
        "2026-10-26T00:04:00.000  6883.79  -311.63  1752.57  -1.651   -1.269   7.171",
        "",
      ].join("\n"),
    },
  },

  // 17. MSC Easy5 (.ez5)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "flight_control.ez5": [
        "MODEL: PitchActuatorControl",
        'TITLE: "Multi-Rate Pitch Electro-Hydrostatic Actuator"',
        "",
        "COMPONENTS:",
        '  CMD01 TYPE=GP/STEP TITLE="Pitch Step Command"',
        "    XP: Y0=0.0, YSTEP=10.0, TSTEP=0.1",
        "",
        '  GA01 TYPE=GP/GA TITLE="Proportional Pitch Gain"',
        "    XP: K=4.5",
        "",
        '  LA01 TYPE=GP/LA TITLE="Actuator Servo Lag"',
        "    XP: TC=0.025, K=1.0",
        "",
        '  IN01 TYPE=GP/IN TITLE="Surface Position Integrator"',
        "    XP: IC=0.0, K=1.0",
        "",
        "CONNECTIONS:",
        "  CMD01.S_OUT -> GA01.S_IN",
        "  GA01.S_OUT -> LA01.S_IN",
        "  LA01.S_OUT -> IN01.S_IN",
        "",
      ].join("\n"),
    },
  },

  // 18. AUTOSAR (.arxml)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "torque_controller.arxml": [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<AUTOSAR xmlns="http://autosar.org/schema/r4.0">',
        "  <AR-PACKAGES>",
        "    <AR-PACKAGE>",
        "      <SHORT-NAME>Powertrain</SHORT-NAME>",
        "      <ELEMENTS>",
        "        <SENDER-RECEIVER-INTERFACE>",
        "          <SHORT-NAME>IF_TorqueSignal</SHORT-NAME>",
        "          <DATA-ELEMENTS>",
        "            <VARIABLE-DATA-PROTOTYPE>",
        "              <SHORT-NAME>TorqueNm</SHORT-NAME>",
        "            </VARIABLE-DATA-PROTOTYPE>",
        "          </DATA-ELEMENTS>",
        "        </SENDER-RECEIVER-INTERFACE>",
        "        <APPLICATION-SW-COMPONENT-TYPE>",
        "          <SHORT-NAME>TorqueController</SHORT-NAME>",
        "          <PORTS>",
        "            <R-PORT-PROTOTYPE>",
        "              <SHORT-NAME>PedalPos</SHORT-NAME>",
        '              <REQUIRED-INTERFACE-TREF DEST="SENDER-RECEIVER-INTERFACE">/Powertrain/IF_TorqueSignal</REQUIRED-INTERFACE-TREF>',
        "            </R-PORT-PROTOTYPE>",
        "            <P-PORT-PROTOTYPE>",
        "              <SHORT-NAME>TorqueCmd</SHORT-NAME>",
        '              <PROVIDED-INTERFACE-TREF DEST="SENDER-RECEIVER-INTERFACE">/Powertrain/IF_TorqueSignal</PROVIDED-INTERFACE-TREF>',
        "            </P-PORT-PROTOTYPE>",
        "          </PORTS>",
        "          <INTERNAL-BEHAVIORS>",
        "            <SWC-INTERNAL-BEHAVIOR>",
        "              <SHORT-NAME>TorqueControllerBehavior</SHORT-NAME>",
        "              <EVENTS>",
        "                <TIMING-EVENT>",
        "                  <SHORT-NAME>TE_10ms</SHORT-NAME>",
        '                  <START-ON-EVENT-REF DEST="RUNNABLE-ENTITY">/Powertrain/TorqueController/TorqueControllerBehavior/StepRunnable</START-ON-EVENT-REF>',
        "                  <PERIOD>0.01</PERIOD>",
        "                </TIMING-EVENT>",
        "              </EVENTS>",
        "              <RUNNABLES>",
        "                <RUNNABLE-ENTITY>",
        "                  <SHORT-NAME>StepRunnable</SHORT-NAME>",
        "                  <MINIMUM-START-INTERVAL>0.0</MINIMUM-START-INTERVAL>",
        "                  <SYMBOL>TorqueController_Step</SYMBOL>",
        "                </RUNNABLE-ENTITY>",
        "              </RUNNABLES>",
        "            </SWC-INTERNAL-BEHAVIOR>",
        "          </INTERNAL-BEHAVIORS>",
        "        </APPLICATION-SW-COMPONENT-TYPE>",
        "      </ELEMENTS>",
        "    </AR-PACKAGE>",
        "  </AR-PACKAGES>",
        "</AUTOSAR>",
        "",
      ].join("\n"),
    },
  },

  // 19. Simulink (.mdl)
  {
    id: "simulink-cruise",
    languageId: "simulink",
    title: "Adaptive Cruise Control Block Diagram",
    summary:
      "Simulink ASCII `.mdl` control loop with Constant setpoint, Sum junction, proportional-integral Gain, and vehicle plant Integrator.",
    badge: "SLX",
    tone: "teal",
    ext: ".mdl",
    primaryFile: "cruise_control.mdl",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "cruise_control.mdl": [
        "Model {",
        '  Name "CruiseControl"',
        "  System {",
        '    Name "CruiseControl"',
        "    Block {",
        "      BlockType Constant",
        '      Name "TargetSpeed"',
        '      Value "28.0"',
        "    }",
        "    Block {",
        "      BlockType Gain",
        '      Name "Kp"',
        '      Gain "3.5"',
        "    }",
        "    Block {",
        "      BlockType Integrator",
        '      Name "VehicleVelocity"',
        '      InitialCondition "0.0"',
        "    }",
        "    Block {",
        "      BlockType Outport",
        '      Name "SpeedOut"',
        "    }",
        "    Line {",
        '      SrcBlock "TargetSpeed"',
        "      SrcPort 1",
        '      DstBlock "Kp"',
        "      DstPort 1",
        "    }",
        "    Line {",
        '      SrcBlock "Kp"',
        "      SrcPort 1",
        '      DstBlock "VehicleVelocity"',
        "      DstPort 1",
        "    }",
        "    Line {",
        '      SrcBlock "VehicleVelocity"',
        "      SrcPort 1",
        '      DstBlock "SpeedOut"',
        "      DstPort 1",
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
    },
  },

  // 20. GT-SUITE (.gtm)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "turbo_inline4.gtm": [
        "[MODEL]",
        "NAME = TurboChargedInline4",
        "SPEED_RPM = 3000.0",
        "CYCLES = 2",
        "",
        "[COMPONENT: ENVIRONMENT]",
        "ID = ambient_inlet",
        "PRESSURE = 101325.0",
        "TEMPERATURE = 298.15",
        "",
        "[COMPONENT: PIPE]",
        "ID = intake_runner",
        "LENGTH = 0.32",
        "DIAMETER = 0.048",
        "ROUGHNESS = 1.5e-5",
        "",
        "[COMPONENT: CYLINDER]",
        "ID = cyl_1",
        "BORE = 0.082",
        "STROKE = 0.090",
        "CR = 10.5",
        "",
        "[COMPONENT: ENVIRONMENT]",
        "ID = exhaust_outlet",
        "PRESSURE = 103000.0",
        "TEMPERATURE = 780.0",
        "",
        "[CONNECTION]",
        "FROM = ambient_inlet",
        "TO = intake_runner",
        "",
        "[CONNECTION]",
        "FROM = intake_runner",
        "TO = cyl_1",
        "",
        "[CONNECTION]",
        "FROM = cyl_1",
        "TO = exhaust_outlet",
        "",
      ].join("\n"),
    },
  },

  // 21. ASAM OpenDRIVE (.xodr)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "highway_corridor.xodr": [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<OpenDRIVE>",
        '  <header revMajor="1" revMinor="7" name="HighwayCorridor" version="1.0" date="2026-10-26"/>',
        '  <road name="InterstateNorth" length="600.0" id="1" junction="-1">',
        "    <planView>",
        '      <geometry s="0.0" x="0.0" y="0.0" hdg="0.0" length="300.0">',
        "        <line/>",
        "      </geometry>",
        '      <geometry s="300.0" x="300.0" y="0.0" hdg="0.0" length="300.0">',
        '        <arc curvature="0.001"/>',
        "      </geometry>",
        "    </planView>",
        "    <lanes>",
        '      <laneSection s="0.0">',
        "        <center>",
        '          <lane id="0" type="none" level="false"/>',
        "        </center>",
        "        <right>",
        '          <lane id="-1" type="driving" level="false">',
        '            <width sOffset="0.0" a="3.75" b="0.0" c="0.0" d="0.0"/>',
        '            <speed sOffset="0.0" max="33.33" unit="m/s"/>',
        "          </lane>",
        '          <lane id="-2" type="driving" level="false">',
        '            <width sOffset="0.0" a="3.75" b="0.0" c="0.0" d="0.0"/>',
        '            <speed sOffset="0.0" max="33.33" unit="m/s"/>',
        "          </lane>",
        "        </right>",
        "      </laneSection>",
        "    </lanes>",
        "  </road>",
        "</OpenDRIVE>",
        "",
      ].join("\n"),
    },
  },

  // 22. ASAM OpenSCENARIO (.xosc)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "highway_cut_in.xosc": [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<OpenSCENARIO>",
        '  <FileHeader revMajor="1" revMinor="2" date="2026-10-26T00:00:00" description="Highway Cut-In" author="ModelScript"/>',
        "  <ParameterDeclarations>",
        '    <ParameterDeclaration name="EgoSpeed" parameterType="double" value="30.0"/>',
        "  </ParameterDeclarations>",
        "  <RoadNetwork>",
        '    <LogicFile filepath="highway_corridor.xodr"/>',
        "  </RoadNetwork>",
        "  <Entities>",
        '    <ScenarioObject name="Ego">',
        '      <Vehicle name="EgoCar" vehicleCategory="car">',
        "        <BoundingBox>",
        '          <Center x="1.4" y="0.0" z="0.8"/>',
        '          <Dimensions width="2.0" length="4.8" height="1.5"/>',
        "        </BoundingBox>",
        '        <Performance maxSpeed="60.0" maxAcceleration="8.0" maxDeceleration="10.0"/>',
        "      </Vehicle>",
        "    </ScenarioObject>",
        '    <ScenarioObject name="Target">',
        '      <Vehicle name="TargetCar" vehicleCategory="car">',
        "        <BoundingBox>",
        '          <Center x="1.4" y="0.0" z="0.8"/>',
        '          <Dimensions width="2.0" length="4.6" height="1.5"/>',
        "        </BoundingBox>",
        '        <Performance maxSpeed="55.0" maxAcceleration="6.0" maxDeceleration="9.0"/>',
        "      </Vehicle>",
        "    </ScenarioObject>",
        "  </Entities>",
        "  <Storyboard>",
        "    <Init>",
        "      <Actions>",
        '        <Private entityRef="Ego">',
        "          <PrivateAction>",
        "            <LongitudinalAction>",
        "              <SpeedAction>",
        '                <SpeedActionDynamics dynamicsShape="step" value="0.0" dynamicsDimension="time"/>',
        "                <SpeedActionTarget>",
        '                  <AbsoluteTargetSpeed value="30.0"/>',
        "                </SpeedActionTarget>",
        "              </SpeedAction>",
        "            </LongitudinalAction>",
        "          </PrivateAction>",
        "        </Private>",
        '        <Private entityRef="Target">',
        "          <PrivateAction>",
        "            <LongitudinalAction>",
        "              <SpeedAction>",
        '                <SpeedActionDynamics dynamicsShape="step" value="0.0" dynamicsDimension="time"/>',
        "                <SpeedActionTarget>",
        '                  <AbsoluteTargetSpeed value="26.0"/>',
        "                </SpeedActionTarget>",
        "              </SpeedAction>",
        "            </LongitudinalAction>",
        "          </PrivateAction>",
        "        </Private>",
        "      </Actions>",
        "    </Init>",
        '    <Story name="CutInStory">',
        '      <Act name="CutInAct">',
        '        <ManeuverGroup maximumExecutionCount="1" name="CutInGroup">',
        '          <Actors selectTriggeringEntities="false">',
        '            <EntityRef entityRef="Target"/>',
        "          </Actors>",
        '          <Maneuver name="CutInManeuver">',
        '            <Event name="LaneChangeEvent" priority="overwrite">',
        '              <Action name="LaneChangeAction">',
        "                <PrivateAction>",
        "                  <LateralAction>",
        "                    <LaneChangeAction>",
        '                      <LaneChangeActionDynamics dynamicsShape="sinusoidal" value="3.0" dynamicsDimension="time"/>',
        "                      <LaneChangeTarget>",
        '                        <RelativeTargetLane entityRef="Ego" value="0"/>',
        "                      </LaneChangeTarget>",
        "                    </LaneChangeAction>",
        "                  </LateralAction>",
        "                </PrivateAction>",
        "              </Action>",
        "            </Event>",
        "          </Maneuver>",
        "        </ManeuverGroup>",
        "      </Act>",
        "    </Story>",
        "  </Storyboard>",
        "</OpenSCENARIO>",
        "",
      ].join("\n"),
    },
  },

  // 23. GENSYS (.calc)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "passenger_coach.calc": [
        "# GENSYS High-Speed Passenger Coach",
        "body carbody 32000 56000 1200000 1200000 0.0 0.0 1.8",
        "body bogie1 2600 1800 1400 2600 9.5 0.0 0.6",
        "body bogie2 2600 1800 1400 2600 -9.5 0.0 0.6",
        "body axle1 1500 800 100 800 10.75 0.0 0.46",
        "body axle2 1500 800 100 800 8.25 0.0 0.46",
        "body axle3 1500 800 100 800 -8.25 0.0 0.46",
        "body axle4 1500 800 100 800 -10.75 0.0 0.46",
        "",
        "spring sec_susp_1 carbody bogie1 160000 160000 420000",
        "spring sec_susp_2 carbody bogie2 160000 160000 420000",
        "damper sec_damp_1 carbody bogie1 20000 40000 30000",
        "damper sec_damp_2 carbody bogie2 20000 40000 30000",
        "",
        "spring pri_susp_1 bogie1 axle1 1200000 1000000 880000",
        "spring pri_susp_2 bogie1 axle2 1200000 1000000 880000",
        "spring pri_susp_3 bogie2 axle3 1200000 1000000 880000",
        "spring pri_susp_4 bogie2 axle4 1200000 1000000 880000",
        "",
        "track tangent_line 1.435 60E1 0.025",
        "contact w_r_1 axle1 tangent_line S1002 UIC60 0.46 0.40",
        "",
      ].join("\n"),
    },
  },

  // 24. SIMPACK (.spck)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "wishbone_suspension.spck": [
        "# SIMPACK Double-Wishbone Suspension Multibody Deck",
        "body chassis Ground_Ref 1450.0 420.0 1850.0 1920.0",
        "body upper_arm Chassis_Ref 4.2 0.08 0.12 0.15",
        "body lower_arm Chassis_Ref 6.8 0.14 0.22 0.28",
        "body knuckle Wheel_Carrier 18.5 0.25 0.25 0.32",
        "",
        "marker m_chassis_ua chassis 0.0 0.35 0.42",
        "marker m_chassis_la chassis 0.0 0.32 0.18",
        "marker m_knuckle_top knuckle 0.0 0.68 0.40",
        "marker m_knuckle_bot knuckle 0.0 0.70 0.16",
        "",
        "joint j_upper_pivot revolute chassis upper_arm",
        "joint j_lower_pivot revolute chassis lower_arm",
        "joint j_knuckle_steer revolute lower_arm knuckle",
        "",
        "force f_coilover spring_damper chassis knuckle 45000.0 3200.0 0.38",
        "",
      ].join("\n"),
    },
  },

  // 25. PSCAD (.pscx)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "Microgrid_IBR.pscx": [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<project name="Microgrid_IBR" version="5.0.0" type="normal">',
        '  <param name="time_step" value="20.0"/>',
        '  <param name="time_duration" value="0.25"/>',
        '  <param name="f_base" value="60.0"/>',
        "  <hierarchy>",
        '    <call name="Main" link="10001" />',
        "  </hierarchy>",
        "  <definitions>",
        '    <definition name="Main" type="module">',
        "      <schematic>",
        '        <User classid="UserCmp" defn="source_3p" id="G1" x="100" y="160" orient="0">',
        '          <param name="Name" value="Utility_Grid_250MVA"/>',
        '          <param name="V" value="16.5"/>',
        '          <param name="MVA" value="250.0"/>',
        '          <param name="freq" value="60.0"/>',
        '          <port name="out" pos="[30, 0]"/>',
        "        </User>",
        '        <Bus name="Bus1" id="B1" x="220" y="160" length="80" vbase="16.5"/>',
        '        <User classid="UserCmp" defn="xfmr-3p" id="T1" x="420" y="160" orient="0">',
        '          <param name="Name" value="Substation_Xfmr_250MVA"/>',
        '          <param name="MVA" value="250.0"/>',
        '          <param name="V1" value="16.5"/>',
        '          <param name="V2" value="230.0"/>',
        '          <param name="X" value="0.0576"/>',
        '          <port name="P" pos="[-30, 0]"/>',
        '          <port name="S" pos="[30, 0]"/>',
        "        </User>",
        '        <Bus name="Bus2" id="B2" x="540" y="160" length="80" vbase="230.0"/>',
        '        <User classid="UserCmp" defn="tline_3p" id="L1" x="760" y="160" orient="0">',
        '          <param name="Name" value="Transmission_Line_50km"/>',
        '          <param name="Length" value="50.0"/>',
        '          <param name="R" value="0.035"/>',
        '          <param name="L" value="0.0012"/>',
        '          <param name="C" value="1.2e-8"/>',
        '          <param name="model" value="bergeron"/>',
        '          <port name="in" pos="[-40, 0]"/>',
        '          <port name="out" pos="[40, 0]"/>',
        "        </User>",
        '        <Bus name="Bus3" id="B3" x="920" y="160" length="80" vbase="230.0"/>',
        '        <User classid="UserCmp" defn="inverter_fmu" id="INV1" x="1100" y="160" orient="0">',
        '          <param name="Name" value="Solar_BESS_IBR_100MVA"/>',
        '          <param name="MVA" value="100.0"/>',
        '          <param name="V" value="230.0"/>',
        '          <port name="term" pos="[-30, 0]"/>',
        "        </User>",
        '        <Wire><vertex x="130" y="160"/><vertex x="220" y="160"/></Wire>',
        '        <Wire><vertex x="300" y="160"/><vertex x="390" y="160"/></Wire>',
        '        <Wire><vertex x="450" y="160"/><vertex x="540" y="160"/></Wire>',
        '        <Wire><vertex x="620" y="160"/><vertex x="720" y="160"/></Wire>',
        '        <Wire><vertex x="800" y="160"/><vertex x="920" y="160"/></Wire>',
        '        <Wire><vertex x="1000" y="160"/><vertex x="1070" y="160"/></Wire>',
        "      </schematic>",
        "    </definition>",
        "  </definitions>",
        "</project>",
        "",
      ].join("\n"),
    },
  },

  // 26. Siemens PSS®E (.raw)
  {
    id: "psse-ieee14",
    languageId: "psse",
    title: "IEEE 14-Bus Transmission Network Power Flow",
    summary:
      "PSS®E v33 `.raw` transmission network with slack/PV/PQ buses, loads, generators, branches, and Newton-Raphson AC power flow.",
    badge: "PSE",
    tone: "teal",
    ext: ".raw",
    primaryFile: "ieee14.raw",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "ieee14.raw": [
        "0, 100.0, 33, 0, 1, 60.0 / IEEE 14-Bus Transmission Benchmark",
        "1, 'Bus 1   ', 138.0, 3, 1, 1, 1, 1.060, 0.000",
        "2, 'Bus 2   ', 138.0, 2, 1, 1, 1, 1.045, -4.98",
        "3, 'Bus 3   ', 138.0, 2, 1, 1, 1, 1.010, -12.72",
        "4, 'Bus 4   ', 138.0, 1, 1, 1, 1, 1.019, -10.33",
        "5, 'Bus 5   ', 138.0, 1, 1, 1, 1, 1.020, -8.78",
        "0 / END OF BUS DATA, BEGIN LOAD DATA",
        "2, '1 ', 1, 1, 1, 21.7, 12.7, 0.0, 0.0, 0.0, 0.0, 1",
        "3, '1 ', 1, 1, 1, 94.2, 19.0, 0.0, 0.0, 0.0, 0.0, 1",
        "4, '1 ', 1, 1, 1, 47.8, -3.9, 0.0, 0.0, 0.0, 0.0, 1",
        "5, '1 ', 1, 1, 1, 7.6, 1.6, 0.0, 0.0, 0.0, 0.0, 1",
        "0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA",
        "0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA",
        "1, '1 ', 232.4, -16.9, 10.0, -10.0, 1.060, 0, 250.0, 0.0, 0.05, 0.0, 0.0, 1.0, 1, 100.0, 332.4, 0.0",
        "2, '1 ', 40.0, 42.4, 50.0, -40.0, 1.045, 0, 100.0, 0.0, 0.05, 0.0, 0.0, 1.0, 1, 100.0, 140.0, 0.0",
        "0 / END OF GENERATOR DATA, BEGIN BRANCH DATA",
        "1, 2, '1 ', 0.01938, 0.05917, 0.0528, 150.0, 150.0, 150.0, 0.0, 0.0, 0.0, 0.0, 1",
        "1, 5, '1 ', 0.05403, 0.22304, 0.0492, 150.0, 150.0, 150.0, 0.0, 0.0, 0.0, 0.0, 1",
        "2, 3, '1 ', 0.04699, 0.19797, 0.0438, 150.0, 150.0, 150.0, 0.0, 0.0, 0.0, 0.0, 1",
        "2, 4, '1 ', 0.05811, 0.17632, 0.0340, 150.0, 150.0, 150.0, 0.0, 0.0, 0.0, 0.0, 1",
        "2, 5, '1 ', 0.05695, 0.17388, 0.0346, 150.0, 150.0, 150.0, 0.0, 0.0, 0.0, 0.0, 1",
        "3, 4, '1 ', 0.06701, 0.17103, 0.0128, 150.0, 150.0, 150.0, 0.0, 0.0, 0.0, 0.0, 1",
        "4, 5, '1 ', 0.01335, 0.04211, 0.0000, 150.0, 150.0, 150.0, 0.0, 0.0, 0.0, 0.0, 1",
        "0 / END OF BRANCH DATA",
        "Q",
        "",
      ].join("\n"),
    },
  },

  // 27. EPRI OpenDSS (.dss)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "ieee4_feeder.dss": [
        "! IEEE 4-Bus Distribution Test Feeder with Solar PV",
        "Clear",
        "New Circuit.IEEE4Bus basekv=12.47 pu=1.00 phases=3 bus1=SourceBus",
        "",
        "New Line.Line1 phases=3 bus1=SourceBus bus2=PrimaryBus length=2000 units=ft r1=0.306 x1=0.627",
        "New Transformer.StepDown phases=3 windings=2 buses=(PrimaryBus SubBus) conns=(delta wye) kvs=(12.47 4.16) kvas=(6000 6000) XHL=6.0",
        "New Line.Line2 phases=3 bus1=SubBus bus2=LoadBus length=2500 units=ft r1=0.306 x1=0.627",
        "",
        "New Load.FeederLoad bus1=LoadBus phases=3 conn=wye kv=4.16 kw=1800 kvar=600 model=1",
        "New PVSystem.RooftopSolar phases=3 bus1=LoadBus kv=4.16 kva=500 pmpp=450 irradiance=1.0",
        "",
        "Set VoltageBases=[12.47, 4.16]",
        "CalcVoltageBases",
        "Solve",
        "",
      ].join("\n"),
    },
  },

  // 28. Schlumberger OLGA (.opi)
  {
    id: "olga-flowline",
    languageId: "olga",
    title: "Subsea Multiphase Tieback & Slug Riser",
    summary:
      "OLGA `.opi` subsea tieback from wellhead source through seabed flowline and vertical riser to topside separator.",
    badge: "OLG",
    tone: "teal",
    ext: ".opi",
    primaryFile: "subsea_flowline.opi",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "subsea_flowline.opi": [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<OlgaModel name="Subsea_Tieback_Flowline" version="2023.1">',
        "  <Network>",
        "    <Nodes>",
        '      <Node id="Wellhead" type="CLOSED" x="100" y="260" temperature="82.0" />',
        '      <Node id="RiserBase" type="INTERNAL" x="450" y="300" />',
        '      <Node id="TopsideSep" type="PRESSURE" x="780" y="100" pressure="2800000" temperature="24.0" />',
        "    </Nodes>",
        "    <Flowpaths>",
        '      <Flowpath id="SeabedLine" from="Wellhead" to="RiserBase" diameter="0.254" roughness="0.000045">',
        "        <Geometry>",
        '          <Pipe label="P_SEABED" length="3500" elevation="-40" wallThickness="0.018" nSegments="25" />',
        "        </Geometry>",
        '        <Source label="WELL_SRC" location="100" massFlow="38.5" temperature="82.0" gasMassFraction="0.22" waterCut="0.15" />',
        "      </Flowpath>",
        '      <Flowpath id="VerticalRiser" from="RiserBase" to="TopsideSep" diameter="0.203" roughness="0.000045">',
        "        <Geometry>",
        '          <Pipe label="P_RISER" length="450" elevation="420" wallThickness="0.020" nSegments="15" />',
        "        </Geometry>",
        '        <Valve label="CHOKE_V1" location="420" opening="0.78" cd="0.84" diameter="0.15" />',
        "      </Flowpath>",
        "    </Flowpaths>",
        "  </Network>",
        '  <Simulation startTime="0" stopTime="600" dt="1.0" fluid="BLACKOIL_NORTH_SEA" />',
        "</OlgaModel>",
        "",
      ].join("\n"),
    },
  },

  // 29. Pipeline Studio LPS (.lps)
  {
    id: "lps-corridor",
    languageId: "lps",
    title: "High-Pressure Gas Transmission Corridor (TGNET)",
    summary:
      "Pipeline Studio `.lps` natural gas corridor with supply receipt, centrifugal compressor station, and delivery sales node.",
    badge: "LPS",
    tone: "sky",
    ext: ".lps",
    primaryFile: "gas_corridor.lps",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "gas_corridor.lps": [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<LPSModel name="Gas_Transmission_Corridor" engine="TGNET" fluid="NATURAL_GAS">',
        "  <Nodes>",
        '    <Supply id="Receipt_Terminal" x="100" y="200" pressure="6200000" temperature="288.15" elevation="50" />',
        '    <Junction id="CS1_Suction" x="340" y="200" elevation="85" />',
        '    <Junction id="CS1_Discharge" x="520" y="200" elevation="85" />',
        '    <Delivery id="City_Gate_Sales" x="800" y="200" flowRate="85.0" minPressure="3800000" elevation="110" />',
        "  </Nodes>",
        "  <Links>",
        '    <Pipe id="Pipe_Upstream" from="Receipt_Terminal" to="CS1_Suction" length="42000" diameter="0.762" roughness="0.000015" wallThickness="0.015" maop="9500000" />',
        '    <Compressor id="Comp_Station_1" from="CS1_Suction" to="CS1_Discharge" mode="RATIO" targetRatio="1.38" maxPowerMW="18.0" efficiency="0.82" speedRPM="5400" />',
        '    <Pipe id="Pipe_Downstream" from="CS1_Discharge" to="City_Gate_Sales" length="55000" diameter="0.762" roughness="0.000015" wallThickness="0.015" maop="9500000" />',
        "  </Links>",
        '  <Simulation startTime="0" stopTime="1200" dt="5.0" specificGravity="0.62" />',
        "</LPSModel>",
        "",
      ].join("\n"),
    },
  },

  // 30. SLB ECLIPSE (.data)
  {
    id: "eclipse-brent",
    languageId: "eclipse",
    title: "North Sea Black-Oil Waterflood Reservoir Deck",
    summary:
      "SLB ECLIPSE 100 `.data` deck with 3D corner-point grid, PVDO/SWOF tables, producer/injector wells, and waterflood schedule.",
    badge: "ECL",
    tone: "amber",
    ext: ".data",
    primaryFile: "brent_reservoir.data",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "brent_reservoir.data": [
        "RUNSPEC",
        "TITLE",
        "  Brent Field Black-Oil Waterflood Benchmark",
        "DIMENS",
        "  5 5 2 /",
        "OIL",
        "WATER",
        "METRIC",
        "",
        "GRID",
        "DX",
        "  50*100.0 /",
        "DY",
        "  50*100.0 /",
        "DZ",
        "  50*15.0 /",
        "TOPS",
        "  25*2400.0 /",
        "PORO",
        "  50*0.22 /",
        "PERMX",
        "  50*250.0 /",
        "PERMY",
        "  50*250.0 /",
        "PERMZ",
        "  50*25.0 /",
        "",
        "PROPS",
        "SWOF",
        "  0.20 0.00 1.00 0.0",
        "  0.50 0.18 0.32 0.0",
        "  0.80 0.65 0.00 0.0 /",
        "PVDO",
        "  100.0 1.22 0.85",
        "  250.0 1.18 0.92",
        "  400.0 1.14 1.02 /",
        "",
        "SOLUTION",
        "EQUIL",
        "  2400.0 265.0 2450.0 0.0 2300.0 0.0 /",
        "",
        "SCHEDULE",
        "WELSPECS",
        "  'PROD1' 'G1' 1 1 2410.0 'OIL' /",
        "  'INJ1'  'G1' 5 5 2420.0 'WATER' /",
        "/",
        "COMPDAT",
        "  'PROD1' 1 1 1 2 'OPEN' 1 0.0 0.19 /",
        "  'INJ1'  5 5 1 2 'OPEN' 1 0.0 0.19 /",
        "/",
        "WCONPROD",
        "  'PROD1' 'OPEN' 'ORAT' 850.0 4* 150.0 /",
        "/",
        "WCONINJE",
        "  'INJ1' 'WATER' 'OPEN' 'RATE' 950.0 1* 340.0 /",
        "/",
        "TSTEP",
        "  30 30 30 30 /",
        "END",
        "",
      ].join("\n"),
    },
  },

  // 31. RELAP5-3D (.r5)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "pwr_loop.r5": [
        "= Reactor Primary Coolant Loop Benchmark",
        "0000100 new transnt",
        "0000105 5.0 15.0",
        "0000201 10.0 1.0e-5 0.05 3 10 50",
        "* Hydrodynamic Components",
        "1000000 corepipe pipe",
        "1000001 5",
        "1000101 0.45 5",
        "1000301 0.85 5",
        "1001201 003 1.55e7 565.0 0.0 0.0 0.0 5",
        "1001301 125.0 0.0 0.0 4",
        "* Hot Leg Single Volume",
        "1100000 hotleg snglvol",
        "1100101 0.50 4.2 2.1 0.0 0.0 0.0 0.00004 0.15 00",
        "1100200 003 1.54e7 595.0",
        "* Core Exit Single Junction",
        "1050000 coreexit sngljun",
        "1050101 100010000 110000000 0.45 0.05 0.05 00000",
        "1050201 1 125.0 0.0 0.0",
        "* Reactor Coolant Pump",
        "1200000 rcpump pump",
        "1200101 0.48 2.0 0.96 0.0 0.0 0.0 00",
        "1200200 003 1.56e7 565.0",
        "1200108 110010000 120000000 0.45 0.02 0.02 00000",
        "1200109 120010000 100000000 0.45 0.02 0.02 00000",
        "1200301 0 125.0 95.0 3770.0 118.8",
        "* Fuel Cladding Heat Structure",
        "11001000 5 5 2 1 0.0041",
        "11001100 0 1",
        "11001101 0.00475 4",
        "11001201 001 3",
        "11001202 002 1",
        "11001501 100010000 10000 1 1 0.85 5",
        "* Point Reactor Kinetics",
        "20000001 point",
        "20000002 2.8e9 0.0 0.0065 1.8e-5",
        ".",
        "",
      ].join("\n"),
    },
  },

  // 32. SINTEF SIMA (.sima)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "oc4_semisub.sima": [
        "# SINTEF SIMA Coupled Aero-Hydro-Servo-Elastic Deck",
        "ENVIRONMENT NorthSea_DLC1_6",
        "  WATER_DEPTH = 200.0",
        "  WAVE_SPECTRUM = JONSWAP",
        "  HS = 6.5",
        "  TP = 11.5",
        "  GAMMA = 3.3",
        "  CURRENT_SPEED = 0.85",
        "  WIND_SPEED = 11.4",
        "END",
        "",
        "BODY OC4_SemiSub",
        "  MASS = 1.3473e7",
        "  COG = (0.0, 0.0, -13.46)",
        "  INERTIA = (6.827e9, 6.827e9, 1.226e10)",
        "  HYDRO_STIFFNESS = (0.0, 0.0, 3.836e6, 3.776e8, 3.776e8, 0.0)",
        "END",
        "",
        "MOORING_LINE Line_1",
        "  BODY = OC4_SemiSub",
        "  FAIRLEAD = (-40.87, 0.0, -14.0)",
        "  ANCHOR = (-837.6, 0.0, -200.0)",
        "  LENGTH = 835.5",
        "  EA = 7.536e8",
        "  MBL = 1.25e7",
        "END",
        "",
        "MOORING_LINE Line_2",
        "  BODY = OC4_SemiSub",
        "  FAIRLEAD = (20.43, 35.39, -14.0)",
        "  ANCHOR = (418.8, 725.4, -200.0)",
        "  LENGTH = 835.5",
        "  EA = 7.536e8",
        "  MBL = 1.25e7",
        "END",
        "",
        "MOORING_LINE Line_3",
        "  BODY = OC4_SemiSub",
        "  FAIRLEAD = (20.43, -35.39, -14.0)",
        "  ANCHOR = (418.8, -725.4, -200.0)",
        "  LENGTH = 835.5",
        "  EA = 7.536e8",
        "  MBL = 1.25e7",
        "END",
        "",
      ].join("\n"),
    },
  },

  // 33. SPICE (.cir)
  {
    id: "spice-filter",
    languageId: "spice",
    title: "Second-Order RLC Low-Pass Analog Filter",
    summary:
      "SPICE circuit netlist with sinusoidal voltage source, series resistor/inductor, shunt capacitor, and `.tran` MNA analysis.",
    badge: "SPC",
    tone: "indigo",
    ext: ".cir",
    primaryFile: "lowpass_filter.cir",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "lowpass_filter.cir": [
        "* Second-Order RLC Low-Pass Filter",
        "V1 in 0 SIN(0 5.0 1000)",
        "R1 in n1 50.0",
        "L1 n1 out 0.010",
        "C1 out 0 1.0e-6",
        "Rload out 0 1000.0",
        ".tran 2e-5 0.005",
        ".end",
        "",
      ].join("\n"),
    },
  },

  // 34. Verilog-A (.va)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "analog_resistor.va": [
        '`include "disciplines.vams"',
        "",
        "module analog_resistor(p, n);",
        "  inout p, n;",
        "  electrical p, n;",
        "  parameter real r0 = 1000.0;",
        "  parameter real tc1 = 0.0015;",
        "",
        "  analog begin",
        "    V(p, n) <+ r0 * (1.0 + tc1) * I(p, n);",
        "  end",
        "endmodule",
        "",
      ].join("\n"),
    },
  },

  // 35. IBIS (.ibs)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "lvcmos_io.ibs": [
        "[IBIS Ver]      5.0",
        "[File Name]     lvcmos_io.ibs",
        "[File Rev]      1.0",
        "[Date]          2026-10-26",
        "",
        "[Component]     MSX_SERDES_IO",
        "[Manufacturer]  ModelScript Semiconductors",
        "[Package]",
        "| variable      typ             min             max",
        "R_pkg           0.120           0.080           0.180",
        "L_pkg           1.20nH          0.85nH          1.65nH",
        "C_pkg           0.45pF          0.30pF          0.65pF",
        "",
        "[Pin]   signal_name     model_name      R_pin   L_pin   C_pin",
        "1       TX_DQ0          LVCMOS_1V8      0.11    1.1nH   0.42pF",
        "2       VDDQ            POWER           NA      NA      NA",
        "3       VSS             GND             NA      NA      NA",
        "",
        "[Model]         LVCMOS_1V8",
        "Model_type      I/O",
        "Vinl = 0.63V",
        "Vinh = 1.17V",
        "C_comp          1.80pF          1.40pF          2.30pF",
        "[Voltage Range] 1.80V           1.70V           1.90V",
        "",
        "[Pulldown]",
        "| Voltage       I(typ)          I(min)          I(max)",
        "  -1.80         -42.0mA         -34.0mA         -52.0mA",
        "   0.00           0.0mA           0.0mA           0.0mA",
        "   0.90          26.5mA          20.0mA          33.0mA",
        "   1.80          38.0mA          29.0mA          47.0mA",
        "",
        "[Pullup]",
        "| Voltage       I(typ)          I(min)          I(max)",
        "  -1.80          40.0mA          32.0mA          50.0mA",
        "   0.00           0.0mA           0.0mA           0.0mA",
        "   0.90         -24.0mA         -18.0mA         -31.0mA",
        "   1.80         -35.0mA         -27.0mA         -44.0mA",
        "",
        "[Rising Waveform]",
        "R_fixture = 50.0",
        "V_fixture = 0.0",
        "| Time          V(typ)          V(min)          V(max)",
        "  0.00ns        0.00V           0.00V           0.00V",
        "  0.25ns        0.55V           0.42V           0.68V",
        "  0.50ns        1.22V           1.05V           1.38V",
        "  1.00ns        1.48V           1.35V           1.60V",
        "",
        "[Falling Waveform]",
        "R_fixture = 50.0",
        "V_fixture = 1.80",
        "| Time          V(typ)          V(min)          V(max)",
        "  0.00ns        1.80V           1.70V           1.90V",
        "  0.25ns        1.15V           1.25V           1.02V",
        "  0.50ns        0.48V           0.60V           0.35V",
        "  1.00ns        0.28V           0.36V           0.20V",
        "",
        "[End]",
        "",
      ].join("\n"),
    },
  },

  // 36. Touchstone (.s2p)
  {
    id: "touchstone-filter",
    languageId: "touchstone",
    title: "2.4 GHz RF Bandpass Filter 2-Port S-Parameters",
    summary:
      "Touchstone `.s2p` 2-port scattering matrix with passivity singular-value verification, reciprocity checks, and rational vector fitting.",
    badge: "SNP",
    tone: "rose",
    ext: ".s2p",
    primaryFile: "bandpass_filter.s2p",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "bandpass_filter.s2p": [
        "! 2.4 GHz RF Bandpass Filter 2-Port S-Parameters",
        "# GHz S MA R 50",
        "! Freq  |S11|  <S11    |S21|  <S21    |S12|  <S12    |S22|  <S22",
        "1.0     0.92   -35.0   0.18   52.0    0.18   52.0    0.92   -35.0",
        "2.0     0.45   -82.0   0.82   12.0    0.82   12.0    0.45   -82.0",
        "2.4     0.08  -145.0   0.97    0.0    0.97    0.0    0.08  -145.0",
        "2.8     0.48    78.0   0.80  -18.0    0.80  -18.0    0.48    78.0",
        "4.0     0.94    32.0   0.14  -64.0    0.14  -64.0    0.94    32.0",
        "",
      ].join("\n"),
    },
  },

  // 37. ROS URDF (.urdf)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "manipulator_2dof.urdf": [
        '<?xml version="1.0"?>',
        '<robot name="Manipulator2DOF">',
        '  <link name="base_link">',
        "    <inertial>",
        '      <origin xyz="0 0 0.05" rpy="0 0 0"/>',
        '      <mass value="6.0"/>',
        '      <inertia ixx="0.08" ixy="0.0" ixz="0.0" iyy="0.08" iyz="0.0" izz="0.10"/>',
        "    </inertial>",
        "  </link>",
        '  <link name="shoulder_link">',
        "    <inertial>",
        '      <origin xyz="0 0 0.25" rpy="0 0 0"/>',
        '      <mass value="3.2"/>',
        '      <inertia ixx="0.045" ixy="0.0" ixz="0.0" iyy="0.045" iyz="0.0" izz="0.018"/>',
        "    </inertial>",
        "  </link>",
        '  <link name="forearm_link">',
        "    <inertial>",
        '      <origin xyz="0 0 0.20" rpy="0 0 0"/>',
        '      <mass value="1.8"/>',
        '      <inertia ixx="0.022" ixy="0.0" ixz="0.0" iyy="0.022" iyz="0.0" izz="0.009"/>',
        "    </inertial>",
        "  </link>",
        '  <joint name="shoulder_joint" type="revolute">',
        '    <parent link="base_link"/>',
        '    <child link="shoulder_link"/>',
        '    <origin xyz="0 0 0.12" rpy="0 0 0"/>',
        '    <axis xyz="0 1 0"/>',
        '    <limit lower="-3.14" upper="3.14" effort="120.0" velocity="3.0"/>',
        "  </joint>",
        '  <joint name="elbow_joint" type="revolute">',
        '    <parent link="shoulder_link"/>',
        '    <child link="forearm_link"/>',
        '    <origin xyz="0 0 0.45" rpy="0 0 0"/>',
        '    <axis xyz="0 1 0"/>',
        '    <limit lower="-2.6" upper="2.6" effort="80.0" velocity="4.0"/>',
        "  </joint>",
        "</robot>",
        "",
      ].join("\n"),
    },
  },

  // 38. IEC 61131-3 / PLCopen (.st)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "tank_level.st": [
        "PROGRAM TankLevelControl",
        "VAR",
        "  SetPoint : REAL := 75.0;",
        "  Level : REAL := 50.0;",
        "  Error : REAL := 0.0;",
        "  ValveCmd : REAL := 0.0;",
        "  Kp : REAL := 1.8;",
        "END_VAR",
        "",
        "Error := SetPoint - Level;",
        "ValveCmd := Kp * Error;",
        "Level := Level + 0.05 * ValveCmd;",
        "END_PROGRAM",
        "",
      ].join("\n"),
    },
  },

  // 39. MSC Adams (.adm)
  {
    id: "adams-pendulum",
    languageId: "adams",
    title: "MSC Adams Damped Pendulum Mechanism",
    summary:
      "MSC Adams/Solver `.adm` dataset with ground PART, pendulum link PART, coordinate MARKERS, REVOLUTE joint, and gravity.",
    badge: "ADM",
    tone: "indigo",
    ext: ".adm",
    primaryFile: "pendulum_mechanism.adm",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "pendulum_mechanism.adm": [
        "Adams/Solver DatasetTitle: Damped_Pendulum_Mechanism",
        "!",
        "PART/1, GROUND",
        "!",
        "MARKER/1, PART = 1, QP = 0.0, 0.0, 0.0",
        "!",
        "PART/2, MASS = 5.0, CM = 2, IP = 0.25, 0.25, 0.05",
        "!",
        "MARKER/2, PART = 2, QP = 0.5, 0.0, 0.0",
        "MARKER/3, PART = 2, QP = 0.0, 0.0, 0.0",
        "!",
        "JOINT/1, REVOLUTE, I = 3, J = 1",
        "!",
        "ACCGRAV/JGRAV = -9.81",
        "!",
        "END",
        "",
      ].join("\n"),
    },
  },

  // 40. DOE EnergyPlus (.idf)
  {
    id: "energyplus-office",
    languageId: "energyplus",
    title: "Commercial Office Thermal Zone & Envelope (ASHRAE 90.1)",
    summary:
      "EnergyPlus `.idf` building thermal model with concrete envelope material, wall construction, conditioned office zone, and thermostat.",
    badge: "IDF",
    tone: "amber",
    ext: ".idf",
    primaryFile: "office_zone.idf",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "office_zone.idf": [
        "Version,24.1;",
        "",
        "Building,",
        "  SmartOfficeBuilding,",
        "  0.0,",
        "  City,",
        "  0.04,",
        "  0.4,",
        "  FullExterior,",
        "  25,",
        "  6;",
        "",
        "Zone,",
        "  MainOfficeZone,",
        "  0.0,",
        "  0.0, 0.0, 0.0,",
        "  1,",
        "  1,",
        "  3.2,",
        "  320.0,",
        "  100.0;",
        "",
        "Material,",
        "  InsulatedConcrete,",
        "  MediumRough,",
        "  0.22,",
        "  0.45,",
        "  1800.0,",
        "  880.0;",
        "",
        "Construction,",
        "  ExteriorWall,",
        "  InsulatedConcrete;",
        "",
      ].join("\n"),
    },
  },

  // 41. US EPA EPANET (.epanet)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "municipal_water.epanet": [
        "[TITLE]",
        "Municipal Water Distribution Loop",
        "",
        "[JUNCTIONS]",
        ";ID      Elev    Demand",
        "J1       45.0    12.0",
        "J2       40.0    18.0",
        "J3       38.0    15.0",
        "",
        "[RESERVOIRS]",
        ";ID      Head",
        "R1       92.0",
        "",
        "[PIPES]",
        ";ID      Node1   Node2   Length  Diameter Roughness",
        "P1       R1      J1      600.0   300.0    120.0",
        "P2       J1      J2      450.0   250.0    120.0",
        "P3       J2      J3      400.0   200.0    115.0",
        "P4       J1      J3      520.0   200.0    115.0",
        "",
        "[TIMES]",
        "Duration 24:00",
        "",
        "[END]",
        "",
      ].join("\n"),
    },
  },

  // 42. US EPA SWMM (.swmm)
  {
    id: "swmm-drainage",
    languageId: "swmm",
    title: "Urban Stormwater Catchment & Conduit Routing",
    summary:
      "EPA SWMM `.swmm` model with design storm rain gage, 2 urban subcatchments, circular storm sewer conduits, and dynamic wave routing.",
    badge: "SWM",
    tone: "teal",
    ext: ".swmm",
    primaryFile: "urban_drainage.swmm",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "urban_drainage.swmm": [
        "[TITLE]",
        "Urban Stormwater Drainage Network",
        "",
        "[OPTIONS]",
        "FLOW_UNITS           CMS",
        "INFILTRATION         HORTON",
        "FLOW_ROUTING         DYNWAVE",
        "",
        "[RAINGAGES]",
        ";Name   Format    Interval  SCF   Source",
        "RG1     INTENSITY 0:15      1.0   TIMESERIES TS_STORM",
        "",
        "[SUBCATCHMENTS]",
        ";Name   RainGage  Outlet  Area  %Imperv Width   %Slope",
        "S1      RG1       J1      4.5   65.0    180.0   1.5",
        "S2      RG1       J2      3.2   50.0    140.0   1.2",
        "",
        "[JUNCTIONS]",
        ";Name   Elevation MaxDepth InitDepth",
        "J1      105.0     3.0      0.0",
        "J2      102.0     3.0      0.0",
        "J3      99.5      3.5      0.0",
        "",
        "[OUTFALLS]",
        ";Name   Elevation Type",
        "OUT1    97.0      FREE",
        "",
        "[CONDUITS]",
        ";Name   FromNode ToNode Length Roughness InOffset OutOffset",
        "C1      J1       J2     220.0  0.013     0.0      0.0",
        "C2      J2       J3     180.0  0.013     0.0      0.0",
        "C3      J3       OUT1   150.0  0.013     0.0      0.0",
        "",
        "[XSECTIONS]",
        ";Link   Shape    Geom1",
        "C1      CIRCULAR 1.0",
        "C2      CIRCULAR 1.2",
        "C3      CIRCULAR 1.5",
        "",
        "[TIMESERIES]",
        ";Name      Time   Value",
        "TS_STORM   0:00   12.0",
        "TS_STORM   0:15   48.0",
        "TS_STORM   0:30   72.0",
        "TS_STORM   0:45   28.0",
        "TS_STORM   1:00   8.0",
        "",
      ].join("\n"),
    },
  },

  // 43. Aspen Plus (.bkp)
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
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "methanol_flash.bkp": [
        "TITLE 'Methanol-Water Binary Flash Separation'",
        "COMPONENTS",
        "  MEOH CH4O METHANOL /",
        "  WATER H2O WATER /",
        "PROPERTIES NRTL",
        "FLOWSHEET",
        "  BLOCK B-HEAT IN=S-FEED OUT=S-HOT",
        "  BLOCK B-FLASH IN=S-HOT OUT=S-VAP S-LIQ",
        "STREAM S-FEED",
        "  SUBSTREAM MIXED TEMP=298.15 PRES=101325.0",
        "  MOLE-FLOW MEOH 60.0 / WATER 40.0",
        "BLOCK B-HEAT HEATER",
        "  PARAM TEMP=351.0 PRES=101325.0",
        "BLOCK B-FLASH FLASH2",
        "  PARAM TEMP=351.0 PRES=101325.0",
        "",
      ].join("\n"),
    },
  },

  // 44. SBML Level 3 (.sbml)
  {
    id: "sbml-enzyme",
    languageId: "sbml",
    title: "Michaelis-Menten Enzyme Catalysis Network",
    summary:
      "SBML Level 3 Version 2 biochemical reaction network ($E + S \\rightleftharpoons ES \\rightarrow E + P$) with conservation-law analysis.",
    badge: "SBM",
    tone: "rose",
    ext: ".sbml",
    primaryFile: "enzyme_kinetics.sbml",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "enzyme_kinetics.sbml": [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<sbml xmlns="http://www.sbml.org/sbml/level3/version2/core" level="3" version="2">',
        '  <model id="EnzymeCatalysis" name="Michaelis-Menten Enzyme Kinetics">',
        "    <listOfCompartments>",
        '      <compartment id="cytosol" size="1.0" constant="true"/>',
        "    </listOfCompartments>",
        "    <listOfSpecies>",
        '      <species id="E" compartment="cytosol" initialConcentration="1.5" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false"/>',
        '      <species id="S" compartment="cytosol" initialConcentration="10.0" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false"/>',
        '      <species id="ES" compartment="cytosol" initialConcentration="0.0" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false"/>',
        '      <species id="P" compartment="cytosol" initialConcentration="0.0" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false"/>',
        "    </listOfSpecies>",
        "    <listOfParameters>",
        '      <parameter id="k_on" value="0.8" constant="true"/>',
        '      <parameter id="k_off" value="0.2" constant="true"/>',
        '      <parameter id="k_cat" value="0.5" constant="true"/>',
        "    </listOfParameters>",
        "    <listOfReactions>",
        '      <reaction id="R_binding" reversible="false">',
        "        <listOfReactants>",
        '          <speciesReference species="E" stoichiometry="1" constant="true"/>',
        '          <speciesReference species="S" stoichiometry="1" constant="true"/>',
        "        </listOfReactants>",
        "        <listOfProducts>",
        '          <speciesReference species="ES" stoichiometry="1" constant="true"/>',
        "        </listOfProducts>",
        "        <kineticLaw>",
        '          <math xmlns="http://www.w3.org/1998/Math/MathML">',
        "            <apply><times/><ci>k_on</ci><ci>E</ci><ci>S</ci></apply>",
        "          </math>",
        "        </kineticLaw>",
        "      </reaction>",
        '      <reaction id="R_catalysis" reversible="false">',
        "        <listOfReactants>",
        '          <speciesReference species="ES" stoichiometry="1" constant="true"/>',
        "        </listOfReactants>",
        "        <listOfProducts>",
        '          <speciesReference species="E" stoichiometry="1" constant="true"/>',
        '          <speciesReference species="P" stoichiometry="1" constant="true"/>',
        "        </listOfProducts>",
        "        <kineticLaw>",
        '          <math xmlns="http://www.w3.org/1998/Math/MathML">',
        "            <apply><times/><ci>k_cat</ci><ci>ES</ci></apply>",
        "          </math>",
        "        </kineticLaw>",
        "      </reaction>",
        "    </listOfReactions>",
        "  </model>",
        "</sbml>",
        "",
      ].join("\n"),
    },
  },
];

// ── Lookup Maps & Empty Workspace Definition ───────────────────────────────

export const EMPTY_WORKSPACE_FILES: Record<string, string> = {
  "HelloWorld.mo": [
    'model HelloWorld "Empty Workspace Starter Model"',
    '  parameter Real a = -1.0 "Decay rate [1/s]";',
    '  Real x(start = 1.0, fixed = true) "State variable";',
    "equation",
    "  der(x) = a * x;",
    "end HelloWorld;",
    "",
  ].join("\n"),
  "README.md": [
    "# ModelScript Empty Workspace",
    "",
    "Welcome to your clean ModelScript polyglot engineering workspace (`memfs://`).",
    "",
    "- Create files in any of the **44 supported engineering languages** (`.mo`, `.sysml`, `.msx`, `.scad`, `.step`, `.inp`, `.cfg`, `.pscx`, `.raw`, `.dss`, `.opi`, `.lps`, `.data`, `.r5`, `.sima`, `.cir`, `.va`, `.ibs`, `.s2p`, `.urdf`, `.st`, `.adm`, `.idf`, `.epanet`, `.swmm`, `.bkp`, `.sbml`, etc.).",
    "- Click any **CodeLens** action above declarations to simulate, verify, or open interactive diagrams.",
    "",
  ].join("\n"),
};

export const EXAMPLE_BY_ID = new Map<string, ExampleWorkspaceDescriptor>(EXAMPLE_TEMPLATES.map((ex) => [ex.id, ex]));

export const EXAMPLES_BY_LANGUAGE = new Map<string, ExampleWorkspaceDescriptor[]>();
for (const tile of LANGUAGE_TILES) {
  EXAMPLES_BY_LANGUAGE.set(tile.id, []);
}
for (const ex of EXAMPLE_TEMPLATES) {
  const list = EXAMPLES_BY_LANGUAGE.get(ex.languageId) ?? [];
  list.push(ex);
  EXAMPLES_BY_LANGUAGE.set(ex.languageId, list);
}

// Legacy/shorthand alias map to verified example IDs
const TEMPLATE_ALIASES: Record<string, string> = {
  "vehicle-architecture": "sysml2",
  "pendulum-3d": "bouncing-ball",
  "drone-chassis": "drone-reachability",
  cad: "scad-airframe",
  "cad-assembly": "step-pendulum",
  "assembly-to-multibody": "step-pendulum",
  "drone-fea": "fea-chassis",
  "drone-cfd": "cfd-aerodynamics",
  "owl2-contradiction": "owl2-units",
  "owl2-subsumption": "owl2-units",
};

export function getTemplateFiles(template: string): Record<string, string> | undefined {
  if (template === "empty" || template === "blank") {
    return EMPTY_WORKSPACE_FILES;
  }
  const direct = EXAMPLE_BY_ID.get(template);
  if (direct) return direct.files;
  const aliasedId = TEMPLATE_ALIASES[template];
  if (aliasedId) {
    return EXAMPLE_BY_ID.get(aliasedId)?.files;
  }
  // Allow looking up by languageId directly (returns its defaultTemplateId)
  const langTile = LANGUAGE_TILES.find((t) => t.id === template);
  if (langTile) {
    return EXAMPLE_BY_ID.get(langTile.defaultTemplateId)?.files;
  }
  return undefined;
}

// ── Artifact & Package Workspace Generators ────────────────────────────────

export function generateArtifactWorkspaceFiles(descriptor: ArtifactWorkspaceDescriptor): GeneratedWorkspace {
  const viewType = (descriptor.viewType || "").toLowerCase();
  const config = descriptor.viewConfig || {};

  // 1. Modelica Code / Schematic / Morsel
  if (
    viewType === "modelica-code" ||
    viewType === "modelica-diagram" ||
    viewType === "morsel" ||
    (!viewType && config["code"])
  ) {
    const rawCode =
      (typeof config["code"] === "string" ? config["code"] : "") ||
      (typeof config["content"] === "string" ? config["content"] : "");
    let modelName = "";
    if (rawCode) {
      const match = rawCode.match(/(?:model|class|block|connector|package)\s+([A-Za-z0-9_]+)/);
      if (match?.[1]) {
        modelName = match[1];
      }
    }
    if (!modelName) {
      modelName = sanitizeModelicaIdentifier(descriptor.title, `Artifact_${descriptor.artifactId}`);
    }

    const code =
      rawCode ||
      [
        `// ModelScript Workspace for Artifact #${descriptor.artifactId}`,
        `// Title: ${descriptor.title || "Community Model"}`,
        ``,
        `model ${modelName} "${descriptor.title || "Community Model"}"`,
        `  Real x(start = 1.0) "State variable";`,
        `  Real y(start = 0.0) "Coupled variable";`,
        `equation`,
        `  der(x) = -y;`,
        `  der(y) = x;`,
        `end ${modelName};`,
        ``,
      ].join("\n");

    const primaryFile = `${modelName}.mo`;
    const files: Record<string, string> = {
      [primaryFile]: code,
      "README.md": [
        `# ${descriptor.title || modelName}`,
        ``,
        `Mounted from ModelScript Hub Community Feed & Physical Twin Workspace.`,
        ``,
        `- **Artifact ID**: #${descriptor.artifactId}`,
        `- **View Type**: \`${viewType || "modelica-code"}\``,
        `- **Primary Model**: \`${modelName}\``,
        ``,
        `To simulate, open \`${primaryFile}\` and press \`F5\` or click **Run Simulation**.`,
      ].join("\n"),
    };

    return { files, primaryFile };
  }

  // 2. Simulation Plot / Result / CFD / FEA Result
  if (
    viewType === "simulation-plot" ||
    viewType === "simulation-result" ||
    viewType === "cfd-result" ||
    viewType === "fea-result" ||
    viewType === "cfd-animation"
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
      "README.md": [
        `# Simulation: ${descriptor.title || modelName}`,
        ``,
        `Mounted from ModelScript Simulation Artifact #${descriptor.artifactId}.`,
        ``,
        `- **Model**: \`${modelName}\``,
        `- **Variables**: ${variables.map((v) => `\`${v}\``).join(", ")}`,
        `- **Script**: \`simulate.mos\``,
      ].join("\n"),
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

  // 3. 3D CAD STEP
  if (viewType === "cad-step" || viewType === "cad_step" || viewType === "3d-model") {
    const stepContent =
      (typeof config["step"] === "string" ? config["step"] : "") ||
      (typeof config["content"] === "string" ? config["content"] : "") ||
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

    const modelName = sanitizeModelicaIdentifier(descriptor.title, `CADAssembly_${descriptor.artifactId}`);
    const primaryFile = `${modelName}.mo`;
    const files: Record<string, string> = {
      [primaryFile]: [
        `// ModelScript 3D CAD Assembly bound to STEP geometry`,
        `model ${modelName} "${descriptor.title || "CAD Model"}"`,
        `  // Bound to local STEP geometry file`,
        `  annotation(Shape(export = "geometry.step"));`,
        `equation`,
        `end ${modelName};`,
        ``,
      ].join("\n"),
      "geometry.step": stepContent,
      "README.md": [
        `# 3D CAD: ${descriptor.title || modelName}`,
        ``,
        `Mounted from ModelScript CAD Artifact #${descriptor.artifactId}.`,
        ``,
        `- **Geometry Asset**: \`geometry.step\``,
        `- **Modelica Wrapper**: \`${primaryFile}\``,
      ].join("\n"),
    };

    return { files, primaryFile };
  }

  // 4. GCode Toolpath
  if (viewType === "gcode" || viewType === "cam-result") {
    const gcodeContent =
      (typeof config["gcode"] === "string" ? config["gcode"] : "") ||
      (typeof config["content"] === "string" ? config["content"] : "") ||
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

    const modelName = sanitizeModelicaIdentifier(descriptor.title, `Manufacturing_${descriptor.artifactId}`);
    const primaryFile = "toolpath.gcode";
    const files: Record<string, string> = {
      [primaryFile]: gcodeContent,
      [`${modelName}.mo`]: [
        `// ModelScript CNC / CAM Manufacturing Process`,
        `model ${modelName} "${descriptor.title || "Toolpath Process"}"`,
        `  parameter String toolpath_file = "toolpath.gcode";`,
        `end ${modelName};`,
        ``,
      ].join("\n"),
      "README.md": [
        `# CAM Toolpath: ${descriptor.title || modelName}`,
        ``,
        `- **G-Code File**: \`toolpath.gcode\``,
        `- **Process Model**: \`${modelName}.mo\``,
      ].join("\n"),
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

    const modelName = sanitizeModelicaIdentifier(descriptor.title, `AAS_${descriptor.artifactId}`);
    const primaryFile = "aas-manifest.json";
    const idShortStr = typeof manifest["idShort"] === "string" && manifest["idShort"] ? manifest["idShort"] : modelName;
    const files: Record<string, string> = {
      [primaryFile]: JSON.stringify(manifest, null, 2),
      [`${modelName}.mo`]: [
        `// ModelScript Asset Administration Shell (AAS) Digital Twin`,
        `model ${modelName} "${descriptor.title || "AAS Digital Twin"}"`,
        `  parameter String manifest_path = "aas-manifest.json";`,
        `  parameter String idShort = "${idShortStr}";`,
        `end ${modelName};`,
        ``,
      ].join("\n"),
      "README.md": [
        `# AAS Digital Twin: ${descriptor.title || modelName}`,
        ``,
        `- **Manifest**: \`aas-manifest.json\``,
        `- **Digital Twin Wrapper**: \`${modelName}.mo\``,
      ].join("\n"),
    };

    return { files, primaryFile };
  }

  // 6. Generic Default Artifact Fallback
  const modelName = sanitizeModelicaIdentifier(descriptor.title, `ArtifactModel_${descriptor.artifactId}`);
  const primaryFile = "ArtifactModel.mo";
  const content = [
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

  const files: Record<string, string> = {
    [primaryFile]: content,
    "README.md": [
      `# Artifact #${descriptor.artifactId}: ${descriptor.title || "Community Model"}`,
      ``,
      `Mounted in ModelScript IDE linear in-memory filesystem (\`memfs://\`).`,
    ].join("\n"),
  };

  return { files, primaryFile };
}

export function generatePackageWorkspaceFiles(
  packageName: string,
  pkgInfo?: Record<string, unknown>,
): GeneratedWorkspace {
  const safeName = sanitizeModelicaIdentifier(packageName, "PackageDemo");
  const primaryFile = `${safeName}Demo.mo`;
  const manifest = {
    name: packageName,
    version: typeof pkgInfo?.["version"] === "string" && pkgInfo["version"] ? pkgInfo["version"] : "1.0.0",
    description:
      typeof pkgInfo?.["description"] === "string" && pkgInfo["description"]
        ? pkgInfo["description"]
        : `ModelScript workspace for package ${packageName}`,
    dependencies: pkgInfo?.["dependencies"] || {},
  };

  const files: Record<string, string> = {
    "package.json": JSON.stringify(manifest, null, 2),
    "package.mo": [
      `package ${safeName}`,
      `  "Library package for ${packageName}"`,
      `  constant String version = "${manifest.version}";`,
      `end ${safeName};`,
      ``,
    ].join("\n"),
    [primaryFile]: [
      `// Test harness and simulation demo for ${packageName}`,
      `model ${safeName}Demo "Testing ${packageName}"`,
      `  // import ${safeName}.*;`,
      `  Real time_val = time;`,
      `equation`,
      `end ${safeName}Demo;`,
      ``,
    ].join("\n"),
    "README.md": [
      `# ${packageName}`,
      ``,
      `ModelScript package workspace for \`${packageName}\`.`,
      ``,
      `- **Entrypoint**: \`${primaryFile}\``,
      `- **Package Root**: \`package.mo\``,
      `- **Registry Metadata**: \`package.json\``,
    ].join("\n"),
  };

  return { files, primaryFile };
}

export function mountArtifactToMemFs(
  memFs: IMemoryFileSystemProvider,
  workspaceUri: vscode.Uri,
  descriptor: ArtifactWorkspaceDescriptor,
): { files: Record<string, string>; primaryFile: string } {
  registerArtifactDescriptor(descriptor);
  const encoder = new TextEncoder();
  const { files, primaryFile } = generateArtifactWorkspaceFiles(descriptor);
  for (const [name, fileContent] of Object.entries(files)) {
    const fileUri = joinPath(workspaceUri, name);
    memFs.writeFile(fileUri, encoder.encode(fileContent));
  }
  return { files, primaryFile };
}

export function scaffoldTemplateFiles(memFs: IMemoryFileSystemProvider, workspaceUri: vscode.Uri): void {
  const encoder = new TextEncoder();
  const template = workspaceUri.path.substring(1) || "empty";

  if (template === "scratch" || template.startsWith("artifact-")) {
    const artifactId = template === "scratch" ? "scratch" : template.slice("artifact-".length);
    let registered = artifactRegistry.get(artifactId);
    if (!registered && typeof sessionStorage !== "undefined") {
      try {
        const raw = sessionStorage.getItem(`modelscript.artifact_${artifactId}`);
        if (raw) registered = JSON.parse(raw);
      } catch {
        // ignore
      }
    }
    const descriptor: ArtifactWorkspaceDescriptor = registered || { artifactId };
    const { files } = generateArtifactWorkspaceFiles(descriptor);
    for (const [name, fileContent] of Object.entries(files)) {
      const fileUri = joinPath(workspaceUri, name);
      memFs.writeFile(fileUri, encoder.encode(fileContent));
    }
    console.log(`[blank-project] Scaffolded ${Object.keys(files).length} artifact file(s) for #${artifactId}`);
    return;
  }

  if (template.startsWith("package-")) {
    const pkgName = template.slice("package-".length);
    const { files } = generatePackageWorkspaceFiles(pkgName);
    for (const [name, fileContent] of Object.entries(files)) {
      const fileUri = joinPath(workspaceUri, name);
      memFs.writeFile(fileUri, encoder.encode(fileContent));
    }
    console.log(`[blank-project] Scaffolded ${Object.keys(files).length} package file(s) for '${pkgName}'`);
    return;
  }

  if (template === "stress-test") {
    const massiveModelRows = [];
    massiveModelRows.push('model MassiveModel "A massive model with thousands of elements"');
    for (let i = 0; i < 5000; i++) {
      massiveModelRows.push(`  Real v${i}(start = ${i});`);
    }
    massiveModelRows.push("equation");
    for (let i = 0; i < 4999; i++) {
      massiveModelRows.push(`  der(v${i}) = v${i + 1} - v${i};`);
    }
    massiveModelRows.push(`  der(v4999) = -v4999;`);
    massiveModelRows.push("end MassiveModel;\n");

    const entries: [vscode.Uri, Uint8Array][] = [];
    entries.push([joinPath(workspaceUri, "MassiveModel.mo"), encoder.encode(massiveModelRows.join("\n"))]);

    for (let i = 0; i < 5; i++) {
      const extendsClause = i > 0 ? `:> Component_${String(i - 1).padStart(3, "0")} ` : "";
      const content = `package Component_${String(i).padStart(3, "0")} {\n  part def Component_${String(i).padStart(3, "0")} ${extendsClause}{\n    attribute localValue : Real = ${i}.0;\n  }\n}\n`;
      entries.push([joinPath(workspaceUri, `Component_${String(i).padStart(3, "0")}.sysml`), encoder.encode(content)]);
    }
    if (memFs.writeFiles) {
      memFs.writeFiles(entries);
    } else {
      for (const [uri, data] of entries) {
        memFs.writeFile(uri, data);
      }
    }
    console.log("[blank-project] Scaffolded stress-test workspace files.");
    return;
  }

  const files = getTemplateFiles(template);
  if (files) {
    for (const [name, content] of Object.entries(files)) {
      const fileUri = joinPath(workspaceUri, name);
      memFs.writeFile(fileUri, encoder.encode(content));
    }
    console.log(`[blank-project] Scaffolded ${Object.keys(files).length} template file(s) for '${template}'`);
  }
}

export function getTemplatePrimaryFile(template: string): string {
  if (template === "empty" || template === "blank") {
    return "HelloWorld.mo";
  }
  if (template === "stress-test") {
    return "MassiveModel.mo";
  }
  if (template === "scratch" || template.startsWith("artifact-")) {
    const artifactId = template === "scratch" ? "scratch" : template.slice("artifact-".length);
    let registered = artifactRegistry.get(artifactId);
    if (!registered && typeof sessionStorage !== "undefined") {
      try {
        const raw = sessionStorage.getItem(`modelscript.artifact_${artifactId}`);
        if (raw) registered = JSON.parse(raw);
      } catch {
        // ignore
      }
    }
    if (registered) {
      const { primaryFile } = generateArtifactWorkspaceFiles(registered);
      return primaryFile;
    }
    return template === "scratch" ? "ScratchModel.mo" : "ArtifactModel.mo";
  }

  if (template.startsWith("package-")) {
    const pkgName = template.slice("package-".length);
    const { primaryFile } = generatePackageWorkspaceFiles(pkgName);
    return primaryFile;
  }

  const direct = EXAMPLE_BY_ID.get(template);
  if (direct) return direct.primaryFile;

  const aliasedId = TEMPLATE_ALIASES[template];
  if (aliasedId) {
    const aliased = EXAMPLE_BY_ID.get(aliasedId);
    if (aliased) return aliased.primaryFile;
  }

  const langTile = LANGUAGE_TILES.find((t) => t.id === template);
  if (langTile) {
    const langEx = EXAMPLE_BY_ID.get(langTile.defaultTemplateId);
    if (langEx) return langEx.primaryFile;
  }

  return "HelloWorld.mo";
}
