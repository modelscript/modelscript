// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanvasTile, TileAnchorSpec, TileArchetype, TileLodTier } from "../schema/canvas-document.js";

export type DomainCluster =
  | "systems-core"
  | "power-electronics"
  | "fluid-process"
  | "multibody-auto"
  | "aerospace-controls"
  | "cad-continuum"
  | "bio-chemistry"
  | "medical-radiology"
  | "analytics-cosim";

export interface LanguageTileDescriptor {
  languageId: string;
  label: string;
  archetype: TileArchetype;
  cluster: DomainCluster;
  accentColor: string;
  extensions: string[];
  defaultSize: { width: number; height: number };
}

export interface TileRenderContext {
  tile: CanvasTile;
  lod: TileLodTier;
  isSelected: boolean;
  isFocused: boolean;
  isWebGlLive: boolean;
  highlightedAnchorPath?: string | null | undefined;
}

export interface TileAdapter {
  readonly archetype: TileArchetype;
  readonly label: string;
  supports(languageId: string, artifactUri: string): boolean;
  getDefaultAnchors?(tile: CanvasTile): TileAnchorSpec[];
  captureThumbnailSvg?(tile: CanvasTile): string;
}

const ARCHETYPE_DEFAULT_SIZE: Record<TileArchetype, { width: number; height: number }> = {
  schematic: { width: 440, height: 340 },
  ecad: { width: 440, height: 360 },
  cad3d: { width: 450, height: 360 },
  table: { width: 520, height: 380 },
  analytics: { width: 520, height: 400 },
  code: { width: 420, height: 320 },
  fmu: { width: 320, height: 220 },
};

const CLUSTER_COLORS: Record<DomainCluster, string> = {
  "systems-core": "#3b82f6",
  "power-electronics": "#f59e0b",
  "fluid-process": "#06b6d4",
  "multibody-auto": "#8b5cf6",
  "aerospace-controls": "#10b981",
  "cad-continuum": "#ec4899",
  "bio-chemistry": "#84cc16",
  "medical-radiology": "#f43f5e",
  "analytics-cosim": "#14b8a6",
};

function lang(
  languageId: string,
  label: string,
  archetype: TileArchetype,
  cluster: DomainCluster,
  extensions: string[],
): LanguageTileDescriptor {
  return {
    languageId,
    label,
    archetype,
    cluster,
    accentColor: CLUSTER_COLORS[cluster],
    extensions,
    defaultSize: ARCHETYPE_DEFAULT_SIZE[archetype],
  };
}

/**
 * Complete registry mapping all 106 ModelScript engineering languages
 * (across all 8 domain clusters) plus virtual analytics/FMU artifacts
 * onto the 7 canonical spatial canvas tile archetypes.
 */
export const POLYGLOT_LANGUAGE_CATALOG: readonly LanguageTileDescriptor[] = [
  // ── 1. Native & Core Systems Engineering (11) ──
  lang("modelscript", "ModelScript", "code", "systems-core", [".ms"]),
  lang("modelica", "Modelica", "schematic", "systems-core", [".mo"]),
  lang("ampl", "AMPL", "code", "systems-core", [".mod", ".dat", ".run"]),
  lang("sysml2", "SysML v2", "schematic", "systems-core", [".sysml", ".kerml"]),
  lang("magicdraw", "MagicDraw / Cameo", "schematic", "systems-core", [".mdzip", ".xmi"]),
  lang("ssp", "SSP Co-Sim", "fmu", "systems-core", [".ssp", ".ssd"]),
  lang("reqif", "ReqIF Requirements", "table", "systems-core", [".reqif", ".reqifz"]),
  lang("oscal", "OSCAL Compliance", "table", "systems-core", [".oscal.json", ".oscal.xml"]),
  lang("owl2", "OWL 2 Ontology", "code", "systems-core", [".owl", ".ttl", ".ofn"]),
  lang("sparql", "SPARQL Query", "code", "systems-core", [".rq", ".sparql"]),
  lang("csv", "CSV Table", "table", "systems-core", [".csv", ".tsv"]),

  // ── 2. Electrical Power Grids, RF, Telecom & Electronics (32) ──
  lang("pscad", "PSCAD EMT", "schematic", "power-electronics", [".pscx", ".pslx"]),
  lang("psse", "PSS/E Grid", "schematic", "power-electronics", [".raw", ".dyr", ".seq"]),
  lang("cgmes", "CGMES CIM", "schematic", "power-electronics", [".cgmes", ".cim.xml"]),
  lang("opendss", "OpenDSS", "schematic", "power-electronics", [".dss"]),
  lang("powerfactory", "PowerFactory", "schematic", "power-electronics", [".dgs", ".pfd"]),
  lang("pslf", "GE PSLF", "schematic", "power-electronics", [".epc", ".dyd"]),
  lang("ocpp", "OCPP EV Charging", "table", "power-electronics", [".ocpp.json"]),
  lang("openadr", "OpenADR", "table", "power-electronics", [".openadr.xml"]),
  lang("spice", "SPICE Circuit", "schematic", "power-electronics", [".cir", ".sp", ".spice", ".net"]),
  lang("atopile", "atopile ECAD", "ecad", "power-electronics", [".ato"]),
  lang("kicad", "KiCad PCB/Schematic", "ecad", "power-electronics", [".kicad_pcb", ".kicad_sch", ".kicad_pro"]),
  lang("verilog-a", "Verilog-A", "code", "power-electronics", [".va", ".vams"]),
  lang("ibis", "IBIS Signal Integrity", "ecad", "power-electronics", [".ibs"]),
  lang("touchstone", "Touchstone RF", "analytics", "power-electronics", [".s1p", ".s2p", ".s4p", ".snp"]),
  lang("optical", "Optical Bench", "schematic", "power-electronics", [".opt", ".zmx"]),
  lang("ran", "5G/6G RAN", "schematic", "power-electronics", [".ran"]),
  lang("fiber", "Optical Fiber Link", "schematic", "power-electronics", [".fiber"]),
  lang("matpower", "MATPOWER", "code", "power-electronics", [".m"]),
  lang("comtrade", "COMTRADE Waveform", "analytics", "power-electronics", [".cfg", ".cff"]),
  lang("scl", "IEC 61850 SCL", "schematic", "power-electronics", [".scd", ".icd", ".cid"]),
  lang("atp", "ATP-EMTP", "schematic", "power-electronics", [".atp"]),
  lang("dnp3", "DNP3 SCADA", "table", "power-electronics", [".dnp3"]),
  lang("oneliner", "ASPEN OneLiner", "schematic", "power-electronics", [".olr"]),
  lang("sel", "SEL Protection", "table", "power-electronics", [".rdb", ".sel"]),
  lang("c37118", "IEEE C37.118 PMU", "analytics", "power-electronics", [".c37118"]),
  lang("cyme", "CYME Distribution", "schematic", "power-electronics", [".sxst", ".cyme"]),
  lang("gridlabd", "GridLAB-D", "schematic", "power-electronics", [".glm"]),
  lang("iec104", "IEC 60870-5-104", "table", "power-electronics", [".iec104"]),
  lang("plscadd", "PLS-CADD Line", "cad3d", "power-electronics", [".xyz", ".plscadd"]),
  lang("powerworld", "PowerWorld", "schematic", "power-electronics", [".aux", ".pwb"]),
  lang("pypsa", "PyPSA Network", "schematic", "power-electronics", [".pypsa"]),
  lang("rtds", "RTDS Draft", "schematic", "power-electronics", [".dfx", ".rtds"]),

  // ── 3. Fluid, Process, Subsurface, Civil Water & Nuclear (16) ──
  lang("olga", "OLGA Multiphase", "schematic", "fluid-process", [".genkey", ".olga"]),
  lang("lps", "LPS Pipeline", "schematic", "fluid-process", [".lps"]),
  lang("aspen", "Aspen Plus", "schematic", "fluid-process", [".bkp", ".inp"]),
  lang("eclipse", "ECLIPSE Reservoir", "cad3d", "fluid-process", [".data", ".grdecl"]),
  lang("las", "LAS Well Log", "analytics", "fluid-process", [".las"]),
  lang("epanet", "EPANET Water", "schematic", "fluid-process", [".epanet", ".epanet.inp"]),
  lang("swmm", "EPA SWMM", "schematic", "fluid-process", [".swmm", ".swmm.inp"]),
  lang("relap5", "RELAP5 Nuclear", "schematic", "fluid-process", [".relap5", ".i"]),
  lang("energyplus", "EnergyPlus Building", "schematic", "fluid-process", [".idf"]),
  lang("hec-ras", "HEC-RAS River", "schematic", "fluid-process", [".prj", ".g01"]),
  lang("tough", "TOUGH Subsurface", "code", "fluid-process", [".tough"]),
  lang("modflow", "MODFLOW Groundwater", "cad3d", "fluid-process", [".nam", ".dis"]),
  lang("landgem", "LandGEM Emissions", "analytics", "fluid-process", [".landgem"]),
  lang("hec-hms", "HEC-HMS Hydrology", "schematic", "fluid-process", [".basin", ".hms"]),
  lang("waterml", "WaterML Time Series", "analytics", "fluid-process", [".waterml"]),
  lang("asm", "Activated Sludge ASM", "schematic", "fluid-process", [".asm"]),

  // ── 4. Multibody, Automotive, Robotics, Marine & Rail (10) ──
  lang("adams", "MSC Adams", "schematic", "multibody-auto", [".adm", ".cmd"]),
  lang("simpack", "SIMPACK Multibody", "schematic", "multibody-auto", [".spck"]),
  lang("gensys", "GENSYS Rail", "schematic", "multibody-auto", [".runf", ".gensys"]),
  lang("gtsuite", "GT-SUITE Engine", "schematic", "multibody-auto", [".gtm", ".gts"]),
  lang("sima", "SIMA Marine", "schematic", "multibody-auto", [".stask", ".sima"]),
  lang("urdf", "URDF Robot", "cad3d", "multibody-auto", [".urdf", ".xacro"]),
  lang("opendrive", "ASAM OpenDRIVE", "schematic", "multibody-auto", [".xodr"]),
  lang("openscenario", "ASAM OpenSCENARIO", "schematic", "multibody-auto", [".xosc"]),
  lang("autosar", "AUTOSAR ARXML", "schematic", "multibody-auto", [".arxml"]),
  lang("gtfs", "GTFS Transit", "table", "multibody-auto", [".gtfs"]),

  // ── 5. Aerospace, Flight Dynamics, Astrodynamics & Controls (7) ──
  lang("simulink", "Simulink", "schematic", "aerospace-controls", [".slx", ".mdl"]),
  lang("easy5", "Easy5 Controls", "schematic", "aerospace-controls", [".ezmod", ".easy5"]),
  lang("jsbsim", "JSBSim Flight", "schematic", "aerospace-controls", [".jsbsim.xml"]),
  lang("rocets", "ROCETS Propulsion", "schematic", "aerospace-controls", [".rocets"]),
  lang("ccsds", "CCSDS Orbit/OEM", "analytics", "aerospace-controls", [".oem", ".opm", ".omm"]),
  lang("plcopen", "PLCopen IEC 61131", "schematic", "aerospace-controls", [".plcopen.xml"]),
  lang("automationml", "AutomationML", "schematic", "aerospace-controls", [".aml"]),

  // ── 6. 3D CAD, Digital Metrology & Continuum Physics (6) ──
  lang("step", "STEP AP242 CAD", "cad3d", "cad-continuum", [".step", ".stp"]),
  lang("qif", "QIF Metrology", "table", "cad-continuum", [".qif"]),
  lang("scad", "OpenSCAD", "cad3d", "cad-continuum", [".scad"]),
  lang("usd", "OpenUSD 3D Scene", "cad3d", "cad-continuum", [".usd", ".usda", ".usdc", ".usdz"]),
  lang("fea", "FEA Structural Mesh", "cad3d", "cad-continuum", [".bdf", ".nas", ".fem", ".fea"]),
  lang("cfd", "CFD Continuum Mesh", "cad3d", "cad-continuum", [".foam", ".cgns", ".cfd"]),

  // ── 7. Chemistry, Systems/Synthetic Biology & Scientific Code (16) ──
  lang("sbml", "SBML Systems Bio", "schematic", "bio-chemistry", [".sbml"]),
  lang("antimony", "Antimony Bio", "code", "bio-chemistry", [".ant"]),
  lang("cantera", "Cantera Kinetics", "code", "bio-chemistry", [".cti", ".cantera.yaml"]),
  lang("smiles", "SMILES Molecule", "schematic", "bio-chemistry", [".smi", ".smiles"]),
  lang("nmtran", "NM-TRAN PK/PD", "code", "bio-chemistry", [".ctl", ".nmtran"]),
  lang("mlxtran", "Mlxtran PK/PD", "code", "bio-chemistry", [".mlxtran"]),
  lang("nmodl", "NMODL Neuron", "code", "bio-chemistry", [".nmodl"]),
  lang("sbol", "SBOL Synthetic Bio", "schematic", "bio-chemistry", [".sbol"]),
  lang("bngl", "BioNetGen BNGL", "code", "bio-chemistry", [".bngl"]),
  lang("sedml", "SED-ML Experiment", "analytics", "bio-chemistry", [".sedml"]),
  lang("pdb", "PDB Protein 3D", "cad3d", "bio-chemistry", [".pdb", ".cif"]),
  lang("genbank", "GenBank Sequence", "code", "bio-chemistry", [".gb", ".gbk"]),
  lang("gproms", "gPROMS Process", "code", "bio-chemistry", [".gproms"]),
  lang("phreeqc", "PHREEQC Geochem", "code", "bio-chemistry", [".pqi", ".phreeqc"]),
  lang("fortran", "Fortran Scientific", "code", "bio-chemistry", [".f90", ".f95", ".f", ".for"]),
  lang("c", "C / Embedded C", "code", "bio-chemistry", [".c", ".h"]),

  // ── 8. Radiology, Radiation Oncology & Computer-Assisted Surgery (8) ──
  lang("opensim", "OpenSim Biomech", "cad3d", "medical-radiology", [".osim"]),
  lang("dicom-rt", "DICOM-RT Oncology", "cad3d", "medical-radiology", [".dcm", ".dicomrt"]),
  lang("cellml", "CellML Physiology", "schematic", "medical-radiology", [".cellml"]),
  lang("febio", "FEBio Biomechanics", "cad3d", "medical-radiology", [".feb"]),
  lang("nifti", "NIfTI Volume", "cad3d", "medical-radiology", [".nii", ".nii.gz"]),
  lang("topas", "TOPAS Monte Carlo", "code", "medical-radiology", [".topas"]),
  lang("three-mf", "3MF Additive Mfg", "cad3d", "medical-radiology", [".3mf"]),
  lang("igtl", "OpenIGTLink Surgery", "analytics", "medical-radiology", [".igtl"]),

  // ── Virtual Platform Artifact Types (FMU & UQ Analytics) ──
  lang("fmu", "FMI 2/3 FMU", "fmu", "analytics-cosim", [".fmu"]),
  lang("ms-uq", "Monte Carlo UQ", "analytics", "analytics-cosim", [".ms-uq", ".uq.json"]),
  lang("ms-sim", "Simulation Waveform", "analytics", "analytics-cosim", [".ms-sim", ".mat", ".parquet"]),
] as const;

/**
 * Registry resolving any of the 106 ModelScript languages (by languageId or file URI)
 * into its canonical TileDescriptor and TileAdapter.
 */
export class TileAdapterRegistry {
  private readonly byLanguage = new Map<string, LanguageTileDescriptor>();
  private readonly byExtension = new Map<string, LanguageTileDescriptor>();
  private readonly adapters = new Map<TileArchetype, TileAdapter>();

  constructor() {
    for (const desc of POLYGLOT_LANGUAGE_CATALOG) {
      this.byLanguage.set(desc.languageId.toLowerCase(), desc);
      for (const ext of desc.extensions) {
        const norm = ext.toLowerCase();
        if (!this.byExtension.has(norm)) {
          this.byExtension.set(norm, desc);
        }
      }
    }

    // Register built-in default adapters for all 7 archetypes
    const archetypes: { id: TileArchetype; label: string }[] = [
      { id: "schematic", label: "Schematic & Block Diagram" },
      { id: "ecad", label: "ECAD / PCB Layout" },
      { id: "cad3d", label: "3D CAD & Continuum Physics" },
      { id: "table", label: "Requirements & Tabular Grid" },
      { id: "analytics", label: "Simulation & Monte Carlo Analytics" },
      { id: "code", label: "Source & Formal Specification" },
      { id: "fmu", label: "FMI / SSP Co-Simulation Block" },
    ];
    for (const a of archetypes) {
      this.registerAdapter({
        archetype: a.id,
        label: a.label,
        supports: (langId, uri) => this.resolveDescriptor(langId, uri).archetype === a.id,
      });
    }
  }

  public registerAdapter(adapter: TileAdapter): void {
    this.adapters.set(adapter.archetype, adapter);
  }

  public getAdapter(archetype: TileArchetype): TileAdapter | undefined {
    return this.adapters.get(archetype);
  }

  public getLanguageCount(): number {
    // Excludes the 3 virtual platform artifact types (fmu, ms-uq, ms-sim)
    return POLYGLOT_LANGUAGE_CATALOG.filter((d) => d.cluster !== "analytics-cosim").length;
  }

  public resolveByLanguageId(languageId: string): LanguageTileDescriptor | undefined {
    return this.byLanguage.get(languageId.toLowerCase());
  }

  public resolveByUri(artifactUri: string): LanguageTileDescriptor | undefined {
    const lower = artifactUri.toLowerCase();
    // Try longest matching compound extension first (e.g. ".oscal.json", ".nii.gz")
    let bestMatch: { extLen: number; desc: LanguageTileDescriptor } | undefined;
    for (const [ext, desc] of this.byExtension.entries()) {
      if (lower.endsWith(ext) && (!bestMatch || ext.length > bestMatch.extLen)) {
        bestMatch = { extLen: ext.length, desc };
      }
    }
    return bestMatch?.desc;
  }

  /** Resolves the best LanguageTileDescriptor for a dropped artifact, falling back to `code`. */
  public resolveDescriptor(languageId?: string, artifactUri?: string): LanguageTileDescriptor {
    if (languageId) {
      const exact = this.resolveByLanguageId(languageId);
      if (exact) return exact;
    }
    if (artifactUri) {
      const byUri = this.resolveByUri(artifactUri);
      if (byUri) return byUri;
    }
    return {
      languageId: languageId || "unknown",
      label: languageId || "Artifact",
      archetype: "code",
      cluster: "systems-core",
      accentColor: CLUSTER_COLORS["systems-core"],
      extensions: [],
      defaultSize: ARCHETYPE_DEFAULT_SIZE.code,
    };
  }

  /** Synthesizes a new CanvasTile from a dropped file URI or language ID at world coordinates. */
  public createTileForDrop(params: {
    id: string;
    artifactUri: string;
    languageId?: string | undefined;
    title?: string | undefined;
    x: number;
    y: number;
    zIndex?: number | undefined;
    targetSymbol?: string | undefined;
  }): CanvasTile {
    const desc = this.resolveDescriptor(params.languageId, params.artifactUri);
    const basename = params.artifactUri.split("/").pop() ?? params.artifactUri;
    return {
      id: params.id,
      title: params.title ?? `${basename} (${desc.label})`,
      artifactUri: params.artifactUri,
      languageId: desc.languageId,
      archetype: desc.archetype,
      targetSymbol: params.targetSymbol,
      bounds: {
        x: params.x,
        y: params.y,
        width: desc.defaultSize.width,
        height: desc.defaultSize.height,
      },
      zIndex: params.zIndex ?? 1,
      health: "ok",
    };
  }
}
