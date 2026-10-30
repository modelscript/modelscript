// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ActionCategory, LanguageAction, LanguageMaturity, LanguageOptions } from "../../dsl/language.js";
import { generateTextMate } from "../parser/textmate.js";
import {
  BROWSER_BUFFER_AND_PROCESS_BANNER,
  BROWSER_BUFFER_BANNER,
  BROWSER_PROCESS_BANNER,
  createNodeBuiltinsIgnorePlugin,
} from "./esbuild-browser-plugin.js";
import { discoverWorkspaceLanguages } from "./language-discovery.js";

/**
 * Canonical maturity classification across all 44 ModelScript languages.
 */
export const DEFAULT_LANGUAGE_MATURITY: Record<string, LanguageMaturity> = {
  // Tier 1: Stable (Production-grade native WASM GLR parser, Salsa queries, simulation/verification)
  modelica: "stable",
  sysml2: "stable",
  step: "stable",
  owl2: "stable",
  scad: "stable",
  csv: "stable",
  ssp: "stable",
  pscad: "stable",

  // Tier 2: Beta (Domain-complete parser, lowering, and custom IDE editor/diagram integration)
  modelscript: "beta",
  cfd: "beta",
  fea: "beta",
  c: "beta",
  fortran: "beta",
  gensys: "beta",
  simpack: "beta",
  psse: "beta",
  olga: "beta",
  lps: "beta",
  easy5: "beta",
  rocets: "beta",
  sima: "beta",
  spice: "beta",
  reqif: "beta",
  simulink: "beta",

  // Tier 3: Experimental (Early-stage domain parser, DAE/Modelica projection, or experimental support)
  adams: "experimental",
  aspen: "experimental",
  autosar: "experimental",
  ccsds: "experimental",
  eclipse: "experimental",
  energyplus: "experimental",
  epanet: "experimental",
  gtsuite: "experimental",
  ibis: "experimental",
  jsbsim: "experimental",
  opendrive: "experimental",
  opendss: "experimental",
  openscenario: "experimental",
  plcopen: "experimental",
  relap5: "experimental",
  sbml: "experimental",
  swmm: "experimental",
  touchstone: "experimental",
  urdf: "experimental",
  "verilog-a": "experimental",
};

/**
 * Languages that have a registered 2D diagram editor provider in @modelscript/ide-client.
 */
export const DIAGRAM_EDITOR_SUPPORTED_LANGS = new Set<string>([
  "modelica",
  "sysml2",
  "sysml",
  "step",
  "scad",
  "owl2",
  "csv",
  "pscad",
  "cfd",
  "fea",
  "ssp",
  "modelscript",
  "adams",
  "aspen",
  "autosar",
  "c",
  "ccsds",
  "easy5",
  "eclipse",
  "energyplus",
  "epanet",
  "fortran",
  "gensys",
  "gtsuite",
  "ibis",
  "jsbsim",
  "lps",
  "olga",
  "opendrive",
  "opendss",
  "openscenario",
  "plcopen",
  "psse",
  "relap5",
  "reqif",
  "rocets",
  "sbml",
  "sima",
  "simpack",
  "simulink",
  "spice",
  "swmm",
  "touchstone",
  "urdf",
  "verilog-a",
]);

/**
 * Configuration options for generating a VS Code extension.
 */
export interface ExtensionOptions {
  /** Extension unique identifier (e.g. "modelscript", "calc-lang") */
  name?: string | undefined;
  /** Human-readable display name (e.g. "ModelScript — Polyglot Systems IDE") */
  displayName?: string | undefined;
  /** Semantic version string */
  version?: string | undefined;
  /** Publisher name */
  publisher?: string | undefined;
  /** Extension description */
  description?: string | undefined;
  /** Homepage URL */
  homepage?: string | undefined;
  /** Repository URL */
  repository?: string | undefined;
  /** Minimum VS Code engine version (default: "^1.80.0") */
  vscodeEngine?: string | undefined;
  /** Output mode: "web" (pure browser) | "node" (desktop) | "universal" (both) */
  target?: "web" | "node" | "universal" | undefined;
  /** Feature toggles */
  features?:
    | {
        diagramEditor?: boolean | undefined;
        cad3dViewer?: boolean | undefined;
        simulationPanels?: boolean | undefined;
        notebooks?: boolean | undefined;
        mcpBridge?: boolean | undefined;
        chatParticipant?: boolean | undefined;
      }
    | undefined;
}

export interface ExtensionGeneratedFile {
  path: string;
  content: string | Uint8Array;
}

/**
 * Normalized language descriptor for extension generation.
 */
export interface NormalizedLanguage {
  id: string;
  name: string;
  displayName: string;
  maturity: LanguageMaturity;
  fileExtensions: string[];
  primaryExtension: string;
  options: LanguageOptions;
  lineComment?: string | undefined;
  blockComment?: { open: string; close: string } | undefined;
  icon?: { light: string; dark: string } | undefined;
}

/**
 * Normalizes a list of LanguageOptions into standard descriptors.
 */
export function normalizeLanguages(languages: (LanguageOptions | any)[]): NormalizedLanguage[] {
  return languages.map((lang) => {
    const rawName = lang.name || "dsl";
    const id = rawName.toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const displayName = lang.displayName || rawName.charAt(0).toUpperCase() + rawName.slice(1);
    const maturity: LanguageMaturity = lang.maturity || DEFAULT_LANGUAGE_MATURITY[id] || "experimental";

    // Extract file extensions
    let extensions: string[] = [];
    if (lang.extensions && Array.isArray(lang.extensions)) {
      extensions = lang.extensions.map((e: string) => (e.startsWith(".") ? e : `.${e}`));
    } else if (lang.lsp?.fileExtensions && Array.isArray(lang.lsp.fileExtensions)) {
      extensions = lang.lsp.fileExtensions.map((e: string) => (e.startsWith(".") ? e : `.${e}`));
    } else if (lang.lsp?.fileExtension) {
      const ext = lang.lsp.fileExtension.startsWith(".") ? lang.lsp.fileExtension : `.${lang.lsp.fileExtension}`;
      extensions = [ext];
    } else if (lang.fileExtensions && Array.isArray(lang.fileExtensions)) {
      extensions = lang.fileExtensions.map((e: string) => (e.startsWith(".") ? e : `.${e}`));
    } else if (id === "sysml2" || id === "sysml") {
      extensions = [".sysml", ".sysml2"];
    } else if (id === "step") {
      extensions = [".step", ".stp", ".p21"];
    } else if (id === "owl2" || id === "owl") {
      extensions = [".owl", ".owl2", ".ofn", ".ttl"];
    } else {
      extensions = [`.${id}`];
    }

    // Never allow .ts (TypeScript) to be hijacked by a domain language
    extensions = extensions.map((ext) => (ext.toLowerCase() === ".ts" ? ".ts2" : ext));

    // Extract comment delimiters
    const lineComment = lang.primitives?.lineComment || "//";
    const blockComment = lang.primitives?.nestedComment || { open: "/*", close: "*/" };

    return {
      id,
      name: rawName,
      displayName,
      maturity,
      fileExtensions: extensions,
      primaryExtension: extensions[0] || `.${id}`,
      options: lang,
      lineComment,
      blockComment,
      icon: lang.lsp?.icons,
    };
  });
}

/**
 * Generates the package.json manifest for the unified VS Code extension.
 */
export function generatePackageJson(languages: NormalizedLanguage[], options?: ExtensionOptions): Record<string, any> {
  const isMultiLang = languages.length > 1;
  const primaryLang = languages[0] || { id: "modelscript", name: "ModelScript", displayName: "ModelScript" };

  const name = options?.name || (isMultiLang ? "modelscript-suite" : `${primaryLang.id}-lang`);
  const displayName =
    options?.displayName ||
    (isMultiLang ? "ModelScript — Polyglot Systems IDE" : `${primaryLang.displayName} for VS Code`);
  const version = options?.version || `1.0.${Math.floor(Date.now() / 1000)}`;
  const publisher = options?.publisher || "modelscript";
  const description =
    options?.description ||
    (isMultiLang
      ? "Complete multi-language modeling, diagramming, and simulation environment for VS Code."
      : `VS Code support for ${primaryLang.displayName} with syntax highlighting, diagnostics, and diagram editing.`);

  const contributesLanguages: any[] = [];
  const contributesGrammars: any[] = [];
  const customEditors: any[] = [];
  const activationEvents: string[] = ["*", "onStartupFinished", "onFileSystem:memfs"];

  for (const lang of languages) {
    activationEvents.push(`onLanguage:${lang.id}`);

    const aliases = [lang.displayName, lang.name];
    if (lang.id === "sysml2" || lang.id === "sysml") {
      for (const a of ["SysML v2", "SysML", "sysml2", "sysml"]) {
        if (!aliases.includes(a)) aliases.push(a);
      }
    }

    const langEntry: any = {
      id: lang.id,
      aliases,
      extensions: lang.fileExtensions,
      configuration: `./language-configuration-${lang.id}.json`,
    };

    if (lang.icon) {
      langEntry.icon = lang.icon;
    }

    contributesLanguages.push(langEntry);

    contributesGrammars.push({
      language: lang.id,
      scopeName: `source.${lang.id}`,
      path: `./syntaxes/${lang.id}.tmLanguage.json`,
    });

    if (lang.id === "sysml2") {
      activationEvents.push("onLanguage:sysml");
      const sysmlEntry: any = {
        id: "sysml",
        aliases: ["SysML", "sysml"],
        extensions: [".sysml"],
        configuration: `./language-configuration-sysml.json`,
      };
      if (lang.icon) {
        sysmlEntry.icon = lang.icon;
      }
      contributesLanguages.push(sysmlEntry);
      contributesGrammars.push({
        language: "sysml",
        scopeName: `source.sysml`,
        path: `./syntaxes/sysml.tmLanguage.json`,
      });
    }

    if (options?.features?.diagramEditor !== false && DIAGRAM_EDITOR_SUPPORTED_LANGS.has(lang.id)) {
      customEditors.push({
        viewType: `${lang.id}.diagramEditor`,
        displayName: `${lang.displayName} 2D Diagram`,
        selector: lang.fileExtensions.map((ext) => ({ filenamePattern: `*${ext}` })),
        priority: "option",
      });
    }
  }

  // If STEP / 3D CAD viewer is enabled
  if (options?.features?.cad3dViewer || languages.some((l) => l.id === "step")) {
    customEditors.push({
      viewType: "modelscript.stepEditor",
      displayName: "3D CAD / STEP Viewer",
      selector: [{ filenamePattern: "*.step" }, { filenamePattern: "*.stp" }],
      priority: "option",
    });
  }

  // FEA / CalculiX Deck 3D Editor
  if (languages.some((l) => l.id === "fea")) {
    customEditors.push({
      viewType: "modelscript.inpEditor",
      displayName: "FEA Deck & 3D Simulation Viewer",
      selector: [{ filenamePattern: "*.inp" }, { filenamePattern: "*.inpt" }],
      priority: "option",
    });
  }

  // CFD / SU2 Config 3D Editor
  if (languages.some((l) => l.id === "cfd")) {
    customEditors.push({
      viewType: "modelscript.cfgEditor",
      displayName: "CFD Config & 3D Aerodynamics Viewer",
      selector: [{ filenamePattern: "*.cfg" }, { filenamePattern: "*.cfgt" }],
      priority: "option",
    });
  }

  // PSS/E RAW Power Flow Grid & SLD Editor
  if (languages.some((l) => l.id === "psse")) {
    customEditors.push({
      viewType: "modelscript.rawEditor",
      displayName: "PSS/E Grid & Single-Line Diagram (SLD) Editor",
      selector: [{ filenamePattern: "*.raw" }],
      priority: "option",
    });
  }

  // OLGA Transient Multiphase Flow Assurance Editor
  if (languages.some((l) => l.id === "olga")) {
    customEditors.push({
      viewType: "modelscript.olgaEditor",
      displayName: "OLGA Multiphase Flow Assurance Editor",
      selector: [
        { filenamePattern: "*.opi" },
        { filenamePattern: "*.key" },
        { filenamePattern: "*.genkey" },
        { filenamePattern: "*.tpl" },
        { filenamePattern: "*.ppl" },
      ],
      priority: "option",
    });
  }

  // EASY5 Dynamic Simulation & Linear Control Editor
  if (languages.some((l) => l.id === "easy5")) {
    customEditors.push({
      viewType: "modelscript.easy5Editor",
      displayName: "EASY5 Schematic & Linear Control Editor",
      selector: [
        { filenamePattern: "*.ez5" },
        { filenamePattern: "*.ezm" },
        { filenamePattern: "*.ezd" },
        { filenamePattern: "*.eas" },
      ],
      priority: "option",
    });
  }

  // NASA ROCETS Liquid Propulsion P&ID & Balance Editor
  if (languages.some((l) => l.id === "rocets")) {
    customEditors.push({
      viewType: "modelscript.rocetsEditor",
      displayName: "ROCETS Propulsion Schematic & Balance Editor",
      selector: [{ filenamePattern: "*.roc" }, { filenamePattern: "*.deck" }],
      priority: "option",
    });
  }

  // LPS Pipeline Hydraulic Studio
  if (languages.some((l) => l.id === "lps")) {
    customEditors.push({
      viewType: "modelscript.lpsEditor",
      displayName: "LPS Pipeline Hydraulic Studio",
      selector: [{ filenamePattern: "*.lps" }, { filenamePattern: "*.lpsx" }],
      priority: "option",
    });
  }

  // SIMA Offshore Marine Operations Studio
  if (languages.some((l) => l.id === "sima")) {
    customEditors.push({
      viewType: "modelscript.simaEditor",
      displayName: "SIMA Offshore Marine Operations Studio",
      selector: [{ filenamePattern: "*.sima" }, { filenamePattern: "*.stask" }],
      priority: "option",
    });
  }

  // GT-SUITE Multi-Physics Powertrain & Thermal Studio
  if (languages.some((l) => l.id === "gtsuite")) {
    customEditors.push({
      viewType: "modelscript.gtsuiteEditor",
      displayName: "GT-SUITE Powertrain & Thermal Studio",
      selector: [{ filenamePattern: "*.gtm" }, { filenamePattern: "*.gtp" }],
      priority: "option",
    });
  }

  // SysML Requirements Matrix & Element Table Custom Editors
  if (languages.some((l) => l.id === "sysml2" || l.id === "sysml")) {
    customEditors.push({
      viewType: "modelscript.requirementsEditor",
      displayName: "SysML Requirements Matrix",
      selector: [{ filenamePattern: "*.sysml" }, { filenamePattern: "*.sysml2" }],
      priority: "option",
    });
    customEditors.push({
      viewType: "modelscript.elementTable",
      displayName: "SysML Element Table",
      selector: [{ filenamePattern: "*.sysml" }, { filenamePattern: "*.sysml2" }],
      priority: "option",
    });
  }

  // Generic ModelScript Diagram Custom Editor
  if (options?.features?.diagramEditor !== false) {
    customEditors.push({
      viewType: "modelscript.diagram",
      displayName: "ModelScript Diagram Editor",
      selector: [
        { filenamePattern: "*.mo" },
        { filenamePattern: "*.sysml" },
        { filenamePattern: "*.sysml2" },
        { filenamePattern: "*.owl" },
        { filenamePattern: "*.ofn" },
        { filenamePattern: "*.ttl" },
        { filenamePattern: "*.pscx" },
        { filenamePattern: "*.ssd" },
      ],
      priority: "option",
    });
  }

  // FMU, SSP, and G-Code Custom Editors
  customEditors.push(
    {
      viewType: "modelscript.fmuViewer",
      displayName: "FMU Archive Inspector",
      selector: [{ filenamePattern: "*.fmu" }],
      priority: "default",
    },
    {
      viewType: "modelscript.sspViewer",
      displayName: "SSP System Structure Viewer",
      selector: [{ filenamePattern: "*.ssp" }],
      priority: "default",
    },
    {
      viewType: "modelscript.gcodeViewer",
      displayName: "3D G-Code Toolpath Viewer",
      selector: [{ filenamePattern: "*.gcode" }, { filenamePattern: "*.nc" }],
      priority: "default",
    },
    {
      viewType: "modelscript.psoutViewer",
      displayName: "PSCAD PSOUT Waveform Studio",
      selector: [{ filenamePattern: "*.psout" }],
      priority: "default",
    },
  );

  // Collect commands, menus, language model tools, and keybindings from language actions
  const commands: any[] = [
    {
      command: "modelscript.configureFeatures",
      title: "ModelScript: Configure Features & Release Channel...",
      category: "ModelScript",
      icon: "$(sliders)",
    },
    {
      command: "modelscript.configureLanguages",
      title: "ModelScript: Configure Languages & Maturity Tiers...",
      category: "ModelScript",
      icon: "$(settings-gear)",
    },
    {
      command: "modelscript.openDiagram",
      title: "ModelScript: Open Diagram",
      category: "ModelScript",
      icon: "$(open-preview)",
    },
    {
      command: "modelscript.openDiagramSource",
      title: "ModelScript: Open Source",
      category: "ModelScript",
      icon: "$(go-to-file)",
    },
    {
      command: "modelscript.openStepViewer",
      title: "ModelScript: Open 3D CAD Viewer",
      category: "ModelScript",
      icon: "$(package)",
    },
    {
      command: "modelscript.generateFeaMesh",
      title: "ModelScript: Discretize CAD to FEA Mesh (.inp)",
      category: "ModelScript CAE",
      icon: "$(symbol-structure)",
    },
    {
      command: "modelscript.generateCfdMesh",
      title: "ModelScript: Discretize CAD to CFD Mesh (.su2)",
      category: "ModelScript CAE",
      icon: "$(flame)",
    },
    {
      command: "modelscript.syncDigitalThreadParams",
      title: "ModelScript: Sync Multi-Domain Digital Thread (CAE -> Modelica & SysML)",
      category: "ModelScript Digital Thread",
      icon: "$(sync)",
    },
    {
      command: "modelscript.generateMultiBody",
      title: "ModelScript: Translate CAD Assembly to Modelica MultiBody",
      category: "ModelScript CAE",
      icon: "$(symbol-structure)",
    },
    {
      command: "modelscript.createFeaSetup",
      title: "ModelScript: Create FEA Simulation Study (.fea.mo)",
      category: "ModelScript CAE",
    },
    {
      command: "modelscript.createCfdSetup",
      title: "ModelScript: Create CFD Simulation Study (.cfd.mo)",
      category: "ModelScript CAE",
    },
    {
      command: "modelscript.projectModel",
      title: "ModelScript: Project Model to Target Engineering Domain...",
      category: "ModelScript Polyglot",
      icon: "$(arrow-swap)",
    },
    {
      command: "modelscript.openPolyglotVisualizer",
      title: "ModelScript: Open 3D Polyglot Visualizer",
      category: "ModelScript Polyglot",
      icon: "$(symbol-misc)",
    },
    {
      command: "modelscript.openRequirements",
      title: "ModelScript: Open Requirements Matrix",
      category: "ModelScript SysML",
      icon: "$(checklist)",
    },
    {
      command: "modelscript.exportFmi2",
      title: "ModelScript: Export FMU (FMI 2.0)",
      category: "ModelScript FMI",
    },
    {
      command: "modelscript.exportFmi3",
      title: "ModelScript: Export FMU (FMI 3.0)",
      category: "ModelScript FMI",
    },
    {
      command: "modelscript.compileWasm",
      title: "ModelScript: Compile Model to WebAssembly (.wasm)",
      category: "ModelScript",
    },
    {
      command: "modelscript.materializeCalculixDeck",
      title: "ModelScript: Materialize FEA Deck (.inpt -> .inp)",
      category: "ModelScript CAE",
      icon: "$(file-code)",
    },
    {
      command: "modelscript.materializeSu2Config",
      title: "ModelScript: Materialize CFD Config (.cfgt -> .cfg)",
      category: "ModelScript CAE",
      icon: "$(file-code)",
    },
    {
      command: "modelscript.exportShapeToStep",
      title: "ModelScript: Export Shape to STEP CAD (.step)",
      category: "ModelScript CAD",
      icon: "$(export)",
    },
    {
      command: "modelscript.owl2.openDiagram",
      title: "ModelScript: Open OWL2 Ontology Graph Diagram",
      category: "ModelScript OWL2",
      icon: "$(organization)",
    },
    {
      command: "modelscript.cosimOpenLivePlot",
      title: "ModelScript: Launch Multi-FMU Co-Simulation Master",
      category: "ModelScript Co-Simulation",
      icon: "$(play)",
    },
    {
      command: "modelscript.openDroneReachabilityDemo",
      title: "ModelScript: Verify Reachability Flowpipes (Zonotopes vs Intervals)",
      category: "ModelScript Verification",
      icon: "$(shield)",
    },
    {
      command: "modelscript.runReachabilityFlowpipe",
      title: "ModelScript: Compute Continuous Reachable Set Envelope (WASM Zonotopes)",
      category: "ModelScript Verification",
      icon: "$(shield)",
    },
    {
      command: "modelscript.openThreadExplorer",
      title: "ModelScript: Open Multi-Domain Digital Thread Explorer",
      category: "ModelScript Digital Thread",
      icon: "$(graph)",
    },
    {
      command: "modelscript.openSimulationView",
      title: "ModelScript: Open Simulation View (RK4 / CVODE)",
      category: "ModelScript Simulation",
      icon: "$(play)",
    },
    {
      command: "modelscript.openVrVisualization",
      title: "ModelScript: Open VR Factory Visualization",
      category: "ModelScript Visualization",
      icon: "$(device-camera-video)",
    },
    {
      command: "modelscript.owl2.goToDeclaration",
      title: "ModelScript: Go to OWL2 Declaration",
      category: "ModelScript OWL2",
    },
  ];

  const submenus: any[] = [
    {
      id: "modelscript.editorTitle.moreActions",
      label: "ModelScript Actions",
      icon: "$(ellipsis)",
    },
    {
      id: "modelscript.context.simulate",
      label: "ModelScript: Simulate & Solve",
      icon: "$(play)",
    },
    {
      id: "modelscript.context.verify",
      label: "ModelScript: Verify & Analyze",
      icon: "$(shield)",
    },
    {
      id: "modelscript.context.convert",
      label: "ModelScript: Convert & Project",
      icon: "$(arrow-swap)",
    },
  ];

  // Secondary actions are folded into the ModelScript Actions overflow menu by default (when editorTitleActions == 'compact')
  const editorMoreActionsMenus: any[] = [
    {
      command: "modelscript.openDroneReachabilityDemo",
      when: "(editorLangId == modelica || resourceLangId == modelica || editorLangId == sysml2 || resourceLangId == sysml2 || editorLangId == sysml || resourceLangId == sysml) && modelscript.feature.demos",
      group: "1_verify@1",
    },
    {
      command: "modelscript.syncDigitalThreadParams",
      when: "(editorLangId == modelica || resourceLangId == modelica || editorLangId == sysml2 || resourceLangId == sysml2 || editorLangId == fea || resourceLangId == fea || editorLangId == cfd || resourceLangId == cfd) && modelscript.feature.digitalThread",
      group: "2_thread@1",
    },
    {
      command: "modelscript.generateFeaMesh",
      when: "(activeCustomEditorId == modelscript.stepEditor || editorLangId == scad || resourceLangId == scad) && modelscript.feature.caeWorkbench",
      group: "3_cae@1",
    },
    {
      command: "modelscript.generateCfdMesh",
      when: "(activeCustomEditorId == modelscript.stepEditor || editorLangId == scad || resourceLangId == scad) && modelscript.feature.caeWorkbench",
      group: "3_cae@2",
    },
  ];

  const editorTitleMenus: any[] = [
    {
      command: "modelscript.openDroneReachabilityDemo",
      when: "(editorLangId == modelica || resourceLangId == modelica || editorLangId == sysml2 || resourceLangId == sysml2 || editorLangId == sysml || resourceLangId == sysml) && config.modelscript.ui.editorTitleActions == 'all' && modelscript.feature.demos",
      group: "navigation@10",
    },
    {
      command: "modelscript.syncDigitalThreadParams",
      when: "(editorLangId == modelica || resourceLangId == modelica || editorLangId == sysml2 || resourceLangId == sysml2 || editorLangId == fea || resourceLangId == fea || editorLangId == cfd || resourceLangId == cfd) && config.modelscript.ui.editorTitleActions == 'all' && modelscript.feature.digitalThread",
      group: "navigation@11",
    },
    {
      command: "modelscript.generateFeaMesh",
      when: "(activeCustomEditorId == modelscript.stepEditor || editorLangId == scad || resourceLangId == scad) && config.modelscript.ui.editorTitleActions == 'all' && modelscript.feature.caeWorkbench",
      group: "navigation@12",
    },
    {
      command: "modelscript.generateCfdMesh",
      when: "(activeCustomEditorId == modelscript.stepEditor || editorLangId == scad || resourceLangId == scad) && config.modelscript.ui.editorTitleActions == 'all' && modelscript.feature.caeWorkbench",
      group: "navigation@13",
    },
  ];

  const editorContextMenus: any[] = [
    {
      command: "modelscript.generateFeaMesh",
      when: "(resourceExtname == .step || resourceExtname == .stp || resourceExtname == .scad || editorLangId == scad || resourceLangId == scad) && modelscript.feature.caeWorkbench",
      group: "2_transform@2",
    },
    {
      command: "modelscript.generateCfdMesh",
      when: "(resourceExtname == .step || resourceExtname == .stp || resourceExtname == .scad || editorLangId == scad || resourceLangId == scad) && modelscript.feature.caeWorkbench",
      group: "2_transform@3",
    },
    {
      command: "modelscript.syncDigitalThreadParams",
      when: "(editorLangId == modelica || resourceLangId == modelica || editorLangId == sysml2 || resourceLangId == sysml2 || editorLangId == fea || resourceLangId == fea || editorLangId == cfd || resourceLangId == cfd) && modelscript.feature.digitalThread",
      group: "4_polyglot@3",
    },
  ];
  const explorerContextMenus: any[] = [
    {
      command: "modelscript.generateFeaMesh",
      when: "(resourceExtname == .step || resourceExtname == .stp || resourceExtname == .scad) && modelscript.feature.caeWorkbench",
      group: "modelscript_convert@2",
    },
    {
      command: "modelscript.generateCfdMesh",
      when: "(resourceExtname == .step || resourceExtname == .stp || resourceExtname == .scad) && modelscript.feature.caeWorkbench",
      group: "modelscript_convert@3",
    },
    {
      command: "modelscript.scad.export_step",
      when: "resourceExtname == .scad",
      group: "modelscript_convert@1",
    },
  ];

  const polyglotWhen = languages.map((l) => `editorLangId == ${l.id} || resourceLangId == ${l.id}`).join(" || ");
  if (polyglotWhen) {
    editorContextMenus.push(
      {
        command: "modelscript.projectModel",
        when: `(${polyglotWhen}) && modelscript.feature.polyglotProjection`,
        group: "4_polyglot@1",
      },
      {
        command: "modelscript.openPolyglotVisualizer",
        when: `(${polyglotWhen}) && modelscript.feature.polyglotProjection`,
        group: "4_polyglot@2",
      },
    );
  }
  const commandPaletteMenus: any[] = [
    {
      command: "modelscript.openDroneReachabilityDemo",
      when: "modelscript.feature.demos",
    },
    {
      command: "modelscript.openVrVisualization",
      when: "modelscript.feature.demos",
    },
    {
      command: "modelscript.syncDigitalThreadParams",
      when: "modelscript.feature.digitalThread",
    },
    {
      command: "modelscript.openThreadExplorer",
      when: "modelscript.feature.digitalThread",
    },
    {
      command: "modelscript.projectModel",
      when: "modelscript.feature.polyglotProjection",
    },
    {
      command: "modelscript.openPolyglotVisualizer",
      when: "modelscript.feature.polyglotProjection",
    },
    {
      command: "modelscript.cosimOpenLivePlot",
      when: "modelscript.feature.coSimulation",
    },
  ];
  const languageModelTools: any[] = [];
  const keybindings: any[] = [];

  // Automatically contribute diagram open/source buttons to editor/title for supported diagram languages
  if (options?.features?.diagramEditor !== false) {
    const diagramLangIds = new Set<string>();
    for (const lang of languages) {
      if (!DIAGRAM_EDITOR_SUPPORTED_LANGS.has(lang.id)) continue;
      // Check if language explicitly defined its own custom diagram action (Method 2)
      const hasCustomDiagramAction = (lang.options.actions || []).some(
        (a: any) => (a.id === "open_diagram" || a.id === "diagram" || a.id === "openDiagram") && a.ui?.editorTitle,
      );
      if (!hasCustomDiagramAction) {
        diagramLangIds.add(lang.id);
        if (lang.id === "sysml2") {
          diagramLangIds.add("sysml");
        }
      }
    }

    if (diagramLangIds.size > 0) {
      const editorWhen = Array.from(diagramLangIds)
        .map((id) => `editorLangId == ${id} || resourceLangId == ${id}`)
        .join(" || ");

      editorTitleMenus.push({
        command: "modelscript.openDiagram",
        when: `(${editorWhen}) && config.modelscript.ui.editorTitleActions != 'none'`,
        group: "navigation@0",
      });
    }

    const diagramViewTypes = [
      "modelscript.diagram",
      ...languages.filter((l) => DIAGRAM_EDITOR_SUPPORTED_LANGS.has(l.id)).map((l) => `${l.id}.diagramEditor`),
      ...(languages.some((l) => l.id === "sysml2") ? ["sysml.diagramEditor"] : []),
    ];
    if (options?.features?.cad3dViewer || languages.some((l) => l.id === "step")) {
      diagramViewTypes.push("modelscript.stepEditor");
    }
    if (languages.some((l) => l.id === "fea")) {
      diagramViewTypes.push("modelscript.inpEditor");
    }
    if (languages.some((l) => l.id === "cfd")) {
      diagramViewTypes.push("modelscript.cfgEditor");
    }
    if (languages.some((l) => l.id === "olga")) {
      diagramViewTypes.push("modelscript.olgaEditor");
    }
    const customEditorWhen = diagramViewTypes.map((vt) => `activeCustomEditorId == ${vt}`).join(" || ");

    editorTitleMenus.push({
      command: "modelscript.openDiagramSource",
      when: customEditorWhen,
      group: "navigation@0",
    });
  }

  const registeredToolNames = new Set<string>();
  const moreActionsLangIds = new Set<string>(["modelica", "sysml2", "sysml", "fea", "cfd", "scad"]);

  for (const lang of languages) {
    const actions: LanguageAction[] = [...(lang.options.actions || [])];

    // Bridge mcp.tools to actions if not explicitly present
    if (lang.options.mcp?.tools) {
      for (const tool of lang.options.mcp.tools) {
        if (
          !actions.some(
            (a) => a.id === tool.name || `modelscript_${a.id}` === tool.name || `${lang.id}_${a.id}` === tool.name,
          )
        ) {
          const cleanId = tool.name.replace(new RegExp(`^${lang.id}_`), "").replace(/^modelscript_/, "");
          actions.push({
            id: cleanId,
            title: tool.description,
            description: tool.description,
            category: (tool.category === "simulation"
              ? "simulate"
              : tool.category === "transformation"
                ? "transform"
                : "query") as ActionCategory,
            inputs: tool.inputSchema as any,
            ui: {
              languageModelTool: {
                name: tool.name.startsWith("modelscript_") ? tool.name : `modelscript_${cleanId}`,
                displayName: tool.description,
                modelDescription: tool.description,
              },
            },
          });
        }
      }
    }

    // Identify the single primary editorTitle action per language (preferring category === 'simulate' or @0)
    const editorTitleActions = actions.filter((a) => Boolean(a.ui?.editorTitle));
    const primaryTitleAction =
      editorTitleActions.find((a) => a.category === "simulate") ??
      editorTitleActions.find((a) => a.ui?.editorTitle?.group?.endsWith("@0")) ??
      editorTitleActions[0];

    for (const action of actions) {
      const commandId = `modelscript.${lang.id}.${action.id}`;
      const category = action.ui?.commandPalette?.category || lang.displayName;

      const cmdEntry: any = {
        command: commandId,
        title: action.title,
        category,
      };
      if (action.ui?.editorTitle?.icon) {
        cmdEntry.icon = action.ui.editorTitle.icon;
      }
      commands.push(cmdEntry);

      // 1. Editor title toolbar menu (cap top-level icons to 1 primary action per language in 'compact' mode)
      if (action.ui?.editorTitle) {
        const baseWhen = action.ui.editorTitle.when || `editorLangId == ${lang.id} || resourceLangId == ${lang.id}`;
        if (action === primaryTitleAction) {
          editorTitleMenus.push({
            command: commandId,
            when: `(${baseWhen}) && config.modelscript.ui.editorTitleActions != 'none'`,
            group: "navigation@1",
          });
        } else {
          moreActionsLangIds.add(lang.id);
          if (lang.id === "sysml2") moreActionsLangIds.add("sysml");
          editorMoreActionsMenus.push({
            command: commandId,
            when: baseWhen,
            group:
              action.category === "verify" ? "1_verify" : action.category === "transform" ? "2_transform" : "3_other",
          });
          editorTitleMenus.push({
            command: commandId,
            when: `(${baseWhen}) && config.modelscript.ui.editorTitleActions == 'all'`,
            group: action.ui.editorTitle.group || "navigation@5",
          });
        }
      }

      // 2. Editor context menu
      if (action.ui?.editorContextMenu) {
        editorContextMenus.push({
          command: commandId,
          when: action.ui.editorContextMenu.when || `editorLangId == ${lang.id} || resourceLangId == ${lang.id}`,
          group: action.ui.editorContextMenu.group || "1_modification",
        });
      }

      // 3. Explorer context menu
      if (action.ui?.explorerContextMenu) {
        const defaultWhen =
          lang.fileExtensions.length > 0
            ? lang.fileExtensions.map((ext) => `resourceExtname == ${ext}`).join(" || ")
            : `resourceLangId == ${lang.id}`;
        explorerContextMenus.push({
          command: commandId,
          when: action.ui.explorerContextMenu.when || defaultWhen,
          group: action.ui.explorerContextMenu.group || "navigation",
        });
      }

      // 4. Command palette filtering
      if (action.ui?.commandPalette?.when) {
        commandPaletteMenus.push({
          command: commandId,
          when: action.ui.commandPalette.when,
        });
      }

      // 5. Keybindings
      if (action.ui?.keybinding) {
        keybindings.push({
          command: commandId,
          key: action.ui.keybinding.key,
          mac: action.ui.keybinding.mac,
          when: action.ui.keybinding.when || `editorLangId == ${lang.id}`,
        });
      }

      // 6. Language Model Tools
      const toolName = action.ui?.languageModelTool?.name || `modelscript_${action.id}`;
      if (!registeredToolNames.has(toolName)) {
        registeredToolNames.add(toolName);

        const properties: Record<string, any> = {};
        const required: string[] = [];
        if (action.inputs) {
          for (const [propName, propDef] of Object.entries(action.inputs)) {
            properties[propName] = {
              type: propDef.type,
              description: propDef.description,
              default: propDef.default,
              enum: propDef.enum,
            };
            if (propDef.required) required.push(propName);
          }
        }

        languageModelTools.push({
          name: toolName,
          displayName: action.ui?.languageModelTool?.displayName || action.title,
          modelDescription: action.ui?.languageModelTool?.modelDescription || action.description,
          inputSchema: {
            type: "object",
            properties,
            ...(required.length > 0 ? { required } : {}),
          },
        });
      }
    }
  }

  if (moreActionsLangIds.size > 0) {
    const moreWhen = [
      ...Array.from(moreActionsLangIds).map((id) => `editorLangId == ${id} || resourceLangId == ${id}`),
      "activeCustomEditorId == modelscript.stepEditor",
    ].join(" || ");
    editorTitleMenus.push({
      submenu: "modelscript.editorTitle.moreActions",
      when: `(${moreWhen}) && config.modelscript.ui.editorTitleActions == 'compact'`,
      group: "navigation@99",
    });
  }

  // Defensively ensure standard built-in modelscript LM tools are always contributed
  const standardLmTools = [
    {
      name: "modelscript_flatten",
      displayName: "Flatten Modelica Model to DAE",
      modelDescription: "Flattens a Modelica model or component into its lower-level DAE equation representation.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Fully qualified Modelica class name" },
        },
        required: ["name"],
      },
    },
    {
      name: "modelscript_simulate",
      displayName: "Simulate Modelica Model",
      modelDescription: "Flattens and simulates a Modelica model with initial conditions and numerical integration.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Fully qualified Modelica class name" },
          startTime: { type: "number", description: "Simulation start time in seconds" },
          stopTime: { type: "number", description: "Simulation stop time in seconds" },
          solver: { type: "string", description: "Numerical ODE solver" },
          format: { type: "string", description: "Output format ('json' or 'csv')" },
        },
        required: ["name"],
      },
    },
    {
      name: "modelscript_query",
      displayName: "Query Model Structure",
      modelDescription: "Queries semantic structure, components, parameters, and extends hierarchy.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Class or component name to query" },
        },
        required: ["name"],
      },
    },
    {
      name: "modelscript_parse",
      displayName: "Parse Modelica Source Code",
      modelDescription: "Parses Modelica code into CST/AST and returns syntax diagnostics.",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "Modelica source code" },
        },
        required: ["code"],
      },
    },
    {
      name: "modelscript_add_component",
      displayName: "Add Component to Model",
      modelDescription: "Adds a subcomponent instance or equation to a Modelica class.",
      inputSchema: {
        type: "object",
        properties: {
          className: { type: "string", description: "Target class name" },
          classKind: { type: "string", description: "Kind of class (model, block, package, etc.)" },
        },
        required: ["className"],
      },
    },
    {
      name: "modelscript_simulate_and_plot",
      displayName: "Simulate and Plot Modelica Model",
      modelDescription: "Simulates a Modelica model and renders interactive visual plots in the simulation panel.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Modelica class name" },
        },
        required: ["name"],
      },
    },
    {
      name: "modelscript_closed_loop_synthesize",
      displayName: "Closed-Loop Compiler Synthesis & STL Certification",
      modelDescription:
        "Synthesizes and verifies a Modelica or SysML v2 candidate against syntax, QUDV units, DAE balance, and STL robustness gates.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Synthesis objective or specification" },
          code: { type: "string", description: "Candidate source code" },
        },
      },
    },
    {
      name: "tgg_reconcile_slot",
      displayName: "Reconcile Triple Graph Grammar (TGG) Slot Conflict",
      modelDescription: "Reconciles a divergent cross-domain parameter or port slot across SysML v2 and Modelica.",
      inputSchema: {
        type: "object",
        properties: {
          slotId: { type: "string", description: "Divergent correspondence slot identifier" },
          strategy: { type: "string", description: "Reconciliation strategy" },
        },
      },
    },
  ];

  for (const stdTool of standardLmTools) {
    if (!registeredToolNames.has(stdTool.name)) {
      registeredToolNames.add(stdTool.name);
      languageModelTools.push(stdTool);
    }
  }

  commands.push({
    command: "modelscript.openModel",
    title: "Open Model in Editor",
    category: "ModelScript",
  });

  commands.push({
    command: "modelscript.addToDiagram",
    title: "Add Component to Diagram",
    category: "ModelScript",
  });

  commands.push({
    command: "modelscript.writebackParameter",
    title: "Writeback Parameter Value to Source",
    category: "ModelScript",
  });

  const contributes: Record<string, any> = {
    languages: contributesLanguages,
    grammars: contributesGrammars,
    customEditors,
    commands,
    submenus,
    "markdown.markdownItPlugins": true,
    "markdown.previewScripts": ["./dist/markdownPreview.js"],
    menus: {
      "editor/title": editorTitleMenus,
      "modelscript.editorTitle.moreActions": editorMoreActionsMenus,
      "editor/context": editorContextMenus,
      "explorer/context": explorerContextMenus,
      "view/item/context": [
        {
          command: "modelscript.openModel",
          when: "view == modelscript.libraryTree",
          group: "navigation@1",
        },
        {
          command: "modelscript.addToDiagram",
          when: "view == modelscript.libraryTree",
          group: "navigation@2",
        },
      ],
      ...(commandPaletteMenus.length > 0 ? { commandPalette: commandPaletteMenus } : {}),
    },
    languageModelTools,
    ...(options?.features?.chatParticipant !== false
      ? {
          chatParticipants: [
            {
              id: "modelscript.chat",
              name: "modelscript",
              fullName: "ModelScript AI",
              description: "Polyglot systems engineering, Modelica simulation, and formal verification assistant.",
              isSticky: true,
            },
          ],
        }
      : {}),
    semanticTokenScopes: [
      {
        language: "modelica",
        scopes: {
          class: ["entity.name.type.class.modelica"],
          type: ["entity.name.type.modelica", "support.type.modelica"],
          variable: ["variable.other.modelica"],
          parameter: ["variable.parameter.modelica"],
          function: ["entity.name.function.modelica", "support.function.modelica"],
          keyword: ["keyword.other.modelica"],
          number: ["constant.numeric.modelica"],
          string: ["string.quoted.double.modelica"],
          comment: ["comment.modelica"],
          operator: ["keyword.operator.modelica"],
        },
      },
    ],
    configurationDefaults: {
      "editor.codeLens": true,
      "editor.semanticHighlighting.enabled": true,
    },
  };

  // Add notebook controller if enabled
  if (options?.features?.notebooks) {
    contributes["notebooks"] = [
      {
        type: "modelscript-notebook",
        displayName: "ModelScript Notebook",
        selector: [{ filenamePattern: "*.monb" }],
        priority: "default",
      },
    ];
  }

  contributes["debuggers"] = [
    {
      type: "modelscript",
      label: "ModelScript Simulator",
      languages: ["modelica"],
      configurationAttributes: {
        launch: {
          required: ["program"],
          properties: {
            program: {
              type: "string",
              description: "Absolute path to the Modelica source file.",
              default: "${file}",
            },
            stopOnEntry: {
              type: "boolean",
              description: "Automatically stop after launch.",
              default: true,
            },
          },
        },
      },
    },
  ];
  contributes["viewsContainers"] = {
    activitybar: [
      {
        id: "modelscript-sidebar",
        title: "ModelScript",
        icon: "$(circuit-board)",
      },
    ],
  };
  contributes["views"] = {
    explorer: [
      {
        id: "modelscript.owl2ClassHierarchy",
        name: "OWL2 Class Hierarchy",
        when: "modelscript.owl2Active && config.modelscript.languages.owl2.enabled",
      },
      {
        id: "modelscript.owl2PropertyHierarchy",
        name: "OWL2 Property Hierarchy",
        when: "modelscript.owl2Active && config.modelscript.languages.owl2.enabled",
      },
    ],
    "modelscript-sidebar": [
      {
        id: "modelscript.libraryTree",
        name: "Standard Libraries",
      },
      {
        id: "modelscript.experimentsView",
        name: "Experiments & Studies",
      },
      {
        id: "modelscript.chat",
        name: "ModelScript AI Copilot",
        type: "webview",
        when: "modelscript.feature.aiCopilot || config.modelscript.features.aiCopilot || config.modelscript.features.channel == 'experimental' || config.modelscript.features.channel == 'dev'",
      },
      {
        id: "modelscript.registryView",
        name: "Package Registry",
        type: "webview",
        when: "modelscript.feature.channel != 'stable' || config.modelscript.features.channel != 'stable'",
      },
      {
        id: "modelscript.cosimPanel",
        name: "Co-Simulation Orchestrator",
        type: "webview",
        when: "modelscript.feature.coSimulation || config.modelscript.features.coSimulation || config.modelscript.features.channel != 'stable'",
      },
      {
        id: "modelscript.mqttTree",
        name: "MQTT Participants",
        when: "modelscript.feature.coSimulation || config.modelscript.features.coSimulation || config.modelscript.features.channel != 'stable'",
      },
    ],
    scm: [
      {
        id: "modelscript.scmTreeView",
        name: "Model Structural Changes",
      },
    ],
  };

  // Build per-language enable/disable settings with maturity badges
  const languageToggleProperties: Record<string, any> = {
    "modelscript.languages.maturityTier": {
      type: "string",
      enum: ["stable", "beta", "experimental"],
      default: "beta",
      enumDescriptions: [
        "Enable only Tier 1 Stable languages (Modelica, SysML v2, STEP, OWL2, OpenSCAD, CSV, SSP, PSCAD).",
        "Enable Tier 1 Stable and Tier 2 Beta languages (recommended; avoids experimental extension collisions).",
        "Enable all 44 languages including Tier 3 Experimental domain dialects.",
      ],
      markdownDescription:
        "Minimum language maturity tier enabled by default across the workspace (`🟢 Stable`, `🟡 Beta`, or `🧪 Experimental`). Individual languages can also be toggled below.",
    },
    "modelscript.languages.showMaturityBadges": {
      type: "boolean",
      default: true,
      description:
        "Display language maturity tier badges (Stable, Beta, Experimental) in the status bar and language picker.",
    },
  };

  const maturityBadges: Record<LanguageMaturity, string> = {
    stable: "🟢 Stable",
    beta: "🟡 Beta",
    experimental: "🧪 Experimental",
  };

  const sortedLangs = [...languages].sort((a, b) => {
    const order: Record<LanguageMaturity, number> = { stable: 0, beta: 1, experimental: 2 };
    if (order[a.maturity] !== order[b.maturity]) return order[a.maturity] - order[b.maturity];
    return a.displayName.localeCompare(b.displayName);
  });

  for (const lang of sortedLangs) {
    const badge = maturityBadges[lang.maturity];
    const exts = lang.fileExtensions.map((e) => `\`${e}\``).join(", ");
    languageToggleProperties[`modelscript.languages.${lang.id}.enabled`] = {
      type: "boolean",
      default: lang.maturity !== "experimental",
      markdownDescription: `**[${badge}]** Enable **${lang.displayName}** (${exts}) language server indexing, diagnostics, actions, and custom views.`,
    };
  }

  contributes["configuration"] = [
    {
      title: "ModelScript: Features & Release Channel",
      properties: {
        "modelscript.features.channel": {
          type: "string",
          enum: ["stable", "preview", "experimental", "dev"],
          default: "stable",
          enumDescriptions: [
            "🟢 Stable: Core LSP, 1-click Simulate CodeLens, 2D/3D viewers, Standard Libraries & Experiments views.",
            "🟡 Preview: Adds Formal Verification, DAE structural proofs, CAE mesh/study workbench, and FMI Co-Simulation.",
            "🧪 Experimental: Adds Cross-Domain Digital Thread, Polyglot Model Projection, Multi-Domain Scaffolding, and AI Copilot.",
            "🔬 Dev / Showcase: Enables all internal vertical demos, Trade Study Tier 1-3 CodeLenses, and medical/VR showcases.",
          ],
          markdownDescription:
            "Controls which IDE and LSP feature maturity channel is enabled by default (`🟢 stable`, `🟡 preview`, `🧪 experimental`, or `🔬 dev`). Individual features can also be overridden below.",
        },
        "modelscript.features.codeLensSimulate": {
          type: "boolean",
          default: true,
          markdownDescription:
            "**[🟢 Stable]** Enable inline `▶ Simulate` and `▶ Run Study` CodeLens actions above executable declarations.",
        },
        "modelscript.features.formalVerification": {
          type: "boolean",
          markdownDescription:
            "**[🟡 Preview]** Enable contract verification, DAE structural singularity proofs, MC/DC coverage, and reachability analysis.",
        },
        "modelscript.features.caeWorkbench": {
          type: "boolean",
          markdownDescription:
            "**[🟡 Preview]** Enable CAD to FEA/CFD mesh discretization (`.inp`, `.su2`) and simulation study generation.",
        },
        "modelscript.features.coSimulation": {
          type: "boolean",
          markdownDescription:
            "**[🟡 Preview]** Enable FMI 2.0/3.0 Co-Simulation Orchestrator and live MQTT participants sidebar views.",
        },
        "modelscript.features.digitalThread": {
          type: "boolean",
          markdownDescription:
            "**[🧪 Experimental]** Enable cross-domain Digital Thread twin alignment, hover links, and parameter synchronization.",
        },
        "modelscript.features.polyglotProjection": {
          type: "boolean",
          markdownDescription: "**[🧪 Experimental]** Enable cross-domain model projection and 3D Polyglot Visualizer.",
        },
        "modelscript.features.scaffolding": {
          type: "boolean",
          markdownDescription:
            "**[🧪 Experimental]** Enable multi-domain file scaffolding (`.scad` + `.mo` + `.inp`) from SysML v2 parts.",
        },
        "modelscript.features.aiCopilot": {
          type: "boolean",
          markdownDescription:
            "**[🧪 Experimental]** Enable ModelScript AI Copilot sidebar view and compiler-in-the-loop synthesis.",
        },
        "modelscript.features.demos": {
          type: "boolean",
          markdownDescription:
            "**[🔬 Dev]** Enable vertical showcase demos (Drone Reachability, Candidate Trade Study Tiers 1-3, Pacemaker, VR Factory).",
        },
      },
    },
    {
      title: "ModelScript: Languages & Maturity",
      properties: languageToggleProperties,
    },
    {
      title: "ModelScript: UI & Editor",
      properties: {
        "modelscript.ui.editorTitleActions": {
          type: "string",
          enum: ["compact", "all", "none"],
          default: "compact",
          enumDescriptions: [
            "Show at most 2 primary buttons (Run/Simulate & Open Diagram) and fold secondary actions into the 'ModelScript Actions' menu.",
            "Show all language actions directly in the editor title bar.",
            "Hide all ModelScript buttons from the editor title bar.",
          ],
          description: "Controls how ModelScript toolbar buttons are displayed in the editor title bar.",
        },
        "modelscript.ui.contextMenuSubmenus": {
          type: "boolean",
          default: true,
          description: "Group ModelScript actions into submenus in the editor and file explorer context menus.",
        },
        "modelscript.ui.statusBar.visibility": {
          type: "string",
          enum: ["relevantOnly", "always", "hidden"],
          default: "relevantOnly",
          description: "Controls when the ModelScript LSP status bar item is visible.",
        },
        "modelscript.ui.statusBar.showSocialFeed": {
          type: "boolean",
          default: false,
          description: "Show the 'Share to Feed' button in the VS Code status bar.",
        },
        "modelscript.ui.statusBar.showCollaboration": {
          type: "boolean",
          default: false,
          description: "Show the live peer collaboration presence indicator in the status bar.",
        },
        "modelscript.ui.statusBar.showCloudStatus": {
          type: "boolean",
          default: false,
          description: "Show the ModelScript Cloud HPC balance & job status indicator in the status bar.",
        },
        "modelscript.ui.sidebar.combineWithMainView": {
          type: "boolean",
          default: true,
          description: "Consolidate ModelScript auxiliary tree views inside the ModelScript activity bar sidebar.",
        },
      },
    },
    {
      title: "ModelScript: CodeLens & Inlay Hints",
      properties: {
        "modelscript.codeLens.enabled": {
          type: "boolean",
          default: true,
          description: "Master switch for all ModelScript CodeLens annotations.",
        },
        "modelscript.codeLens.simulate": {
          type: "boolean",
          default: true,
          description: "Show '▶ Simulate' / '▶ Run Study' CodeLens above model and study declarations.",
        },
        "modelscript.codeLens.diagram": {
          type: "boolean",
          default: false,
          description:
            "Show '⊞ Open Interactive Diagram' as an inline CodeLens (disabled by default since Open Diagram is available in the Editor Title Bar).",
        },
        "modelscript.codeLens.verification": {
          type: "string",
          enum: ["all", "problemsOnly", "off"],
          default: "problemsOnly",
          enumDescriptions: [
            "Show formal verification, DAE singularity, and MC/DC badges on all declarations.",
            "Show formal verification badges only when potential or definite defects exist.",
            "Hide all formal verification CodeLenses.",
          ],
          description: "Controls when formal proof and DAE verification CodeLens badges are shown.",
        },
        "modelscript.codeLens.polyglotLinks": {
          type: "boolean",
          default: false,
          description: "Show Digital Thread cross-domain alignment and parameter twin CodeLenses.",
        },
        "modelscript.codeLens.cadMetrics": {
          type: "boolean",
          default: false,
          description: "Show 3D CAD / CAE geometry and mesh metrics CodeLenses.",
        },
        "modelscript.codeLens.fileConversions": {
          type: "boolean",
          default: false,
          description: "Show file-level CAD/CAE discretization and STEP export CodeLenses.",
        },
        "modelscript.inlayHints.enabled": {
          type: "boolean",
          default: true,
          description: "Enable inline ModelScript inlay hints in the editor.",
        },
        "modelscript.inlayHints.units": {
          type: "boolean",
          default: true,
          description: "Show physical unit inlay hints (e.g. [kg], [Pa]) next to declarations and literals.",
        },
        "modelscript.inlayHints.evaluatedConstants": {
          type: "boolean",
          default: true,
          description: "Show evaluated constant/parameter binding values inline.",
        },
        "modelscript.inlayHints.salsaTypes": {
          type: "boolean",
          default: false,
          description: "Show resolved Salsa type and variability annotations inline.",
        },
        "modelscript.inlayHints.crossFileBindings": {
          type: "boolean",
          default: true,
          description: "Show cross-file Digital Thread parameter binding values inline.",
        },
      },
    },
    {
      title: "ModelScript: Compiler & Diagnostics",
      properties: {
        "modelscript.compiler.flattenerBackend": {
          type: "string",
          enum: ["hybrid", "wasm", "ts"],
          default: "hybrid",
          description: "Modelica DAE flattener execution backend.",
        },
        "modelscript.diagnostics.enableCfa": {
          type: "boolean",
          default: true,
          description: "Enable abstract interpretation & control-flow analysis (CFA) formal verification lints.",
        },
        "modelscript.diagnostics.crossDomainConsistency": {
          type: "boolean",
          default: true,
          description: "Enable cross-domain Digital Thread parameter drift and contract consistency diagnostics.",
        },
        "modelscript.diagnostics.severityOverrides": {
          type: "object",
          default: {},
          description: 'Override diagnostic severity by error code (e.g. { "M3001": "warning", "M4002": "off" }).',
        },
        "modelscript.diagnostics.maxNumberOfProblems": {
          type: "number",
          default: 250,
          description: "Maximum number of diagnostics reported per file.",
        },
      },
    },
    {
      title: "ModelScript: Simulation & Solvers",
      properties: {
        "modelscript.simulation.defaultStopTime": {
          type: "number",
          default: 10.0,
          description: "Default simulation stop time in seconds when not specified by an experiment annotation.",
        },
        "modelscript.simulation.defaultIntervals": {
          type: "number",
          default: 500,
          description: "Default number of output intervals for time-domain simulations.",
        },
        "modelscript.simulation.defaultTolerance": {
          type: "number",
          default: 1e-6,
          description: "Default relative integration error tolerance.",
        },
        "modelscript.simulation.defaultSolver": {
          type: "string",
          enum: ["rk4", "dopri5", "bdf", "cvode", "ida", "radau5"],
          default: "dopri5",
          description: "Default numerical ODE/DAE solver.",
        },
        "modelscript.simulation.executionTarget": {
          type: "string",
          enum: ["wasm-cpu", "webgpu", "cloud"],
          default: "wasm-cpu",
          description: "Default execution target for simulations and parameter sweeps.",
        },
        "modelscript.simulation.autoOpenPlotPanel": {
          type: "boolean",
          default: true,
          description: "Automatically open the interactive plot panel when a simulation finishes.",
        },
      },
    },
    {
      title: "ModelScript: Diagrams & CAD",
      properties: {
        "modelscript.diagram.autoLayoutEngine": {
          type: "string",
          enum: ["elk-layered", "dagre", "force"],
          default: "elk-layered",
          description: "Auto-layout algorithm for 2D schematic and SysML diagrams.",
        },
        "modelscript.diagram.routingStyle": {
          type: "string",
          enum: ["orthogonal", "bezier", "straight"],
          default: "orthogonal",
          description: "Connection line routing style in 2D diagrams.",
        },
        "modelscript.diagram.invertColorsInDarkMode": {
          type: "boolean",
          default: true,
          description: "Adapt Modelica icon and diagram colors for dark editor themes.",
        },
        "modelscript.cad.meshDeflection": {
          type: "number",
          default: 0.1,
          description: "Linear deflection tolerance for 3D STEP/CSG surface triangulation.",
        },
        "modelscript.cad.autoEvaluateCsgInCodeLens": {
          type: "boolean",
          default: true,
          description: "Automatically evaluate OpenSCAD CSG volume and frontal area metrics for CodeLens.",
        },
      },
    },
    {
      title: "ModelScript: Cloud, Registry & AI",
      properties: {
        "modelscript.apiUrl": {
          type: "string",
          default: "http://localhost:3000/api/v1",
          description: "Base URL for the ModelScript backend API server.",
        },
        "modelscript.registry.url": {
          type: "string",
          default: "https://api.modelscript.org",
          description: "Base URL for the ModelScript package registry.",
        },
        "modelscript.registryUrl": {
          type: "string",
          default: "https://api.modelscript.org",
          markdownDeprecationMessage: "Use `#modelscript.registry.url#` instead.",
          description: "Base URL for the ModelScript package registry and backend API.",
        },
        "modelscript.library.useApiRegistry": {
          type: "boolean",
          default: false,
          description:
            "Fetch standard library packages from the remote API registry instead of bundled local snapshots.",
        },
        "modelscript.llm.provider": {
          type: "string",
          enum: ["webllm", "ollama", "openai", "anthropic", "gemini"],
          default: "webllm",
          description: "AI language model provider for ModelScript chat and code synthesis.",
        },
        "modelscript.llm.apiKey": {
          type: "string",
          default: "",
          description: "API key for cloud LLM providers (OpenAI, Anthropic, Gemini).",
        },
        "modelscript.llm.endpoint": {
          type: "string",
          default: "http://localhost:11434",
          description: "Custom endpoint URL for local or self-hosted LLM providers (e.g. Ollama).",
        },
        "modelscript.llm.model": {
          type: "string",
          default: "",
          description: "Model identifier override for the configured LLM provider.",
        },
        "modelscript.cosim.brokerUrl": {
          type: "string",
          default: "ws://localhost:9001",
          description: "WebSocket MQTT broker URL for live digital twin and co-simulation streaming.",
        },
        "modelscript.mqtt.brokerUrl": {
          type: "string",
          default: "ws://localhost:9001",
          markdownDeprecationMessage: "Use `#modelscript.cosim.brokerUrl#` instead.",
          description: "WebSocket MQTT broker URL for live digital twin and hardware-in-the-loop streaming.",
        },
        "modelscript.collab.signalingUrl": {
          type: "string",
          default: "ws://localhost:3000/collab",
          description: "WebSocket signaling URL for live multi-user collaborative editing.",
        },
        "modelscript.cloud.apiUrl": {
          type: "string",
          default: "https://api.modelscript.org",
          description: "Endpoint URL for ModelScript Cloud HPC simulation jobs.",
        },
        "modelscript.cloud.apiKey": {
          type: "string",
          default: "",
          description: "Authentication API key for ModelScript Cloud simulation services.",
        },
        "modelscript.cloud.pollIntervalMs": {
          type: "number",
          default: 30000,
          description:
            "Polling interval in milliseconds for ModelScript Cloud job status (set to 0 to disable background polling).",
        },
      },
    },
  ];

  const manifest: Record<string, any> = {
    name,
    displayName,
    version,
    publisher,
    description,
    categories: ["Programming Languages", "Linters", "Formatters"],
    keywords: ["modelica", "sysml", "simulation", "dsl", "modeling", "wasm"],
    homepage: options?.homepage || "https://modelscript.org",
    repository: {
      type: "git",
      url: options?.repository || "https://github.com/modelscript/modelscript.git",
    },
    license: "AGPL-3.0-or-later",
    engines: {
      vscode: options?.vscodeEngine || "^1.80.0",
    },
    browser: "./dist/extension.js",
    activationEvents,
    contributes,
  };

  return manifest;
}

/**
 * Generates language-configuration.json content for a specific language.
 */
export function generateLanguageConfiguration(lang: NormalizedLanguage): string {
  const lineComment = lang.lineComment || "//";
  const blockOpen = lang.blockComment?.open || "/*";
  const blockClose = lang.blockComment?.close || "*/";

  const config = {
    comments: {
      lineComment,
      blockComment: [blockOpen, blockClose],
    },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"', notIn: ["string"] },
      { open: "'", close: "'", notIn: ["string", "comment"] },
    ],
    surroundingPairs: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
      ['"', '"'],
      ["'", "'"],
    ],
    folding: {
      markers: {
        start: "^\\s*//\\s*#?region\\b",
        end: "^\\s*//\\s*#?endregion\\b",
      },
    },
  };

  return JSON.stringify(config, null, 2);
}

/**
 * Generates the unified client extension.ts TypeScript bootstrap source.
 */
export function generateExtensionBootstrap(languages: NormalizedLanguage[], _options?: ExtensionOptions): string {
  const langArrayJson = JSON.stringify(
    languages.map((l) => ({
      id: l.id,
      name: l.name,
      displayName: l.displayName,
      primaryExtension: l.primaryExtension,
      fileExtensions: l.fileExtensions,
    })),
    null,
    2,
  );

  return `// SPDX-License-Identifier: AGPL-3.0-or-later
// Auto-generated by ModelScript Unified Extension Generator
import * as vscode from "vscode";

interface LanguageMeta {
  id: string;
  name: string;
  displayName: string;
  primaryExtension: string;
  fileExtensions: string[];
}

const REGISTERED_LANGUAGES: LanguageMeta[] = ${langArrayJson};

let wasmExports: any;
let wasmMemory: WebAssembly.Memory;
let currentWasmBufferUri: string | null = null;
const uriToLastText = new Map<string, string>();
const uriToFileId = new Map<string, number>();
const fileIdToUri = new Map<number, string>();
let nextFileId = 0;

function getFileId(uri: string): number {
  if (uriToFileId.has(uri)) return uriToFileId.get(uri)!;
  const id = nextFileId++;
  uriToFileId.set(uri, id);
  fileIdToUri.set(id, uri);
  return id;
}

function syncWasmInputBuffer(doc: vscode.TextDocument) {
  if (!wasmExports) return;
  if (currentWasmBufferUri === doc.uri.toString() && uriToLastText.get(doc.uri.toString()) === doc.getText()) return;
  const text = doc.getText();
  const lenBytes = text.length * 2;
  const textPtr = wasmExports.ensureInputBuffer ? wasmExports.ensureInputBuffer(lenBytes) : (wasmExports.getInputBuffer ? wasmExports.getInputBuffer() : 0);
  if (!textPtr || !wasmMemory) return;

  const memArray = new Uint16Array(wasmMemory.buffer);
  for (let i = 0; i < text.length; i++) {
    memArray[(textPtr >> 1) + i] = text.charCodeAt(i);
  }
  if (wasmExports.lsp_setInputEncoding) wasmExports.lsp_setInputEncoding(1);
  if (wasmExports.lsp_setInputLength) wasmExports.lsp_setInputLength(lenBytes);

  currentWasmBufferUri = doc.uri.toString();
  uriToLastText.set(doc.uri.toString(), text);
}

// Diagram Editor Provider
class PolyglotDiagramEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext, private readonly langMeta: LanguageMeta) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = { enableScripts: true };

    const updateWebview = () => {
      syncWasmInputBuffer(document);
      const fileId = getFileId(document.uri.toString());
      let diagramData = { nodes: [], edges: [] };
      if (wasmExports && wasmExports.getDiagramData) {
        try {
          const ptr = wasmExports.getDiagramData(fileId);
          if (ptr) {
            // Read JSON from WASM memory
            const mem = new Uint8Array(wasmMemory.buffer);
            let end = ptr;
            while (mem[end] !== 0) end++;
            const jsonStr = new TextDecoder().decode(mem.subarray(ptr, end));
            diagramData = JSON.parse(jsonStr);
          }
        } catch (e) {
          console.warn("Diagram extraction failed:", e);
        }
      }
      webviewPanel.webview.postMessage({
        type: "update",
        text: document.getText(),
        diagramData,
        language: this.langMeta.displayName,
      });
    };

    const changeDocSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocSubscription.dispose();
    });

    webviewPanel.webview.onDidReceiveMessage((e) => {
      if (e.type === "edit" && e.actions) {
        // Handle diagram user edits
      }
    });

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, document);
    updateWebview();
  }

  private getHtmlForWebview(_webview: vscode.Webview, _document: vscode.TextDocument): string {
    return \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${this.langMeta.displayName} Diagram</title>
  <style>
    body { margin: 0; padding: 0; background: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow: hidden; height: 100vh; display: flex; flex-direction: column; }
    #canvas-container { flex: 1; position: relative; background: #0d1117; background-image: radial-gradient(#21262d 1px, transparent 1px); background-size: 20px 20px; overflow: hidden; }
    .diagram-node { position: absolute; border: 2px solid #58a6ff; background: rgba(56, 139, 253, 0.15); border-radius: 6px; cursor: move; user-select: none; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #f0f6fc; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
    .diagram-node:hover { border-color: #79c0ff; background: rgba(56, 139, 253, 0.25); }
    .port-pin { position: absolute; width: 8px; height: 8px; background: #3fb950; border: 1px solid #ffffff; border-radius: 50%; }
  </style>
</head>
<body>
  <div id="canvas-container"></div>
  <script>
    const vscode = acquireVsCodeApi();
    const container = document.getElementById('canvas-container');
    let currentDiagram = { nodes: [], edges: [] };

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'update') {
        currentDiagram = message.diagramData || { nodes: [], edges: [] };
        render();
      }
    });

    function render() {
      container.innerHTML = '';
      (currentDiagram.nodes || []).forEach(node => {
        const el = document.createElement('div');
        el.className = 'diagram-node';
        el.style.left = (node.x + 250) + 'px';
        el.style.top = (node.y + 200) + 'px';
        el.style.width = (node.width || 120) + 'px';
        el.style.height = (node.height || 60) + 'px';
        el.innerHTML = '<span style="font-size: 11px; opacity: 0.7;">' + (node.typeId || 'Node') + '</span><span>' + (node.label || node.id || 'Node') + '</span>';
        container.appendChild(el);
      });
    }
  </script>
</body>
</html>\`;
  }
}

export async function activate(context: vscode.ExtensionContext) {
  console.log("Activating ModelScript Extension for languages:", REGISTERED_LANGUAGES.map(l => l.displayName).join(", "));

  // Try to initialize WASM backend if available in the extension
  try {
    const wasmUri = vscode.Uri.joinPath(context.extensionUri, "parser.wasm");
    const wasmBytes = await vscode.workspace.fs.readFile(wasmUri);
    wasmMemory = new WebAssembly.Memory({ initial: 4000, maximum: 16000, shared: true });
    const env = {
      memory: wasmMemory,
      abort: () => console.error("WASM Abort"),
      logInt: () => {},
    };
    const module = await WebAssembly.instantiate(wasmBytes, { env, parser: env, engine: { debugLog: env.logInt }, host: { runHostQuery: () => 0 } });
    wasmExports = module.instance.exports;
    if (wasmExports.initArena) wasmExports.initArena(10 * 1024 * 1024);
  } catch (e) {
    console.log("Note: Running in lightweight mode without local parser.wasm:", e);
  }

  // Register Custom Diagram Editors for each registered language
  for (const lang of REGISTERED_LANGUAGES) {
    const provider = new PolyglotDiagramEditorProvider(context, lang);
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(\`\${lang.id}.diagramEditor\`, provider, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: true,
      })
    );
  }

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.openDiagram", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const lang = REGISTERED_LANGUAGES.find(l => l.fileExtensions.some(ext => editor.document.fileName.endsWith(ext)));
      if (lang) {
        const viewType = lang.id === "step" ? "modelscript.stepEditor" : \`\${lang.id}.diagramEditor\`;
        await vscode.commands.executeCommand("vscode.openWith", editor.document.uri, viewType);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.openDiagramSource", async () => {
      const tab = vscode.window.tabGroups?.activeTabGroup?.activeTab;
      if (tab?.input && typeof tab.input === "object" && "uri" in (tab.input as any)) {
        await vscode.commands.executeCommand("vscode.openWith", (tab.input as any).uri, "default");
      } else {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          await vscode.commands.executeCommand("vscode.openWith", editor.document.uri, "default");
        }
      }
    })
  );
}

export function deactivate() {}
`;
}

/**
 * Generates the complete set of files for a VS Code Extension in-memory.
 * Returns a list of relative paths and string/binary contents.
 */
export function bundleExtension(
  languagesInput: (LanguageOptions | any)[] | LanguageOptions,
  options?: ExtensionOptions,
): ExtensionGeneratedFile[] {
  const rawList = Array.isArray(languagesInput) ? languagesInput : [languagesInput];
  const languages = normalizeLanguages(rawList);
  const files: ExtensionGeneratedFile[] = [];

  // 1. package.json
  const packageJson = generatePackageJson(languages, options);
  files.push({
    path: "package.json",
    content: JSON.stringify(packageJson, null, 2),
  });

  // 2. tsconfig.json
  const tsconfig = {
    compilerOptions: {
      module: "CommonJS",
      target: "ES2022",
      outDir: "out",
      lib: ["ES2022"],
      sourceMap: true,
      rootDir: "src",
      strict: true,
    },
  };
  files.push({
    path: "tsconfig.json",
    content: JSON.stringify(tsconfig, null, 2),
  });

  // 3. Language configurations & TextMate grammars for each language
  for (const lang of languages) {
    // language-configuration-<id>.json
    files.push({
      path: `language-configuration-${lang.id}.json`,
      content: generateLanguageConfiguration(lang),
    });

    // syntaxes/<id>.tmLanguage.json
    try {
      const tm = generateTextMate(lang.options);
      files.push({
        path: `syntaxes/${lang.id}.tmLanguage.json`,
        content: tm.tm || JSON.stringify({}),
      });
    } catch {
      files.push({
        path: `syntaxes/${lang.id}.tmLanguage.json`,
        content: JSON.stringify(
          {
            name: lang.displayName,
            scopeName: `source.${lang.id}`,
            patterns: [],
          },
          null,
          2,
        ),
      });
    }

    if (lang.id === "sysml2") {
      files.push({
        path: `language-configuration-sysml.json`,
        content: generateLanguageConfiguration(lang),
      });
      try {
        const sysmlTm = generateTextMate({ ...lang.options, name: "sysml" });
        files.push({
          path: `syntaxes/sysml.tmLanguage.json`,
          content: sysmlTm.tm || JSON.stringify({}),
        });
      } catch {
        files.push({
          path: `syntaxes/sysml.tmLanguage.json`,
          content: JSON.stringify(
            {
              name: "SysML",
              scopeName: "source.sysml",
              patterns: [],
            },
            null,
            2,
          ),
        });
      }
    }
  }

  // 4. Client bootstrap TypeScript source (src/extension.ts)
  files.push({
    path: "src/extension.ts",
    content: generateExtensionBootstrap(languages, options),
  });

  // 5. README.md & LICENSE.md
  files.push({
    path: "README.md",
    content: `# ${packageJson["displayName"] || "ModelScript"}\n\n${packageJson["description"] || ""}\n`,
  });
  files.push({
    path: "LICENSE.md",
    content: `GNU AFFERO GENERAL PUBLIC LICENSE Version 3\n\nCopyright (C) 2026 ModelScript Contributors\n`,
  });

  return files;
}

/**
 * Builds the complete production ModelScript VS Code IDE extension to a target directory.
 */
export async function buildIdeExtension(outDir: string, options?: ExtensionOptions): Promise<void> {
  const fs = await import("fs");
  const path = await import("path");
  const esbuild = await import("esbuild");

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(outDir, "dist"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "server", "dist"), { recursive: true });

  // 1. Locate repository root and discover workspace languages
  const currentDir = path.dirname(new URL(import.meta.url).pathname);
  let repoRoot = currentDir;
  let workspaceVersion = "0.0.18";
  while (repoRoot !== path.dirname(repoRoot)) {
    if (fs.existsSync(path.join(repoRoot, "package.json"))) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
        if (pkg.name === "modelscript") {
          if (pkg.version && pkg.version !== "0.0.0") {
            workspaceVersion = pkg.version;
          } else if (fs.existsSync(path.join(repoRoot, "packages/runtime/package.json"))) {
            const rtPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "packages/runtime/package.json"), "utf8"));
            if (rtPkg.version) workspaceVersion = rtPkg.version;
          }
          break;
        }
      } catch {}
    }
    repoRoot = path.dirname(repoRoot);
  }

  const languagesDir = path.join(repoRoot, "languages");
  const discovered = await discoverWorkspaceLanguages(languagesDir);
  const languages =
    discovered.languages.length > 0
      ? discovered.languages
      : normalizeLanguages([{ name: "modelica", lsp: { fileExtensions: [".mo"] } }]);

  // Write languages manifest for runtime & web worker loading
  fs.writeFileSync(
    path.join(outDir, "server", "dist", "languages-manifest.json"),
    JSON.stringify(discovered.manifest, null, 2),
    "utf-8",
  );

  // 2. Generate package.json manifest
  const pkg = generatePackageJson(languages, {
    name: "modelscript",
    displayName: "ModelScript — Modelica & Polyglot Systems IDE",
    description:
      "Complete Modelica, SysML, STEP, and OWL2 development environment — diagram editing, simulation, scripting, notebooks, and bundled MSL.",
    version: options?.version || workspaceVersion,
    ...options,
    features: {
      diagramEditor: true,
      cad3dViewer: true,
      simulationPanels: true,
      notebooks: true,
      mcpBridge: true,
      chatParticipant: true,
      ...options?.features,
    },
  });

  // Set browser client entry point
  pkg["browser"] = "./dist/browserClientMain.js";
  fs.writeFileSync(path.join(outDir, "package.json"), JSON.stringify(pkg, null, 2), "utf-8");
  fs.writeFileSync(path.join(outDir, "package.nls.json"), "{}", "utf-8");
  fs.writeFileSync(
    path.join(outDir, "LICENSE.md"),
    "GNU AFFERO GENERAL PUBLIC LICENSE Version 3\n\nCopyright (C) 2026 ModelScript Contributors\n",
    "utf-8",
  );
  fs.writeFileSync(path.join(outDir, "README.md"), `# ${pkg["displayName"]}\n\n${pkg["description"]}\n`, "utf-8");

  // 3. Write language configs and syntaxes
  for (const lang of languages) {
    fs.writeFileSync(
      path.join(outDir, `language-configuration-${lang.id}.json`),
      generateLanguageConfiguration(lang),
      "utf-8",
    );

    const syntaxesDir = path.join(outDir, "syntaxes");
    fs.mkdirSync(syntaxesDir, { recursive: true });
    try {
      const tm = generateTextMate(lang.options);
      fs.writeFileSync(path.join(syntaxesDir, `${lang.id}.tmLanguage.json`), tm.tm, "utf-8");
    } catch {
      fs.writeFileSync(
        path.join(syntaxesDir, `${lang.id}.tmLanguage.json`),
        JSON.stringify({ name: lang.displayName, scopeName: `source.${lang.id}`, patterns: [] }, null, 2),
        "utf-8",
      );
    }

    if (lang.id === "sysml2") {
      fs.writeFileSync(
        path.join(outDir, `language-configuration-sysml.json`),
        generateLanguageConfiguration(lang),
        "utf-8",
      );
      try {
        const sysmlTm = generateTextMate({ ...lang.options, name: "sysml" });
        fs.writeFileSync(path.join(syntaxesDir, `sysml.tmLanguage.json`), sysmlTm.tm, "utf-8");
      } catch {
        fs.writeFileSync(
          path.join(syntaxesDir, `sysml.tmLanguage.json`),
          JSON.stringify({ name: "SysML", scopeName: "source.sysml", patterns: [] }, null, 2),
          "utf-8",
        );
      }
    }
  }

  // 4. Compile with esbuild
  const ideDir =
    [
      path.resolve(repoRoot, "packages/ide/src"),
      path.resolve(repoRoot, "packages/ide"),
      path.resolve(currentDir, "../../../../packages/ide/src"),
      path.resolve(currentDir, "../../../packages/ide/src"),
      path.resolve(currentDir, "../ide"),
    ].find((p) => fs.existsSync(p)) ?? path.resolve(repoRoot, "packages/ide/src");

  const ignorePlugin = createNodeBuiltinsIgnorePlugin();

  // Build browser client
  const clientMainPath = fs.existsSync(path.join(ideDir, "browser-client-main.ts"))
    ? path.join(ideDir, "browser-client-main.ts")
    : path.join(ideDir, "browserClientMain.ts");
  if (fs.existsSync(clientMainPath)) {
    await esbuild.build({
      entryPoints: [clientMainPath],
      outfile: path.join(outDir, "dist", "browserClientMain.js"),
      bundle: true,
      format: "cjs",
      platform: "browser",
      target: "es2022",
      external: ["vscode"],
      define: {
        "process.env": JSON.stringify({}),
        "process.browser": "true",
      },
      banner: {
        js: BROWSER_BUFFER_AND_PROCESS_BANNER,
      },
      plugins: [ignorePlugin],
      logOverride: {
        "duplicate-object-key": "silent",
        "empty-import-meta": "silent",
      },
      sourcemap: "linked",
    });
  }

  // Build webviews
  const webviewDir = path.join(ideDir, "webview");
  const webviewEntries: string[] = [];
  if (fs.existsSync(webviewDir)) {
    const files = fs.readdirSync(webviewDir);
    for (const f of files) {
      if (
        (f.endsWith(".ts") || f.endsWith(".tsx")) &&
        f !== "notebook-renderer.ts" &&
        f !== "notebookRenderer.ts" &&
        !f.startsWith("base-")
      ) {
        const fullPath = path.join(webviewDir, f);
        if (fs.statSync(fullPath).isFile()) {
          webviewEntries.push(fullPath);
        }
      }
    }
  }

  if (webviewEntries.length > 0) {
    await esbuild.build({
      entryPoints: webviewEntries,
      outdir: path.join(outDir, "dist"),
      bundle: true,
      format: "iife",
      platform: "browser",
      sourcemap: "linked",
      external: ["vscode", "@kitware/vtk.js", "@kitware/vtk.js/*"],
      define: {
        "process.env": JSON.stringify({}),
        "process.browser": "true",
      },
      logOverride: {
        "duplicate-object-key": "silent",
        "empty-import-meta": "silent",
      },
      banner: {
        js: BROWSER_BUFFER_BANNER,
      },
      plugins: [ignorePlugin],
    });
  }

  // Build notebook renderer
  const notebookRendererPath = [
    path.join(ideDir, "webview", "notebook-renderer.ts"),
    path.join(ideDir, "webview", "notebookRenderer.ts"),
  ].find((p) => fs.existsSync(p));

  if (notebookRendererPath) {
    const nbOut = path.join(outDir, "dist", "notebook-renderer.js");
    await esbuild.build({
      entryPoints: [notebookRendererPath],
      outfile: nbOut,
      bundle: true,
      format: "esm",
      platform: "browser",
      sourcemap: "linked",
      logOverride: {
        "duplicate-object-key": "silent",
        "empty-import-meta": "silent",
      },
    });
  }

  // 5. Copy WASM and library assets
  // Copy discovered language WASM assets (<lang>.wasm)
  for (const asset of discovered.wasmAssets) {
    const destPath = path.join(outDir, asset.dest);
    if (fs.existsSync(asset.src)) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.cpSync(asset.src, destPath, { recursive: true });
    }
  }

  const candidateAssets = [
    [path.join(repoRoot, "packages/runtime/build/release.wasm"), "server/dist/release.wasm"],
    [path.join(repoRoot, "node_modules/occt-import-js/dist/occt-import-js.wasm"), "server/dist/occt-import-js.wasm"],
    [
      path.join(repoRoot, "scripts/ModelicaStandardLibrary_v4.1.0.zip"),
      "server/dist/ModelicaStandardLibrary_v4.1.0.zip",
    ],
    [path.join(repoRoot, "scripts/SysML-v2-Release-2026-03.zip"), "server/dist/SysML-v2-Release-2026-03.zip"],
    [path.join(repoRoot, "languages/modelica/assets"), "assets"],
    [path.join(repoRoot, "apps/web/public/ms-logo.png"), "images/icon.png"],
  ];

  for (const [src, dest] of candidateAssets) {
    const destPath = path.join(outDir, dest!);
    if (fs.existsSync(src!)) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.cpSync(src!, destPath, { recursive: true });
    }
  }

  // Copy discovered language assets (languages/<lang>/assets -> assets/<lang>/)
  if (fs.existsSync(languagesDir)) {
    const langDirs = fs.readdirSync(languagesDir, { withFileTypes: true });
    for (const d of langDirs) {
      if (!d.isDirectory()) continue;
      const langAssetDir = path.join(languagesDir, d.name, "assets");
      if (fs.existsSync(langAssetDir)) {
        const destLangAssets = path.join(outDir, "assets", d.name);
        fs.mkdirSync(destLangAssets, { recursive: true });
        fs.cpSync(langAssetDir, destLangAssets, { recursive: true });
      }
    }
  }

  // 6. Bundle LSP browser server into standalone IIFE (if not already copied from lsp dist)
  const lspDir = path.join(repoRoot, "packages/lsp");
  const browserServerMain = path.join(lspDir, "src/browserServerMain.ts");
  const destBrowserServer = path.join(outDir, "server/dist/browserServerMain.js");
  const destIndexerWorker = path.join(outDir, "server/dist/workers/indexer.worker.js");
  const lspDist = path.join(lspDir, "dist");
  if (fs.existsSync(path.join(lspDist, "browserServerMain.js"))) {
    fs.mkdirSync(path.dirname(destBrowserServer), { recursive: true });
    fs.cpSync(path.join(lspDist, "browserServerMain.js"), destBrowserServer);
    if (fs.existsSync(path.join(lspDist, "workers/indexer.worker.js"))) {
      fs.mkdirSync(path.dirname(destIndexerWorker), { recursive: true });
      fs.cpSync(path.join(lspDist, "workers/indexer.worker.js"), destIndexerWorker);
    }
  } else if (fs.existsSync(browserServerMain)) {
    await esbuild.build({
      entryPoints: [browserServerMain],
      outfile: destBrowserServer,
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2022",
      minify: false,
      keepNames: true,
      sourcemap: "linked",
      banner: {
        js: `${BROWSER_PROCESS_BANNER}\nvar process = globalThis.process;\n`,
      },
      define: {
        "process.env": "{}",
        "process.browser": "true",
        "import.meta.url": "self.location.href",
      },
      logOverride: {
        "duplicate-object-key": "silent",
        "empty-import-meta": "silent",
      },
      plugins: [ignorePlugin],
    });

    const indexerWorker = path.join(lspDir, "src/workers/indexer.worker.ts");
    if (fs.existsSync(indexerWorker)) {
      await esbuild.build({
        entryPoints: [indexerWorker],
        outfile: destIndexerWorker,
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "es2022",
        minify: false,
        keepNames: true,
        sourcemap: "linked",
        banner: {
          js: `${BROWSER_PROCESS_BANNER}\nvar process = globalThis.process;\n`,
        },
        define: {
          "process.env": "{}",
          "process.browser": "true",
          "import.meta.url": "self.location.href",
        },
        logOverride: {
          "duplicate-object-key": "silent",
          "empty-import-meta": "silent",
        },
        plugins: [ignorePlugin],
      });
    }
  }
}
