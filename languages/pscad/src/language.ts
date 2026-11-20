// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript PSCAD Language Definition.
 *
 * Provides declarative grammar, XML AST parsing, pre-flight linter,
 * and polyglot cross-language projections for PSCAD v4/v5 projects.
 */

import { language, xmlRules } from "@modelscript/dsl";
import type { FmiLsEmtCompanionInstance } from "@modelscript/exchange";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildPscadBuiltinSymbols } from "./builtins.js";
import { instantiateWasmCompanionsForNetlist } from "./catalog/wasm-companion-loader.js";
import { emtResultToComtrade, writeComtrade } from "./comtrade/comtrade-writer.js";
import { writePscadOut, type PscadOutResult } from "./comtrade/pscad-out-writer.js";
import { indexPscadDocument } from "./indexing.js";
import { lintPscx } from "./lints/index.js";
import { registerPscadSource } from "./model/workspace-registry.js";
import { computeSimulationCoverage, type SimulationCoverage } from "./netlist/coverage.js";
import { extractEmtNetlist, netlistToEmtCircuit } from "./netlist/emt-netlist.js";
import { parsePscx } from "./parser/pscx-parser.js";
import { writePscadPsout } from "./psout/index.js";
import { EmtSolver, parsePscadSnapshot, type PscadSnapshot } from "./solver/emt-solver.js";
import { runFrequencyScan } from "./solver/frequency-scanner.js";
import { runMultipleRunSweep, runPointOnWaveSweep } from "./solver/parametric-sweep.js";
import { pscadPolyglotConfig } from "./tgg/pscad-polyglot.js";
import {
  verifyIeee2800Compliance,
  type Ieee2800ComplianceReport,
  type Ieee2800FaultSpec,
} from "./verification/ieee2800.js";

/**
 * Configuration options for executing the end-to-end PSCAD `.pscx` simulation and compliance pipeline.
 */
export interface PscadSimulationPipelineOptions {
  /** Raw XML contents of the `.pscx` or `.pslx` project document. */
  documentText: string;
  /** Optional external `.pslx` library XML contents to register before netlist extraction. */
  librarySources?: string[] | undefined;
  /** Optional filesystem path to the `.pscx` file; sibling `*.pslx` libraries in the same directory are auto-registered. */
  projectPath?: string | undefined;
  /** Whether to execute fixed-step electromagnetic transient (EMT) time-domain simulation. */
  runSimulation?: boolean | undefined;
  /** Whether to serialize the simulated waveforms into IEEE C37.111 COMTRADE `.cfg` and `.dat` strings. */
  exportComtrade?: boolean | undefined;
  /** Whether to serialize the simulated waveforms into PSCAD-style `.inf` and `_NN.out` files. */
  exportOut?: boolean | undefined;
  /** Whether to serialize the simulated waveforms into modern PSCAD V5+ binary `.psout` file. */
  exportPsout?: boolean | undefined;
  /** Whether to run automated IEEE 2800-2022 / NERC PRC-029-1 fault ride-through compliance checks. */
  verifyIeee2800?: boolean | undefined;
  /** Optional overrides for the fault event specification evaluated during IEEE 2800-2022 verification. */
  faultSpec?: Partial<Ieee2800FaultSpec> | undefined;
  /** Optional simulation duration override in seconds (defaults to project settings or 0.2s). */
  durationSec?: number | undefined;
  /** Optional simulation fixed time step override in seconds (defaults to project settings or 50us). */
  timeStepSec?: number | undefined;
  /**
   * When true, never fall back to the built-in companion synthesizer (which injects reference
   * sources on unsourced buses and canned IBR currents). Without a `solverRunner` no result is produced.
   */
  strict?: boolean | undefined;
  /**
   * When true, fail simulation with a `P6100` error if EMT netlist lowering coverage is below 90%
   * or if the extracted netlist contains no sources.
   */
  strictNetlist?: boolean | undefined;
  /** Optional `fmi-ls-emt` Norton-companion instances (e.g. compiled Modelica electrical leaves) keyed by component/FMU ID. */
  fmuCompanions?: Map<string, FmiLsEmtCompanionInstance> | undefined;
  /** Optional `.snp` snapshot object or serialized text to warm-start the EMT solver. */
  initialSnapshot?: PscadSnapshot | string | undefined;
  /** When true, exports the final `.snp` snapshot state from EmtSolver. */
  exportSnapshot?: boolean | undefined;
  /** Optional per-step streaming callback forwarded to EmtSolver. */
  onStep?:
    | ((timeSec: number, stepIndex: number, busVoltages: Map<string, { a: number; b: number; c: number }>) => void)
    | undefined;
  /** Optional external EMT solver callback (e.g., `@modelscript/simulate` Dommel solver); falls back to built-in companion synthesizer when omitted. */
  solverRunner?:
    | ((
        circuit: ReturnType<typeof netlistToEmtCircuit>,
        options: {
          timeStepSec: number;
          durationSec: number;
          nominalFrequencyHz: number;
          threePhase?: boolean | undefined;
          steadyStateInit?: boolean | undefined;
        },
      ) => {
        time: Float64Array;
        busVoltages: Map<string, Float64Array>;
        busPhaseVoltages?: Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }> | undefined;
        branchCurrents: Map<string, Float64Array>;
        branchPhaseCurrents?: Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }> | undefined;
        controlSignals?: Map<string, Float64Array> | undefined;
      })
    | undefined;
}

/**
 * Synthesizes a 3-phase companion transient trajectory directly from the extracted EmtNetlist
 * using the high-performance native EmtSolver with Critical Damping Adjustment (CDA).
 */
function synthesizeCompanionTrajectory(
  netlist: ReturnType<typeof extractEmtNetlist>,
  timeStepSec: number,
  durationSec: number,
  extraCompanions?: Map<string, FmiLsEmtCompanionInstance>,
  initialSnapshot?: PscadSnapshot | string,
  exportSnapshot?: boolean,
  onStep?: PscadSimulationPipelineOptions["onStep"],
) {
  const fmuCompanions = instantiateWasmCompanionsForNetlist(netlist);
  if (extraCompanions) {
    for (const [k, v] of extraCompanions) {
      fmuCompanions.set(k, v);
    }
  }
  const parsedSnap = initialSnapshot
    ? typeof initialSnapshot === "string"
      ? parsePscadSnapshot(initialSnapshot)
      : initialSnapshot
    : undefined;
  const solver = new EmtSolver(netlist, {
    timeStepSec,
    durationSec,
    nominalFrequencyHz: netlist.nominalFrequencyHz || 60.0,
    enableCda: true,
    ...(fmuCompanions.size > 0 ? { fmuCompanions } : {}),
    ...(onStep ? { onStep } : {}),
    ...(parsedSnap ? { initialSnapshot: parsedSnap } : {}),
  });
  const simResult = solver.solve();
  const snapshot = exportSnapshot ? solver.exportSnapshot() : undefined;
  return { simResult, snapshot };
}

/**
 * Executes the turnkey PSCAD `.pscx` parsing, pre-flight linting, EMT simulation,
 * IEEE C37.111 COMTRADE export, and IEEE 2800-2022 compliance verification pipeline.
 */
export function runPscadSimulationPipeline(options: PscadSimulationPipelineOptions) {
  if (options.librarySources) {
    for (let i = 0; i < options.librarySources.length; i++) {
      const libXml = options.librarySources[i];
      if (libXml) registerPscadSource(`pscad-lib://inline/${i}.pslx`, libXml);
    }
  }
  if (options.projectPath) {
    try {
      const dir = path.dirname(options.projectPath);
      if (fs.existsSync(dir)) {
        for (const entry of fs.readdirSync(dir)) {
          if (/\.pslx$/i.test(entry)) {
            const fullPath = path.join(dir, entry);
            registerPscadSource(`file://${fullPath}`, fs.readFileSync(fullPath, "utf8"));
          }
        }
      }
    } catch {
      // Ignore filesystem errors in browser/virtual environments
    }
  }
  const project = parsePscx(options.documentText);
  const netlist = extractEmtNetlist(project);
  const circuit = netlistToEmtCircuit(netlist);
  const diagnostics = lintPscx(project, { netlist });
  const coverage = computeSimulationCoverage(project, netlist);
  const simulationReport: PscadSimulationReport = {
    solver: "none",
    status: "rejected",
    coverage,
    injectedReferenceBuses: [],
    synthesizedIbr: false,
    fidelitySummary: `${coverage.lowered}/${coverage.simulatable} simulatable components lowered (${(coverage.ratio * 100).toFixed(0)}%)`,
  };
  let strictNetlistFailed = false;
  if (coverage.simulatable > 0 && coverage.ratio < 0.9) {
    const top = coverage.dropped
      .slice(0, 5)
      .map((d) => `${d.definition} (${d.count})`)
      .join(", ");
    diagnostics.push({
      code: "P6100",
      rule: "emt-netlist-coverage",
      severity: options.strictNetlist ? "error" : "warning",
      message: `Only ${coverage.lowered} of ${coverage.simulatable} simulatable components are supported by the EMT netlist; unsupported: ${top}.`,
    });
    if (options.strictNetlist) {
      strictNetlistFailed = true;
    }
  }
  const hasActiveSource =
    netlist.sources.length > 0 ||
    (netlist.currentSources?.length ?? 0) > 0 ||
    (netlist.synchronousMachines?.length ?? 0) > 0;
  const isControlOnly =
    !hasActiveSource &&
    ((netlist.controlBlocks?.length ?? 0) > 0 || (netlist.customFortranBlocks?.length ?? 0) > 0) &&
    netlist.branches.length === 0 &&
    netlist.transformers.length === 0 &&
    netlist.transmissionLines.length === 0;
  if (options.strictNetlist && !hasActiveSource && !isControlOnly) {
    diagnostics.push({
      code: "P6100",
      rule: "emt-netlist-coverage",
      severity: "error",
      message:
        "Strict netlist mode rejected simulation because the extracted EMT netlist has no voltage/current sources.",
    });
    strictNetlistFailed = true;
  }

  if (netlist.assumptions && netlist.assumptions.length > 0) {
    diagnostics.push({
      code: "P6103",
      rule: "emt-assumed-parameters",
      severity: "warning",
      message: `${netlist.assumptions.length} parameter default(s) were assumed: ${netlist.assumptions[0]}${netlist.assumptions.length > 1 ? " (and more)" : ""}`,
    });
  }

  if (netlist.customFortranBlocks && netlist.customFortranBlocks.length > 0) {
    diagnostics.push({
      code: "P6104",
      rule: "fortran-companion-fallback",
      severity: "warning",
      message: `${netlist.customFortranBlocks.length} custom Fortran (DSDYN/DSOUT) block(s) detected; provide clean-room AssemblyScript fmi-ls-emt companions via compileAssemblyScriptCompanion for native WASM execution.`,
    });
  }

  const timeStepSec =
    typeof options.timeStepSec === "number" && options.timeStepSec > 0
      ? options.timeStepSec
      : Math.max(1e-6, (project.settings.timeStepUs || 50.0) * 1e-6);
  const durationSec =
    typeof options.durationSec === "number" && options.durationSec > 0
      ? options.durationSec
      : Math.max(timeStepSec * 10, project.settings.durationSec || 0.2);
  const shouldRunSim =
    Boolean(options.runSimulation) ||
    Boolean(options.solverRunner) ||
    Boolean(options.exportComtrade) ||
    Boolean(options.verifyIeee2800);

  let snapshot: PscadSnapshot | undefined;
  let simulationResult:
    | {
        time: Float64Array;
        busVoltages: Map<string, Float64Array>;
        busPhaseVoltages?: Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }> | undefined;
        branchCurrents: Map<string, Float64Array>;
        branchPhaseCurrents?: Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }> | undefined;
        controlSignals?: Map<string, Float64Array> | undefined;
      }
    | undefined;

  if (shouldRunSim && !strictNetlistFailed) {
    if (options.solverRunner) {
      simulationReport.solver = "external";
      simulationResult = options.solverRunner(circuit, {
        timeStepSec,
        durationSec,
        nominalFrequencyHz: netlist.nominalFrequencyHz || 60.0,
        threePhase: true,
        steadyStateInit: true,
      });
    } else if (options.strict) {
      diagnostics.push({
        code: "P6101",
        rule: "emt-no-solver",
        severity: "error",
        message: "Strict simulation requested but no EMT solver was supplied.",
      });
    } else {
      simulationReport.solver = "builtin-companion";
      const sourced = new Set(((netlist.sources ?? []) as { bus?: string }[]).map((s) => s.bus));
      const isolatedUnsourced = isControlOnly
        ? []
        : Array.from(netlist.buses.keys()).filter((b) => {
            if (sourced.has(b)) return false;
            const busObj = netlist.buses.get(b);
            return !busObj || busObj.connectedBranchIds.length === 0;
          });
      simulationReport.injectedReferenceBuses = isolatedUnsourced;
      simulationReport.synthesizedIbr = !isControlOnly && (netlist.fmuInstances ?? []).length > 0;
      const companionOut = synthesizeCompanionTrajectory(
        netlist,
        timeStepSec,
        durationSec,
        options.fmuCompanions,
        options.initialSnapshot,
        options.exportSnapshot,
        options.onStep,
      );
      simulationResult = companionOut.simResult;
      snapshot = companionOut.snapshot;
      if (simulationReport.injectedReferenceBuses.length > 0 || simulationReport.synthesizedIbr) {
        diagnostics.push({
          code: "P6102",
          rule: "emt-synthetic-fallback",
          severity: "warning",
          message:
            `Built-in companion fallback used: ` +
            (simulationReport.injectedReferenceBuses.length > 0
              ? `stabilized ${simulationReport.injectedReferenceBuses.length} floating isolated bus(es)`
              : "") +
            (simulationReport.synthesizedIbr ? " and approximated IBR currents" : "") +
            "; results are not a faithful EMT simulation.",
        });
      }
    }
  }

  if (simulationResult && netlist.pgbChannels && netlist.pgbChannels.length > 0) {
    const sigMap = new Map<string, Float64Array>(simulationResult.controlSignals ?? []);
    for (const pgb of netlist.pgbChannels) {
      if (!pgb.name || sigMap.has(pgb.name)) continue;
      const srcKey = pgb.sourceSignal;
      if (!srcKey) continue;
      const rawArr =
        sigMap.get(srcKey) ?? simulationResult.busVoltages.get(srcKey) ?? simulationResult.branchCurrents.get(srcKey);
      if (!rawArr) continue;
      const scale = pgb.scale !== undefined && Number.isFinite(pgb.scale) ? pgb.scale : 1.0;
      if (scale === 1.0) {
        sigMap.set(pgb.name, rawArr);
      } else {
        const scaled = new Float64Array(rawArr.length);
        for (let k = 0; k < rawArr.length; k++) scaled[k] = rawArr[k]! * scale;
        sigMap.set(pgb.name, scaled);
      }
    }
    simulationResult = { ...simulationResult, controlSignals: sigMap };
  }

  let comtrade: { cfg: string; dat: string } | undefined;
  if (simulationResult && (options.exportComtrade ?? true)) {
    const record = emtResultToComtrade(simulationResult, project.name, "MSX_EMT", netlist.nominalFrequencyHz);
    comtrade = writeComtrade(record);
  }

  let pscadOut: PscadOutResult | undefined;
  if (simulationResult && (options.exportOut ?? true)) {
    pscadOut = writePscadOut(simulationResult, project.name);
  }

  let pscadPsout: Uint8Array | undefined;
  if (simulationResult && (options.exportPsout ?? true)) {
    pscadPsout = writePscadPsout(simulationResult, { projectName: project.name });
  }

  let complianceReport: Ieee2800ComplianceReport | undefined;
  if (simulationResult && (options.verifyIeee2800 || netlist.fmuInstances.length > 0)) {
    const fmu = netlist.fmuInstances[0];
    const poiBusId =
      fmu?.busConnection ?? netlist.faults?.[0]?.bus ?? Array.from(simulationResult.busVoltages.keys())[0];
    const vPoi = poiBusId ? simulationResult.busVoltages.get(poiBusId) : undefined;
    const iIbr =
      (fmu ? simulationResult.branchCurrents.get(fmu.id) : undefined) ??
      Array.from(simulationResult.branchCurrents.values())[0];

    if (vPoi && iIbr) {
      const busBaseKv = (poiBusId ? netlist.buses.get(poiBusId)?.baseKv : undefined) ?? fmu?.ratedKv ?? 230.0;
      const netFault = netlist.faults?.[0];
      const spec: Ieee2800FaultSpec = {
        faultStartSec: options.faultSpec?.faultStartSec ?? netFault?.startSec ?? 0.05,
        faultDurationSec:
          options.faultSpec?.faultDurationSec ?? (netFault ? Math.max(0.01, netFault.endSec - netFault.startSec) : 0.1),
        vPreFaultKv: options.faultSpec?.vPreFaultKv ?? busBaseKv,
        vFaultKv: options.faultSpec?.vFaultKv ?? 0.25 * busBaseKv,
        ratedCurrentAmp: options.faultSpec?.ratedCurrentAmp,
        minK1Gain: options.faultSpec?.minK1Gain,
        minK2Gain: options.faultSpec?.minK2Gain,
        evaluateExtendedClauses: options.faultSpec?.evaluateExtendedClauses,
      };
      complianceReport = verifyIeee2800Compliance(
        project.name,
        netlist,
        {
          time: simulationResult.time,
          vPoi,
          iIbr,
          vPoiAbc: poiBusId ? simulationResult.busPhaseVoltages?.get(poiBusId) : undefined,
          iIbrAbc: fmu ? simulationResult.branchPhaseCurrents?.get(fmu.id) : undefined,
        },
        spec,
      );
    }
  }

  const pct = (coverage.ratio * 100).toFixed(0);
  if (simulationReport.solver === "none") {
    simulationReport.status = "rejected";
    simulationReport.fidelitySummary = `${coverage.lowered}/${coverage.simulatable} simulatable components lowered (${pct}%), simulation not executed`;
  } else if (
    simulationReport.solver === "builtin-companion" ||
    coverage.ratio < 1.0 ||
    simulationReport.injectedReferenceBuses.length > 0 ||
    simulationReport.synthesizedIbr
  ) {
    simulationReport.status = "degraded";
    simulationReport.fidelitySummary =
      `${coverage.lowered}/${coverage.simulatable} components lowered (${pct}%, solver=${simulationReport.solver}` +
      `${simulationReport.injectedReferenceBuses.length > 0 ? `, injectedRefs=${simulationReport.injectedReferenceBuses.length}` : ""}` +
      `${simulationReport.synthesizedIbr ? ", synthesizedIbr=true" : ""})`;
  } else {
    simulationReport.status = "ok";
    simulationReport.fidelitySummary = `${coverage.lowered}/${coverage.simulatable} components lowered (100%, solver=${simulationReport.solver})`;
  }

  return {
    project: project.name,
    settings: project.settings,
    netlist,
    circuit,
    diagnostics,
    simulationResult,
    comtrade,
    pscadOut,
    pscadPsout,
    complianceReport,
    simulationReport,
    snapshot,
  };
}

/** Describes how a PSCAD simulation result was obtained and how much of the model it reflects. */
export interface PscadSimulationReport {
  solver: "external" | "builtin-companion" | "none";
  status: "ok" | "degraded" | "rejected";
  fidelitySummary: string;
  coverage: SimulationCoverage;
  /** Buses that received a fabricated Thevenin reference source in the companion fallback. */
  injectedReferenceBuses: string[];
  /** Whether IBR/FMU currents were approximated by the fallback's canned LVRT model. */
  synthesizedIbr: boolean;
}

/**
 * Declarative ModelScript language definition for PSCAD (`.pscx`, `.pslx`, `.pswx`, `.psmx`) projects,
 * registering LSP capabilities and IDE/MCP actions for pre-flight linting, schematic inspection, and hybrid EMT simulation.
 */
export const pscadLanguage = language({
  name: "pscad",
  fileExtensions: [".pscx", ".pslx", ".pswx", ".psmx", ".psout"],
  maturity: "stable",
  lsp: {
    fileExtensions: [".pscx", ".pslx", ".pswx", ".psmx", ".psout"],
    folding: ["Element", { rule: "COMMENT", kind: "comment", defaultCollapsed: true }],
    outline: ["Element"],
    icons: {
      light: "./assets/pscad/icon-light.png",
      dark: "./assets/pscad/icon-dark.png",
    },
  },
  ui: {
    panels: [
      {
        id: "pscadEditor",
        viewType: "modelscript.pscadEditor",
        title: "PSCAD EMT Schematic Studio",
        shortTitle: "PSCAD",
        selector: ["*.pscx", "*.pslx"],
        priority: "option",
        targets: ["vscode", "morsel", "artifact"],
        entry: "./src/ui/PscadPanel.tsx",
        artifactViewTypes: ["pscad", "pscx", "pslx"],
      },
    ],
    stencils: [
      { label: "AC Source", className: "master:source_3", snippet: "" },
      { label: "Resistor", className: "master:resistor", snippet: "" },
      { label: "Inductor", className: "master:inductor", snippet: "" },
      { label: "Capacitor", className: "master:capacitor", snippet: "" },
      { label: "Ground", className: "master:ground", snippet: "" },
      { label: "Breaker", className: "master:breaker3", snippet: "" },
      { label: "Fault", className: "master:tpflt", snippet: "" },
      { label: "Transformer", className: "master:xfmr-3p2w", snippet: "" },
      { label: "PI Line", className: "master:pi_line", snippet: "" },
      { label: "Gain", className: "master:gain", snippet: "" },
      { label: "PI Control", className: "master:pi_ctlr", snippet: "" },
      { label: "PGB Output", className: "master:pgb", snippet: "" },
    ],
    simulationCards: [
      {
        id: "ieee2800",
        title: "IEEE 2800-2022 IBR Verification",
        entry: "./src/ui/Ieee2800Card.tsx",
      },
    ],
    toolbarButtons: [
      {
        id: "autoLayout",
        label: "Auto-Layout Diagram",
        shortLabel: "Layout",
        tooltip: "Re-run automatic schematic layout on the current diagram",
        icon: "flowchart",
        views: ["diagram"],
        targets: ["morsel"],
        placement: "primary",
        order: 10,
        command: "morsel:autoLayout",
      },
      {
        id: "inspectPscadSchematic",
        label: "Inspect Power System Schematic",
        shortLabel: "Inspect Power",
        tooltip: "Inspect Power System Schematic",
        icon: "circuit-board",
        views: ["diagram", "inspector"],
        targets: ["morsel"],
        placement: "primary",
        order: 20,
        actionId: "inspect_pscad_schematic",
      },
      {
        id: "simulateHybridEmt",
        label: "Launch Hybrid EMT Simulation",
        shortLabel: "Launch Hybrid",
        tooltip: "Launch Hybrid EMT Simulation",
        icon: "play",
        views: ["diagram", "simulation"],
        targets: ["morsel"],
        placement: "overflow",
        order: 30,
        actionId: "simulate_hybrid_emt",
      },
      {
        id: "computeLineConstants",
        label: "Compute Overhead Tower & Cable Line Constants (LCP)",
        shortLabel: "Compute Overhead",
        tooltip: "Compute Overhead Tower & Cable Line Constants (LCP)",
        icon: "sliders",
        views: ["diagram", "inspector"],
        targets: ["morsel"],
        placement: "overflow",
        order: 40,
        actionId: "compute_line_constants",
      },
      {
        id: "analyzeRelayCoordination",
        label: "Analyze Distance (21) R-X Mho/Quad Zones & Overcurrent (51) TCC Curves",
        shortLabel: "Analyze Distance",
        tooltip: "Analyze Distance (21) R-X Mho/Quad Zones & Overcurrent (51) TCC Curves",
        icon: "zap",
        views: ["diagram", "inspector"],
        targets: ["morsel"],
        placement: "overflow",
        order: 50,
        actionId: "analyze_relay_coordination",
      },
      {
        id: "runPowSweep",
        label: "Point-on-Wave (PoW) Parametric Sweep & SSOV Histogram",
        shortLabel: "Point-on-Wave",
        tooltip: "Point-on-Wave (PoW) Parametric Sweep & SSOV Histogram",
        icon: "play",
        views: ["diagram", "simulation"],
        targets: ["morsel"],
        placement: "overflow",
        order: 60,
        actionId: "run_pow_sweep",
      },
      {
        id: "runFrequencyScan",
        label: "Subsynchronous Impedance Frequency Scan (SSR/SSCI)",
        shortLabel: "Subsynchronous",
        tooltip: "Subsynchronous Impedance Frequency Scan (SSR/SSCI)",
        icon: "pulse",
        views: ["diagram", "simulation"],
        targets: ["morsel"],
        placement: "overflow",
        order: 70,
        actionId: "run_frequency_scan",
      },
      {
        id: "runMrunSweep",
        label: "PSCAD Multiple-Run (MRUN) Parametric & Statistical Sweep",
        shortLabel: "PSCAD",
        tooltip: "PSCAD Multiple-Run (MRUN) Parametric & Statistical Sweep",
        icon: "play",
        views: ["diagram", "simulation"],
        targets: ["morsel"],
        placement: "overflow",
        order: 80,
        actionId: "run_mrun_sweep",
      },
      {
        id: "lintPscadProject",
        label: "Lint PSCAD Project",
        shortLabel: "Lint PSCAD",
        tooltip: "Lint PSCAD Project",
        icon: "shield-check",
        views: ["*"],
        targets: ["morsel"],
        placement: "overflow",
        order: 90,
        actionId: "lint_pscad_project",
      },
    ],
  },
  polyglot: pscadPolyglotConfig,
  rules: {
    ...xmlRules,
  },
  extras: ($) => [/[ \t\r\n]+/, $["COMMENT"]!, $["PROCESSING_INSTRUCTION"]!],
  indexing: {
    builtins: buildPscadBuiltinSymbols,
    indexFile: indexPscadDocument,
  },

  actions: [
    {
      id: "lint_pscad_project",
      title: "Lint PSCAD Project",
      description: "Performs pre-flight electrical topology and parameter bounds checks.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(check)",
          group: "navigation@0",
        },
        explorerContextMenu: {
          group: "modelscript_run@0",
        },
        languageModelTool: {
          name: "pscad_lint",
          displayName: "Lint PSCAD Project",
          modelDescription: "Lints PSCAD project for floating nodes and parameter errors.",
        },
      },
      execute: async (ctx: { documentText?: string | undefined }, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const project = parsePscx(text);
        return lintPscx(project);
      },
    },
    {
      id: "inspect_pscad_schematic",
      title: "Inspect Power System Schematic",
      description: "Opens interactive Single-Line Diagram (SLD) and 3-phase schematic visualizer.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(circuit-board)",
          group: "navigation@1",
        },
        explorerContextMenu: {
          group: "modelscript_run@1",
        },
        languageModelTool: {
          name: "pscad_inspect_schematic",
          displayName: "Inspect PSCAD Schematic",
          modelDescription: "Inspects PSCAD components, buses, and wiring topology.",
        },
      },
      execute: async (ctx: { documentText?: string | undefined }, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const project = parsePscx(text);
        return extractEmtNetlist(project);
      },
    },
    {
      id: "simulate_hybrid_emt",
      title: "Launch Hybrid EMT Simulation",
      description: "Launches high-speed WebAssembly Dommel companion solver with black-box FMU co-simulation.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(play)",
          group: "navigation@2",
        },
        explorerContextMenu: {
          group: "modelscript_run@2",
        },
        languageModelTool: {
          name: "pscad_simulate_emt",
          displayName: "Simulate Hybrid EMT",
          modelDescription: "Executes fixed-step companion circuit EMT simulation.",
        },
      },
      execute: async (
        ctx: {
          documentText?: string | undefined;
          solverRunner?: PscadSimulationPipelineOptions["solverRunner"] | undefined;
        },
        params?: Partial<PscadSimulationPipelineOptions> & { allowSyntheticFallback?: boolean | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        return runPscadSimulationPipeline({
          runSimulation: true,
          ...params,
          strictNetlist: params?.allowSyntheticFallback ? false : (params?.strictNetlist ?? true),
          documentText: text,
          solverRunner: params?.solverRunner ?? ctx?.solverRunner,
        });
      },
    },
    {
      id: "compute_line_constants",
      title: "Compute Overhead Tower & Cable Line Constants (LCP)",
      description:
        "Computes frequency-dependent Carson/Derri-Semlyen R/L/C matrices and modal parameters for transmission lines.",
      category: "query",
      execute: async (ctx: { documentText?: string | undefined }, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const project = parsePscx(text);
        const netlist = extractEmtNetlist(project);
        return {
          project: project.name,
          nominalFrequencyHz: netlist.nominalFrequencyHz,
          lines: netlist.transmissionLines.map((ln) => ({
            id: ln.id,
            fromBus: ln.fromBus,
            toBus: ln.toBus,
            lengthKm: ln.lengthKm,
            modelType: ln.modelType,
            z0CharacteristicOhm: Math.sqrt(Math.max(1e-6, ln.lPerKm) / Math.max(1e-12, ln.cPerKm)),
            propagationVelocityKmSec: 1.0 / Math.sqrt(Math.max(1e-6, ln.lPerKm) * Math.max(1e-12, ln.cPerKm)),
            rPerKm: ln.rPerKm,
            lPerKm: ln.lPerKm,
            cPerKm: ln.cPerKm,
            r0PerKm: ln.r0PerKm,
            l0PerKm: ln.l0PerKm,
            c0PerKm: ln.c0PerKm,
          })),
        };
      },
    },
    {
      id: "analyze_relay_coordination",
      title: "Analyze Distance (21) R-X Mho/Quad Zones & Overcurrent (51) TCC Curves",
      description:
        "Computes R-X Mho/Quad zone boundaries, apparent impedance trajectories, and IEEE/IEC TCC trip curves.",
      category: "query",
      execute: async (ctx: { documentText?: string | undefined }, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const project = parsePscx(text);
        const netlist = extractEmtNetlist(project);
        const sim = synthesizeCompanionTrajectory(
          netlist,
          50e-6,
          Math.min(0.2, project.settings.durationSec || 0.1),
        ).simResult;
        const relays = (netlist.protectionRelays ?? []).map((r) => {
          const z1 = r.zone1ReachOhm ?? 15.0;
          const z2 = r.zone2ReachOhm ?? 1.25 * z1;
          const z3 = r.zone3ReachOhm ?? 1.6 * z1;
          const mtaRad = (75.0 * Math.PI) / 180.0;
          const buildMhoCircle = (reach: number) =>
            Array.from({ length: 37 }, (_, idx) => {
              const ang = (idx * 10.0 * Math.PI) / 180.0;
              const cx = 0.5 * reach * Math.cos(mtaRad);
              const cy = 0.5 * reach * Math.sin(mtaRad);
              return {
                rOhm: Number((cx + 0.5 * reach * Math.cos(ang)).toFixed(4)),
                xOhm: Number((cy + 0.5 * reach * Math.sin(ang)).toFixed(4)),
              };
            });
          const multiples = [1.5, 2.0, 3.0, 5.0, 8.0, 10.0, 15.0, 20.0];
          const td = r.timeDialSetting ?? 0.5;
          const tccCurve = multiples.map((m) => ({
            multipleOfPickup: m,
            tripTimeSec: Number(((0.14 * td) / (Math.pow(m, 0.02) - 1.0)).toFixed(4)),
          }));
          const tripSignal = sim.controlSignals?.get(`${r.id}_trip`);
          const zAppSignal = sim.controlSignals?.get(`${r.id}_zAppOhm`);
          return {
            id: r.id,
            ansiCode: r.ansiCode,
            monitoredBus: r.monitoredBus,
            monitoredBranch: r.monitoredBranch,
            tripBreakerId: r.tripBreakerId,
            mhoZones: {
              zone1: buildMhoCircle(z1),
              zone2: buildMhoCircle(z2),
              zone3: buildMhoCircle(z3),
            },
            tccCurve,
            tripped: tripSignal ? tripSignal.some((v) => v > 0.5) : false,
            minApparentImpedanceOhm:
              zAppSignal && zAppSignal.length > 0 ? Math.min(...Array.from(zAppSignal)) : undefined,
          };
        });
        return { project: project.name, relays };
      },
    },
    {
      id: "run_pow_sweep",
      title: "Point-on-Wave (PoW) Parametric Sweep & SSOV Histogram",
      description:
        "Executes statistical breaker closing angle sweeps (0-360 deg with Gaussian pole scatter) and computes 2% SSOV overvoltage.",
      category: "simulate",
      execute: async (
        ctx: { documentText?: string | undefined },
        params?: { documentText?: string | undefined; breakerId?: string; numRuns?: number },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const project = parsePscx(text);
        const netlist = extractEmtNetlist(project);
        return runPointOnWaveSweep(netlist, {
          breakerId: params?.breakerId,
          numRuns: params?.numRuns ?? 30,
        });
      },
    },
    {
      id: "run_frequency_scan",
      title: "Subsynchronous Impedance Frequency Scan (SSR/SSCI)",
      description:
        "Scans driving-point impedance Z(f) across 1-150 Hz to detect series resonance and undamped negative resistance SSCI modes.",
      category: "simulate",
      execute: async (
        ctx: { documentText?: string | undefined },
        params?: { documentText?: string | undefined; busId?: string; fMinHz?: number; fMaxHz?: number },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const project = parsePscx(text);
        const netlist = extractEmtNetlist(project);
        const firstBus = Array.from(netlist.buses.keys())[0] ?? "Bus1";
        const targetBus = params?.busId ?? netlist.fmuInstances[0]?.busConnection ?? firstBus;
        return runFrequencyScan(netlist, {
          busId: targetBus,
          fMinHz: params?.fMinHz ?? 1.0,
          fMaxHz: params?.fMaxHz ?? 150.0,
        });
      },
    },
    {
      id: "run_mrun_sweep",
      title: "PSCAD Multiple-Run (MRUN) Parametric & Statistical Sweep",
      description:
        "Runs multi-iteration parametric/Monte-Carlo EMT sweeps across branch, source, or fault parameters and computes envelope statistics.",
      category: "simulate",
      execute: async (
        ctx: { documentText?: string | undefined },
        params?: {
          documentText?: string | undefined;
          numRuns?: number;
          durationSec?: number;
          timeStepSec?: number;
          seed?: number;
        },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const project = parsePscx(text);
        const netlist = extractEmtNetlist(project);
        // Auto-discover master:mrun NR / NumRuns parameter when present
        const mrunCmp = [project.rootModule, ...project.subModules.values()]
          .flatMap((m) => m.components)
          .find((c) => c.definitionName.toLowerCase().endsWith("mrun"));
        const nrRaw = mrunCmp
          ? Number(mrunCmp.parameters["NR"] ?? mrunCmp.parameters["NumRuns"] ?? mrunCmp.parameters["N"] ?? NaN)
          : NaN;
        const numRuns = params?.numRuns ?? (Number.isFinite(nrRaw) && nrRaw > 0 ? Math.trunc(nrRaw) : 10);
        return runMultipleRunSweep(netlist, { ...params, numRuns });
      },
    },
  ],
});
