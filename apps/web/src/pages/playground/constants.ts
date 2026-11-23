// SPDX-License-Identifier: AGPL-3.0-or-later

import { isLanguageFlagEnabled } from "@modelscript/editor/workbench/constants";
import { useMemo } from "react";
import { getLanguageFlagKey, isLanguageEnabledInFlags, useFeatureFlags } from "../../FeatureFlagContext";
import { EXTENDED_LANGUAGE_EXAMPLES } from "./languageExamples";

export interface HeroExample {
  id: string;
  title: string;
  category: string;
  lang: string;
  code: string;
  files?: Record<string, string> | undefined;
  activeFile?: string | undefined;
  domain?: string;
  description?: string;
  tags?: string[];
}

export const TEMPLATE_CATEGORIES = [
  "All",
  "Electrical & RF",
  "Mechanics & Multibody",
  "Systems & Controls",
  "Fluids & Process",
  "3D CAD & FEA",
  "Systems Biology",
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export interface PlaygroundLanguageOption {
  id: string;
  label: string;
  ext: string;
  featureFlag?: string | undefined;
  hiddenByDefault?: boolean | undefined;
}

export const ALL_PLAYGROUND_LANGUAGES: PlaygroundLanguageOption[] = [
  { id: "modelica", label: "Modelica 3.x", ext: ".mo" },
  { id: "sysml2", label: "SysML v2 / KerML", ext: ".sysml" },
  { id: "scad", label: "OpenSCAD (CSG)", ext: ".scad" },
  { id: "owl2", label: "OWL2 Ontology", ext: ".owl" },
  { id: "pscad", label: "PSCAD (EMT)", ext: ".pscx" },
  { id: "spice", label: "SPICE Circuit", ext: ".sp" },
  { id: "fea", label: "FEA Deck (CalculiX/Abaqus)", ext: ".inp" },
  { id: "cfd", label: "CFD Config (SU2)", ext: ".su2" },
  { id: "step", label: "STEP (ISO 10303)", ext: ".step" },
  { id: "ssp", label: "SSP Architecture", ext: ".ssd" },
  { id: "psse", label: "PSS/E Power Flow", ext: ".raw" },
  { id: "gensys", label: "GENSYS Railway", ext: ".tsimf" },
  { id: "simpack", label: "SIMPACK Multibody", ext: ".spck" },
  {
    id: "modelscript",
    label: "ModelScript (.msx)",
    ext: ".msx",
    featureFlag: "lang_modelscript",
    hiddenByDefault: true,
  },
  { id: "verilog-a", label: "Verilog-A", ext: ".va" },
  { id: "c", label: "C (Embedded)", ext: ".c" },
  { id: "fortran", label: "Fortran 90", ext: ".f90" },
  { id: "plcopen", label: "PLCopen ST (IEC 61131-3)", ext: ".st" },
  { id: "autosar", label: "AUTOSAR ARXML", ext: ".arxml" },
  { id: "simulink", label: "Simulink Model", ext: ".mdl" },
  { id: "reqif", label: "ReqIF Requirements", ext: ".reqif" },
  { id: "ccsds", label: "CCSDS Orbit Ephemeris", ext: ".oem" },
  { id: "opendrive", label: "OpenDRIVE Road Network", ext: ".xodr" },
  { id: "openscenario", label: "OpenSCENARIO", ext: ".xosc" },
  { id: "urdf", label: "URDF Robotics", ext: ".urdf" },
  { id: "usd", label: "OpenUSD Digital Twin", ext: ".usda" },
  { id: "adams", label: "ADAMS Multibody", ext: ".adm" },
  { id: "sima", label: "SIMA Offshore Mooring", ext: ".sima" },
  { id: "olga", label: "OLGA Multiphase Flow", ext: ".opi" },
  { id: "lps", label: "LPS Pipeline", ext: ".lps" },
  { id: "epanet", label: "EPANET Hydraulic", ext: ".inp" },
  { id: "swmm", label: "SWMM Stormwater", ext: ".swmm" },
  { id: "gtsuite", label: "GT-SUITE Powertrain", ext: ".gtm" },
  { id: "easy5", label: "Easy5 Controls", ext: ".ez5" },
  { id: "rocets", label: "ROCETS Rocket Propulsion", ext: ".roc" },
  { id: "relap5", label: "RELAP5 Thermal-Hydraulics", ext: ".r5" },
  { id: "energyplus", label: "EnergyPlus Building HVAC", ext: ".idf" },
  { id: "aspen", label: "Aspen Process Flowsheet", ext: ".aspen" },
  { id: "eclipse", label: "ECLIPSE Reservoir", ext: ".data" },
  { id: "sbml", label: "SBML Systems Biology", ext: ".sbml" },
  { id: "jsbsim", label: "JSBSim Flight Dynamics", ext: ".jsbsim" },
  { id: "touchstone", label: "Touchstone RF S-Params", ext: ".s2p" },
  { id: "ibis", label: "IBIS Signal Integrity", ext: ".ibs" },
  { id: "opendss", label: "OpenDSS Distribution Grid", ext: ".dss" },
  { id: "csv", label: "CSV Tabular Dataset", ext: ".csv" },
  { id: "ampl", label: "AMPL Optimization", ext: ".mod" },
  { id: "oscal", label: "NIST OSCAL", ext: ".oscal.json" },
  { id: "qif", label: "QIF (ISO 23952)", ext: ".qif" },
  { id: "gtfs", label: "GTFS Transit", ext: ".gtfs" },
  { id: "powerfactory", label: "DIgSILENT PowerFactory", ext: ".dgs" },
  { id: "pslf", label: "GE Vernova PSLF", ext: ".epc" },
  { id: "cgmes", label: "CIM / CGMES", ext: ".xml" },
  { id: "ocpp", label: "OCPP EV Charging", ext: ".ocpp" },
  { id: "openadr", label: "OpenADR Demand Response", ext: ".oadr" },
  { id: "tough", label: "LBNL TOUGH Subsurface", ext: ".tgh" },
  { id: "matpower", label: "MATPOWER OPF", ext: ".m" },
  { id: "comtrade", label: "IEEE COMTRADE", ext: ".cfg" },
  { id: "scl", label: "IEC 61850 SCL", ext: ".scd" },
  { id: "atp", label: "ATP-EMTP", ext: ".atp" },
  { id: "dnp3", label: "IEEE 1815 / DNP3", ext: ".dnp3" },
  { id: "oneliner", label: "ASPEN OneLiner / CAPE", ext: ".olx" },
  { id: "sel", label: "SEL Relay Settings", ext: ".rdb" },
  { id: "optical", label: "OpenROADM & Telcordia .sor", ext: ".sor" },
  { id: "ran", label: "NSMA WG16 & Planet Antenna", ext: ".adf" },
  { id: "fiber", label: "TIA-598-D Outside Plant", ext: ".geojson" },
  { id: "automationml", label: "AutomationML (IEC 62714)", ext: ".aml" },
  { id: "hec-ras", label: "USACE HEC-RAS", ext: ".g01" },
  { id: "modflow", label: "USGS MODFLOW", ext: ".dis" },
  { id: "landgem", label: "EPA LandGEM", ext: ".landgem" },
  { id: "hec-hms", label: "USACE HEC-HMS", ext: ".basin" },
  { id: "waterml", label: "OGC WaterML 2.0", ext: ".waterml" },
  { id: "asm", label: "IWA Activated Sludge Models", ext: ".asm" },
  { id: "gproms", label: "gPROMS / PML", ext: ".gproms" },
  { id: "cantera", label: "Cantera Kinetics", ext: ".yaml" },
  { id: "phreeqc", label: "PHREEQC Geochemistry", ext: ".pqi" },
  { id: "smiles", label: "SMILES / SDF", ext: ".smi" },
  { id: "antimony", label: "Antimony", ext: ".ant" },
  { id: "bngl", label: "BioNetGen (BNGL)", ext: ".bngl" },
  { id: "sbol", label: "SBOL3", ext: ".sbol" },
  { id: "sedml", label: "SED-ML", ext: ".sedml" },
  { id: "nmtran", label: "NMTRAN (NONMEM)", ext: ".ctl" },
  { id: "mlxtran", label: "MLXTRAN (Monolix)", ext: ".mlxtran" },
  { id: "pdb", label: "PDB / mmCIF", ext: ".pdb" },
  { id: "genbank", label: "GenBank / FASTA", ext: ".gb" },
  { id: "cellml", label: "CellML", ext: ".cellml" },
  { id: "nmodl", label: "NMODL (NEURON)", ext: ".mod" },
  { id: "opensim", label: "OpenSim Biomechanics", ext: ".osim" },
  { id: "febio", label: "FEBio / SOFA", ext: ".feb" },
  { id: "dicom-rt", label: "DICOM-RT", ext: ".rtplan" },
  { id: "topas", label: "TOPAS / GATE", ext: ".topas" },
  { id: "nifti", label: "NIfTI / NRRD", ext: ".nii" },
  { id: "three-mf", label: "3MF Medical", ext: ".3mf" },
  { id: "igtl", label: "OpenIGTLink / PLUS", ext: ".igtl" },
  { id: "acsl", label: "ACSL", ext: ".csl" },
  { id: "apdl", label: "ANSYS APDL", ext: ".apdl" },
  { id: "apt", label: "APT", ext: ".apt" },
  { id: "arinc429", label: "ARINC 429", ext: ".a429" },
  { id: "asn1", label: "ASN.1", ext: ".asn" },
  { id: "atopile", label: "ATOPILE", ext: ".ato" },
  { id: "bufr", label: "WMO BUFR", ext: ".bufr" },
  { id: "c37118", label: "C37118", ext: ".c37118" },
  { id: "cea", label: "NASA CEA", ext: ".cea" },
  { id: "chemkin", label: "CHEMKIN", ext: ".inp" },
  { id: "cif", label: "CIF", ext: ".cif" },
  { id: "cplex-lp", label: "CPLEX LP", ext: ".lp" },
  { id: "csmp", label: "CSMP", ext: ".csmp" },
  { id: "cyme", label: "CYME", ext: ".sxst" },
  { id: "datcom", label: "DATCOM", ext: ".dcm" },
  { id: "doe2", label: "DOE-2 BDL", ext: ".inp" },
  { id: "dxf", label: "DXF", ext: ".dxf" },
  { id: "dynamo", label: "DYNAMO", ext: ".dyn" },
  { id: "edif", label: "EDIF", ext: ".edf" },
  { id: "endf6", label: "ENDF-6", ext: ".endf" },
  { id: "esl", label: "ESL", ext: ".esl" },
  { id: "esterel", label: "Esterel", ext: ".strl" },
  { id: "fits", label: "FITS", ext: ".fits" },
  { id: "gams", label: "GAMS", ext: ".gms" },
  { id: "gaussian", label: "Gaussian", ext: ".gjf" },
  { id: "gcode", label: "G-code", ext: ".nc" },
  { id: "gdsii", label: "GDSII", ext: ".gds" },
  { id: "gerber", label: "Gerber", ext: ".gbr" },
  { id: "gpss", label: "GPSS", ext: ".gps" },
  { id: "grib", label: "WMO GRIB", ext: ".grb" },
  { id: "gridlabd", label: "GRIDLABD", ext: ".glm" },
  { id: "hdf4", label: "NCSA HDF4", ext: ".hdf" },
  { id: "hec1", label: "HEC-1", ext: ".hec1" },
  { id: "hec2", label: "HEC-2", ext: ".hc2" },
  { id: "iec104", label: "IEC104", ext: ".iec104" },
  { id: "ieee-cdf", label: "IEEE CDF", ext: ".cdf" },
  { id: "iges", label: "IGES", ext: ".igs" },
  { id: "ihex", label: "Intel HEX", ext: ".hex" },
  { id: "irig106", label: "IRIG 106", ext: ".tmats" },
  { id: "iucr-cif", label: "IUCr CIF", ext: ".cif" },
  { id: "jcamp-dx", label: "JCAMP-DX", ext: ".jdx" },
  { id: "jedec", label: "JEDEC JESD3", ext: ".jed" },
  { id: "kicad", label: "KICAD", ext: ".kicad_pcb" },
  { id: "las", label: "LAS", ext: ".las" },
  { id: "lsdyna", label: "LS-DYNA", ext: ".k" },
  { id: "lustre", label: "Lustre", ext: ".lus" },
  { id: "magicdraw", label: "MAGICDRAW", ext: ".mdzip" },
  { id: "mcnp", label: "MCNP", ext: ".mcnp" },
  { id: "melcor", label: "MELCOR", ext: ".mel" },
  { id: "molfile", label: "MDL Molfile", ext: ".mol" },
  { id: "mps", label: "IBM MPS", ext: ".mps" },
  { id: "nasa-cdf", label: "NASA CDF", ext: ".skt" },
  { id: "nec2", label: "NEC-2", ext: ".nec" },
  { id: "netcdf", label: "NetCDF", ext: ".cdl" },
  { id: "nmea0183", label: "NMEA 0183", ext: ".nmea" },
  { id: "obj", label: "Wavefront OBJ", ext: ".obj" },
  { id: "plot3d", label: "PLOT3D", ext: ".xyz" },
  { id: "plscadd", label: "PLSCADD", ext: ".pol" },
  { id: "powerworld", label: "POWERWORLD", ext: ".aux" },
  { id: "pypsa", label: "PYPSA", ext: ".pypsa" },
  { id: "rinex", label: "RINEX v2", ext: ".obs" },
  { id: "rtds", label: "RTDS", ext: ".dft" },
  { id: "scale", label: "SCALE", ext: ".scale" },
  { id: "sdl", label: "SDL-88", ext: ".sdl" },
  { id: "segy", label: "SEG-Y", ext: ".sgy" },
  { id: "simscript", label: "SIMSCRIPT", ext: ".sim" },
  { id: "sinda", label: "SINDA", ext: ".sin" },
  { id: "slam", label: "SLAM II", ext: ".slam" },
  { id: "sparql", label: "SPARQL", ext: ".rq" },
  { id: "srec", label: "Motorola SREC", ext: ".srec" },
  { id: "stl", label: "STL", ext: ".stl" },
  { id: "trasys", label: "TRASYS", ext: ".tra" },
  { id: "trnsys", label: "TRNSYS", ext: ".dck" },
  { id: "usgs-dem", label: "USGS DEM", ext: ".dem" },
  { id: "verilog", label: "Verilog", ext: ".v" },
  { id: "vhdl", label: "VHDL", ext: ".vhd" },
];

export const PLAYGROUND_LANGUAGES: PlaygroundLanguageOption[] = ALL_PLAYGROUND_LANGUAGES.filter((lang) =>
  isLanguageFlagEnabled(lang.featureFlag ?? getLanguageFlagKey(lang.id), !lang.hiddenByDefault),
);

export function getVisiblePlaygroundLanguages(isFlagEnabled?: (key: string) => boolean): PlaygroundLanguageOption[] {
  return ALL_PLAYGROUND_LANGUAGES.filter((lang) => {
    if (isFlagEnabled) {
      return isLanguageEnabledInFlags(lang.id, isFlagEnabled);
    }
    return isLanguageFlagEnabled(lang.featureFlag ?? getLanguageFlagKey(lang.id), !lang.hiddenByDefault);
  });
}

export function useVisiblePlaygroundLanguages(): PlaygroundLanguageOption[] {
  const { isEnabled } = useFeatureFlags();
  return useMemo(() => getVisiblePlaygroundLanguages(isEnabled), [isEnabled]);
}

export const PINNED_PLAYGROUND_LANGUAGE_IDS = ["modelica", "sysml2", "scad", "spice", "pscad", "step"] as const;

export const PLAYGROUND_LANGUAGE_DOMAINS: ReadonlyArray<{ title: string; ids: readonly string[] }> = [
  {
    title: "Core Systems & Modeling",
    ids: ["modelica", "modelscript", "ampl", "sysml2", "ssp", "reqif", "oscal", "owl2", "csv"],
  },
  {
    title: "Power Grids, RF & Electronics",
    ids: [
      "pscad",
      "psse",
      "cgmes",
      "opendss",
      "powerfactory",
      "pslf",
      "ocpp",
      "openadr",
      "spice",
      "verilog-a",
      "ibis",
      "touchstone",
      "optical",
      "ran",
      "fiber",
      "matpower",
      "comtrade",
      "scl",
      "atp",
      "dnp3",
      "oneliner",
      "sel",
    ],
  },
  {
    title: "Fluids, Process & Civil Water",
    ids: [
      "olga",
      "lps",
      "aspen",
      "eclipse",
      "epanet",
      "swmm",
      "relap5",
      "energyplus",
      "hec-ras",
      "tough",
      "modflow",
      "landgem",
      "hec-hms",
      "waterml",
      "asm",
    ],
  },
  {
    title: "Multibody, Auto, Robotics & Rail",
    ids: ["adams", "simpack", "gensys", "gtsuite", "sima", "urdf", "opendrive", "openscenario", "autosar", "gtfs"],
  },
  {
    title: "Aerospace & Controls",
    ids: ["simulink", "easy5", "jsbsim", "rocets", "ccsds", "plcopen", "automationml"],
  },
  {
    title: "3D CAD, Metrology & Physics",
    ids: ["step", "qif", "scad", "usd", "fea", "cfd"],
  },
  {
    title: "Chemistry, Biology & Scientific",
    ids: [
      "sbml",
      "antimony",
      "cantera",
      "smiles",
      "nmtran",
      "mlxtran",
      "nmodl",
      "sbol",
      "bngl",
      "sedml",
      "pdb",
      "genbank",
      "gproms",
      "phreeqc",
      "fortran",
      "c",
    ],
  },
  {
    title: "Medical & Biomechanics",
    ids: ["opensim", "dicom-rt", "cellml", "febio", "nifti", "topas", "three-mf", "igtl"],
  },
  {
    title: "Heritage Simulation, Control & Nuclear",
    ids: [
      "acsl",
      "csmp",
      "dynamo",
      "esl",
      "gpss",
      "simscript",
      "slam",
      "vhdl",
      "verilog",
      "lustre",
      "esterel",
      "sdl",
      "edif",
      "gdsii",
      "cif",
      "gerber",
      "mcnp",
      "melcor",
      "scale",
      "sinda",
      "trasys",
      "nec2",
      "datcom",
      "cea",
      "gams",
      "mps",
      "cplex-lp",
      "iges",
      "dxf",
      "gcode",
      "apt",
      "lsdyna",
      "apdl",
      "plot3d",
      "trnsys",
      "doe2",
      "chemkin",
      "molfile",
      "gaussian",
      "ieee-cdf",
      "hec1",
      "hec2",
      "segy",
      "fits",
    ],
  },
  {
    title: "Telemetry, Earth, Mesh & Firmware Formats",
    ids: [
      "netcdf",
      "nasa-cdf",
      "grib",
      "bufr",
      "usgs-dem",
      "hdf4",
      "arinc429",
      "nmea0183",
      "rinex",
      "irig106",
      "endf6",
      "jcamp-dx",
      "iucr-cif",
      "stl",
      "obj",
      "ihex",
      "srec",
      "jedec",
      "asn1",
    ],
  },
  {
    title: "Additional Power, EDA & Graph Languages",
    ids: [
      "sparql",
      "magicdraw",
      "atopile",
      "kicad",
      "c37118",
      "cyme",
      "gridlabd",
      "iec104",
      "plscadd",
      "powerworld",
      "pypsa",
      "rtds",
      "las",
    ],
  },
];

export function getPlaygroundLanguageDomain(langId: string): string {
  for (const group of PLAYGROUND_LANGUAGE_DOMAINS) {
    if (group.ids.includes(langId)) {
      return group.title;
    }
  }
  return "Other";
}

export const DEFAULT_EMPTY_MODELICA_CODE = `model Untitled "Untitled engineering model"
  annotation(
    Icon(coordinateSystem(preserveAspectRatio = false, extent = {{-100, -100}, {100, 100}})),
    Diagram(coordinateSystem(preserveAspectRatio = false, extent = {{-100, -100}, {100, 100}}))
  );
end Untitled;
`;

export const HERO_EXAMPLES: HeroExample[] = [
  {
    id: "rlc-circuit",
    title: "RLC Resonant Circuit",
    category: "Electrical",
    lang: "modelica",
    code: `model RLCCircuit "RLC circuit with Modelica Standard Library components"
  Modelica.Electrical.Analog.Sources.SineVoltage Vb(V = 10, f = 50)
    annotation(Placement(transformation(origin = {-70, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));
  Modelica.Electrical.Analog.Basic.Inductor L(L = 0.5)
    annotation(Placement(transformation(origin = {0, 40}, extent = {{-10, -10}, {10, 10}})));
  Modelica.Electrical.Analog.Basic.Capacitor C(C = 1e-4)
    annotation(Placement(transformation(origin = {20, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));
  Modelica.Electrical.Analog.Basic.Resistor R(R = 100)
    annotation(Placement(transformation(origin = {60, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(origin = {-70, -40}, extent = {{-10, -10}, {10, 10}})));
equation
  connect(Vb.p, L.p)
    annotation(Line(points = {{-70, 10}, {-70, 40}, {-10, 40}}, color = {0, 0, 255}));
  connect(L.n, C.p)
    annotation(Line(points = {{10, 40}, {20, 40}, {20, 10}}, color = {0, 0, 255}));
  connect(L.n, R.p)
    annotation(Line(points = {{10, 40}, {60, 40}, {60, 10}}, color = {0, 0, 255}));
  connect(R.n, Vb.n)
    annotation(Line(points = {{60, -10}, {60, -30}, {-70, -30}, {-70, -10}}, color = {0, 0, 255}));
  connect(C.n, Vb.n)
    annotation(Line(points = {{20, -10}, {20, -30}, {-70, -30}, {-70, -10}}, color = {0, 0, 255}));
  connect(Vb.n, ground.p)
    annotation(Line(points = {{-70, -10}, {-70, -30}}, color = {0, 0, 255}));
  annotation(
    Icon(coordinateSystem(preserveAspectRatio = false, extent = {{-100, -100}, {100, 100}})),
    Diagram(coordinateSystem(preserveAspectRatio = false, extent = {{-100, -100}, {100, 100}}))
  );
end RLCCircuit;`,
  },
  {
    id: "bouncing-ball",
    title: "Hybrid Bouncing Ball",
    category: "Mechanics",
    lang: "modelica",
    code: `model BouncingBall "Gravitational free-fall with restitution damping"
  parameter Real g = 9.81 "Gravity (m/s2)";
  parameter Real e = 0.8 "Coefficient of restitution";
  parameter Real k_ground = 5000.0 "Contact stiffness";
  parameter Real c_ground = 45.0 "Contact damping";

  Real h(start = 5.0) "Altitude (m)";
  Real v(start = 0.0) "Vertical velocity (m/s)";
equation
  der(h) = v;
  der(v) = -g + (if h < 0 then -k_ground * h - c_ground * v else 0.0);
end BouncingBall;`,
  },
  {
    id: "lorenz-attractor",
    title: "Lorenz Chaotic Attractor",
    category: "Nonlinear Dynamics",
    lang: "modelica",
    code: `model LorenzAttractor "Three-dimensional chaotic convection system"
  parameter Real sigma = 10.0 "Prandtl number";
  parameter Real rho = 28.0 "Rayleigh number";
  parameter Real beta = 2.6667 "Geometric factor";

  Real x(start = 1.0);
  Real y(start = 0.0);
  Real z(start = 0.0);
equation
  der(x) = sigma * (y - x);
  der(y) = x * (rho - z) - y;
  der(z) = x * y - beta * z;
end LorenzAttractor;`,
  },
  {
    id: "sysml-satellite",
    title: "CubeSat Power Architecture",
    category: "SysML v2",
    lang: "sysml2",
    code: `package CubeSatPowerSystem {
  part def SolarArray {
    attribute peakPower : Real = 48.0;
    port dcOut;
  }
  part def BatteryPack {
    attribute capacityWh : Real = 120.0;
    port powerBus;
  }
  part def AvionicsPayload {
    attribute nominalDrawW : Real = 18.5;
    port powerIn;
  }
  part cubeSat {
    part solar : SolarArray;
    part battery : BatteryPack;
    part payload : AvionicsPayload;
    connect solar.dcOut to battery.powerBus;
    connect battery.powerBus to payload.powerIn;
  }
}`,
  },
  {
    id: "scad-flanged-hub",
    title: "Parametric Flanged Drive Hub",
    category: "OpenSCAD CSG",
    lang: "scad",
    code: `// Parametric Aerospace Flanged Drive Hub
$fn = 48;
flange_radius = 42;
flange_thickness = 8;
hub_radius = 22;
hub_height = 32;
bore_radius = 10;

difference() {
  union() {
    cylinder(h = flange_thickness, r = flange_radius, center = false);
    cylinder(h = hub_height, r = hub_radius, center = false);
  }
  translate([0, 0, -1])
    cylinder(h = hub_height + 2, r = bore_radius, center = false);
  for (i = [0 : 5]) {
    rotate([0, 0, i * 60])
      translate([31, 0, -1])
        cylinder(h = flange_thickness + 2, r = 4, center = false);
  }
}`,
  },
  {
    id: "owl2-propulsion-ontology",
    title: "Aerospace Propulsion Ontology",
    category: "OWL2 Ontology",
    lang: "owl2",
    code: `Prefix(:=<http://modelscript.org/ontologies/propulsion#>)
Prefix(owl:=<http://www.w3.org/2002/07/owl#>)
Prefix(rdfs:=<http://www.w3.org/2000/01/rdf-schema#>)

Ontology(<http://modelscript.org/ontologies/propulsion>
  Declaration(Class(:PropulsionSystem))
  Declaration(Class(:LiquidRocketEngine))
  Declaration(Class(:TurbopumpAssembly))
  Declaration(Class(:ThrustChamber))
  Declaration(ObjectProperty(:hasSubsystem))

  SubClassOf(:LiquidRocketEngine :PropulsionSystem)
  SubClassOf(:LiquidRocketEngine ObjectSomeValuesFrom(:hasSubsystem :TurbopumpAssembly))
  SubClassOf(:LiquidRocketEngine ObjectSomeValuesFrom(:hasSubsystem :ThrustChamber))
  DisjointClasses(:TurbopumpAssembly :ThrustChamber)
)`,
  },
  {
    id: "pscad-ieee2800-inverter",
    title: "IEEE 2800 Grid-Forming Inverter",
    category: "PSCAD EMT",
    lang: "pscad",
    code: `<project name="IEEE2800_IBR_Benchmark" version="5.0.1">
  <definitions>
    <definition name="Main">
      <schematic>
        <User classid="UserCmp" id="u1" name="master:source_3" x="126" y="180">
          <paramlist>
            <param name="Name" value="Grid230kV_Thevenin" />
            <param name="Vm" value="230.0 [kV]" />
            <param name="F0" value="60.0 [Hz]" />
          </paramlist>
        </User>
        <User classid="UserCmp" id="u2" name="master:tline" x="252" y="180">
          <paramlist>
            <param name="Name" value="Collector_Line" />
            <param name="Length" value="42.0 [km]" />
          </paramlist>
        </User>
        <User classid="UserCmp" id="u3" name="master:xfmr-3p2w" x="396" y="180">
          <paramlist>
            <param name="Name" value="GSU_Transformer" />
            <param name="Tmva" value="120.0 [MVA]" />
            <param name="Xl" value="0.08 [pu]" />
          </paramlist>
        </User>
        <User classid="UserCmp" id="u4" name="master:inverter_fmu" x="540" y="180">
          <paramlist>
            <param name="Name" value="VSC_Inverter" />
            <param name="H_virt" value="4.5 [s]" />
          </paramlist>
        </User>
        <Wire classid="WireOrthogonal" id="w1" x="162" y="180">
          <vertex x="0" y="0" />
          <vertex x="54" y="0" />
        </Wire>
        <Wire classid="WireOrthogonal" id="w2" x="288" y="180">
          <vertex x="0" y="0" />
          <vertex x="54" y="0" />
        </Wire>
        <Wire classid="WireOrthogonal" id="w3" x="432" y="180">
          <vertex x="0" y="0" />
          <vertex x="88" y="0" />
        </Wire>
      </schematic>
    </definition>
  </definitions>
</project>`,
  },
  {
    id: "spice-lowpass-filter",
    title: "Active Sallen-Key Filter",
    category: "SPICE Circuit",
    lang: "spice",
    code: `* Second-Order Sallen-Key Low-Pass Filter
V1 in 0 SIN(0 1.0 1000) AC 1.0
R1 in n1 10k
R2 n1 out 10k
C1 n1 out 15.9n
C2 out 0 15.9n
Rload out 0 100k
.tran 10u 5m
.ac dec 20 10 100k
.end`,
  },
  {
    id: "fea-bracket-deck",
    title: "Titanium Actuator Bracket FEA",
    category: "CalculiX FEA",
    lang: "fea",
    code: `*HEADING
Ti-6Al-4V Aerospace Actuator Bracket Static Stress Analysis
*NODE
1, 0.0, 0.0, 0.0
2, 100.0, 0.0, 0.0
3, 100.0, 50.0, 0.0
4, 0.0, 50.0, 0.0
5, 0.0, 0.0, 12.0
6, 100.0, 0.0, 12.0
7, 100.0, 50.0, 12.0
8, 0.0, 50.0, 12.0
*ELEMENT, TYPE=C3D8, ELSET=EALL
1, 1, 2, 3, 4, 5, 6, 7, 8
*MATERIAL, NAME=TI6AL4V
*ELASTIC
114000.0, 0.34
*SOLID SECTION, ELSET=EALL, MATERIAL=TI6AL4V
*BOUNDARY
1, 1, 3
4, 1, 3
5, 1, 3
8, 1, 3
*STEP
*STATIC
*CLOAD
2, 3, -4500.0
3, 3, -4500.0
*END STEP`,
  },
  {
    id: "cfd-rae2822-su2",
    title: "RAE 2822 Transonic Airfoil CFD",
    category: "SU2 CFD",
    lang: "cfd",
    code: `% SU2 Configuration: RAE 2822 Transonic Airfoil
SOLVER= RANS
KIND_TURB_MODEL= SA
MATH_PROBLEM= DIRECT
MACH_NUMBER= 0.729
AOA= 2.31
FREESTREAM_TEMPERATURE= 288.15
REYNOLDS_NUMBER= 6.5E6
REYNOLDS_LENGTH= 1.0
NUM_METHOD_GRAD= GREEN_GAUSS
CFL_NUMBER= 10.0
ITER= 250
MESH_FILENAME= mesh_RAE2822_turb.su2
CONV_FILENAME= history`,
  },
  {
    id: "step-aerospace-bracket",
    title: "Aerospace Actuator Housing STEP",
    category: "STEP ISO 10303",
    lang: "step",
    code: `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Aerospace Ti-6Al-4V Bracket','AP242 Manifold B-Rep'),'2;1');
FILE_NAME('Aerospace_Bracket.step','2026-01-01T00:00:00',('ModelScript'),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1 = PRODUCT('AEROSPACE_BRACKET','Aerospace Actuator Bracket','',());
#101 = CARTESIAN_POINT('P1',(-50.0,-30.0,0.0));
#102 = CARTESIAN_POINT('P2',( 50.0,-30.0,0.0));
#103 = CARTESIAN_POINT('P3',( 50.0, 30.0,0.0));
#104 = CARTESIAN_POINT('P4',(-50.0, 30.0,0.0));
#105 = CARTESIAN_POINT('P5',(-50.0,-30.0,15.0));
#106 = CARTESIAN_POINT('P6',( 50.0,-30.0,15.0));
#107 = CARTESIAN_POINT('P7',( 50.0, 30.0,15.0));
#108 = CARTESIAN_POINT('P8',(-50.0, 30.0,15.0));
#201 = POLY_LOOP('BOT',(#101,#104,#103,#102));
#202 = POLY_LOOP('TOP',(#105,#106,#107,#108));
#203 = POLY_LOOP('FRONT',(#101,#102,#106,#105));
#204 = POLY_LOOP('RIGHT',(#102,#103,#107,#106));
#205 = POLY_LOOP('BACK',(#103,#104,#108,#107));
#206 = POLY_LOOP('LEFT',(#104,#101,#105,#108));
#301 = FACE_OUTER_BOUND('',#201,.T.);
#302 = FACE_OUTER_BOUND('',#202,.T.);
#303 = FACE_OUTER_BOUND('',#203,.T.);
#304 = FACE_OUTER_BOUND('',#204,.T.);
#305 = FACE_OUTER_BOUND('',#205,.T.);
#306 = FACE_OUTER_BOUND('',#206,.T.);
#401 = ADVANCED_FACE('Bottom',(#301),#1,.T.);
#402 = ADVANCED_FACE('Top',(#302),#1,.T.);
#403 = ADVANCED_FACE('Front',(#303),#1,.T.);
#404 = ADVANCED_FACE('Right',(#304),#1,.T.);
#405 = ADVANCED_FACE('Back',(#305),#1,.T.);
#406 = ADVANCED_FACE('Left',(#306),#1,.T.);
#501 = CLOSED_SHELL('Shell',(#401,#402,#403,#404,#405,#406));
#601 = MANIFOLD_SOLID_BREP('AerospaceBracket',#501);
ENDSEC;
END-ISO-10303-21;`,
  },
  {
    id: "simpack-pendulum",
    title: "Wind Turbine Planetary Drivetrain",
    category: "SIMPACK MBS",
    lang: "simpack",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<SimpackModel name="Planetary_Drivetrain_MBS" version="2026.1">
  <Body id="bedplate" name="Nacelle_Bedplate" mass="42000.0" ixx="180000.0" iyy="220000.0" izz="250000.0">
    <Marker id="m_bed_brg" name="MainBearing_Seat" x="0.0" y="0.0" z="1.5" />
  </Body>
  <Body id="rotor_shaft" name="Rotor_LowSpeed_Shaft" mass="68000.0" ixx="8500000.0" iyy="4200000.0" izz="4200000.0">
    <Marker id="m_lss_brg" name="LSS_Journal" x="0.0" y="0.0" z="1.5" />
    <Marker id="m_lss_end" name="LSS_Carrier_Spline" x="-2.4" y="0.0" z="1.5" />
  </Body>
  <Body id="sun_gear" name="Helical_Sun_Gear" mass="2400.0" ixx="1420.0" iyy="980.0" izz="980.0">
    <Marker id="m_sun_center" name="Sun_Center" x="-2.4" y="0.0" z="1.5" />
  </Body>
  <Joint id="j_lss_rev" name="Main_LSS_Revolute" type="revolute" from="m_bed_brg" to="m_lss_brg" />
  <Joint id="j_sun_rev" name="Sun_Gear_Revolute" type="revolute" from="m_lss_end" to="m_sun_center" />
  <Force id="f_mesh" name="Tooth_Mesh_Stiffness" from="m_lss_end" to="m_sun_center" kx="8.5e8" ky="1.2e9" kz="6.4e8" cx="2.5e5" cy="3.2e5" cz="1.8e5" />
</SimpackModel>`,
  },
  {
    id: "gensys-bogie",
    title: "High-Speed Rail Vehicle Bogie",
    category: "GENSYS Railway",
    lang: "gensys",
    code: `# GENSYS High-Speed Rail Bogie & EN 14363 Stability Model
set v_kmh = 250.0
set v_ms  = v_kmh / 3.6
speed v_ms
tstart 0.0
tstop  8.0
dt     0.001

body carbody  36000.0  58000.0  1650000.0  1620000.0   0.0  0.0  1.80
body bogie_f   2600.0   1750.0     3100.0     4100.0   9.0  0.0  0.60
wheelset axle_1  1550.0  840.0  110.0  840.0  1.435  0.460  0.15  "S1002_UIC60.whe"
wheelset axle_2  1550.0  840.0  110.0  840.0  1.435  0.460  0.15  "S1002_UIC60.whe"

spring k_prim_1  bogie_f  axle_1   15.0e6  5.5e6  1.1e6  10000.0  8000.0  16000.0
spring k_prim_2  bogie_f  axle_2   15.0e6  5.5e6  1.1e6  10000.0  8000.0  16000.0
spring k_sec_f   carbody  bogie_f   0.16e6  0.16e6 0.40e6 900000.0 25000.0 30000.0`,
  },
  {
    id: "epanet-water-network",
    title: "Municipal Water Distribution Loop",
    category: "EPANET Hydraulics",
    domain: "Fluids & Process",
    description: "Two-loop municipal potable water distribution network with reservoirs, junctions, and pipes.",
    tags: ["Water", "Hydraulics", "Pipes", "Civil"],
    lang: "epanet",
    code: `[TITLE]
Municipal Water Distribution Network Two-Loop System

[JUNCTIONS]
;ID              Elev         Demand       Pattern
 2               210          0.00         
 3               215          150.00       
 4               210          200.00       
 5               200          150.00       
 6               210          0.00         

[RESERVOIRS]
;ID              Head         Pattern
 1               240          

[PIPES]
;ID              Node1        Node2        Length       Diameter     Roughness    MinorLoss    Status
 1               1            2            3000         14           100          0            Open
 2               2            3            5000         12           100          0            Open
 3               3            4            5000         8            100          0            Open
 4               4            5            5000         8            100          0            Open
 5               5            6            5000         8            100          0            Open
 6               6            2            5000         10           100          0            Open
 7               3            6            5000         10           100          0            Open

[COORDINATES]
;Node            X-Coord      Y-Coord
 1               100          300
 2               300          300
 3               700          300
 4               700          100
 5               300          100
 6               500          200

[END]`,
  },
  {
    id: "sbml-enzymatic-cascade",
    title: "Michaelis-Menten Enzyme Cascade",
    category: "SBML Pathways",
    domain: "Systems Biology",
    description: "Biochemical enzyme-substrate binding and catalytic product formation kinetic network.",
    tags: ["Biochemical", "Enzymes", "Kinetics", "Pathways"],
    lang: "sbml",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<sbml xmlns="http://www.sbml.org/sbml/level3/version2/core" level="3" version="2">
  <model id="EnzymeKineticsCascade" name="Michaelis-Menten Enzymatic Pathway">
    <listOfCompartments>
      <compartment id="cell" spatialDimensions="3" size="1e-15" constant="true"/>
    </listOfCompartments>
    <listOfSpecies>
      <species id="Substrate" compartment="cell" initialConcentration="10.0" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false"/>
      <species id="Enzyme" compartment="cell" initialConcentration="1.0" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false"/>
      <species id="Complex" compartment="cell" initialConcentration="0.0" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false"/>
      <species id="Product" compartment="cell" initialConcentration="0.0" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false"/>
    </listOfSpecies>
    <listOfReactions>
      <reaction id="Binding" reversible="true">
        <listOfReactants>
          <speciesReference species="Substrate" stoichiometry="1" constant="true"/>
          <speciesReference species="Enzyme" stoichiometry="1" constant="true"/>
        </listOfReactants>
        <listOfProducts>
          <speciesReference species="Complex" stoichiometry="1" constant="true"/>
        </listOfProducts>
      </reaction>
      <reaction id="Catalysis" reversible="false">
        <listOfReactants>
          <speciesReference species="Complex" stoichiometry="1" constant="true"/>
        </listOfReactants>
        <listOfProducts>
          <speciesReference species="Product" stoichiometry="1" constant="true"/>
          <speciesReference species="Enzyme" stoichiometry="1" constant="true"/>
        </listOfProducts>
      </reaction>
    </listOfReactions>
  </model>
</sbml>`,
  },
  {
    id: "digital-thread-sysml-scad-modelica",
    title: "Digital Thread: SysML v2 + SCAD + Modelica",
    category: "SysML v2 Systems",
    domain: "Systems & Controls",
    description:
      "Multi-artifact digital thread linking SysML v2 thermal requirements, OpenSCAD heatsink geometry, and Modelica thermal plant dynamics with formal & simulation verification.",
    tags: ["Digital Thread", "SysML v2", "OpenSCAD", "Modelica", "Verification"],
    lang: "sysml2",
    activeFile: "Requirements.sysml",
    code: `package ThermalSystemThread {
  import ThermalPlant::*;

  part def HeatsinkAssembly {
    attribute fin_height_mm = 25.0 [mm];
    attribute max_temp_C = 85.0 [degC];
  }

  part def ThermalPlant {
    attribute T = 25.0 [degC];
  }

  requirement def <'REQ-THM-01'> MaxTempRequirement {
    doc /* Plant steady-state temperature shall remain below 85 degC */
    subject plant : ThermalPlant;
    require constraint { ThermalPlant.T_max <= 85.0 }
  }

  verification def ThermalSimVerification {
    subject plant : ThermalPlant;
    verify requirement MaxTempRequirement;
  }
}`,
    files: {
      "Requirements.sysml": `package ThermalSystemThread {
  import ThermalPlant::*;

  part def HeatsinkAssembly {
    attribute fin_height_mm = 25.0 [mm];
    attribute max_temp_C = 85.0 [degC];
  }

  part def ThermalPlant {
    attribute T = 25.0 [degC];
  }

  requirement def <'REQ-THM-01'> MaxTempRequirement {
    doc /* Plant steady-state temperature shall remain below 85 degC */
    subject plant : ThermalPlant;
    require constraint { ThermalPlant.T_max <= 85.0 }
  }

  verification def ThermalSimVerification {
    subject plant : ThermalPlant;
    verify requirement MaxTempRequirement;
  }
}`,
      "Enclosure.scad": `// @twin: fin_height_mm <-> ThermalSystemThread::HeatsinkAssembly.fin_height_mm
// @unit: fin_height_mm = mm
fin_height_mm = 25.0;
base_w = 60;
base_d = 40;

union() {
  cube([base_w, base_d, 4]);
  for (i = [0 : 4]) {
    translate([4 + i * 12, 0, 4])
      cube([3, base_d, fin_height_mm]);
  }
}`,
      "ThermalPlant.mo": `model ThermalPlant
  parameter Real fin_height_mm(unit="mm") = 25.0 annotation(twin = "ThermalSystemThread::HeatsinkAssembly.fin_height_mm");
  parameter Real T_max(unit="degC") = 85.0 annotation(twin = "ThermalSystemThread::HeatsinkAssembly.max_temp_C");
  parameter Real Q_in = 40.0;
  parameter Real C_th = 120.0;
  parameter Real G_conv = 0.85;
  Real T(start = 25.0);
equation
  C_th * der(T) = Q_in - G_conv * (T - 25.0);
  annotation(implements="ThermalPlant", experiment(StartTime = 0, StopTime = 300, Interval = 1));
end ThermalPlant;`,
    },
  },
  {
    id: "polyglot-power-grid-comtrade-calibration",
    title: "Polyglot Power Grid: SysML v2 + PSS/E + PSCAD + Fortran + Modelica + COMTRADE",
    category: "Power Grids & EMT",
    domain: "Power Grids",
    description:
      "End-to-end power systems digital thread linking SysML v2 NERC MOD-026 requirements, PSS/E transmission power flow, PSCAD EMT inverter island calling an external Fortran 90 (.f90) Volt-Var UDM, Modelica plant controller, and an IEEE COMTRADE (.cff) disturbance record for in-browser parameter calibration.",
    tags: ["Polyglot", "SysML v2", "PSS/E", "PSCAD", "Fortran 90", "Modelica", "COMTRADE", "Calibration"],
    lang: "sysml2",
    activeFile: "GridRequirements.sysml",
    code: `package IBRGridDigitalThread {
  import PlantController::*;

  part def GridArchitecture {
    attribute pcc_bus_kv = 230.0 [kV];
    attribute nominal_freq_hz = 60.0 [Hz];
    attribute emt_timestep_us = 50.0 [us];
  }

  part def PlantController {
    attribute K_droop = 4.0;
    attribute T_avr = 0.20 [s];
    attribute Vt_min_pu = 0.90 [pu];
  }

  requirement def <'REQ-MOD26-01'> VoltageRecoveryReq {
    doc /* Plant terminal voltage shall recover above 0.90 pu with calibrated droop gain */
    subject plant : PlantController;
    require constraint { PlantController.Vt >= 0.90 }
  }

  verification def ComtradeCalibrationVerification {
    subject plant : PlantController;
    verify requirement VoltageRecoveryReq;
  }
}`,
    files: {
      "GridRequirements.sysml": `package IBRGridDigitalThread {
  import PlantController::*;

  part def GridArchitecture {
    attribute pcc_bus_kv = 230.0 [kV];
    attribute nominal_freq_hz = 60.0 [Hz];
    attribute emt_timestep_us = 50.0 [us];
  }

  part def PlantController {
    attribute K_droop = 4.0;
    attribute T_avr = 0.20 [s];
    attribute Vt_min_pu = 0.90 [pu];
  }

  requirement def <'REQ-MOD26-01'> VoltageRecoveryReq {
    doc /* Plant terminal voltage shall recover above 0.90 pu with calibrated droop gain */
    subject plant : PlantController;
    require constraint { PlantController.Vt >= 0.90 }
  }

  verification def ComtradeCalibrationVerification {
    subject plant : PlantController;
    verify requirement VoltageRecoveryReq;
  }
}`,
      "TransmissionGrid.raw": `0, 100.0, 33, 0, 0, 60.0 / IEEE 3-BUS IBR INTERCONNECTION CASE
IBR DIGITAL THREAD — 230 KV TRANSMISSION INTERFACE
1, 'SLACK_230   ', 230.0000, 3, 1, 1, 1, 1.02000,   0.0000
2, 'PCC_IBR     ', 230.0000, 2, 1, 1, 1, 1.00000,  -2.4000
3, 'LOAD_SUB    ', 230.0000, 1, 1, 1, 1, 0.98500,  -5.1000
0 / END OF BUS DATA, BEGIN LOAD DATA
3, '1 ', 1, 1, 1, 120.000, 35.000, 0.000, 0.000, 0.000, 0.000, 1
0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA
0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA
1, '1 ',  70.000,  20.000,  150.000, -100.000, 1.02000, 0, 100.0, 0.0, 0.20, 0.0, 0.0, 1.0, 1, 100.0, 200.0, 0.0
2, '1 ',  50.000,  15.000,   60.000,  -60.000, 1.00000, 0, 100.0, 0.0, 0.15, 0.0, 0.0, 1.0, 1, 100.0, 100.0, 0.0
0 / END OF GENERATOR DATA, BEGIN BRANCH DATA
1, 2, '1 ', 0.01000, 0.08500, 0.01760, 250.0, 250.0, 250.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 1.0
2, 3, '1 ', 0.01700, 0.09200, 0.01580, 200.0, 200.0, 200.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 1.0
0 / END OF BRANCH DATA
Q`,
      "InverterIsland.pscx": `<project name="InverterIsland" version="5.0">
  <definitions>
    <Definition classid="UserCmpDefn" name="VoltVarDroopUDM" id="200">
      <paramlist>
        <param name="K_droop" value="4.0" />
        <param name="Q_max" value="1.2" />
      </paramlist>
      <script>
        <segment name="Fortran" id="1"><![CDATA[
#LOCAL REAL v_err, q_raw, q_clamped
v_err = 1.0 - ABS($V_pcc) / 230.0
q_raw = DROOP_GAIN(v_err, $K_droop)
CALL RIDE_THROUGH_CLAMP(q_raw, $Q_max, q_clamped)
$Q_cmd = q_clamped
        ]]></segment>
      </script>
    </Definition>
  </definitions>
  <schematic classid="UserCanvas">
    <User classid="UserCmp" id="10" name="master:source_3" defn="master:source_3" x="100" y="120">
      <paramlist>
        <param name="Name" value="GridSrc" />
        <param name="Vm" value="230.0" />
        <param name="F" value="60.0" />
      </paramlist>
    </User>
    <User classid="UserCmp" id="20" name="master:resistor" defn="master:resistor" x="240" y="120">
      <paramlist>
        <param name="Name" value="R_tie" />
        <param name="R" value="1.5" />
      </paramlist>
    </User>
    <User classid="UserCmp" id="30" name="VoltVarDroopUDM" defn="VoltVarDroopUDM" x="380" y="120">
      <paramlist>
        <param name="Name" value="IBR_Ctrl" />
        <param name="K_droop" value="4.0" />
        <param name="Q_max" value="1.2" />
      </paramlist>
    </User>
  </schematic>
</project>`,
      "VoltVarDroop.f90": `! Custom Fortran 90 User-Defined Model (UDM) linked into InverterIsland.pscx
! Called live at every EMTDC time step via PSCAD workspace Fortran dispatch.

REAL FUNCTION DROOP_GAIN(V_ERR, K_GAIN)
  REAL, INTENT(IN) :: V_ERR, K_GAIN
  ! Deadband +/- 0.01 pu before linear Volt-Var droop response
  IF (ABS(V_ERR) < 0.01) THEN
    DROOP_GAIN = 0.0
  ELSE
    DROOP_GAIN = V_ERR * K_GAIN
  END IF
END FUNCTION DROOP_GAIN

SUBROUTINE RIDE_THROUGH_CLAMP(Q_RAW, Q_MAX, Q_OUT)
  REAL, INTENT(IN) :: Q_RAW, Q_MAX
  REAL, INTENT(OUT) :: Q_OUT
  IF (Q_RAW > Q_MAX) THEN
    Q_OUT = Q_MAX
  ELSE IF (Q_RAW < -Q_MAX) THEN
    Q_OUT = -Q_MAX
  ELSE
    Q_OUT = Q_RAW
  END IF
END SUBROUTINE RIDE_THROUGH_CLAMP`,
      "PlantController.mo": `model PlantController
  // Initial uncalibrated estimates — open Inspector -> Calibration and fit to FaultRecord.cff
  // True disturbance parameters: K_droop = 4.0, T_avr = 0.20 s
  parameter Real K_droop = 2.0 annotation(twin = "IBRGridDigitalThread::PlantController.K_droop");
  parameter Real T_avr(unit = "s") = 0.45 annotation(twin = "IBRGridDigitalThread::PlantController.T_avr");
  parameter Real T_q(unit = "s") = 0.10;
  parameter Real V_ref = 1.00;
  parameter Real V_dip = 0.88;
  Real Vt(start = 0.88);
  Real Q_out(start = 0.0);
equation
  T_avr * der(Vt) = (V_ref - Vt) - 0.05 * (Vt - V_dip);
  T_q * der(Q_out) = K_droop * (V_ref - Vt) - Q_out;
  annotation(implements = "PlantController", experiment(StartTime = 0, StopTime = 1.5, Interval = 0.05));
end PlantController;`,
      "FaultRecord.cff": `--- file type: CFG ---
PCC_IBR_230KV,PMU_01,2013
2,2A,0D
1,Vt,,,pu,0.0001,0.0,0,-32767,32767,1.0,1.0,P
2,Q_out,,,pu,0.0001,0.0,0,-32767,32767,1.0,1.0,P
60.0
1
20.0,31
01/05/2026,14:22:10.000000
01/05/2026,14:22:10.000000
ASCII
1.0
--- file type: DAT ASCII ---
1,0,8800,0
2,50000,9064,1655
3,100000,9267,2297
4,150000,9423,2409
5,200000,9543,2263
6,250000,9635,2010
7,300000,9706,1730
8,350000,9761,1463
9,400000,9803,1227
10,450000,9835,1026
11,500000,9860,859
12,550000,9879,725
13,600000,9894,617
14,650000,9905,531
15,700000,9914,464
16,750000,9921,411
17,800000,9926,370
18,850000,9930,338
19,900000,9933,313
20,950000,9935,293
21,1000000,9937,279
22,1050000,9938,267
23,1100000,9939,258
24,1150000,9940,251
25,1200000,9941,246
26,1250000,9941,242
27,1300000,9942,239
28,1350000,9942,237
29,1400000,9942,235
30,1450000,9942,233
31,1500000,9942,232`,
    },
  },
  ...EXTENDED_LANGUAGE_EXAMPLES,
];
