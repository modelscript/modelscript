// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript PSCAD Language Definition.
 *
 * Provides declarative grammar, XML AST parsing, pre-flight linter,
 * and polyglot cross-language projections for PSCAD v4/v5 projects.
 */

import { language } from "@modelscript/dsl";
import { emtResultToComtrade, writeComtrade } from "./comtrade/comtrade-writer.js";
import { writePscadOut, type PscadOutResult } from "./comtrade/pscad-out-writer.js";
import { lintPscx } from "./lints/index.js";
import { computeSimulationCoverage, type SimulationCoverage } from "./netlist/coverage.js";
import { extractEmtNetlist, netlistToEmtCircuit } from "./netlist/emt-netlist.js";
import { parsePscx } from "./parser/pscx-parser.js";
import { writePscadPsout } from "./psout/index.js";
import { EmtSolver } from "./solver/emt-solver.js";
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
) {
  const solver = new EmtSolver(netlist, {
    timeStepSec,
    durationSec,
    nominalFrequencyHz: netlist.nominalFrequencyHz || 60.0,
    enableCda: true,
  });
  return solver.solve();
}

/**
 * Executes the turnkey PSCAD `.pscx` parsing, pre-flight linting, EMT simulation,
 * IEEE C37.111 COMTRADE export, and IEEE 2800-2022 compliance verification pipeline.
 */
export function runPscadSimulationPipeline(options: PscadSimulationPipelineOptions) {
  const project = parsePscx(options.documentText);
  const netlist = extractEmtNetlist(project);
  const circuit = netlistToEmtCircuit(netlist);
  const diagnostics = lintPscx(project);
  const coverage = computeSimulationCoverage(project, netlist);
  const simulationReport: PscadSimulationReport = {
    solver: "none",
    coverage,
    injectedReferenceBuses: [],
    synthesizedIbr: false,
  };
  if (coverage.simulatable > 0 && coverage.ratio < 0.9) {
    const top = coverage.dropped
      .slice(0, 5)
      .map((d) => `${d.definition} (${d.count})`)
      .join(", ");
    diagnostics.push({
      code: "P6100",
      rule: "emt-netlist-coverage",
      severity: "warning",
      message: `Only ${coverage.lowered} of ${coverage.simulatable} simulatable components are supported by the EMT netlist; unsupported: ${top}.`,
    });
  }

  if (netlist.assumptions && netlist.assumptions.length > 0) {
    diagnostics.push({
      code: "P6103",
      rule: "emt-assumed-parameters",
      severity: "warning",
      message: `${netlist.assumptions.length} parameter default(s) were assumed: ${netlist.assumptions[0]}${netlist.assumptions.length > 1 ? " (and more)" : ""}`,
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

  if (shouldRunSim) {
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
      const isolatedUnsourced = Array.from(netlist.buses.keys()).filter((b) => {
        if (sourced.has(b)) return false;
        const busObj = netlist.buses.get(b);
        return !busObj || busObj.connectedBranchIds.length === 0;
      });
      simulationReport.injectedReferenceBuses = isolatedUnsourced;
      simulationReport.synthesizedIbr = (netlist.fmuInstances ?? []).length > 0;
      simulationResult = synthesizeCompanionTrajectory(netlist, timeStepSec, durationSec);
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

  let comtrade: { cfg: string; dat: string } | undefined;
  if (simulationResult && (options.exportComtrade ?? true)) {
    const record = emtResultToComtrade(simulationResult, project.name, "MSX_EMT");
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
  };
}

/** Describes how a PSCAD simulation result was obtained and how much of the model it reflects. */
export interface PscadSimulationReport {
  solver: "external" | "builtin-companion" | "none";
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
    icons: {
      light: "./assets/pscad/icon-light.png",
      dark: "./assets/pscad/icon-dark.png",
    },
  },
  rules: {
    Root: () => "pscad",
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
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
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
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
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
      execute: async (ctx: any, params?: Partial<PscadSimulationPipelineOptions>) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        return runPscadSimulationPipeline({
          runSimulation: true,
          ...params,
          documentText: text,
          solverRunner: params?.solverRunner ?? ctx?.solverRunner,
        });
      },
    },
  ],
});
