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
  { id: "twentysim", label: "20-sim Bond Graphs", ext: ".emx" },
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
    ids: ["simulink", "easy5", "twentysim", "jsbsim", "rocets", "ccsds", "plcopen", "automationml"],
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
    domain: "Robotics & CAD",
    description: "Parametric aerospace flanged drive hub with central bore and 6-bolt mounting flange.",
    tags: ["VR", "3D", "OpenSCAD", "CAD", "Flange"],
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
    id: "scad-harmonic-servo",
    title: "Harmonic Drive Servo Actuator (VR 3D)",
    category: "OpenSCAD CSG",
    domain: "Robotics & CAD",
    description:
      "Parametric robotic harmonic-drive actuator housing with mounting flange, stator drum, 6 perimeter bolt bosses, and coaxial output shaft.",
    tags: ["VR", "3D", "OpenSCAD", "Robotics", "Servo", "Actuator"],
    lang: "scad",
    code: `// Robotic Harmonic Drive Servo Actuator (VR 3D Showcase)
$fn = 40;
base_r = 46;
base_h = 8;
stator_r = 34;
stator_h = 38;
cap_r = 38;
cap_h = 7;
shaft_r = 12;
shaft_h = 58;
bore_r = 6;

difference() {
  union() {
    // Mounting flange base
    cylinder(h = base_h, r = base_r, center = false);
    // Main stator housing drum
    cylinder(h = stator_h, r = stator_r, center = false);
    // Upper bearing retaining cap
    translate([0, 0, stator_h])
      cylinder(h = cap_h, r = cap_r, center = false);
    // Coaxial precision output shaft
    cylinder(h = shaft_h, r = shaft_r, center = false);
    // 6 perimeter bolt bosses
    for (i = [0 : 5]) {
      rotate([0, 0, i * 60])
        translate([39, 0, 0])
          cylinder(h = base_h + 4, r = 6, center = false);
    }
  }
  // Hollow cable pass-through bore
  translate([0, 0, -1])
    cylinder(h = shaft_h + 2, r = bore_r, center = false);
  // 6 flange mounting bolt holes
  for (i = [0 : 5]) {
    rotate([0, 0, i * 60])
      translate([39, 0, -1])
        cylinder(h = base_h + 8, r = 3, center = false);
  }
}`,
  },
  {
    id: "scad-hexacopter-frame",
    title: "Hexacopter Carbon Airframe (VR 3D)",
    category: "OpenSCAD CSG",
    domain: "Robotics & CAD",
    description:
      "6-rotor UAV carbon-composite central avionics chassis with 6 radial rotor booms and brushless motor mount cups.",
    tags: ["VR", "3D", "OpenSCAD", "Drone", "Hexacopter", "UAV"],
    lang: "scad",
    code: `// 6-Rotor Hexacopter Carbon Airframe (VR 3D Showcase)
$fn = 32;
hub_r = 26;
hub_h = 10;
arm_len = 62;
arm_w = 8;
arm_h = 6;
motor_r = 11;
motor_h = 12;

difference() {
  union() {
    // Central avionics deck & battery bay
    cylinder(h = hub_h, r = hub_r, center = false);
    // 6 radial rotor booms + brushless motor cups
    for (i = [0 : 5]) {
      rotate([0, 0, i * 60]) {
        translate([hub_r - 4, -arm_w / 2, 2])
          cube([arm_len, arm_w, arm_h], center = false);
        translate([hub_r + arm_len - 4, 0, 0])
          cylinder(h = motor_h, r = motor_r, center = false);
      }
    }
  }
  // Central avionics weight-relief bore
  translate([0, 0, -1])
    cylinder(h = hub_h + 2, r = 9, center = false);
  // 6 motor shaft clearances
  for (i = [0 : 5]) {
    rotate([0, 0, i * 60])
      translate([hub_r + arm_len - 4, 0, -1])
        cylinder(h = motor_h + 2, r = 4, center = false);
  }
}`,
  },
  {
    id: "scad-turbofan-shroud",
    title: "Ducted Turbofan Rotor Shroud (VR 3D)",
    category: "OpenSCAD CSG",
    domain: "Aerospace",
    description:
      "Parametric aerospace ducted fan cowling with concentric bypass duct, center spinner cone, and 6 radial stator struts.",
    tags: ["VR", "3D", "OpenSCAD", "Aerospace", "Turbofan", "CFD"],
    lang: "scad",
    code: `// Ducted Turbofan Nacelle & Stator Assembly (VR 3D Showcase)
$fn = 44;
outer_r = 48;
inner_r = 41;
duct_h = 34;
hub_r = 13;

union() {
  // Concentric bypass nacelle shroud
  difference() {
    cylinder(h = duct_h, r = outer_r, center = false);
    translate([0, 0, -1])
      cylinder(h = duct_h + 2, r = inner_r, center = false);
  }
  // Center hub & aerodynamic nose cone
  cylinder(h = duct_h * 0.72, r = hub_r, center = false);
  translate([0, 0, duct_h * 0.72])
    cylinder(h = 18, r1 = hub_r, r2 = 2, center = false);
  // 6 radial stator guide vanes
  for (i = [0 : 5]) {
    rotate([0, 0, i * 60])
      translate([hub_r - 2, -2, 8])
        cube([inner_r - hub_r + 4, 4, 14], center = false);
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
    domain: "Mechanics & Multibody",
    description:
      "Ti-6Al-4V aerospace actuator bracket static stress finite-element deck with Von Mises stress visualization in 3D & VR.",
    tags: ["VR", "3D", "FEA", "CalculiX", "Stress", "Aerospace"],
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
    domain: "Aerospace & Fluids",
    description:
      "Transonic Mach 0.729 RAE 2822 airfoil RANS Spalart-Allmaras CFD flow simulation with 3D aerodynamic field inspection in VR.",
    tags: ["VR", "3D", "CFD", "SU2", "Aerospace", "Airfoil"],
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
    domain: "Robotics & CAD",
    description:
      "ISO 10303-21 AP242 Ti-6Al-4V aerospace actuator mounting bracket with manifold B-Rep geometry for 3D CAD and VR inspection.",
    tags: ["VR", "3D", "STEP", "CAD", "Aerospace", "Bracket"],
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
    domain: "Mechanics & Multibody",
    description:
      "Multi-body wind turbine nacelle bedplate, low-speed rotor shaft, helical sun gear, and gear tooth mesh stiffness model.",
    tags: ["VR", "3D", "SIMPACK", "Multibody", "Drivetrain", "Wind Turbine"],
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
    domain: "Mechanics & Multibody",
    description:
      "250 km/h high-speed railway bogie & wheelset hunting stability model with primary suspension springs and S1002 wheel profiles.",
    tags: ["VR", "3D", "GENSYS", "Rail", "Multibody", "Bogie"],
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
  part def GridArchitecture {
    attribute pcc_bus_kv = 230.0 [kV];
    attribute nominal_freq_hz = 60.0 [Hz];
    attribute emt_timestep_us = 50.0 [us];
  }

  part def PlantController {
    // Baseline uncalibrated estimates (aligned with PlantController.mo).
    // Calibrating PlantController.mo against FaultRecord.cff updates K_droop -> 4.0, T_avr -> 0.20 s.
    attribute K_droop = 2.0;
    attribute T_avr = 0.45 [s];
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
  part def GridArchitecture {
    attribute pcc_bus_kv = 230.0 [kV];
    attribute nominal_freq_hz = 60.0 [Hz];
    attribute emt_timestep_us = 50.0 [us];
  }

  part def PlantController {
    // Baseline uncalibrated estimates (aligned with PlantController.mo).
    // Calibrating PlantController.mo against FaultRecord.cff updates K_droop -> 4.0, T_avr -> 0.20 s.
    attribute K_droop = 2.0;
    attribute T_avr = 0.45 [s];
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
  {
    id: "urdf-hexacopter-drone",
    title: "Autonomous Hexacopter UAV (URDF)",
    category: "URDF Robotics",
    domain: "Mechanics & Multibody",
    description:
      "6-rotor autonomous carbon-fiber hexacopter UAV with central avionics hub, 6 radial carbon arms, 6 continuous brushless rotor joints, 2-axis stabilized optical camera gimbal, and underslung 6S LiPo battery pack.",
    tags: ["VR", "URDF", "Drone", "UAV", "Hexacopter", "Robotics", "Multibody"],
    lang: "urdf",
    code: `<?xml version="1.0"?>
<robot name="autonomous_hexacopter_uav">
  <material name="carbon_matte">
    <color rgba="0.12 0.14 0.18 1.0"/>
  </material>
  <material name="aerospace_cyan">
    <color rgba="0.06 0.72 0.94 1.0"/>
  </material>
  <material name="safety_amber">
    <color rgba="0.96 0.62 0.04 1.0"/>
  </material>
  <material name="lipo_graphite">
    <color rgba="0.22 0.25 0.32 1.0"/>
  </material>

  <link name="base_link">
    <inertial>
      <mass value="1.85"/>
      <origin xyz="0 0 0" rpy="0 0 0"/>
      <inertia ixx="0.024" ixy="0" ixz="0" iyy="0.024" iyz="0" izz="0.041"/>
    </inertial>
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0"/>
      <geometry>
        <cylinder length="0.07" radius="0.14"/>
      </geometry>
      <material name="carbon_matte"/>
    </visual>
    <collision>
      <geometry>
        <cylinder length="0.08" radius="0.15"/>
      </geometry>
    </collision>
  </link>

  <link name="battery_pack">
    <inertial>
      <mass value="1.45"/>
      <origin xyz="0 0 0" rpy="0 0 0"/>
      <inertia ixx="0.0042" ixy="0" ixz="0" iyy="0.0068" iyz="0" izz="0.0075"/>
    </inertial>
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0"/>
      <geometry>
        <box size="0.19 0.085 0.065"/>
      </geometry>
      <material name="lipo_graphite"/>
    </visual>
  </link>

  <joint name="battery_mount_joint" type="fixed">
    <parent link="base_link"/>
    <child link="battery_pack"/>
    <origin xyz="0 0 -0.068" rpy="0 0 0"/>
  </joint>

  <link name="gimbal_yaw_link">
    <inertial>
      <mass value="0.18"/>
      <origin xyz="0 0 -0.03" rpy="0 0 0"/>
      <inertia ixx="0.0004" ixy="0" ixz="0" iyy="0.0004" iyz="0" izz="0.0005"/>
    </inertial>
    <visual>
      <origin xyz="0 0 -0.025" rpy="0 0 0"/>
      <geometry>
        <cylinder length="0.05" radius="0.032"/>
      </geometry>
      <material name="aerospace_cyan"/>
    </visual>
  </link>

  <joint name="gimbal_yaw_joint" type="revolute">
    <parent link="base_link"/>
    <child link="gimbal_yaw_link"/>
    <origin xyz="0.095 0 -0.055" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-3.14159" upper="3.14159" effort="2.5" velocity="6.0"/>
    <dynamics damping="0.02" friction="0.005"/>
  </joint>

  <link name="camera_gimbal_link">
    <inertial>
      <mass value="0.34"/>
      <origin xyz="0.01 0 0" rpy="0 0 0"/>
      <inertia ixx="0.0006" ixy="0" ixz="0" iyy="0.0007" iyz="0" izz="0.0006"/>
    </inertial>
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0"/>
      <geometry>
        <box size="0.075 0.065 0.058"/>
      </geometry>
      <material name="carbon_matte"/>
    </visual>
  </link>

  <joint name="gimbal_pitch_joint" type="revolute">
    <parent link="gimbal_yaw_link"/>
    <child link="camera_gimbal_link"/>
    <origin xyz="0 0 -0.058" rpy="0 0 0"/>
    <axis xyz="0 1 0"/>
    <limit lower="-1.5708" upper="0.5236" effort="2.0" velocity="5.0"/>
    <dynamics damping="0.015" friction="0.004"/>
  </joint>

  <link name="arm_1">
    <inertial>
      <mass value="0.16"/>
      <origin xyz="0.21 0 0" rpy="0 0 0"/>
      <inertia ixx="0.0002" ixy="0" ixz="0" iyy="0.0024" iyz="0" izz="0.0024"/>
    </inertial>
    <visual>
      <origin xyz="0.21 0 0" rpy="0 1.5708 0"/>
      <geometry>
        <cylinder length="0.42" radius="0.014"/>
      </geometry>
      <material name="carbon_matte"/>
    </visual>
  </link>
  <joint name="arm_1_joint" type="fixed">
    <parent link="base_link"/>
    <child link="arm_1"/>
    <origin xyz="0 0 0.01" rpy="0 0 0"/>
  </joint>

  <link name="rotor_1">
    <inertial>
      <mass value="0.14"/>
      <origin xyz="0 0 0.02" rpy="0 0 0"/>
      <inertia ixx="0.0005" ixy="0" ixz="0" iyy="0.0005" iyz="0" izz="0.0009"/>
    </inertial>
    <visual>
      <origin xyz="0 0 0.025" rpy="0 0 0"/>
      <geometry>
        <cylinder length="0.012" radius="0.19"/>
      </geometry>
      <material name="aerospace_cyan"/>
    </visual>
  </link>
  <joint name="rotor_1_joint" type="continuous">
    <parent link="arm_1"/>
    <child link="rotor_1"/>
    <origin xyz="0.42 0 0.02" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <dynamics damping="0.002" friction="0.001"/>
  </joint>

  <link name="arm_2">
    <inertial>
      <mass value="0.16"/>
      <origin xyz="0.21 0 0" rpy="0 0 0"/>
      <inertia ixx="0.0002" ixy="0" ixz="0" iyy="0.0024" iyz="0" izz="0.0024"/>
    </inertial>
    <visual>
      <origin xyz="0.21 0 0" rpy="0 1.5708 0"/>
      <geometry>
        <cylinder length="0.42" radius="0.014"/>
      </geometry>
      <material name="carbon_matte"/>
    </visual>
  </link>
  <joint name="arm_2_joint" type="fixed">
    <parent link="base_link"/>
    <child link="arm_2"/>
    <origin xyz="0 0 0.01" rpy="0 0 1.0472"/>
  </joint>

  <link name="rotor_2">
    <inertial>
      <mass value="0.14"/>
      <origin xyz="0 0 0.02" rpy="0 0 0"/>
      <inertia ixx="0.0005" ixy="0" ixz="0" iyy="0.0005" iyz="0" izz="0.0009"/>
    </inertial>
    <visual>
      <origin xyz="0 0 0.025" rpy="0 0 0"/>
      <geometry>
        <cylinder length="0.012" radius="0.19"/>
      </geometry>
      <material name="safety_amber"/>
    </visual>
  </link>
  <joint name="rotor_2_joint" type="continuous">
    <parent link="arm_2"/>
    <child link="rotor_2"/>
    <origin xyz="0.42 0 0.02" rpy="0 0 0"/>
    <axis xyz="0 0 -1"/>
    <dynamics damping="0.002" friction="0.001"/>
  </joint>

  <link name="arm_3">
    <inertial>
      <mass value="0.16"/>
      <origin xyz="0.21 0 0" rpy="0 0 0"/>
      <inertia ixx="0.0002" ixy="0" ixz="0" iyy="0.0024" iyz="0" izz="0.0024"/>
    </inertial>
    <visual>
      <origin xyz="0.21 0 0" rpy="0 1.5708 0"/>
      <geometry>
        <cylinder length="0.42" radius="0.014"/>
      </geometry>
      <material name="carbon_matte"/>
    </visual>
  </link>
  <joint name="arm_3_joint" type="fixed">
    <parent link="base_link"/>
    <child link="arm_3"/>
    <origin xyz="0 0 0.01" rpy="0 0 2.0944"/>
  </joint>

  <link name="rotor_3">
    <inertial>
      <mass value="0.14"/>
      <origin xyz="0 0 0.02" rpy="0 0 0"/>
      <inertia ixx="0.0005" ixy="0" ixz="0" iyy="0.0005" iyz="0" izz="0.0009"/>
    </inertial>
    <visual>
      <origin xyz="0 0 0.025" rpy="0 0 0"/>
      <geometry>
        <cylinder length="0.012" radius="0.19"/>
      </geometry>
      <material name="aerospace_cyan"/>
    </visual>
  </link>
  <joint name="rotor_3_joint" type="continuous">
    <parent link="arm_3"/>
    <child link="rotor_3"/>
    <origin xyz="0.42 0 0.02" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <dynamics damping="0.002" friction="0.001"/>
  </joint>

  <link name="arm_4">
    <inertial>
      <mass value="0.16"/>
      <origin xyz="0.21 0 0" rpy="0 0 0"/>
      <inertia ixx="0.0002" ixy="0" ixz="0" iyy="0.0024" iyz="0" izz="0.0024"/>
    </inertial>
    <visual>
      <origin xyz="0.21 0 0" rpy="0 1.5708 0"/>
      <geometry>
        <cylinder length="0.42" radius="0.014"/>
      </geometry>
      <material name="carbon_matte"/>
    </visual>
  </link>
  <joint name="arm_4_joint" type="fixed">
    <parent link="base_link"/>
    <child link="arm_4"/>
    <origin xyz="0 0 0.01" rpy="0 0 3.14159"/>
  </joint>

  <link name="rotor_4">
    <inertial>
      <mass value="0.14"/>
      <origin xyz="0 0 0.02" rpy="0 0 0"/>
      <inertia ixx="0.0005" ixy="0" ixz="0" iyy="0.0005" iyz="0" izz="0.0009"/>
    </inertial>
    <visual>
      <origin xyz="0 0 0.025" rpy="0 0 0"/>
      <geometry>
        <cylinder length="0.012" radius="0.19"/>
      </geometry>
      <material name="safety_amber"/>
    </visual>
  </link>
  <joint name="rotor_4_joint" type="continuous">
    <parent link="arm_4"/>
    <child link="rotor_4"/>
    <origin xyz="0.42 0 0.02" rpy="0 0 0"/>
    <axis xyz="0 0 -1"/>
    <dynamics damping="0.002" friction="0.001"/>
  </joint>

  <link name="arm_5">
    <inertial>
      <mass value="0.16"/>
      <origin xyz="0.21 0 0" rpy="0 0 0"/>
      <inertia ixx="0.0002" ixy="0" ixz="0" iyy="0.0024" iyz="0" izz="0.0024"/>
    </inertial>
    <visual>
      <origin xyz="0.21 0 0" rpy="0 1.5708 0"/>
      <geometry>
        <cylinder length="0.42" radius="0.014"/>
      </geometry>
      <material name="carbon_matte"/>
    </visual>
  </link>
  <joint name="arm_5_joint" type="fixed">
    <parent link="base_link"/>
    <child link="arm_5"/>
    <origin xyz="0 0 0.01" rpy="0 0 4.18879"/>
  </joint>

  <link name="rotor_5">
    <inertial>
      <mass value="0.14"/>
      <origin xyz="0 0 0.02" rpy="0 0 0"/>
      <inertia ixx="0.0005" ixy="0" ixz="0" iyy="0.0005" iyz="0" izz="0.0009"/>
    </inertial>
    <visual>
      <origin xyz="0 0 0.025" rpy="0 0 0"/>
      <geometry>
        <cylinder length="0.012" radius="0.19"/>
      </geometry>
      <material name="aerospace_cyan"/>
    </visual>
  </link>
  <joint name="rotor_5_joint" type="continuous">
    <parent link="arm_5"/>
    <child link="rotor_5"/>
    <origin xyz="0.42 0 0.02" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <dynamics damping="0.002" friction="0.001"/>
  </joint>

  <link name="arm_6">
    <inertial>
      <mass value="0.16"/>
      <origin xyz="0.21 0 0" rpy="0 0 0"/>
      <inertia ixx="0.0002" ixy="0" ixz="0" iyy="0.0024" iyz="0" izz="0.0024"/>
    </inertial>
    <visual>
      <origin xyz="0.21 0 0" rpy="0 1.5708 0"/>
      <geometry>
        <cylinder length="0.42" radius="0.014"/>
      </geometry>
      <material name="carbon_matte"/>
    </visual>
  </link>
  <joint name="arm_6_joint" type="fixed">
    <parent link="base_link"/>
    <child link="arm_6"/>
    <origin xyz="0 0 0.01" rpy="0 0 5.23599"/>
  </joint>

  <link name="rotor_6">
    <inertial>
      <mass value="0.14"/>
      <origin xyz="0 0 0.02" rpy="0 0 0"/>
      <inertia ixx="0.0005" ixy="0" ixz="0" iyy="0.0005" iyz="0" izz="0.0009"/>
    </inertial>
    <visual>
      <origin xyz="0 0 0.025" rpy="0 0 0"/>
      <geometry>
        <cylinder length="0.012" radius="0.19"/>
      </geometry>
      <material name="safety_amber"/>
    </visual>
  </link>
  <joint name="rotor_6_joint" type="continuous">
    <parent link="arm_6"/>
    <child link="rotor_6"/>
    <origin xyz="0.42 0 0.02" rpy="0 0 0"/>
    <axis xyz="0 0 -1"/>
    <dynamics damping="0.002" friction="0.001"/>
  </joint>
</robot>`,
  },
  {
    id: "modelica-wind-turbine",
    title: "5 MW Offshore Wind Turbine Drivetrain",
    category: "Energy & Aerospace",
    domain: "Mechanics & Multibody",
    description:
      "5 MW variable-speed pitch-controlled offshore wind turbine coupling aerodynamic rotor torque, 2-mass flexible drivetrain + 1:97 nacelle planetary gearbox, generator torque control, and PI blade pitch regulation.",
    tags: ["VR", "Modelica", "Wind Turbine", "Drivetrain", "Pitch Control", "Renewable"],
    lang: "modelica",
    code: `model OffshoreWindTurbine5MW "5 MW variable-speed wind turbine drivetrain, nacelle gearbox & blade pitch controller"
  parameter Real rho = 1.225 "Air density (kg/m3)";
  parameter Real R_blade = 63.0 "Rotor blade radius (m)";
  parameter Real N_gear = 97.0 "Nacelle planetary gearbox ratio";
  parameter Real J_rotor = 3.54e7 "Low-speed rotor inertia (kg*m2)";
  parameter Real J_gen = 534.0 "High-speed generator inertia (kg*m2)";
  parameter Real K_shaft = 8.67e8 "Main shaft torsional stiffness (N*m/rad)";
  parameter Real D_shaft = 6.21e6 "Main shaft torsional damping (N*m*s/rad)";
  parameter Real eta_gear = 0.965 "Gearbox & converter efficiency";
  parameter Real v_wind_mean = 13.5 "Mean hub-height wind speed (m/s)";
  parameter Real v_gust_amp = 2.6 "Turbulent gust amplitude (m/s)";
  parameter Real omega_ref = 1.267 "Rated rotor speed setpoint (rad/s, ~12.1 rpm)";
  parameter Real P_rated = 5.0e6 "Rated electrical output (W)";
  parameter Real Kp_pitch = 22.0 "Blade pitch proportional gain (deg*s/rad)";
  parameter Real Ki_pitch = 5.5 "Blade pitch integral gain (deg/rad)";
  parameter Real tau_pitch = 0.35 "Hydraulic pitch actuator lag (s)";

  Real omega_r(start = 1.18) "Rotor low-speed shaft velocity (rad/s)";
  Real omega_g(start = 114.46) "Generator high-speed shaft velocity (rad/s)";
  Real theta_twist(start = 0.0042) "Drivetrain torsional shaft twist (rad)";
  Real beta_deg(start = 4.5) "Collective blade pitch angle (deg)";
  Real pitch_int(start = 4.5) "Blade pitch PI integrator state (deg)";

  Real v_wind "Hub-height wind speed (m/s)";
  Real tsr "Rotor tip-speed ratio";
  Real Cp "Aerodynamic power coefficient";
  Real T_aero "Aerodynamic rotor torque (N*m)";
  Real T_shaft "Low-speed shaft torsional torque (N*m)";
  Real T_gen "High-speed generator reaction torque (N*m)";
  Real beta_raw "Unclamped blade pitch command (deg)";
  Real beta_cmd "Clamped blade pitch command (deg)";
  Real P_elec_MW "Net electrical power output (MW)";
  Real rpm_rotor "Rotor speed (rpm)";
equation
  v_wind = v_wind_mean + v_gust_amp * sin(0.35 * time);
  tsr = omega_r * R_blade / (if v_wind > 1.0 then v_wind else 1.0);
  Cp = max(0.05, 0.48 * exp(-0.045 * (tsr - 7.5) * (tsr - 7.5)) * exp(-0.058 * beta_deg));

  T_aero = 0.5 * rho * 3.14159265 * R_blade * R_blade * v_wind * v_wind * v_wind * Cp
           / (if omega_r > 0.2 then omega_r else 0.2);

  T_shaft = K_shaft * theta_twist + D_shaft * (omega_r - omega_g / N_gear);
  T_gen = P_rated / (eta_gear * (if omega_g > 10.0 then omega_g else 10.0));

  der(theta_twist) = omega_r - omega_g / N_gear;
  J_rotor * der(omega_r) = T_aero - T_shaft;
  J_gen * der(omega_g) = (T_shaft / N_gear) - T_gen;

  der(pitch_int) = Ki_pitch * (omega_r - omega_ref);
  beta_raw = pitch_int + Kp_pitch * (omega_r - omega_ref);
  beta_cmd = if beta_raw < 0.0 then 0.0 else (if beta_raw > 28.0 then 28.0 else beta_raw);
  tau_pitch * der(beta_deg) = beta_cmd - beta_deg;

  P_elec_MW = eta_gear * T_gen * omega_g * 1.0e-6;
  rpm_rotor = omega_r * 9.54929659;

  annotation(experiment(StartTime = 0, StopTime = 30, Interval = 0.1));
end OffshoreWindTurbine5MW;`,
  },
  {
    id: "modelica-ev-battery-cooling",
    title: "800V EV Battery Electro-Thermal Pack",
    category: "Automotive & Thermal",
    domain: "Fluids & Process",
    description:
      "800V 100 kWh EV traction battery pack coupling OCV + RC polarization electro-chemistry, Joule heat generation, serpentine liquid cold-plate conduction, and proportional glycol pump cooling under high-load transients.",
    tags: ["VR", "Modelica", "EV Battery", "800V", "Thermal", "Cold Plate", "Automotive"],
    lang: "modelica",
    code: `model EVBatteryPackCooling800V "800V EV traction battery electro-thermal & liquid cold-plate cooling model"
  parameter Real Q_nom_Ah = 125.0 "Nominal pack capacity (Ah, ~100 kWh at 800V)";
  parameter Real R0_ref = 0.042 "Pack ohmic internal resistance at 25 degC (Ohm)";
  parameter Real R1 = 0.018 "RC polarization resistance (Ohm)";
  parameter Real C1 = 1800.0 "RC polarization capacitance (F)";
  parameter Real C_cell = 4.2e5 "Prismatic cell stack thermal mass (J/K)";
  parameter Real C_plate = 6.5e4 "Serpentine aluminum cold-plate thermal mass (J/K)";
  parameter Real UA_cell_plate = 950.0 "Cell-to-cold-plate thermal conductance (W/K)";
  parameter Real UA_amb = 18.0 "Pack enclosure ambient conductance (W/K)";
  parameter Real cp_coolant = 3450.0 "50/50 water-glycol specific heat (J/(kg*K))";
  parameter Real T_inlet = 293.15 "Chiller coolant inlet temperature (K, 20 degC)";
  parameter Real T_target = 306.15 "Target cell temperature setpoint (K, 33 degC)";
  parameter Real T_amb = 298.15 "Ambient underbody air temperature (K, 25 degC)";
  parameter Real I_base = 260.0 "Sustained highway/fast-charge current (A)";
  parameter Real I_pulse = 140.0 "Acceleration/regen current modulation (A)";

  Real soc(start = 0.85) "Pack State of Charge (0..1)";
  Real V_rc(start = 0.0) "RC polarization overpotential (V)";
  Real T_cell(start = 298.15) "Cell core temperature (K)";
  Real T_plate(start = 295.15) "Liquid cold-plate temperature (K)";

  Real I_pack "Pack discharge current (A)";
  Real V_ocv "Pack open-circuit voltage (V)";
  Real R0 "Temperature-dependent ohmic resistance (Ohm)";
  Real V_term "Pack terminal voltage (V)";
  Real P_elec_kW "Pack electrical power output (kW)";
  Real Q_gen "Total electrochemical Joule heat generation (W)";
  Real m_dot_raw "Unclamped glycol coolant pump flow command (kg/s)";
  Real m_dot_coolant "Clamped coolant mass flow rate (kg/s)";
  Real Q_cooling "Heat rejected into liquid cold-plate loop (W)";
  Real T_cell_C "Cell core temperature (degC)";
  Real T_plate_C "Cold-plate temperature (degC)";
equation
  I_pack = I_base + I_pulse * sin(0.04 * time);
  der(soc) = -I_pack / (Q_nom_Ah * 3600.0);

  V_ocv = 720.0 + 135.0 * soc - 28.0 * (1.0 - soc) * (1.0 - soc);
  R0 = R0_ref * (1.0 - 0.004 * (T_cell - 298.15));
  C1 * der(V_rc) = I_pack - V_rc / R1;
  V_term = V_ocv - I_pack * R0 - V_rc;
  P_elec_kW = V_term * I_pack * 1.0e-3;

  Q_gen = I_pack * I_pack * R0 + (V_rc * V_rc) / R1;

  m_dot_raw = 0.12 + 0.045 * (T_cell - T_target);
  m_dot_coolant = if m_dot_raw < 0.08 then 0.08 else (if m_dot_raw > 0.65 then 0.65 else m_dot_raw);
  Q_cooling = m_dot_coolant * cp_coolant * (T_plate - T_inlet) * 0.72;

  C_cell * der(T_cell) = Q_gen - UA_cell_plate * (T_cell - T_plate) - UA_amb * (T_cell - T_amb);
  C_plate * der(T_plate) = UA_cell_plate * (T_cell - T_plate) - Q_cooling;

  T_cell_C = T_cell - 273.15;
  T_plate_C = T_plate - 273.15;

  annotation(experiment(StartTime = 0, StopTime = 600, Interval = 2));
end EVBatteryPackCooling800V;`,
  },
  {
    id: "modelica-orbital-satellite",
    title: "LEO Satellite ADCS & Eclipse Thermal",
    category: "Aerospace & Orbital",
    domain: "Systems & Controls",
    description:
      "Low-Earth-Orbit (LEO) spacecraft combining reaction-wheel attitude slew control (ADCS), wheel momentum exchange, and sunlit-to-eclipse radiative thermal balance.",
    tags: ["VR", "Modelica", "Satellite", "ADCS", "Reaction Wheel", "Orbital", "Thermal"],
    lang: "modelica",
    code: `model OrbitalSatelliteADCS "LEO spacecraft reaction-wheel ADCS slew & solar eclipse thermal balance"
  parameter Real I_sc = 42.0 "Spacecraft bus moment of inertia (kg*m2)";
  parameter Real I_rw = 0.035 "Reaction wheel rotor inertia (kg*m2)";
  parameter Real theta_cmd = 0.5236 "Target attitude slew angle (rad, 30 deg)";
  parameter Real Kp_adcs = 6.4 "ADCS attitude proportional gain (N*m/rad)";
  parameter Real Kd_adcs = 14.5 "ADCS angular rate derivative gain (N*m*s/rad)";
  parameter Real tau_rw_max = 0.25 "Reaction wheel peak torque limit (N*m)";
  parameter Real T_orbit = 5400.0 "LEO orbital period (s, 90 min)";
  parameter Real S_solar = 1361.0 "AM0 solar constant (W/m2)";
  parameter Real A_panel = 2.4 "Projected solar wing area (m2)";
  parameter Real alpha_s = 0.72 "Solar absorptivity";
  parameter Real eps_ir = 0.82 "Radiator infrared emissivity";
  parameter Real A_rad = 1.6 "Thermal radiator louver area (m2)";
  parameter Real sigma_sb = 5.670374e-8 "Stefan-Boltzmann constant (W/(m2*K4))";
  parameter Real C_bus = 38000.0 "Spacecraft thermal capacitance (J/K)";
  parameter Real Q_avionics = 185.0 "Internal payload & ADCS heat load (W)";

  Real theta(start = 0.0) "Spacecraft attitude angle (rad)";
  Real omega_sc(start = 0.0) "Spacecraft angular rate (rad/s)";
  Real omega_rw(start = 0.0) "Reaction wheel angular speed (rad/s)";
  Real T_bus(start = 295.0) "Spacecraft bus temperature (K)";

  Real tau_cmd "Unclamped PD attitude torque command (N*m)";
  Real tau_rw "Reaction wheel applied torque (N*m)";
  Real sunlight "Orbital solar illumination factor (1=sunlit, 0=eclipse)";
  Real Q_solar "Absorbed solar flux (W)";
  Real Q_rad "Deep-space infrared radiation (W)";
  Real theta_deg "Spacecraft pointing angle (deg)";
  Real rpm_rw "Reaction wheel speed (rpm)";
  Real T_bus_C "Spacecraft bus temperature (degC)";
equation
  tau_cmd = Kp_adcs * (theta_cmd - theta) - Kd_adcs * omega_sc;
  tau_rw = if tau_cmd > tau_rw_max then tau_rw_max else (if tau_cmd < -tau_rw_max then -tau_rw_max else tau_cmd);

  der(theta) = omega_sc;
  I_sc * der(omega_sc) = tau_rw - 0.002 * omega_sc;
  I_rw * der(omega_rw) = -tau_rw - 1.0e-5 * omega_rw;

  sunlight = if sin(2.0 * 3.14159265 * time / T_orbit) > -0.35 then 1.0 else 0.0;
  Q_solar = sunlight * alpha_s * S_solar * A_panel * 0.28;
  Q_rad = eps_ir * sigma_sb * A_rad * T_bus * T_bus * T_bus * T_bus;
  C_bus * der(T_bus) = Q_solar + Q_avionics - Q_rad;

  theta_deg = theta * 57.2957795;
  rpm_rw = omega_rw * 9.54929659;
  T_bus_C = T_bus - 273.15;

  annotation(experiment(StartTime = 0, StopTime = 5400, Interval = 10));
end OrbitalSatelliteADCS;`,
  },
  {
    id: "modelica-pelagos-octopus",
    title: "Pelagos OC-8 Subsea Robotic Octopus",
    category: "Subsea Robotics & Multibody",
    domain: "Mechanics & Multibody",
    description:
      "Acausal multi-body + fluid siphon Modelica starter template for Pelagos OC-8 (8 arms, 202 segments, 489 wheels) coupling SeawaterIntake, BrushlessPumpDrive, SwashplatePump7Piston, SiphonJetNozzle (2.68 m/s, 6.0 N), 4-DOF MantleRigidBody, and ArticulatedArmBank with autonomous Arm 3 detach/reconnect.",
    tags: ["vr", "robotics", "subsea", "multibody", "fluid", "modelica", "pelagos", "siphon", "3d"],
    lang: "modelica",
    code: `model PelagosOC8SubseaOctopus "Pelagos OC-8 8-arm subsea robotic octopus — coupled multi-body + 7-piston swashplate fluid siphon starter template"

  // ── Acausal Physical Connectors ──────────────────────────────────────────

  connector FluidPort "Acausal incompressible seawater hydraulic port"
    Real p "Static seawater pressure [Pa]";
    flow Real m_flow "Seawater mass flow rate into component [kg/s]";
  end FluidPort;

  connector RotationalShaft "Acausal 1D rotational drive flange for the 7-piston swashplate shaft"
    Real phi "Shaft rotation angle [rad]";
    flow Real tau "Shaft torque into component [N*m]";
  end RotationalShaft;

  connector SurgeFlange "Acausal 1D multi-body hydrodynamic surge coupling (swim axis)"
    Real s "Forward surge displacement [m]";
    flow Real f "Axial propulsion / reaction force [N]";
  end SurgeFlange;

  connector HeaveFlange "Acausal 1D multi-body hydrodynamic heave coupling (depth axis)"
    Real z "Subsea operating depth below surface [m]";
    flow Real f_z "Vertical ballast / heave force [N]";
  end HeaveFlange;

  connector ArmMountFlange "Acausal multi-body arm-to-mantle roll torque coupling (supports Arm 3 magnetic detach)"
    Real roll "Mantle roll attitude angle [rad]";
    flow Real tau_roll "Net arm-chain roll reaction torque on mantle [N*m]";
  end ArmMountFlange;

  // ── Subsystem Models ─────────────────────────────────────────────────────

  model SeawaterIntake "Ambient hydrostatic seawater intake boundary"
    FluidPort port_out "Suction outlet to 7-piston swashplate pump";
    input Real depthM "Instantaneous vehicle depth [m]";
    parameter Real p_atm = 101325.0 "Sea-level atmospheric pressure [Pa]";
    parameter Real rhoSea = 1025.0 "Ambient seawater density [kg/m3]";
    parameter Real g = 9.81 "Gravitational acceleration [m/s2]";
  equation
    port_out.p = p_atm + rhoSea * g * max(0.0, depthM);
  end SeawaterIntake;

  model BrushlessPumpDrive "Servo-regulated brushless swashplate pump motor drive"
    RotationalShaft flange "Mechanical shaft output flange";
    input Real omegaCmd "Target swashplate angular speed [rad/s]";
    parameter Real J_motor = 0.004 "Motor rotor inertia [kg*m2]";
    parameter Real Kp_speed = 0.28 "Proportional shaft speed controller gain [N*m*s/rad]";
    parameter Real tau_max = 18.0 "Peak brushless motor torque limit [N*m]";
    Real omega(start = 47.12, fixed = true) "Motor shaft angular speed [rad/s]";
    Real tau_em "Electromagnetic drive torque [N*m]";
    Real elecPowerW "Electrical drive power [W]";
  equation
    omega = der(flange.phi);
    tau_em = max(-tau_max, min(tau_max, Kp_speed * (omegaCmd - omega)));
    J_motor * der(omega) = tau_em + flange.tau;
    elecPowerW = abs(tau_em * omega);
  end BrushlessPumpDrive;

  model SwashplatePump7Piston "Internal 7-piston axial swashplate seawater pump with core thermal balance"
    FluidPort port_in "Ambient seawater suction port";
    FluidPort port_out "Pressurized discharge manifold to siphon nozzle";
    RotationalShaft shaft "Mechanical drive input from brushless motor";

    parameter Integer nPistons = 7 "Axial piston cylinder count";
    parameter Real swashplateTiltRad = 0.28 "Swashplate tilt angle [rad]";
    parameter Real pitchRadius = 0.042 "Piston pitch-circle radius [m]";
    parameter Real pistonArea = 5.5e-4 "Individual piston bore area [m2]";
    parameter Real etaVol = 0.94 "Volumetric efficiency";
    parameter Real rhoSea = 1025.0 "Seawater density [kg/m3]";
    parameter Real J_barrel = 0.004 "Cylinder barrel inertia [kg*m2]";
    parameter Real b_viscous = 0.0022 "Rotary viscous friction [N*m*s/rad]";
    parameter Real T_seaC = 18.0 "Ambient seawater temperature [degC]";
    parameter Real C_pump = 28.0 "Pump core thermal capacitance [J/K]";
    parameter Real G_hull = 12.0 "Mantle-to-seawater thermal conductance [W/K]";

    Real theta(start = 0.0, fixed = true) "Swashplate barrel rotation angle [rad]";
    Real omega(start = 47.12, fixed = true) "Swashplate angular speed [rad/s]";
    Real tempC(start = 23.0, fixed = true) "7-piston pump core temperature [degC]";
    Real strokeAmp "Single-piston axial stroke amplitude [m]";
    Real piston1Disp "Piston 1 axial stroke displacement [m]";
    Real piston2Disp "Piston 2 axial stroke displacement [m]";
    Real piston3Disp "Piston 3 axial stroke displacement [m]";
    Real piston4Disp "Piston 4 axial stroke displacement [m]";
    Real piston5Disp "Piston 5 axial stroke displacement [m]";
    Real piston6Disp "Piston 6 axial stroke displacement [m]";
    Real piston7Disp "Piston 7 axial stroke displacement [m]";
    Real flowRate "Volumetric seawater discharge rate [m3/s]";
    Real flowLpm "Volumetric seawater discharge rate [L/min]";
    Real deltaP "Discharge pressure rise across pump [Pa]";
    Real hydraulicPowerW "Delivered fluid hydraulic power [W]";
    Real heatLossW "Viscous & motor Joule heat dissipation [W]";
  equation
    shaft.phi = theta;
    der(theta) = omega;

    // 7-piston axial swashplate kinematics (2*pi/7 = 0.8975979 rad spacing)
    strokeAmp = pitchRadius * tan(swashplateTiltRad);
    piston1Disp = strokeAmp * sin(theta + 0.0000000);
    piston2Disp = strokeAmp * sin(theta + 0.8975979);
    piston3Disp = strokeAmp * sin(theta + 1.7951958);
    piston4Disp = strokeAmp * sin(theta + 2.6927937);
    piston5Disp = strokeAmp * sin(theta + 3.5903916);
    piston6Disp = strokeAmp * sin(theta + 4.4879895);
    piston7Disp = strokeAmp * sin(theta + 5.3855874);

    // Positive-displacement mass conservation
    flowRate = max(0.0, etaVol * nPistons * pistonArea * (2.0 * strokeAmp) * (omega / (2.0 * 3.14159265)));
    flowLpm = flowRate * 60000.0;
    port_in.m_flow = rhoSea * flowRate;
    port_in.m_flow + port_out.m_flow = 0.0;

    // Hydraulic load torque & thermal core balance
    deltaP = max(0.0, port_out.p - port_in.p);
    hydraulicPowerW = flowRate * deltaP;
    J_barrel * der(omega) = shaft.tau - b_viscous * omega - hydraulicPowerW / max(1.0, omega);

    heatLossW = 42.0 + 0.35 * hydraulicPowerW + 0.0018 * omega * omega;
    C_pump * der(tempC) = heatLossW - G_hull * (tempC - T_seaC);
  end SwashplatePump7Piston;

  model SiphonJetNozzle "Vectored siphon water-jet thruster nozzle (2.68 m/s peak, 6.0 N burst)"
    FluidPort port_in "Pressurized seawater supply from 7-piston pump";
    SurgeFlange flange_hull "Mechanical reaction thrust transmitted to mantle hull";
    input Real depthM "Vehicle operating depth for ambient back-pressure [m]";

    parameter Real nozzleArea = 8.15e-4 "Convergent siphon nozzle exit area [m2]";
    parameter Real Cd_nozzle = 0.96 "Nozzle discharge coefficient";
    parameter Real p_atm = 101325.0 "Sea-level atmospheric pressure [Pa]";
    parameter Real rhoSea = 1025.0 "Ambient seawater density [kg/m3]";
    parameter Real g = 9.81 "Gravitational acceleration [m/s2]";
    parameter Real maxJetVelocity = 2.68 "Peak rated siphon exit velocity [m/s]";
    parameter Real maxThrust = 6.0 "Peak rated siphon burst thrust [N]";

    Real p_amb "Ambient seawater static pressure at nozzle exit [Pa]";
    Real Q_jet "Nozzle volumetric jet discharge [m3/s]";
    Real jetVelocity "Siphon nozzle exit jet velocity [m/s]";
    Real thrust "Water-jet momentum thrust [N]";
    Real jetLoad "Normalized propulsion load [%]";
    Real jetLoadFrac "Normalized propulsion load fraction [0..1]";
  equation
    p_amb = p_atm + rhoSea * g * max(0.0, depthM);
    Q_jet = max(0.0, port_in.m_flow / rhoSea);
    jetVelocity = min(maxJetVelocity, Q_jet / nozzleArea);

    // Bernoulli convergent nozzle pressure drop
    port_in.p - p_amb = 0.5 * rhoSea * (jetVelocity / Cd_nozzle) * (jetVelocity / Cd_nozzle);

    // Momentum jet reaction force applied acausally to hull surge flange
    thrust = min(maxThrust, port_in.m_flow * jetVelocity);
    flange_hull.f = -thrust;
    jetLoadFrac = thrust / maxThrust;
    jetLoad = 100.0 * jetLoadFrac;
  end SiphonJetNozzle;

  model BallastDepthActuator "Hydrostatic variable-buoyancy ballast trim actuator"
    HeaveFlange flange_heave "Vertical ballast force applied to mantle hull";
    input Real depthTarget "Commanded dive depth setpoint [m]";
    parameter Real k_depth = 38.0 "Ballast depth-hold proportional gain [N/m]";
  equation
    flange_heave.f_z = -k_depth * (depthTarget - flange_heave.z);
  end BallastDepthActuator;

  model MantleRigidBody "Coupled 4-DOF ceramic mantle multi-body hull (surge, heave, pitch, roll)"
    SurgeFlange flange_surge "Siphon water-jet axial propulsion flange";
    HeaveFlange flange_heave "Variable-buoyancy ballast vertical flange";
    ArmMountFlange flange_arms "8-arm multi-body reaction coupling flange";

    parameter Real m_hull = 6.2 "Dry + flooded ceramic mantle structural mass [kg]";
    parameter Real m_added_x = 1.6 "Hydrodynamic surge added mass [kg]";
    parameter Real m_added_z = 8.3 "Hydrodynamic heave added mass [kg]";
    parameter Real CdA_surge = 0.00163 "Streamlined surge drag area (6.0 N at 2.68 m/s) [m2]";
    parameter Real rhoSea = 1025.0 "Ambient seawater density [kg/m3]";
    parameter Real c_heave = 36.0 "Vertical hydrodynamic heave damping [N*s/m]";
    parameter Real I_pitch = 0.42 "Mantle pitch inertia [kg*m2]";
    parameter Real k_pitch = 3.2 "Hydrostatic righting pitch stiffness [N*m/rad]";
    parameter Real d_pitch = 1.8 "Hydrodynamic pitch damping [N*m*s/rad]";
    parameter Real I_roll = 0.36 "Mantle roll inertia [kg*m2]";
    parameter Real k_roll = 2.8 "Hydrostatic righting roll stiffness [N*m/rad]";
    parameter Real d_roll = 1.5 "Hydrodynamic roll damping [N*m*s/rad]";

    Real x(start = 0.0, fixed = true) "Surge travel distance [m]";
    Real vx(start = 0.25, fixed = true) "Forward swim velocity [m/s]";
    Real z(start = 4.0, fixed = true) "Subsea operating depth [m]";
    Real vz(start = 0.0, fixed = true) "Vertical dive/ascent velocity [m/s]";
    Real pitch(start = 0.0, fixed = true) "Pitch attitude angle [rad]";
    Real q_pitch(start = 0.0, fixed = true) "Pitch angular rate [rad/s]";
    Real roll(start = 0.0, fixed = true) "Roll attitude angle [rad]";
    Real p_roll(start = 0.0, fixed = true) "Roll angular rate [rad/s]";
    Real pitchDeg "Pitch attitude angle [deg]";
    Real rollDeg "Roll attitude angle [deg]";
  equation
    flange_surge.s = x;
    flange_heave.z = z;
    flange_arms.roll = roll;

    // Coupled surge propulsion vs quadratic hydrodynamic drag
    der(x) = vx;
    (m_hull + m_added_x) * der(vx) = flange_surge.f - 0.5 * rhoSea * CdA_surge * vx * abs(vx);

    // Coupled heave ballast dynamics
    der(z) = vz;
    (m_hull + m_added_z) * der(vz) = flange_heave.f_z - c_heave * vz;

    // Coupled pitch & roll rigid-body dynamics (with siphon pitch moment & arm roll reaction)
    der(pitch) = q_pitch;
    I_pitch * der(q_pitch) = 0.095 * flange_surge.f - 0.14 * vz - k_pitch * pitch - d_pitch * q_pitch;

    der(roll) = p_roll;
    I_roll * der(p_roll) = flange_arms.tau_roll - k_roll * roll - d_roll * p_roll;

    pitchDeg = pitch * 57.2957795;
    rollDeg = roll * 57.2957795;
  end MantleRigidBody;

  model ArticulatedArmBank "8 independent robotic arm chains (202 links, 489 wheels) with autonomous Arm 3 magnetic detach"
    ArmMountFlange flange_mantle "Mechanical roll reaction flange attached to ceramic mantle";
    input Real jetLoadFrac "Normalized siphon burst load fraction [0..1]";
    input Real arm3DetachCmd "Autonomous Arm 3 collar release command (1=detach, 0=dock)";

    parameter Integer nArms = 8 "Independently articulated robotic arm count";
    parameter Integer nSegments = 202 "Total linked arm segments (2*26 + 6*25)";
    parameter Integer nWheels = 489 "Total traction rollers (404 ventral + 85 dorsal)";
    parameter Real tau_arm = 0.32 "Tendon curl actuation lag [s]";
    parameter Real tau_collar = 0.40 "Magnetic collar separation/docking time constant [s]";
    parameter Real detachSpanM = 0.24 "Free-floating Arm 3 sampling separation distance [m]";

    Real arm1Curl(start = 70.0, fixed = true) "Arm 1 curl actuation [%]";
    Real arm2Curl(start = 84.0, fixed = true) "Arm 2 curl actuation [%]";
    Real arm3Curl(start = 87.0, fixed = true) "Arm 3 curl actuation (autonomous specimen arm) [%]";
    Real arm4Curl(start = 76.0, fixed = true) "Arm 4 curl actuation [%]";
    Real arm5Curl(start = 60.0, fixed = true) "Arm 5 curl actuation [%]";
    Real arm6Curl(start = 52.0, fixed = true) "Arm 6 curl actuation [%]";
    Real arm7Curl(start = 57.0, fixed = true) "Arm 7 curl actuation [%]";
    Real arm8Curl(start = 73.0, fixed = true) "Arm 8 curl actuation [%]";
    Real arm3DetachOffset(start = 0.0, fixed = true) "Arm 3 collar separation distance [m]";
    Real arm3Attached "Arm 3 magnetic collar status (1=docked, 0=detached)";
  equation
    arm3Attached = if arm3DetachCmd > 0.5 then 0.0 else 1.0;
    tau_collar * der(arm3DetachOffset) = arm3DetachCmd * detachSpanM - arm3DetachOffset;

    // 8 independent biomimetic arm curl trajectories with jet-burst hydrodynamic tuck
    tau_arm * der(arm1Curl) = (70.0 + 18.0 * sin(1.35 * time + 0.00) - 28.0 * jetLoadFrac) - arm1Curl;
    tau_arm * der(arm2Curl) = (70.0 + 18.0 * sin(1.35 * time + 0.92) - 28.0 * jetLoadFrac) - arm2Curl;
    tau_arm * der(arm3Curl) = (if arm3Attached < 0.5 then 88.0 + 8.0 * sin(2.40 * time)
                               else 70.0 + 18.0 * sin(1.35 * time + 1.84) - 28.0 * jetLoadFrac) - arm3Curl;
    tau_arm * der(arm4Curl) = (70.0 + 18.0 * sin(1.35 * time + 2.76) - 28.0 * jetLoadFrac) - arm4Curl;
    tau_arm * der(arm5Curl) = (70.0 + 18.0 * sin(1.35 * time + 3.68) - 28.0 * jetLoadFrac) - arm5Curl;
    tau_arm * der(arm6Curl) = (70.0 + 18.0 * sin(1.35 * time + 4.60) - 28.0 * jetLoadFrac) - arm6Curl;
    tau_arm * der(arm7Curl) = (70.0 + 18.0 * sin(1.35 * time + 5.52) - 28.0 * jetLoadFrac) - arm7Curl;
    tau_arm * der(arm8Curl) = (70.0 + 18.0 * sin(1.35 * time + 6.44) - 28.0 * jetLoadFrac) - arm8Curl;

    // Asymmetric roll reaction torque when Arm 3 detaches from the port-side collar
    flange_mantle.tau_roll = -(0.22 * sin(0.95 * time) - 0.34 * (1.0 - arm3Attached));
  end ArticulatedArmBank;

  model MissionAutonomyController "25-second 4-phase subsea mission sequencer (Dive, Arm 3 Detach, Jet Burst, Surface)"
    output Real omegaPumpCmd "Commanded 7-piston swashplate speed [rad/s]";
    output Real depthTarget "Commanded mission operating depth [m]";
    output Real arm3DetachCmd "Arm 3 magnetic collar detach trigger (1=detach, 0=dock)";
    output Real missionPhase "Active phase index (0=DIVE, 1=DETACH, 2=JET, 3=SURFACE)";

    parameter Real detachStartTime = 6.0 "Arm 3 magnetic collar release time [s]";
    parameter Real reconnectTime = 12.8 "Arm 3 inductive dock reconnect time [s]";
    parameter Real burstStartTime = 13.0 "Siphon jet-assist burst start time [s]";
    parameter Real burstEndTime = 20.0 "Siphon jet-assist burst end time [s]";
    parameter Real omegaPumpCruise = 47.12 "Cruise pump speed (450 RPM) [rad/s]";
    parameter Real omegaPumpBurst = 164.0 "Burst pump speed (1566 RPM) [rad/s]";
  equation
    omegaPumpCmd = if (time >= burstStartTime) and (time <= burstEndTime)
                   then omegaPumpBurst * (0.96 + 0.04 * sin(6.0 * time))
                   else (if time > burstEndTime then 24.0 else omegaPumpCruise);

    arm3DetachCmd = if (time >= detachStartTime) and (time <= reconnectTime) then 1.0 else 0.0;

    depthTarget = if time < detachStartTime then 4.0 + 34.0 * (time / detachStartTime)
                  else (if time < burstStartTime then 38.0
                  else (if time < burstEndTime then 38.0 - 14.0 * ((time - burstStartTime) / (burstEndTime - burstStartTime))
                  else 24.0 - 20.0 * ((time - burstEndTime) / 5.0)));

    missionPhase = if time < detachStartTime then 0.0
                   else (if time < burstStartTime then 1.0
                   else (if time < burstEndTime then 2.0 else 3.0));
  end MissionAutonomyController;

  // ── System-Level Mechanical Inventory Parameters ─────────────────────────

  parameter Integer nArms = 8 "Independently articulated robotic arms";
  parameter Integer nSegments = 202 "Total linked arm segments (2*26 + 6*25)";
  parameter Integer nWheels = 489 "Ventral (404) + dorsal (85) traction rollers";
  parameter Integer nPistons = 7 "Internal axial swashplate pump cylinders";
  parameter Real maxJetVelocity = 2.68 "Peak siphon water-jet velocity [m/s]";
  parameter Real maxThrust = 6.0 "Peak siphon burst thrust [N]";

  // ── Connected Multi-Body + Fluid Siphon Subsystem Instances ──────────────

  MissionAutonomyController mission
    annotation(Placement(transformation(extent = {{-96, 36}, {-64, 68}})));

  SeawaterIntake intake
    annotation(Placement(transformation(extent = {{-96, -18}, {-68, 10}})));

  BrushlessPumpDrive motor
    annotation(Placement(transformation(extent = {{-44, 36}, {-16, 64}})));

  SwashplatePump7Piston pump
    annotation(
      Placement(transformation(extent = {{-44, -20}, {-12, 12}})),
      CAD(uri = "procedural://pelagos-oc8/pump-core", position = {0, 0.07, 0}, scale = {0.11, 0.12, 0.11})
    );

  SiphonJetNozzle siphon
    annotation(
      Placement(transformation(extent = {{10, -20}, {42, 12}})),
      CAD(uri = "procedural://pelagos-oc8/siphon", position = {0, 0.015, -0.17}, scale = {0.07, 0.07, 0.14})
    );

  BallastDepthActuator ballast
    annotation(Placement(transformation(extent = {{12, 36}, {42, 64}})));

  MantleRigidBody hull
    annotation(
      Placement(transformation(extent = {{64, 4}, {96, 40}})),
      CAD(uri = "procedural://pelagos-oc8/mantle", position = {0, 0.21, 0}, scale = {0.22, 0.28, 0.22})
    );

  ArticulatedArmBank arms
    annotation(
      Placement(transformation(extent = {{64, -58}, {96, -24}})),
      CAD(uri = "procedural://pelagos-oc8/arm-chains", position = {0.33, -0.02, 0.14}, scale = {0.42, 0.08, 0.42})
    );

  // ── Top-Level Telemetry & 3D Field-Simulator Channels ────────────────────

  Real pumpOmega "7-piston swashplate angular speed [rad/s]";
  Real pumpFlowLpm "7-piston seawater flow rate [L/min]";
  Real pumpTempC "7-piston pump core temperature [degC]";
  Real jetVelocity "Siphon exit jet velocity [m/s]";
  Real siphonThrust "Siphon water-jet thrust [N]";
  Real jetLoad "Normalized siphon propulsion load [%]";
  Real surgeVelocity "Pelagos OC-8 forward swim velocity [m/s]";
  Real depthM "Operating depth below sea surface [m]";
  Real pitchDeg "Mantle pitch attitude [deg]";
  Real rollDeg "Mantle roll attitude [deg]";
  Real arm3Attached "Arm 3 magnetic collar state (1=docked, 0=detached)"
    annotation(CAD(uri = "procedural://pelagos-oc8/arm3-collar", position = {0.18, -0.02, 0.18}, scale = {0.06, 0.06, 0.06}));
  Real arm3DetachOffset "Arm 3 free-floating separation distance [m]";

equation
  // Acausal hydraulic seawater loop: SeawaterIntake -> 7-Piston Pump -> Siphon Jet Nozzle
  connect(intake.port_out, pump.port_in)
    annotation(Line(points = {{-68, -4}, {-44, -4}}, color = {6, 182, 212}));
  connect(pump.port_out, siphon.port_in)
    annotation(Line(points = {{-12, -4}, {10, -4}}, color = {2, 132, 199}));

  // Acausal mechanical shaft & multi-body force/torque couplings
  connect(motor.flange, pump.shaft)
    annotation(Line(points = {{-30, 36}, {-30, 12}}, color = {16, 185, 129}));
  connect(siphon.flange_hull, hull.flange_surge)
    annotation(Line(points = {{42, -4}, {54, -4}, {54, 16}, {64, 16}}, color = {249, 115, 22}));
  connect(ballast.flange_heave, hull.flange_heave)
    annotation(Line(points = {{42, 50}, {54, 50}, {54, 30}, {64, 30}}, color = {16, 185, 129}));
  connect(arms.flange_mantle, hull.flange_arms)
    annotation(Line(points = {{80, -24}, {80, 4}}, color = {168, 85, 247}));

  // Closed-loop mission control & ambient depth coupling
  motor.omegaCmd = mission.omegaPumpCmd;
  ballast.depthTarget = mission.depthTarget;
  arms.arm3DetachCmd = mission.arm3DetachCmd;
  arms.jetLoadFrac = siphon.jetLoadFrac;
  intake.depthM = hull.z;
  siphon.depthM = hull.z;

  // Top-level telemetry aliases matching Pelagos OC-8 Field HUD & VR Rotunda channels
  pumpOmega = pump.omega;
  pumpFlowLpm = pump.flowLpm;
  pumpTempC = pump.tempC;
  jetVelocity = siphon.jetVelocity;
  siphonThrust = siphon.thrust;
  jetLoad = siphon.jetLoad;
  surgeVelocity = hull.vx;
  depthM = hull.z;
  pitchDeg = hull.pitchDeg;
  rollDeg = hull.rollDeg;
  arm3Attached = arms.arm3Attached;
  arm3DetachOffset = arms.arm3DetachOffset;

  annotation(experiment(StartTime = 0, StopTime = 25, Interval = 0.1));
end PelagosOC8SubseaOctopus;`,
  },
  ...EXTENDED_LANGUAGE_EXAMPLES,
];
