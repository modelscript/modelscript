// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure, dependency-free dialect detection and realistic fault-injection
 * helpers shared across the ModelScript docs sandbox, VitePress build, and
 * Ansatz Editor.
 */

export interface DetectedLanguageMatch {
  slug: string;
  reason: string;
}

export const UNIQUE_EXT_TO_SLUG: Record<string, string> = {
  ".mo": "modelica",
  ".msx": "modelscript",
  ".modelscript": "modelscript",
  ".ampl": "ampl",
  ".sysml": "sysml2",
  ".kerml": "sysml2",
  ".sysml2": "sysml2",
  ".scad": "scad",
  ".sp": "spice",
  ".spice": "spice",
  ".cir": "spice",
  ".kicad_pcb": "kicad",
  ".kicad_sch": "kicad",
  ".kicad_sym": "kicad",
  ".kicad_mod": "kicad",
  ".ato": "atopile",
  ".urdf": "urdf",
  ".xacro": "urdf",
  ".step": "step",
  ".stp": "step",
  ".p21": "step",
  ".qif": "qif",
  ".reqif": "reqif",
  ".owl": "owl2",
  ".owl2": "owl2",
  ".ofn": "owl2",
  ".ttl": "owl2",
  ".arxml": "autosar",
  ".slx": "simulink",
  ".mdl": "simulink",
  ".pscx": "pscad",
  ".ssd": "ssp",
  ".ssp": "ssp",
  ".raw": "psse",
  ".dyr": "psse",
  ".sbml": "sbml",
  ".cellml": "cellml",
  ".sbol": "sbol",
  ".sedml": "sedml",
  ".bngl": "bngl",
  ".va": "verilog-a",
  ".vams": "verilog-a",
  ".f90": "fortran",
  ".f95": "fortran",
  ".f03": "fortran",
  ".f08": "fortran",
  ".c": "c",
  ".h": "c",
  ".st": "plcopen",
  ".xodr": "opendrive",
  ".xosc": "openscenario",
  ".s1p": "touchstone",
  ".s2p": "touchstone",
  ".s3p": "touchstone",
  ".s4p": "touchstone",
  ".ibs": "ibis",
  ".dss": "opendss",
  ".idf": "energyplus",
  ".osim": "opensim",
  ".feb": "febio",
  ".aml": "automationml",
  ".csv": "csv",
  ".las": "las",
  ".usda": "usd",
  ".usd": "usd",
  ".adm": "adams",
  ".su2": "cfd",
  ".yaml": "cantera",
  ".cti": "cantera",
  ".glm": "gridlabd",
  ".aux": "powerworld",
  ".cdf": "powerworld",
  ".iec104": "iec104",
  ".104": "iec104",
  ".c37118": "c37118",
  ".pmu": "c37118",
  ".cff": "comtrade",
  ".cfg": "comtrade",
  ".dat": "comtrade",
  ".pypsa": "pypsa",
  ".sxst": "cyme",
  ".cyme": "cyme",
  ".dft": "rtds",
  ".rtds": "rtds",
  ".pol": "plscadd",
  ".loa": "plscadd",
  ".plscadd": "plscadd",
};

const CONTENT_PATTERNS: ReadonlyArray<{
  test: (sample: string, lower: string) => boolean;
  match: DetectedLanguageMatch;
}> = [
  // XML / structured formats first (disambiguates .xml/.inp files)
  {
    test: (_s, l) => l.includes("<req-if") || l.includes("the-value="),
    match: { slug: "reqif", reason: "ReqIF XML schema" },
  },
  {
    test: (_s, l) => l.includes("<autosar") || l.includes("ar-package"),
    match: { slug: "autosar", reason: "AUTOSAR ARXML root" },
  },
  {
    test: (_s, l) => l.includes("<robot") && (l.includes("<link") || l.includes("<joint")),
    match: { slug: "urdf", reason: "URDF kinematics XML" },
  },
  {
    test: (_s, l) => l.includes("<sbml") || l.includes("listofspecies"),
    match: { slug: "sbml", reason: "SBML biological model" },
  },
  {
    test: (_s, l) => l.includes("<sedml"),
    match: { slug: "sedml", reason: "SED-ML experiment XML" },
  },
  {
    test: (_s, l) => l.includes("<model") && l.includes("cellml"),
    match: { slug: "cellml", reason: "CellML mathematical model" },
  },
  {
    test: (_s, l) => l.includes("<rdf:rdf") && l.includes("sbol"),
    match: { slug: "sbol", reason: "SBOL synthetic biology RDF" },
  },
  {
    test: (_s, l) => l.includes("<systemstructuredescription") || l.includes("xmlns:ssd"),
    match: { slug: "ssp", reason: "SSP architecture XML" },
  },
  {
    test: (_s, l) => l.includes("<febio_spec"),
    match: { slug: "febio", reason: "FEBio XML spec" },
  },
  {
    test: (_s, l) => l.includes("<opensimdocument"),
    match: { slug: "opensim", reason: "OpenSim XML" },
  },
  {
    test: (_s, l) => l.includes("<caexfile"),
    match: { slug: "automationml", reason: "AutomationML CAEX XML" },
  },
  {
    test: (_s, l) => l.includes("<opendrive"),
    match: { slug: "opendrive", reason: "ASAM OpenDRIVE road network" },
  },
  {
    test: (_s, l) => l.includes("<openscenario"),
    match: { slug: "openscenario", reason: "ASAM OpenSCENARIO XML" },
  },
  {
    test: (_s, l) => l.includes("iso-10303-21;"),
    match: { slug: "step", reason: "STEP ISO 10303-21 header" },
  },
  // Engineering text / DSL syntaxes
  {
    test: (s) => /^\s*\*heading\b/im.test(s) || (/^\*material\b/im.test(s) && /^\*elastic\b/im.test(s)),
    match: { slug: "fea", reason: "Abaqus / CalculiX FEA keywords" },
  },
  {
    test: (s) => /\[junctions\]/i.test(s) && (/\[pipes\]/i.test(s) || /\[reservoirs\]/i.test(s)),
    match: { slug: "epanet", reason: "EPANET hydraulic sections" },
  },
  {
    test: (s) => /\[subcatchments\]/i.test(s) && /\[conduits\]/i.test(s),
    match: { slug: "swmm", reason: "EPA SWMM sections" },
  },
  {
    test: (s) => /^\s*clear\s*$/im.test(s) && /\bnew\s+(?:circuit|line|load|vsource)\./i.test(s),
    match: { slug: "opendss", reason: "OpenDSS circuit script" },
  },
  {
    test: (s) => /^\s*0\s*,\s*100\.\d+\s*\/\s*pss[e/]/im.test(s) || /0\s*\/\s*end of bus data/im.test(s),
    match: { slug: "psse", reason: "Siemens PSS/E RAW/DYR data" },
  },
  {
    test: (s) => /\bversion,\s*[\d.]+\s*;/.test(s) && /\b(?:building|zone|simulationcontrol)\s*,/i.test(s),
    match: { slug: "energyplus", reason: "EnergyPlus IDF syntax" },
  },
  {
    test: (s) => /^\s*=\s*.*\n/m.test(s) && /\b(?:snglvol|branch|tmdpvol|pipe)\b/i.test(s),
    match: { slug: "relap5", reason: "RELAP5 thermal-hydraulics deck" },
  },
  {
    test: (s) => /^\s*(?:part|marker|joint|jprim)\/\d+/im.test(s),
    match: { slug: "adams", reason: "MSC Adams ADM dataset" },
  },
  {
    test: (s) => /\bbegin\s+model\b/i.test(s) && /\bbegin\s+species\b/i.test(s),
    match: { slug: "bngl", reason: "BioNetGen BNGL rules" },
  },
  {
    test: (s) => /^\s*#\s*(?:ghz|mhz|khz|hz)\s+[syzh]\s+(?:ma|ri|db)\s+r\s+\d+/im.test(s),
    match: { slug: "touchstone", reason: "Touchstone SnP S-parameters" },
  },
  {
    test: (s) => /\[ibis ver\]/i.test(s) && /\[component\]/i.test(s),
    match: { slug: "ibis", reason: "IBIS behavioral I/O spec" },
  },
  {
    test: (s) =>
      /\b(?:part|port|requirement|item|attribute|constraint|action|state)\s+def\b/.test(s) ||
      /^\s*package\s+[A-Z]\w*\s*\{/m.test(s),
    match: { slug: "sysml2", reason: "SysML v2 syntax" },
  },
  {
    test: (s) =>
      /^\s*(?:system|architecture|digitaltwin|workflow)\s+[A-Za-z_]\w*/m.test(s) &&
      /\b(?:twin|domain|reconcile)\b/.test(s),
    match: { slug: "modelscript", reason: "ModelScript orchestration DSL" },
  },
  {
    test: (s) =>
      /^\s*(?:within\s+[\w.]+;|model\s+[A-Za-z_]\w*)/m.test(s) && /\bequation\b|\bend\s+[A-Za-z_]\w*\s*;/.test(s),
    match: { slug: "modelica", reason: "Modelica model/equation syntax" },
  },
  {
    test: (s) =>
      /^\s*\.param\b|\.(?:tran|ac|dc)\b/im.test(s) || (/^[rclv]\d+\s+\S+\s+\S+\s+\S+/im.test(s) && /^\*/m.test(s)),
    match: { slug: "spice", reason: "SPICE netlist syntax" },
  },
  {
    test: (s) => /\bdiscipline\s+\w+|\banalog\s+begin\b/.test(s),
    match: { slug: "verilog-a", reason: "Verilog-A analog block" },
  },
  {
    test: (s) => /\b(?:program|function_block)\s+[A-Za-z_]\w*[\s\S]*\b(?:end_program|end_function_block)\b/i.test(s),
    match: { slug: "plcopen", reason: "IEC 61131-3 Structured Text" },
  },
  {
    test: (s) => /\b(?:module\s+\w+\s*\(|difference\s*\(|union\s*\(|linear_extrude\s*\(|cube\s*\()/.test(s),
    match: { slug: "scad", reason: "OpenSCAD CSG primitives" },
  },
  {
    test: (s) => /^\s*(?:prefix\s*\(|ontology\s*\(|subclassof\s*\()/im.test(s),
    match: { slug: "owl2", reason: "OWL 2 functional syntax" },
  },
  {
    test: (s) => /\bsolver\s*=\s*(?:rans|euler|navier_stokes)|% --- su2/i.test(s),
    match: { slug: "cfd", reason: "CFD / SU2 directives" },
  },
  {
    test: (s) => /^\s*phases:\s*$/im.test(s) && /\b(?:thermo|reactions):(?:\s|$)/im.test(s),
    match: { slug: "cantera", reason: "Cantera YAML mechanism" },
  },
  {
    test: (s) =>
      /^\s*(?:program|subroutine|module)\s+[A-Za-z_]\w*[\s\S]*\bend\s+(?:program|subroutine|module)\b/i.test(s),
    match: { slug: "fortran", reason: "Fortran program unit" },
  },
  {
    test: (s) => /^\s*#include\s+[<"][^">]+[>"]/m.test(s) && /\bint\s+main\s*\(/.test(s),
    match: { slug: "c", reason: "C translation unit" },
  },
];

export function detectPolyglotLanguage(content: string, fileName?: string): DetectedLanguageMatch | null {
  const sample = content.slice(0, 6000);
  const lower = sample.toLowerCase();

  for (const rule of CONTENT_PATTERNS) {
    if (rule.test(sample, lower)) {
      return rule.match;
    }
  }

  if (fileName) {
    const extIdx = fileName.lastIndexOf(".");
    if (extIdx >= 0) {
      const ext = fileName.slice(extIdx).toLowerCase();
      const mapped = UNIQUE_EXT_TO_SLUG[ext];
      if (mapped) {
        return { slug: mapped, reason: `File extension ${ext}` };
      }
    }
  }
  return null;
}

const XML_DIALECTS = new Set([
  "urdf",
  "reqif",
  "autosar",
  "ssp",
  "sbml",
  "cellml",
  "sbol",
  "sedml",
  "opensim",
  "febio",
  "automationml",
  "opendrive",
  "openscenario",
]);

export function injectRealisticFault(langSlug: string, code: string): { code: string; label: string } {
  switch (langSlug) {
    case "modelica":
      if (code.includes("equation")) {
        return {
          label: "Injected undeclared variable reference (M2002)",
          code: code.replace("equation", "equation\n  unknown_var = 42.0;"),
        };
      }
      return {
        label: "Injected mismatched end identifier",
        code: `${code}\nend MismatchedBlockName;`,
      };
    case "sysml2":
      if (code.includes("package ")) {
        const trimmed = code.trimEnd();
        const body = trimmed.endsWith("}") ? trimmed.slice(0, -1) : trimmed;
        return {
          label: "Injected unresolved part type reference",
          code: `${body}\n  part broken : UndefinedSubcomponent;\n}`,
        };
      }
      return {
        label: "Injected SysML syntax error",
        code: `${code}\npart def BrokenPart { attribute x = ; }`,
      };
    case "spice":
      return {
        label: "Injected @twin drift + dangling resistor node",
        code: `* @twin: v_out <-> PowerSupply::FilterStage.v_out\n${code}\nR_fault missing_node ;;;`,
      };
    case "scad":
      return {
        label: "Injected unclosed OpenSCAD module syntax error",
        code: `${code}\nmodule faulty_flange( { cube([10, 10, 1]); }`,
      };
    case "psse":
      return {
        label: "Injected out-of-range bus voltage + malformed RAW record",
        code: `${code.trimEnd()}\n99999,'FAULT_BUS',138.0,1,1,1,1,1.85,0.0,1.1,0.9,1.1,0.9`,
      };
    case "opendss":
      return {
        label: "Injected undefined bus reference in OpenDSS Line",
        code: `${code.trimEnd()}\nNew Line.FaultLine Phases=3 Bus1=NonExistentBus.1.2.3 Bus2=LoadBus.1.2.3`,
      };
    case "epanet":
      return {
        label: "Injected disconnected pipe referencing missing node",
        code: `${code.trimEnd()}\n[PIPES]\nP_FAULT  MISSING_J1  J2  1000  300  100  0  OPEN`,
      };
    case "swmm":
      return {
        label: "Injected SWMM conduit with negative length",
        code: `${code.trimEnd()}\n[CONDUITS]\nC_FAULT  N1  N2  -25.0  0.013  0  0  0  0`,
      };
    case "fortran":
      return {
        label: "Injected implicit syntax mismatch in Fortran block",
        code: `${code.trimEnd()}\nend subroutine MismatchedSub`,
      };
    case "c":
      return {
        label: "Injected unclosed declaration syntax error",
        code: `${code.trimEnd()}\nint broken_decl( ;`,
      };
    case "plcopen":
      return {
        label: "Injected missing END_IF terminator in Structured Text",
        code: `${code.trimEnd()}\nIF FaultFlag THEN x := 1;`,
      };
    case "verilog-a":
      return {
        label: "Injected undeclared electrical branch fault",
        code: `${code.trimEnd()}\nanalog begin V(missing_node) <+ 5.0; endmodule`,
      };
    case "owl2":
      return {
        label: "Injected malformed OWL 2 functional axiom",
        code: `${code.trimEnd()}\nSubClassOf(:UnclosedClass :Thing`,
      };
    case "step":
      return {
        label: "Injected malformed STEP ISO-10303-21 entity",
        code: `${code.trimEnd()}\n#99999=UNCLOSED_ENTITY('broken'`,
      };
    case "qif":
      return {
        label: "Injected illegal MMC modifier on Plane feature (M8104)",
        code: `${code.trimEnd()}\nCHARACTERISTIC C_FAULT Perpendicularity "InvalidDatumMod" zone=0.02 material=MMC datums=[A] features=[F_DATUM_A]`,
      };
    default:
      if (XML_DIALECTS.has(langSlug)) {
        return {
          label: `Injected malformed ${langSlug.toUpperCase()} closing tag`,
          code: `${code}\n<unclosed_tag attr="broken">`,
        };
      }
      return {
        label: `Injected @twin drift + syntax fault for ${langSlug}`,
        code: `${code}\n// @twin: missing_param <-> SysML::Missing.param\n__INVALID_TOKEN__(;;;)`,
      };
  }
}
