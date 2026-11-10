// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared utility functions for file extension handling and model file identification.
 */

export const SUPPORTED_MODEL_EXTENSIONS = [
  // Core Modeling & Architecture
  ".mo",
  ".mos",
  ".sysml",
  ".sysml2",
  ".kerml",
  ".msx",
  ".reqif",

  // 3D Geometry, CAD & Metrology
  ".step",
  ".stp",
  ".p21",
  ".scad",
  ".3mf",
  ".qif",
  ".gcode",
  ".nc",
  ".usd",
  ".usda",
  ".usdc",

  // Ontologies & Tabular Data
  ".owl",
  ".owl2",
  ".ofn",
  ".ttl",
  ".csv",
  ".tsv",

  // CFD & FEA Continuum Physics
  ".cfg",
  ".cfgt",
  ".su2",
  ".inp",
  ".inpt",
  ".bdf",

  // Standards, Packages & FMI
  ".ssp",
  ".ssd",
  ".fmu",
  ".aml",
  ".caex",
  ".oscal.json",
  ".oscal.yaml",
  ".oscal.yml",
  ".oscal.xml",

  // Electrical Grids, Electronics & RF
  ".pscx",
  ".pslx",
  ".psout",
  ".raw",
  ".dss",
  ".sp",
  ".cir",
  ".va",
  ".s2p",
  ".s1p",
  ".ibs",

  // Multibody, Rail & Robotics
  ".calc",
  ".tsimf",
  ".gpf",
  ".sub",
  ".run",
  ".spck",
  ".sim",
  ".mbs",
  ".urdf",
  ".adm",
  ".acf",

  // Automotive, Aerospace & Control
  ".arxml",
  ".xodr",
  ".xosc",
  ".mdl",
  ".oem",
  ".ez5",
  ".ezm",
  ".ezd",
  ".eas",
  ".roc",
  ".deck",
  ".jsbsim",
  ".sima",
  ".stask",

  // Fluid Assurance, Chemical & Process
  ".opi",
  ".key",
  ".genkey",
  ".tpl",
  ".ppl",
  ".lps",
  ".lpsx",
  ".tgx",
  ".aspen",
  ".gproms",
  ".cti",
  ".pqi",
  ".smi",

  // Subsurface, Water, Nuclear & Building
  ".swmm",
  ".data",
  ".r5",
  ".relap5",
  ".idf",
  ".gtm",
  ".gtp",
  ".gtd",
  ".tough",
  ".modflow",
  ".landgem",

  // Scientific Systems Code
  ".c",
  ".h",
  ".f90",
  ".f",
  ".st",
  ".plcopen",
  ".iec",
  ".ampl",

  // Systems Biology, Pharmacology & Medicine
  ".sbml",
  ".sedml",
  ".sbol",
  ".gb",
  ".pdb",
  ".ant",
  ".bngl",
  ".cellml",
  ".ctl",
  ".osim",
  ".feb",
  ".dcm",
  ".dcm.json",
  ".nii",
  ".nii.json",
  ".topas",
  ".igtl",
  ".igtl.json",
] as const;

export const SUPPORTED_MODEL_REGEX =
  /\.(oscal\.(json|yaml|yml|xml)|(dcm|nii|igtl|qif)\.json|mo|mos|sysml|sysml2|kerml|msx|reqif|step|stp|p21|scad|3mf|qif|gcode|nc|usd|usda|usdc|owl|owl2|ofn|ttl|csv|tsv|cfg|cfgt|su2|inp|inpt|bdf|ssp|ssd|fmu|aml|caex|pscx|pslx|psout|raw|dss|sp|cir|va|s2p|s1p|ibs|calc|tsimf|gpf|sub|run|spck|sim|mbs|urdf|adm|acf|arxml|xodr|xosc|mdl|oem|ez5|ezm|ezd|eas|roc|deck|jsbsim|sima|stask|opi|key|genkey|tpl|ppl|lps|lpsx|tgx|aspen|gproms|cti|pqi|smi|swmm|data|r5|relap5|idf|gtm|gtp|gtd|tough|modflow|landgem|c|h|f90|f|st|plcopen|iec|ampl|sbml|sedml|sbol|gb|pdb|ant|bngl|cellml|ctl|osim|feb|dcm|nii|topas|igtl)$/i;

/**
 * Checks whether the given file path or URI belongs to a supported ModelScript model file.
 */
export function isSupportedModelFile(pathOrUri: string): boolean {
  return SUPPORTED_MODEL_REGEX.test(pathOrUri);
}
