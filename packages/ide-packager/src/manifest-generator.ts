// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ActionCategory, LanguageAction, LanguageMaturity } from "@modelscript/dsl";
import {
  DEFAULT_LANGUAGE_MATURITY,
  isSupportedDiagramLanguage,
  type ExtensionOptions,
  type NormalizedLanguage,
} from "./language-normalization.js";

const BUILTIN_COMMANDS: Record<string, unknown>[] = [
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
    command: "modelscript.libraryView.addPackage",
    title: "Add Package from Ansatz...",
    category: "ModelScript",
    icon: "$(add)",
  },
  {
    command: "modelscript.libraryView.importZip",
    title: "Import Library from .zip Archive...",
    category: "ModelScript",
    icon: "$(file-zip)",
  },
  {
    command: "modelscript.libraryView.refresh",
    title: "Refresh Libraries",
    category: "ModelScript",
    icon: "$(refresh)",
  },
  {
    command: "modelscript.libraryView.switchVersion",
    title: "Switch Library Version...",
    category: "ModelScript",
    icon: "$(versions)",
  },
  {
    command: "modelscript.libraryView.openPackageDetails",
    title: "View Library in Ansatz Registry",
    category: "ModelScript",
    icon: "$(globe)",
  },
  {
    command: "modelscript.libraryView.removePackage",
    title: "Remove Library from Workspace",
    category: "ModelScript",
    icon: "$(trash)",
  },
  {
    command: "modelscript.experimentsView.refresh",
    title: "Refresh Experiments",
    category: "ModelScript",
    icon: "$(refresh)",
  },
  {
    command: "modelscript.registry.search",
    title: "Search & Install Package from Ansatz...",
    category: "ModelScript",
    icon: "$(package)",
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
    command: "modelscript.owl2.goToDeclaration",
    title: "ModelScript: Go to OWL2 Declaration",
    category: "ModelScript OWL2",
  },
  {
    command: "modelscript.openRtmContracts",
    title: "ModelScript: Open Requirements, RTM & Contracts",
    category: "ModelScript Verification",
    icon: "$(checklist)",
  },
  {
    command: "modelscript.openSpatialDiagram3D",
    title: "ModelScript: Open 3D / VR Spatial Diagram Stage",
    category: "ModelScript Diagrams",
    icon: "$(globe)",
  },
  {
    command: "modelscript.openAnsatzCopilot",
    title: "ModelScript: Open Ansatz AI Copilot",
    category: "ModelScript AI",
    icon: "$(sparkle)",
  },
  {
    command: "modelscript.openDomainInspector",
    title: "ModelScript: Open Polyglot Domain Inspector",
    category: "ModelScript Inspector",
    icon: "$(inspect)",
  },
];

const STANDARD_LM_TOOLS = [
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
  {
    name: "validate_system_consistency",
    displayName: "Validate Cross-Domain System Consistency",
    modelDescription:
      "Validates logical and dimensional consistency across SysML v2 requirements/architecture, Modelica equations, and OWL 2 ontologies.",
    inputSchema: {
      type: "object",
      properties: {
        sysmlCode: { type: "string", description: "SysML v2 architecture source code" },
        modelicaCode: { type: "string", description: "Modelica physics source code" },
      },
    },
  },
  {
    name: "pscad_lint",
    displayName: "Lint PSCAD Electromagnetic Transient Topology",
    modelDescription:
      "Runs electrical topology, floating terminal, and weak grid Short-Circuit Ratio (SCR) diagnostics on a PSCAD case.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "PSCAD case XML or netlist source" },
        filePath: { type: "string", description: "Path to .pscx or .pslx file" },
      },
    },
  },
  {
    name: "pscad_verify_ieee2800",
    displayName: "Verify IEEE Std 2800-2022 Grid Code Compliance",
    modelDescription:
      "Executes IEEE 2800-2022 voltage/frequency ride-through and reactive current injection compliance checks on an IBR power plant model.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "PSCAD case source" },
        faultResidualVoltagePu: { type: "number", description: "Retained terminal voltage during fault (pu)" },
        faultDurationSec: { type: "number", description: "Fault clearing duration (s)" },
      },
    },
  },
  {
    name: "cad_fea_closed_loop_size",
    displayName: "Closed-Loop 3D CAD & Tetrahedral FEA Structural Sizing",
    modelDescription:
      "Runs parametric 3D CSG/STEP meshing, linear-elastic tetrahedral FEA stress evaluation, and BVH clearance verification.",
    inputSchema: {
      type: "object",
      properties: {
        scadCode: { type: "string", description: "OpenSCAD parametric geometry source" },
        material: { type: "string", description: "Isotropic material designation" },
        appliedLoadN: { type: "number", description: "Applied structural load (N)" },
        minSafetyFactor: { type: "number", description: "Minimum allowable yield safety factor" },
      },
    },
  },
  {
    name: "polyglot_migrate_and_verify_b2b",
    displayName: "Migrate Legacy Model & Certify ISO 26262 Back-to-Back Equivalence",
    modelDescription:
      "Translates a legacy Simulink, SPICE, or Adams model into Modelica + SysML v2 and verifies trajectory & C99 equivalence.",
    inputSchema: {
      type: "object",
      properties: {
        sourceFormat: { type: "string", description: "Legacy source format (simulink, spice, adams)" },
        sourceCode: { type: "string", description: "Legacy model source text" },
        toleranceRmse: { type: "number", description: "Maximum allowable trajectory RMSE" },
      },
      required: ["sourceFormat"],
    },
  },
  {
    name: "formal_verify_safety_and_mcdc",
    displayName: "Prove Safety Invariants (IC3/SOS) & Synthesize DO-178C MC/DC Vectors",
    modelDescription:
      "Proves unbounded safety properties using IC3/PDR and SOS barrier certificates and generates 100% MC/DC test vectors.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Modelica or synchronous controller source code" },
        safetyProperty: { type: "string", description: "Invariant expression to prove" },
      },
      required: ["code"],
    },
  },
];

function buildConfigurationSections(languages: NormalizedLanguage[]): Record<string, unknown>[] {
  const languageToggleProperties: Record<string, unknown> = {
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

  return [
    {
      title: "ModelScript: Features & Release Channel",
      properties: {
        "modelscript.features.channel": {
          type: "string",
          enum: ["stable", "preview", "experimental", "dev"],
          default: "stable",
          enumDescriptions: [
            "🟢 Stable: Core LSP, 1-click Simulate CodeLens, 2D/3D viewers, Libraries (+ Ansatz search) & Experiments views.",
            "🟡 Preview: Adds Formal Verification, DAE structural proofs, and CAE mesh/study workbench.",
            "🧪 Experimental: Adds FMI Co-Simulation & MQTT, Cloud HPC, Cross-Domain Digital Thread, Polyglot Projection, Multi-Domain Scaffolding, and AI Copilot.",
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
            "**[🧪 Experimental]** Enable FMI 2.0/3.0 Co-Simulation Orchestrator and live MQTT participants sidebar views.",
        },
        "modelscript.features.cloudCompute": {
          type: "boolean",
          markdownDescription:
            "**[🧪 Experimental]** Enable remote Cloud HPC simulation job execution, queue management, and status bar telemetry.",
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
          markdownDescription: "**[🔬 Dev]** Enable vertical showcase demos (Reachability Flowpipe Comparison).",
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
          scope: "machine",
          default: "http://localhost:3000/api/v1",
          description: "Base URL for the ModelScript backend API server. Configured at machine/user scope.",
        },
        "modelscript.registry.url": {
          type: "string",
          scope: "machine",
          default: "https://api.modelscript.org",
          description: "Base URL for the ModelScript package registry.",
        },
        "modelscript.registryUrl": {
          type: "string",
          scope: "machine",
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
          scope: "application",
          description:
            "API key for cloud LLM providers (OpenAI, Anthropic, Gemini). Stored in application scope or SecretStorage.",
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
          scope: "machine",
          default: "ws://localhost:9001",
          description: "WebSocket MQTT broker URL for live digital twin and co-simulation streaming.",
        },
        "modelscript.mqtt.brokerUrl": {
          type: "string",
          scope: "machine",
          default: "ws://localhost:9001",
          markdownDeprecationMessage: "Use `#modelscript.cosim.brokerUrl#` instead.",
          description: "WebSocket MQTT broker URL for live digital twin and hardware-in-the-loop streaming.",
        },
        "modelscript.collab.signalingUrl": {
          type: "string",
          scope: "machine",
          default: "ws://localhost:3000/collab",
          description: "WebSocket signaling URL for live multi-user collaborative editing.",
        },
        "modelscript.cloud.apiUrl": {
          type: "string",
          scope: "machine",
          default: "https://api.modelscript.org",
          description: "Endpoint URL for ModelScript Cloud HPC simulation jobs.",
        },
        "modelscript.cloud.apiKey": {
          type: "string",
          default: "",
          scope: "application",
          description:
            "Authentication API key for ModelScript Cloud simulation services. Stored in application scope or SecretStorage.",
        },
        "modelscript.cloud.pollIntervalMs": {
          type: "number",
          default: 30000,
          description:
            "Polling interval in milliseconds for ModelScript Cloud job status (set to 0 to disable background polling).",
        },
      },
    },
    {
      title: "ModelScript: Security & Air-Gapped Network",
      properties: {
        "modelscript.security.trustedOrigins": {
          type: "array",
          items: {
            type: "string",
          },
          default: [],
          scope: "machine",
          description:
            "Explicit list of trusted parent origins allowed to communicate with ModelScript Studio via postMessage (e.g. ['https://ansatz.internal.corp']). In air-gapped environments, only origins in this list and local loopback are accepted.",
        },
        "modelscript.network.airgapped": {
          type: "boolean",
          default: false,
          scope: "machine",
          description:
            "Enable strict air-gapped / offline operation. Completely blocks all automatic phone-home network access to public endpoints (ansatz.social, modelscript.org).",
        },
      },
    },
  ];
}

/**
 * Generates the package.json manifest for the unified VS Code extension.
 */
export function generatePackageJson(
  languages: NormalizedLanguage[],
  options?: ExtensionOptions,
): Record<string, unknown> {
  const isMultiLang = languages.length > 1;
  const primaryLang = languages[0] || { id: "modelscript", name: "ModelScript", displayName: "ModelScript" };

  const name = options?.name || (isMultiLang ? "modelscript-suite" : `${primaryLang.id}-lang`);
  const displayName =
    options?.displayName || (isMultiLang ? "Ansatz Studio" : `${primaryLang.displayName} for VS Code`);
  const version = options?.version || `1.0.${Math.floor(Date.now() / 1000)}`;
  const publisher = options?.publisher || "modelscript";
  const description =
    options?.description ||
    (isMultiLang
      ? "Ansatz Studio — Complete multi-language modeling, diagramming, and simulation environment for VS Code powered by ModelScript."
      : `VS Code support for ${primaryLang.displayName} with syntax highlighting, diagnostics, and diagram editing.`);

  const contributesLanguages: Record<string, unknown>[] = [];
  const contributesGrammars: Record<string, unknown>[] = [];
  const customEditors: Record<string, unknown>[] = [];
  const activationEvents: string[] = ["onUri", "onFileSystem:memfs", "onFileSystem:modelica", "onFileSystem:github"];

  for (const lang of languages) {
    const aliases = [lang.displayName, lang.name];
    if (lang.id === "sysml2" || lang.id === "sysml") {
      for (const a of ["SysML v2", "SysML", "sysml2", "sysml"]) {
        if (!aliases.includes(a)) aliases.push(a);
      }
    }

    const langEntry: Record<string, unknown> = {
      id: lang.id,
      aliases,
      extensions: lang.fileExtensions,
      configuration: `./language-configuration-${lang.id}.json`,
    };

    if (lang.icon) {
      langEntry["icon"] = lang.icon;
    }

    contributesLanguages.push(langEntry);

    contributesGrammars.push({
      language: lang.id,
      scopeName: `source.${lang.id}`,
      path: `./syntaxes/${lang.id}.tmLanguage.json`,
    });

    if (lang.id === "sysml2") {
      const sysmlEntry: Record<string, unknown> = {
        id: "sysml",
        aliases: ["SysML", "sysml"],
        extensions: [".sysml"],
        configuration: `./language-configuration-sysml.json`,
      };
      if (lang.icon) {
        sysmlEntry["icon"] = lang.icon;
      }
      contributesLanguages.push(sysmlEntry);
      contributesGrammars.push({
        language: "sysml",
        scopeName: `source.sysml`,
        path: `./syntaxes/sysml.tmLanguage.json`,
      });
    }

    if (options?.features?.diagramEditor !== false && isSupportedDiagramLanguage(lang, options)) {
      customEditors.push({
        viewType: `${lang.id}.diagramEditor`,
        displayName: `${lang.displayName} 2D Diagram`,
        selector: lang.fileExtensions.map((ext) => ({ filenamePattern: `*${ext}` })),
        priority: "option",
      });
    }
  }

  // Polyglot Infinite Spatial Canvas Custom Editor (.mscanvas)
  customEditors.push({
    viewType: "modelscript.spatialCanvas",
    displayName: "Polyglot Spatial Canvas",
    selector: [{ filenamePattern: "*.mscanvas" }],
    priority: "default",
  });

  // If STEP / 3D CAD viewer is enabled
  if (options?.features?.cad3dViewer || languages.some((l) => l.id === "step")) {
    customEditors.push({
      viewType: "modelscript.stepEditor",
      displayName: "3D CAD / STEP Viewer",
      selector: [{ filenamePattern: "*.step" }, { filenamePattern: "*.stp" }],
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
  );

  if (languages.some((l) => l.id === "pscad")) {
    customEditors.push({
      viewType: "modelscript.psoutViewer",
      displayName: "PSCAD PSOUT Waveform Studio",
      selector: [{ filenamePattern: "*.psout" }],
      priority: "default",
    });
  }

  customEditors.push({
    viewType: "modelscript.tabularPlotViewer",
    displayName: "Well Log & Tabular Plot Studio",
    selector: [{ filenamePattern: "*.las" }, { filenamePattern: "*.csv" }],
    priority: "option",
  });

  // Declarative Language DSL UI panels (`language({ ui: { panels: [...] } })`)
  const seenCustomEditorViewTypes = new Set<string>(
    customEditors.map((ce) => String(ce["viewType"] ?? "")).filter(Boolean),
  );
  const dslPanelCommands: Record<string, unknown>[] = [];
  for (const lang of languages) {
    const panels = lang.options.ui?.panels;
    if (!Array.isArray(panels)) continue;
    for (const panel of panels) {
      const targets = panel.targets ?? ["vscode", "ansatz", "artifact"];
      if (!targets.includes("vscode")) continue;
      const viewType = panel.viewType ?? `modelscript.${lang.id}.${panel.id}`;
      const selector = (
        panel.selector && panel.selector.length > 0 ? panel.selector : lang.fileExtensions.map((ext) => `*${ext}`)
      ).map((pattern) => ({ filenamePattern: pattern }));
      if (!seenCustomEditorViewTypes.has(viewType)) {
        seenCustomEditorViewTypes.add(viewType);
        customEditors.push({
          viewType,
          displayName: panel.title,
          selector,
          priority: panel.priority ?? "option",
        });
      }
      if (panel.openCommand) {
        dslPanelCommands.push({
          command: panel.openCommand.id,
          title: panel.openCommand.title,
          category: "ModelScript",
          ...(panel.openCommand.icon ? { icon: panel.openCommand.icon } : {}),
        });
      }
    }
  }

  // Collect commands, menus, language model tools, and keybindings from language actions
  const commands: Record<string, unknown>[] = [...dslPanelCommands, ...BUILTIN_COMMANDS];

  const submenus: Record<string, unknown>[] = [
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
  const editorMoreActionsMenus: Record<string, unknown>[] = [
    {
      command: "modelscript.openDomainInspector",
      when: "modelscript.activeEditorSupported",
      group: "0_ansatz@1",
    },
    {
      command: "modelscript.openSpatialDiagram3D",
      when: "modelscript.activeEditorSupported",
      group: "0_ansatz@2",
    },
    {
      command: "modelscript.openRtmContracts",
      when: "modelscript.activeEditorSupported",
      group: "0_ansatz@3",
    },
    {
      command: "modelscript.openAnsatzCopilot",
      when: "modelscript.activeEditorSupported",
      group: "0_ansatz@4",
    },
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

  const editorTitleMenus: Record<string, unknown>[] = [
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

  const editorContextMenus: Record<string, unknown>[] = [
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

  const explorerContextMenus: Record<string, unknown>[] = [
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

  const commandPaletteMenus: Record<string, unknown>[] = [
    { command: "modelscript.openDroneReachabilityDemo", when: "modelscript.feature.demos" },
    { command: "modelscript.syncDigitalThreadParams", when: "modelscript.feature.digitalThread" },
    { command: "modelscript.openThreadExplorer", when: "modelscript.feature.digitalThread" },
    { command: "modelscript.projectModel", when: "modelscript.feature.polyglotProjection" },
    { command: "modelscript.openPolyglotVisualizer", when: "modelscript.feature.polyglotProjection" },
    { command: "modelscript.cosimOpenLivePlot", when: "modelscript.feature.coSimulation" },
  ];

  const languageModelTools: Record<string, unknown>[] = [];
  const keybindings: Record<string, unknown>[] = [];
  const hasKnownWorkspaceLang = languages.some((l) => l.id in DEFAULT_LANGUAGE_MATURITY);

  // Automatically contribute diagram open/source buttons to editor/title for supported diagram languages
  if (options?.features?.diagramEditor !== false) {
    const diagramLangIds = new Set<string>();
    for (const lang of languages) {
      if (!isSupportedDiagramLanguage(lang, options)) continue;
      // Check if language explicitly defined its own custom diagram action (Method 2)
      const hasCustomDiagramAction = (lang.options.actions || []).some(
        (a: LanguageAction) =>
          (a.id === "open_diagram" || a.id === "diagram" || a.id === "openDiagram") && a.ui?.editorTitle,
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
        when: hasKnownWorkspaceLang
          ? `(${editorWhen}) && config.modelscript.ui.editorTitleActions != 'none'`
          : editorWhen,
        group: "navigation@0",
      });
    }

    const diagramViewTypes = [
      "modelscript.diagram",
      ...languages.filter((l) => isSupportedDiagramLanguage(l, options)).map((l) => `${l.id}.diagramEditor`),
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
            inputs: tool.inputSchema as unknown as LanguageAction["inputs"],
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

      const cmdEntry: Record<string, unknown> = {
        command: commandId,
        title: action.title,
        category,
      };
      if (action.ui?.editorTitle?.icon) {
        cmdEntry["icon"] = action.ui.editorTitle.icon;
      }
      commands.push(cmdEntry);

      // 1. Editor title toolbar menu (cap top-level icons to 1 primary action per language in 'compact' mode)
      if (action.ui?.editorTitle) {
        const baseWhen = action.ui.editorTitle.when || `editorLangId == ${lang.id} || resourceLangId == ${lang.id}`;
        if (action === primaryTitleAction) {
          editorTitleMenus.push({
            command: commandId,
            when: hasKnownWorkspaceLang
              ? `(${baseWhen}) && config.modelscript.ui.editorTitleActions != 'none'`
              : baseWhen,
            group: action.ui.editorTitle.group || "navigation@1",
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

        const properties: Record<string, unknown> = {};
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

    // 7. Declarative ui.toolbarButtons targeting VS Code (unified with Ansatz Editor topbar)
    const declaredToolbarButtons = lang.options.ui?.toolbarButtons ?? [];
    const registeredEditorTitleCmds = new Set<string>(editorTitleActions.map((a) => `modelscript.${lang.id}.${a.id}`));
    const registeredCommandIds = new Set<string>(commands.map((c) => String(c["command"] ?? "")));
    let hasPrimaryTitleSlot = Boolean(primaryTitleAction);

    for (const btn of declaredToolbarButtons) {
      const targets = btn.targets && btn.targets.length > 0 ? btn.targets : ["ansatz", "vscode"];
      if (!targets.includes("vscode")) continue;

      const resolvedCommandId = btn.actionId
        ? `modelscript.${lang.id}.${btn.actionId}`
        : btn.command && !btn.command.startsWith("ansatz:")
          ? btn.command
          : null;
      if (!resolvedCommandId || registeredEditorTitleCmds.has(resolvedCommandId)) continue;
      registeredEditorTitleCmds.add(resolvedCommandId);

      const codicon = btn.icon ? (btn.icon.startsWith("$(") ? btn.icon : `$(${btn.icon})`) : "$(zap)";
      if (!registeredCommandIds.has(resolvedCommandId)) {
        registeredCommandIds.add(resolvedCommandId);
        commands.push({
          command: resolvedCommandId,
          title: btn.label,
          category: lang.displayName,
          icon: codicon,
        });
      }

      const baseWhen = `editorLangId == ${lang.id} || resourceLangId == ${lang.id}`;
      const isPrimary = (btn.placement ?? "primary") === "primary" && !hasPrimaryTitleSlot;
      if (isPrimary) {
        hasPrimaryTitleSlot = true;
        editorTitleMenus.push({
          command: resolvedCommandId,
          when: hasKnownWorkspaceLang
            ? `(${baseWhen}) && config.modelscript.ui.editorTitleActions != 'none'`
            : baseWhen,
          group: `navigation@${btn.order ?? 1}`,
        });
      } else {
        moreActionsLangIds.add(lang.id);
        if (lang.id === "sysml2") moreActionsLangIds.add("sysml");
        editorMoreActionsMenus.push({
          command: resolvedCommandId,
          when: baseWhen,
          group: "3_other",
        });
        editorTitleMenus.push({
          command: resolvedCommandId,
          when: `(${baseWhen}) && config.modelscript.ui.editorTitleActions == 'all'`,
          group: `navigation@${btn.order ?? 5}`,
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
  for (const stdTool of STANDARD_LM_TOOLS) {
    if (!registeredToolNames.has(stdTool.name)) {
      registeredToolNames.add(stdTool.name);
      languageModelTools.push(stdTool);
    }
  }

  commands.push(
    {
      command: "modelscript.openModel",
      title: "Open Model...",
      category: "ModelScript",
    },
    {
      command: "modelscript.openModelGallery",
      title: "Open Model Gallery...",
      category: "ModelScript",
      icon: "$(circuit-board)",
    },
    {
      command: "modelscript.addToDiagram",
      title: "Add Component to Diagram",
      category: "ModelScript",
    },
    {
      command: "modelscript.writebackParameter",
      title: "Writeback Parameter Value to Source",
      category: "ModelScript",
    },
  );

  const contributes: Record<string, unknown> = {
    languages: contributesLanguages,
    grammars: contributesGrammars,
    iconThemes: [
      {
        id: "modelscript-file-icons",
        label: "ModelScript File Icons",
        path: "./file-icons/theme.json",
      },
    ],
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
      "view/title": [
        {
          command: "modelscript.openModelGallery",
          when: "view == modelscript.libraryTree",
          group: "navigation@0",
        },
        {
          command: "modelscript.libraryView.addPackage",
          when: "view == modelscript.libraryTree",
          group: "navigation@1",
        },
        {
          command: "modelscript.libraryView.importZip",
          when: "view == modelscript.libraryTree",
          group: "navigation@2",
        },
        {
          command: "modelscript.libraryView.refresh",
          when: "view == modelscript.libraryTree",
          group: "navigation@3",
        },
        {
          command: "modelscript.experimentsView.refresh",
          when: "view == modelscript.experimentsView",
          group: "navigation@1",
        },
      ],
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
        {
          command: "modelscript.libraryView.switchVersion",
          when: "view == modelscript.libraryTree && viewItem == installedPackage",
          group: "inline@1",
        },
        {
          command: "modelscript.libraryView.removePackage",
          when: "view == modelscript.libraryTree && viewItem == installedPackage",
          group: "inline@2",
        },
        {
          command: "modelscript.libraryView.openPackageDetails",
          when: "view == modelscript.libraryTree && viewItem == installedPackage",
          group: "1_package@1",
        },
        {
          command: "modelscript.libraryView.switchVersion",
          when: "view == modelscript.libraryTree && viewItem == installedPackage",
          group: "1_package@2",
        },
        {
          command: "modelscript.libraryView.removePackage",
          when: "view == modelscript.libraryTree && viewItem == installedPackage",
          group: "1_package@3",
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
        icon: "assets/modelscript/icon.svg",
      },
    ],
  };

  const dynamicViewsByContainer: Record<string, Array<{ id: string; name: string; when?: string }>> = {};
  for (const lang of languages) {
    const tvs = lang.options.ui?.treeViews ?? [];
    for (const tv of tvs) {
      const container = tv.container ?? "modelscript-sidebar";
      if (!dynamicViewsByContainer[container]) {
        dynamicViewsByContainer[container] = [];
      }
      if (!dynamicViewsByContainer[container]!.some((v) => v.id === tv.id)) {
        dynamicViewsByContainer[container]!.push({
          id: tv.id,
          name: tv.name,
          ...(tv.when ? { when: tv.when } : {}),
        });
      }
    }
  }

  const explorerViews = dynamicViewsByContainer["explorer"] ?? [];
  const extraSidebarViews = dynamicViewsByContainer["modelscript-sidebar"] ?? [];
  contributes["views"] = {
    ...(explorerViews.length > 0 ? { explorer: explorerViews } : {}),
    "modelscript-sidebar": [
      ...extraSidebarViews,
      { id: "modelscript.libraryTree", name: "Libraries" },
      { id: "modelscript.experimentsView", name: "Experiments & Studies" },
      { id: "modelscript.verificationGatesView", name: "Verification Gates" },
      {
        id: "modelscript.chat",
        name: "ModelScript AI Copilot",
        type: "webview",
        when: "modelscript.feature.aiCopilot || config.modelscript.features.aiCopilot || config.modelscript.features.channel == 'experimental' || config.modelscript.features.channel == 'dev'",
      },
      {
        id: "modelscript.cosimPanel",
        name: "Co-Simulation Orchestrator",
        type: "webview",
        when: "modelscript.feature.coSimulation || config.modelscript.features.coSimulation || config.modelscript.features.channel == 'experimental' || config.modelscript.features.channel == 'dev'",
      },
      {
        id: "modelscript.mqttTree",
        name: "MQTT Participants",
        when: "modelscript.feature.coSimulation || config.modelscript.features.coSimulation || config.modelscript.features.channel == 'experimental' || config.modelscript.features.channel == 'dev'",
      },
    ],
    scm: [
      {
        id: "modelscript.scmTreeView",
        name: "Model Structural Changes",
        when: "modelscript.feature.digitalThread || config.modelscript.features.digitalThread || config.modelscript.features.channel == 'experimental' || config.modelscript.features.channel == 'dev'",
      },
    ],
  };

  contributes["viewsWelcome"] = [
    {
      view: "modelscript.libraryTree",
      contents:
        "No libraries are mounted in this workspace yet.\n[$(add) Add Package from Ansatz](command:modelscript.libraryView.addPackage)\n[$(file-zip) Import Library (.zip)](command:modelscript.libraryView.importZip)\n[$(cloud-download) Import Library from URL](command:modelscript.libraryView.importUrl)",
    },
  ];

  contributes["configuration"] = buildConfigurationSections(languages);

  return {
    name,
    displayName,
    version,
    publisher,
    description,
    ...(options?.icon ? { icon: options.icon } : {}),
    categories: ["Programming Languages", "Linters", "Formatters"],
    keywords: ["modelica", "sysml", "simulation", "dsl", "modeling", "wasm"],
    homepage: options?.homepage || "https://modelscript.org",
    repository: {
      type: "git",
      url: options?.repository || "https://github.com/modelscript/modelscript.git",
    },
    license: "AGPL-3.0-or-later",
    engines: {
      vscode: options?.vscodeEngine || "^1.90.0",
    },
    capabilities: {
      virtualWorkspaces: true,
      untrustedWorkspaces: {
        supported: "limited",
        description:
          "Cloud simulation job submission, remote package installation, co-simulation brokers, and custom API endpoints are restricted in untrusted workspaces.",
        restrictedConfigurations: [
          "modelscript.apiUrl",
          "modelscript.registry.url",
          "modelscript.registryUrl",
          "modelscript.llm.apiKey",
          "modelscript.llm.endpoint",
          "modelscript.cosim.brokerUrl",
          "modelscript.mqtt.brokerUrl",
          "modelscript.collab.signalingUrl",
          "modelscript.cloud.apiUrl",
          "modelscript.cloud.apiKey",
          "modelscript.security.trustedOrigins",
          "modelscript.network.airgapped",
        ],
      },
    },
    browser: "./dist/extension.js",
    activationEvents,
    contributes,
  };
}
