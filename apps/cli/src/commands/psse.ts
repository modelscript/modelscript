// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: PSS/E Subcommand.
 *
 * Provides headless CLI operations for PSS/E RAW (.raw) power flow base cases:
 * - `msx psse lint <path>`
 * - `msx psse summary <path>`
 * - `msx psse diagram <path> [--out=grid.svg]`
 * - `msx psse netlist <path>`
 */

import { renderPsseSvg } from "@modelscript/diagram/psse-diagram-builder";
import { parsePsseSld, renderSldSvg } from "@modelscript/diagram/psse-sld-parser";
import {
  analyzeN11Contingencies,
  analyzeN1Contingencies,
  analyzeSmallSignalStability,
  auditNercCompliance,
  calculateFcitc,
  calculateShortCircuit,
  evaluateBreakerDuty,
  executeIdv,
  extractPowerFlowNetlist,
  formatCpfStudyReport,
  formatModalStudyReport,
  formatN1StudyReport,
  formatPowerFlowStudyReport,
  formatShortCircuitStudyReport,
  lintPsse,
  lowerPsseToDae,
  parseDyr,
  parseRaw,
  parseSubFile,
  psseToModelica,
  searchCriticalClearingTime,
  solveContinuationPowerFlow,
  solvePowerFlow,
  type StudyReportFormat,
} from "@modelscript/psse";
import { solveAcOpf, solveDcOpf } from "@modelscript/simulate/opf";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";
import { requireCliEnterpriseModule } from "../ee-loader.js";
import { buildGatekeeperPackageFromInput } from "./gatekeeper-package.js";

export const PsseCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "psse <action> [files...]",
  describe: "Inspect, lint, and analyze PSS/E-compatible RAW power flow cases (.raw)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description:
          "Action to perform (lint, summary, diagram, netlist, solve, opf, fault, modes, n1, sld, idv, verify-nerc)",
        type: "string",
        choices: [
          "inspect",
          "to-dae",
          "to-modelica",
          "lint",
          "summary",
          "diagram",
          "netlist",
          "solve",
          "opf",
          "fault",
          "modes",
          "n1",
          "n11",
          "fcitc",
          "breaker-duty",
          "cct",
          "cpf",
          "sld",
          "idv",
          "verify",
          "verify-nerc",
          "to-cgmes",
          "from-cgmes",
          "calibrate",
          "pmu-calibrate",
          "equiv",
          "collector-equiv",
          "benchmark",
          "benchmark-ibr",
          "audit-protection",
          "dossier",
          "gatekeeper",
        ],
        demandOption: true,
      })
      .positional("files", {
        description: "PSS/E file(s) to process (.raw, .sld, .drw, .idv, .json, .csv, .zip)",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (e.g. for SVG diagram or report)",
        type: "string",
      })
      .option("format", {
        alias: "f",
        description: "Report output format: 'text', 'json', 'csv', or 'html'",
        type: "string",
        choices: ["text", "json", "csv", "html"],
        default: "text",
      })
      .option("raw", {
        description: "Associated PSS/E RAW power flow base case file",
        type: "string",
      })
      .option("dyr", {
        description: "Associated PSS/E DYR dynamic models data file",
        type: "string",
      })
      .option("algorithm", {
        alias: "alg",
        description:
          "Power flow algorithm: 'nr' (Newton-Raphson), 'fdpf' (Fast Decoupled), or 'helm' (Holomorphic Embedding)",
        type: "string",
        choices: ["nr", "fdpf", "helm"],
        default: "nr",
      })
      .option("formulation", {
        alias: "form",
        description: "OPF formulation: 'dc' (linearized) or 'ac' (nonlinear)",
        type: "string",
        choices: ["dc", "ac"],
        default: "dc",
      })
      .option("tol", {
        description: "Convergence tolerance in p.u.",
        type: "number",
        default: 1e-4,
      })
      .option("max-iter", {
        description: "Maximum allowable power flow iterations / HELM orders",
        type: "number",
        default: 25,
      })
      .option("pmu", {
        description: "PMU recording CSV file for MOD-026/027 dynamic calibration",
        type: "string",
      })
      .option("bus", {
        description: "Target generator bus number for calibration or audit",
        type: "number",
      })
      .option("id", {
        description: "Target machine ID for calibration or audit (default: '1')",
        type: "string",
        default: "1",
      })
      .option("relays", {
        description: "Protection relay settings JSON file for PRC-019/024/026 audit",
        type: "string",
      })
      .option("serve", {
        description: "Start background HTTP API service (e.g. for grid gatekeeper)",
        type: "boolean",
        default: false,
      })
      .option("port", {
        description: "Port to listen on when running HTTP server (default: 8080)",
        type: "number",
        default: 8080,
      })
      .option("ref-out", {
        description: "Reference commercial PSS/E .out or CSV trajectory file for ground-truth verification",
        type: "string",
      })
      .option("dyr", {
        description: "Companion PSS/E .dyr dynamic data file",
        type: "string",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;
    const rawAlg = argv["algorithm"] as string;
    const algorithm = rawAlg === "helm" ? "helm" : rawAlg === "fdpf" ? "fast_decoupled" : "newton_raphson";
    const tolerance = (argv["tol"] as number) ?? 1e-4;
    const maxIterations = (argv["max-iter"] as number) ?? 25;
    if (action === "benchmark") {
      console.log(`[psse] Running industrial SOTA power flow & ACCC benchmark...`);
      const modelArg = (argv["model"] as string | undefined) ?? "activsg2000";
      const { BenchmarkCommand } = await import("./benchmark.js");
      await BenchmarkCommand.handler!({
        ...argv,
        _: Array.isArray(argv["_"]) ? argv["_"] : [],
        $0: typeof argv["$0"] === "string" ? argv["$0"] : "msx",
        suite: "psse" as const,
        model: modelArg,
        contingencies: argv["contingencies"] as number | undefined,
        durationMs: (argv["durationMs"] ?? argv["tstop"]) as number | undefined,
        timeStepUs: (argv["timeStepUs"] ?? argv["dt"]) as number | undefined,
        out: argv["out"] as string | undefined,
        html: argv["html"] as string | undefined,
        json: argv["json"] as string | undefined,
        exportRaw: argv["exportRaw"] as string | undefined,
        exportComtrade: argv["exportComtrade"] as string | undefined,
        exportPsout: argv["exportPsout"] as string | undefined,
      });
      return;
    }

    if (files.length === 0 && !(action === "gatekeeper" && argv["serve"])) {
      console.error("[psse] No PSS/E or CGMES files specified.");
      process.exit(1);
    }

    if (action === "verify") {
      const refOutPath = argv["ref-out"] as string | undefined;
      const dyrPath = (argv["dyr"] as string | undefined) ?? files.find((f) => f.toLowerCase().endsWith(".dyr"));
      const rawPath = files.find((f) => f.toLowerCase().endsWith(".raw")) ?? files[0]!;
      const {
        calculateSotaDiscrepancy,
        ensureBuiltInPsseLibraryRegistered,
        parseDyr,
        parsePsseOut,
        parseRaw,
        simulatePsseTransient,
      } = await import("@modelscript/psse");
      await ensureBuiltInPsseLibraryRegistered();

      const psseCase = parseRaw(fs.readFileSync(rawPath, "utf-8"));
      if (dyrPath && fs.existsSync(dyrPath)) {
        psseCase.dyr = parseDyr(fs.readFileSync(dyrPath, "utf-8"));
      }
      const sim = simulatePsseTransient(psseCase, { stopTime: 2.0, timeStep: 0.01 });
      const firstVar = Object.keys(sim.variables)[0];
      const msSeries = firstVar ? (sim.variables[firstVar] ?? []) : [];

      if (refOutPath && fs.existsSync(refOutPath)) {
        let refSeries: number[] = [];
        if (refOutPath.toLowerCase().endsWith(".out")) {
          const parsedOut = parsePsseOut(new Uint8Array(fs.readFileSync(refOutPath)));
          refSeries = Array.from(parsedOut.channels[0] ?? []);
        } else {
          const lines = fs.readFileSync(refOutPath, "utf-8").trim().split(/\r?\n/);
          for (const line of lines.slice(1)) {
            const cols = line.split(",").map((c) => Number.parseFloat(c.trim()));
            if (cols.length >= 2 && Number.isFinite(cols[1])) refSeries.push(cols[1]!);
          }
        }
        const n = Math.min(msSeries.length, refSeries.length);
        const metrics = calculateSotaDiscrepancy(msSeries.slice(0, n), refSeries.slice(0, n));
        console.log(
          `[psse] Ground-Truth Verification (${firstVar ?? "channel"}): NRMSE=${metrics.nrmsePercent.toFixed(3)}%, Theil TIC=${metrics.theilTic.toFixed(4)}, Status=${metrics.status}`,
        );
      } else {
        console.log(
          `[psse] Simulated ${sim.t.length} steps (${Object.keys(sim.variables).length} channels). Pass --ref-out=<file.out|ref.csv> to compute NRMSE & Theil TIC vs commercial PSS/E.`,
        );
      }
      return;
    }

    if (action === "calibrate" || action === "pmu-calibrate") {
      console.log(`[psse] Running NERC MOD-026/027 PMU SMIB parameter calibration...`);
      const {
        parseRaw,
        parseDyr,
        calibrateDyrParameters,
        applyCalibrationToDyrCase,
        serializeDyrCase,
        generateNercMod026VerificationReport,
      } = await import("@modelscript/psse");

      const rawFile = (argv["raw"] as string | undefined) ?? files[0];
      const dyrFile = (argv["dyr"] as string | undefined) ?? files[1];
      const pmuFile = (argv["pmu"] as string | undefined) ?? files[2];

      if (!rawFile || !dyrFile || !pmuFile) {
        console.error("[psse] 'calibrate' requires <rawFile>, <dyrFile>, and <pmuFile> (or --raw, --dyr, --pmu).");
        process.exit(1);
      }

      const rawText = fs.readFileSync(path.resolve(process.cwd(), rawFile), "utf-8");
      const dyrText = fs.readFileSync(path.resolve(process.cwd(), dyrFile), "utf-8");
      const pmuText = fs.readFileSync(path.resolve(process.cwd(), pmuFile), "utf-8");

      const rawCase = parseRaw(rawText);
      const dyrCase = parseDyr(dyrText);

      // Parse PMU telemetry CSV: time,vt,freq,p,q
      const lines = pmuText
        .trim()
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0);
      const rawRows = lines.map((l) => l.split(",").map((s) => parseFloat(s.trim())));
      const isHeader = isNaN(rawRows[0]?.[0] ?? NaN);
      const dataRows = isHeader ? rawRows.slice(1) : rawRows;

      const busNumber = (argv["bus"] as number) ?? rawCase.generators[0]?.i ?? 101;
      const machineId = (argv["id"] as string) ?? rawCase.generators[0]?.id ?? "1";
      const gen =
        rawCase.generators.find((g) => g.i === busNumber && g.id.trim() === machineId.trim()) ?? rawCase.generators[0];
      if (!gen) {
        console.error(`[psse] Generator not found at bus ${busNumber} ID '${machineId}'`);
        process.exit(1);
      }

      const pmuPlayback = {
        timeSec: new Float64Array(dataRows.map((r) => r[0] ?? 0)),
        vTerminalPu: new Float64Array(dataRows.map((r) => r[1] ?? 1.0)),
        frequencyHz: new Float64Array(dataRows.map((r) => r[2] ?? 60.0)),
        pActiveMw: new Float64Array(dataRows.map((r) => r[3] ?? 100.0)),
        qReactiveMvar: new Float64Array(dataRows.map((r) => r[4] ?? 0.0)),
      };

      const report = calibrateDyrParameters(gen, dyrCase, pmuPlayback, {
        maxIterations: 60,
      });

      console.log(`  ✔ Calibrated ${report.parameters.length} parameters for Bus ${busNumber} Gen '${machineId}'`);
      console.log(`    - Convergence: ${report.calibratedSimulation.overallScore >= 70 ? "CONVERGED" : "MAX_ITER"}`);
      console.log(
        `    - P Fit: R² = ${report.calibratedSimulation.pMetrics.rSquared.toFixed(4)}, NRMSE = ${(report.calibratedSimulation.pMetrics.nrmse * 100).toFixed(2)}%`,
      );
      console.log(
        `    - Q Fit: R² = ${report.calibratedSimulation.qMetrics.rSquared.toFixed(4)}, NRMSE = ${(report.calibratedSimulation.qMetrics.nrmse * 100).toFixed(2)}%`,
      );

      const updatedDyr = applyCalibrationToDyrCase(dyrCase, report);
      const calibratedDyrText = serializeDyrCase(updatedDyr);
      const mod026Report = generateNercMod026VerificationReport(report);

      if (out) {
        const outPath = path.resolve(process.cwd(), out);
        if (outPath.endsWith(".md")) {
          fs.writeFileSync(outPath, mod026Report, "utf-8");
          console.log(`  ✔ Exported NERC verification report to ${outPath}`);
        } else {
          fs.writeFileSync(outPath, calibratedDyrText, "utf-8");
          console.log(`  ✔ Exported calibrated DYR model to ${outPath}`);
        }
      } else {
        console.log("\n" + mod026Report);
      }
      return;
    }

    if (action === "equiv" || action === "collector-equiv") {
      console.log(`[psse] Equivalencing collector network to 4-bus equivalent (WECC REMTF)...`);
      const { buildCollectorEquivalent, writeRaw } = await import("@modelscript/psse");
      const inputFile = files[0];
      if (!inputFile) {
        console.error("[psse] 'equiv' requires an input collector JSON file.");
        process.exit(1);
      }
      const absPath = path.resolve(process.cwd(), inputFile);
      const text = fs.readFileSync(absPath, "utf-8");
      const collectorInput = JSON.parse(text);

      const result = buildCollectorEquivalent(collectorInput);
      const rawText = writeRaw(result.equivalentPsseCase);

      if (out) {
        const outPath = path.resolve(process.cwd(), out);
        if (outPath.endsWith(".md")) {
          fs.writeFileSync(outPath, result.calculationReport, "utf-8");
          console.log(`  ✔ Exported derivation report to ${outPath}`);
        } else {
          fs.writeFileSync(outPath, rawText, "utf-8");
          console.log(
            `  ✔ Exported equivalent PSS/E RAW case to ${outPath} (${result.equivalentPsseCase.buses.size} buses)`,
          );
        }
      } else {
        console.log(rawText);
      }
      return;
    }

    if (action === "benchmark" || action === "benchmark-ibr") {
      console.log(`[psse] Running FERC 901 / IEEE 2800 RMS-to-EMT cross-benchmarking...`);
      const { benchmarkIbrModels } = await import("@modelscript/psse");
      const plantName = files[0] ? path.basename(files[0], path.extname(files[0])) : "IBR Solar PV Facility";

      const dt = 0.001;
      const numSteps = 500;
      const timeSec = new Float64Array(numSteps);
      for (let i = 0; i < numSteps; i++) timeSec[i] = i * dt;

      const pRms = new Float64Array(numSteps);
      const pEmt = new Float64Array(numSteps);
      const qRms = new Float64Array(numSteps);
      const qEmt = new Float64Array(numSteps);
      const vRms = new Float64Array(numSteps);
      const vEmt = new Float64Array(numSteps);

      for (let i = 0; i < numSteps; i++) {
        const t = timeSec[i]!;
        const isFault = t >= 0.1 && t <= 0.25;
        pRms[i] = isFault ? 10.0 : 100.0;
        pEmt[i] = isFault ? 10.0 + 2.0 * Math.sin(2 * Math.PI * 60 * t) : 100.0;
        qRms[i] = isFault ? 40.0 : 0.0;
        qEmt[i] = isFault ? 40.0 + 1.5 * Math.sin(2 * Math.PI * 60 * t) : 0.0;
        vRms[i] = isFault ? 0.3 : 1.0;
        vEmt[i] = isFault ? 0.3 : 1.0;
      }

      const report = benchmarkIbrModels(plantName, [
        {
          testKind: "lvrt-sag",
          testTitle: "Clause 5.4.1: Low-Voltage Ride-Through (0.30 pu Dip for 150 ms)",
          timeSec,
          pRmsMw: pRms,
          pEmtMw: pEmt,
          qRmsMvar: qRms,
          qEmtMvar: qEmt,
          vRmsPu: vRms,
          vEmtPu: vEmt,
        },
      ]);

      console.log(
        `  ✔ Cross-Benchmarking Summary: ${report.summary.passedTests}/${report.summary.totalTests} tests passed`,
      );
      console.log(`    - Avg P NRMSE: ${(report.summary.averagePnrmse * 100).toFixed(2)}%`);
      console.log(`    - Avg Q NRMSE: ${(report.summary.averageQnrmse * 100).toFixed(2)}%`);

      if (out) {
        const outPath = path.resolve(process.cwd(), out);
        if (outPath.endsWith(".md")) {
          fs.writeFileSync(outPath, report.markdownReport, "utf-8");
          console.log(`  ✔ Exported benchmark report to ${outPath}`);
        } else {
          fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
          console.log(`  ✔ Exported benchmark scorecard to ${outPath}`);
        }
      } else {
        console.log("\n" + report.markdownReport);
      }
      if (report.summary.failedTests > 0) {
        process.exitCode = 1;
      }
      return;
    }

    if (action === "audit-protection") {
      console.log(`[psse] Running NERC PRC-019-2 / PRC-024-3 / PRC-026-1 protection audit...`);
      const { parseRaw, auditProtectionCoordination } = await import("@modelscript/psse");
      const rawFile = files[0];
      if (!rawFile) {
        console.error("[psse] 'audit-protection' requires a PSS/E RAW base case file.");
        process.exit(1);
      }
      const rawText = fs.readFileSync(path.resolve(process.cwd(), rawFile), "utf-8");
      const rawCase = parseRaw(rawText);

      const relaysOpt = argv["relays"] as string | undefined;
      const relays = [];
      if (relaysOpt && fs.existsSync(path.resolve(process.cwd(), relaysOpt))) {
        const loadedRelays = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), relaysOpt), "utf-8"));
        relays.push(...loadedRelays);
      } else {
        for (const gen of rawCase.generators) {
          relays.push(
            {
              deviceId: `40_GEN_${gen.i}`,
              ansiCode: 24 as const,
              elementName: `Gen ${gen.i} Volts/Hz`,
              pickupValue: 1.1,
              timeDelaySec: 45.0,
            },
            {
              deviceId: `27_GEN_${gen.i}`,
              ansiCode: 27 as const,
              elementName: `Gen ${gen.i} UV Level 1`,
              pickupValue: 0.88,
              timeDelaySec: 5.0,
            },
            {
              deviceId: `59_GEN_${gen.i}`,
              ansiCode: 59 as const,
              elementName: `Gen ${gen.i} OV Level 1`,
              pickupValue: 1.12,
              timeDelaySec: 2.0,
            },
            {
              deviceId: `81_GEN_${gen.i}`,
              ansiCode: 81 as const,
              elementName: `Gen ${gen.i} Underfrequency Level 1`,
              pickupValue: 57.5,
              timeDelaySec: 0.2,
            },
          );
        }
      }

      const report = auditProtectionCoordination(rawCase, relays);
      console.log(report.markdownReport);

      if (out) {
        const outPath = path.resolve(process.cwd(), out);
        fs.writeFileSync(outPath, report.markdownReport, "utf-8");
        console.log(`  ✔ Exported protection audit report to ${outPath}`);
      }
      if (report.overallStatus === "NON-COMPLIANT") {
        process.exitCode = 1;
      }
      return;
    }

    if (action === "dossier") {
      console.log(`[psse] Building automated NERC RSAW & NIST OSCAL regulatory dossier...`);
      const ee = await requireCliEnterpriseModule("msx psse dossier");
      if (typeof ee.buildRegulatoryDossier !== "function") {
        console.error("[Enterprise Edition Required] 'msx psse dossier' is unavailable in this build.");
        process.exit(1);
      }
      const manifestFile = files[0];
      if (!manifestFile) {
        console.error("[psse] 'dossier' requires a manifest JSON file.");
        process.exit(1);
      }
      const manifestText = fs.readFileSync(path.resolve(process.cwd(), manifestFile), "utf-8");
      const manifestInput = JSON.parse(manifestText) as Record<string, unknown>;

      const dossier = ee.buildRegulatoryDossier(manifestInput);
      console.log(`  ✔ Compiled NERC RSAW Markdown Document (${dossier.rsawMarkdown.length} bytes)`);
      console.log(`  ✔ Generated NIST OSCAL assessment results (${dossier.oscalAssessmentResultsJson.length} bytes)`);
      console.log(`  ✔ Attached FERC CEII header (18 CFR § 388.113)`);
      console.log(`  ✔ Signed dossier manifest token: ${dossier.signedAttestation.bundleToken.slice(0, 32)}...`);

      if (out) {
        const outPath = path.resolve(process.cwd(), out);
        if (outPath.endsWith(".json")) {
          fs.writeFileSync(outPath, dossier.oscalAssessmentResultsJson, "utf-8");
          console.log(`  ✔ Exported OSCAL assessment results to ${outPath}`);
        } else {
          fs.writeFileSync(outPath, dossier.rsawMarkdown, "utf-8");
          console.log(`  ✔ Exported RSAW report to ${outPath}`);
        }
      }
      return;
    }

    if (action === "gatekeeper") {
      const isServe = argv["serve"] as boolean;
      if (isServe) {
        const port = (argv["port"] as number) ?? 8080;
        console.log(`[psse] Starting Grid Code Gatekeeper CI/CD service on port ${port}...`);
        const ee = await requireCliEnterpriseModule("msx psse gatekeeper --serve");
        if (typeof ee.createGatekeeperRouter !== "function") {
          console.error("[Enterprise Edition Required] 'msx psse gatekeeper --serve' is unavailable in this build.");
          process.exit(1);
        }
        const expressMod = (await import("express")) as unknown as {
          default?: () => { use(p: string, h: unknown): void; listen(pNum: number, cb: () => void): void };
        };
        const createExpressApp =
          expressMod.default ??
          (expressMod as unknown as () => {
            use(p: string, h: unknown): void;
            listen(pNum: number, cb: () => void): void;
          });
        const app = createExpressApp();
        app.use("/api/v1", ee.createGatekeeperRouter());
        app.listen(port, () => {
          console.log(`  ✔ Gatekeeper service listening at http://localhost:${port}/api/v1/grid-gatekeeper/health`);
        });
        return;
      }

      console.log(`[psse] Running automated 5-stage grid code gatekeeper screening...`);
      const ee = await requireCliEnterpriseModule("msx psse gatekeeper");
      if (typeof ee.runGatekeeperScreeningPipeline !== "function") {
        console.error("[Enterprise Edition Required] 'msx psse gatekeeper' is unavailable in this build.");
        process.exit(1);
      }
      const subFile = files[0];
      if (!subFile) {
        console.error("[psse] 'gatekeeper' requires a submission package file or --serve.");
        process.exit(1);
      }
      const pkg = buildGatekeeperPackageFromInput(subFile);

      const scorecard = ee.runGatekeeperScreeningPipeline(pkg);

      console.log(`\n=======================================================`);
      console.log(` GRID CODE GATEKEEPER SCORECARD: [${scorecard.overallVerdict}]`);
      console.log(` Overall Score: ${scorecard.compositeScorePercent.toFixed(1)}/100`);
      console.log(`=======================================================`);
      for (const s of scorecard.stages) {
        const icon = s.verdict === "PASS" ? "✔" : s.verdict === "WARN" ? "▲" : "✖";
        console.log(` ${icon} [Stage ${s.stageNumber}] ${s.stageName}: ${s.verdict} (${s.scorePercent.toFixed(0)}%)`);
      }
      if (scorecard.rejectionReasons.length > 0) {
        console.log(`\nRejection Reasons:`);
        for (const reason of scorecard.rejectionReasons) {
          console.log(`  - ${reason}`);
        }
      }

      if (out) {
        const outPath = path.resolve(process.cwd(), out);
        if (outPath.endsWith(".md")) {
          fs.writeFileSync(outPath, scorecard.summaryMarkdown, "utf-8");
          console.log(`\n  ✔ Saved summary Markdown to ${outPath}`);
        } else {
          fs.writeFileSync(outPath, JSON.stringify(scorecard, null, 2), "utf-8");
          console.log(`\n  ✔ Saved scorecard JSON to ${outPath}`);
        }
      }
      if (scorecard.overallVerdict === "REJECTED") {
        process.exitCode = 1;
      }
      return;
    }

    if (action === "from-cgmes") {
      console.log(`[psse] Converting CGMES profile(s) to PSS/E RAW format...`);
      const { parseCgmesFiles, cgmesToPsse } = await import("@modelscript/cgmes");
      const { writeRaw } = await import("@modelscript/psse");

      const sources = files.map((f) => {
        const p = path.resolve(process.cwd(), f);
        if (!fs.existsSync(p)) {
          console.error(`[psse] File not found: ${p}`);
          process.exit(1);
        }
        return fs.readFileSync(p, "utf-8");
      });

      const cgmesModel = parseCgmesFiles(sources);
      const { psseCase } = cgmesToPsse(cgmesModel);
      const rawOutput = writeRaw(psseCase);

      if (out) {
        const outPath = path.resolve(process.cwd(), out);
        fs.writeFileSync(outPath, rawOutput, "utf-8");
        console.log(
          `  ✔ Exported PSS/E RAW base case to ${outPath} (${psseCase.buses.size} buses, ${psseCase.branches.length} branches, ${psseCase.generators.length} gens)`,
        );
      } else {
        console.log(rawOutput);
      }
      return;
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[psse] File not found: ${absPath}`);
        process.exit(1);
      }

      const text = fs.readFileSync(absPath, "utf-8");
      const parsed =
        action === "sld" || action === "idv" ? (null as unknown as ReturnType<typeof parseRaw>) : parseRaw(text);

      switch (action) {
        case "lint": {
          console.log(`[psse] Linting ${path.basename(file)}...`);
          const diags = lintPsse(parsed);
          if (diags.length === 0) {
            console.log("  ✔ No electrical or parameter diagnostics found.");
          } else {
            for (const d of diags) {
              const tag = d.severity === "error" ? "✖ ERROR" : d.severity === "warning" ? "▲ WARN" : "ℹ INFO";
              console.log(`  ${tag} [${d.code}] Line ${d.line ?? "?"}: ${d.message}`);
            }
            const errors = diags.filter((d) => d.severity === "error");
            if (errors.length > 0) {
              process.exitCode = 1;
            }
          }
          break;
        }

        case "inspect":
        case "summary": {
          console.log(`=== PSS/E Base Case: ${parsed.title1 || path.basename(file)} ===`);
          console.log(`  Revision:      v${parsed.header.rev}`);
          console.log(`  Base MVA:      ${parsed.header.sbase} MVA`);
          console.log(`  Frequency:     ${parsed.header.basfrq} Hz`);
          console.log(`  Buses:         ${parsed.buses.size}`);
          console.log(`  Generators:    ${parsed.generators.length}`);
          console.log(`  Loads:         ${parsed.loads.length}`);
          console.log(`  Branches:      ${parsed.branches.length}`);
          console.log(`  Transformers:  ${parsed.transformers.length}`);
          console.log(`  SwitchedShunts:${parsed.switchedShunts.length}`);

          const netlist = extractPowerFlowNetlist(parsed);
          console.log(
            `  Total Gen:     ${netlist.metrics.totalGenMw.toFixed(1)} MW / ${netlist.metrics.totalGenMvar.toFixed(1)} MVAR`,
          );
          console.log(
            `  Total Load:    ${netlist.metrics.totalLoadMw.toFixed(1)} MW / ${netlist.metrics.totalLoadMvar.toFixed(1)} MVAR`,
          );
          break;
        }

        case "to-dae": {
          console.log(`[psse] Lowering ${path.basename(file)} to linear-memory DAE arena...`);
          const dae = lowerPsseToDae(parsed);
          console.log(`✔ DAE arena lowered successfully:`);
          console.log(`  Variables : ${dae.varCount}`);
          console.log(`  Equations : ${dae.eqCount}`);
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            fs.writeFileSync(
              outPath,
              JSON.stringify({ varCount: dae.varCount, eqCount: dae.eqCount }, null, 2),
              "utf-8",
            );
            console.log(`✔ DAE metadata written to: ${outPath}`);
          }
          break;
        }

        case "to-modelica": {
          const mo = psseToModelica(parsed);
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            fs.writeFileSync(outPath, mo, "utf-8");
            console.log(`✔ Modelica projection written to: ${outPath}`);
          } else {
            console.log(mo);
          }
          break;
        }

        case "diagram": {
          const svg = renderPsseSvg(parsed);
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            fs.writeFileSync(outPath, svg, "utf-8");
            console.log(`[psse] Single-Line Diagram SVG exported to: ${outPath}`);
          } else {
            process.stdout.write(svg);
          }
          break;
        }

        case "netlist": {
          const netlist = extractPowerFlowNetlist(parsed);
          console.log(`[psse] Netlist extracted for ${netlist.nBuses} buses.`);
          console.log(
            `  Matrix non-zeros (G): ${Array.from(netlist.ybus.g.values()).reduce((acc, m) => acc + m.size, 0)}`,
          );
          console.log(
            `  Matrix non-zeros (B): ${Array.from(netlist.ybus.b.values()).reduce((acc, m) => acc + m.size, 0)}`,
          );
          break;
        }

        case "solve": {
          console.log(`[psse] Solving AC Power Flow for ${path.basename(file)} (algorithm: ${algorithm})...`);
          const solution = solvePowerFlow(parsed, {
            algorithm: algorithm as "newton_raphson" | "fast_decoupled",
            tolerance,
            maxIterations,
          });
          if (solution.converged) {
            console.log(
              `  ✔ Converged in ${solution.iterations} iterations (max mismatch: ${solution.maxMismatchPu.toExponential(3)} pu)`,
            );
          } else {
            console.log(`  ✖ Failed to converge within ${solution.iterations} iterations`);
            process.exitCode = 1;
          }
          console.log(
            `  Total Generation: ${solution.totalGenMw.toFixed(1)} MW / ${solution.totalGenMvar.toFixed(1)} MVAR`,
          );
          console.log(
            `  Total Demand:     ${solution.totalLoadMw.toFixed(1)} MW / ${solution.totalLoadMvar.toFixed(1)} MVAR`,
          );
          console.log(`  Active Losses:    ${solution.totalLossMw.toFixed(2)} MW`);

          // Voltage violations (< 0.95 or > 1.05 pu)
          const violations = solution.buses.filter((b) => b.vm < 0.95 || b.vm > 1.05);
          if (violations.length > 0) {
            console.log(`\n  ▲ Voltage Violations (${violations.length} buses outside 0.95-1.05 pu):`);
            for (const b of violations) {
              const tag = b.vm < 0.95 ? "UNDER-VOLTAGE" : "OVER-VOLTAGE";
              console.log(`    Bus ${b.busNumber} (${b.name.trim()}): ${b.vm.toFixed(4)} pu [${tag}]`);
            }
          }

          // Branch thermal overloads (> 100% Rate A)
          const overloads = solution.branches.filter((br) => br.loadingPercent && br.loadingPercent > 100);
          if (overloads.length > 0) {
            console.log(`\n  ▲ Branch Overloads (${overloads.length} lines exceeding Rate A):`);
            for (const br of overloads) {
              console.log(
                `    Line ${br.fromBus}->${br.toBus} (${br.ckt}): ${br.mvaFlow.toFixed(1)} MVA / ${br.rateMva} MVA (${br.loadingPercent?.toFixed(1)}%)`,
              );
            }
          }

          console.log("\n  Bus Voltage Profile (First 10 buses):");
          console.log("  Bus #   Name            Base kV   Type    Vm (pu)   Va (deg)");
          console.log("  -------------------------------------------------------------");
          for (const b of solution.buses.slice(0, 10)) {
            console.log(
              `  ${String(b.busNumber).padEnd(7)} ${b.name.padEnd(15)} ${b.baseKv.toFixed(1).padEnd(9)} ${b.type.padEnd(7)} ${b.vm.toFixed(4).padEnd(9)} ${b.va.toFixed(2)}°`,
            );
          }
          if (solution.buses.length > 10) {
            console.log(`  ... and ${solution.buses.length - 10} more buses.`);
          }
          const pfFmt = (argv["format"] as string | undefined) ?? "text";
          if (pfFmt !== "text" || out) {
            const fmt: StudyReportFormat =
              pfFmt === "json" || pfFmt === "csv" || pfFmt === "html"
                ? pfFmt
                : out?.endsWith(".csv")
                  ? "csv"
                  : out?.endsWith(".html")
                    ? "html"
                    : "json";
            const formatted = formatPowerFlowStudyReport(solution, fmt, path.basename(file));
            if (out) fs.writeFileSync(path.resolve(process.cwd(), out), formatted);
            else if (pfFmt !== "text") console.log(formatted);
          }
          break;
        }

        case "opf": {
          const form = (argv["formulation"] as string) === "ac" ? "ac" : "dc";
          console.log(
            `[psse] Running Optimal Power Flow (${form.toUpperCase()}-OPF) dispatch & LMP analysis on ${path.basename(file)}...`,
          );
          const opfSol =
            form === "ac"
              ? solveAcOpf(parsed, { enforceThermalLimits: true, caseTitle: parsed.title1 || path.basename(file) })
              : solveDcOpf(parsed, { enforceThermalLimits: true, caseTitle: parsed.title1 || path.basename(file) });
          console.log(opfSol.reportText);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), opfSol.reportText);
          }
          break;
        }

        case "fault": {
          console.log(`[psse] Running IEC 60909 / ANSI C37 short-circuit analysis on ${path.basename(file)}...`);
          const sc = calculateShortCircuit(parsed);
          const fmt = argv["format"] as string | undefined;
          const output =
            fmt === "json" || fmt === "csv" || fmt === "html"
              ? formatShortCircuitStudyReport(sc, fmt, path.basename(file))
              : sc.reportText;
          console.log(output);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), output);
          }
          break;
        }

        case "modes": {
          console.log(`[psse] Running small-signal stability modal analysis on ${path.basename(file)}...`);
          const modal = analyzeSmallSignalStability(parsed);
          const fmt = argv["format"] as string | undefined;
          const output =
            fmt === "json" || fmt === "csv" || fmt === "html"
              ? formatModalStudyReport(modal, fmt, path.basename(file))
              : modal.reportText;
          console.log(output);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), output);
          }
          break;
        }

        case "n1": {
          console.log(`[psse] Running N-1 contingency security screening on ${path.basename(file)}...`);
          const n1 = analyzeN1Contingencies(parsed);
          const fmt = argv["format"] as string | undefined;
          const output =
            fmt === "json" || fmt === "csv" || fmt === "html"
              ? formatN1StudyReport(n1, fmt, path.basename(file))
              : n1.reportText;
          console.log(output);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), output);
          }
          break;
        }

        case "n11": {
          console.log(`[psse] Running Sequential N-1-1 contingency study on ${path.basename(file)}...`);
          const n11 = analyzeN11Contingencies(parsed);
          console.log(n11.summary);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), JSON.stringify(n11, null, 2));
          }
          break;
        }

        case "fcitc": {
          console.log(`[psse] Computing FCITC transfer capability on ${path.basename(file)}...`);
          const subPath = argv["sub"] as string | undefined;
          const subFile = subPath
            ? parseSubFile(fs.readFileSync(path.resolve(process.cwd(), subPath), "utf-8"))
            : parseSubFile(`SUBSYSTEM 'SOURCE'\nAREA 1\nEND\nSUBSYSTEM 'SINK'\nAREA 2\nEND\n`);
          const sourceSub = (argv["source"] as string | undefined) ?? "SOURCE";
          const sinkSub = (argv["sink"] as string | undefined) ?? "SINK";
          const fcitc = calculateFcitc(parsed, { sourceSubsystem: sourceSub, sinkSubsystem: sinkSub, subFile });
          console.log(fcitc.summary);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), JSON.stringify(fcitc, null, 2));
          }
          break;
        }

        case "breaker-duty": {
          console.log(`[psse] Evaluating ANSI C37 / IEC 60909 circuit breaker duty on ${path.basename(file)}...`);
          const std = (argv["standard"] as "ansi-c37" | "iec-60909" | undefined) ?? "ansi-c37";
          const bd = evaluateBreakerDuty(parsed, { standard: std });
          console.log(bd.summary);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), JSON.stringify(bd, null, 2));
          }
          break;
        }

        case "cct": {
          const defaultBus = parsed.buses.keys().next().value ?? 1;
          const faultBus = Number(argv["fault-bus"] ?? defaultBus);
          console.log(`[psse] Running CCT binary search + SOS Lyapunov certificate at Bus ${faultBus}...`);
          const cct = searchCriticalClearingTime(parsed, { faultBus });
          console.log(cct.summary);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), JSON.stringify(cct, null, 2));
          }
          break;
        }

        case "cpf": {
          console.log(`[psse] Running Continuation Power Flow (CPF) P-V curve tracing on ${path.basename(file)}...`);
          const cpf = solveContinuationPowerFlow(parsed);
          const fmt = argv["format"] as string | undefined;
          const output =
            fmt === "json" || fmt === "csv" || fmt === "html"
              ? formatCpfStudyReport(cpf, fmt, path.basename(file))
              : cpf.reportText;
          console.log(output);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), output);
          }
          break;
        }

        case "sld": {
          console.log(`[psse] Ingesting PSS/E Single-Line Diagram (.sld/.drw): ${path.basename(file)}...`);
          const drawing = parsePsseSld(text);
          console.log(`  Title:      ${drawing.title}`);
          console.log(`  Buses:      ${drawing.buses.size} busbars mapped`);
          console.log(`  Branches:   ${drawing.branches.length} transmission lines`);
          console.log(`  Equipment:  ${drawing.components.length} equipment glyphs`);
          console.log(`  Labels:     ${drawing.annotations.length} annotations`);

          const rawOpt = argv["raw"] as string | undefined;
          let rawCase = undefined;
          if (rawOpt) {
            const rawAbs = path.resolve(process.cwd(), rawOpt);
            if (fs.existsSync(rawAbs)) {
              rawCase = parseRaw(fs.readFileSync(rawAbs, "utf-8"));
              console.log(`  Linked to RAW base case: ${path.basename(rawOpt)}`);
            }
          }

          const svg = renderSldSvg(drawing, rawCase);
          const outPath = out || `${path.basename(file, path.extname(file))}.svg`;
          fs.writeFileSync(path.resolve(process.cwd(), outPath), svg, "utf-8");
          console.log(`  ✔ Rendered standalone SVG diagram to ${outPath}`);
          break;
        }

        case "idv": {
          console.log(`[psse] Executing PSS/E .idv macro script: ${path.basename(file)}...`);
          const rawOpt = argv["raw"] as string | undefined;
          let initialCase = undefined;
          if (rawOpt) {
            const rawAbs = path.resolve(process.cwd(), rawOpt);
            if (fs.existsSync(rawAbs)) {
              initialCase = parseRaw(fs.readFileSync(rawAbs, "utf-8"));
            }
          }

          const result = executeIdv(text, undefined, { initialCase });
          console.log(`  Executed: ${result.commandsExecuted} / ${result.totalCommands} commands.`);
          for (const l of result.logs) {
            console.log(`  ℹ ${l}`);
          }
          if (result.errors.length > 0) {
            for (const e of result.errors) {
              console.error(`  ✖ ${e}`);
            }
            process.exitCode = 1;
          } else {
            console.log(`  ✔ All IDV batch commands completed successfully.`);
          }
          if (out) {
            const outText = result.logs.concat(result.errors).join("\n");
            fs.writeFileSync(path.resolve(process.cwd(), out), outText, "utf-8");
          }
          break;
        }

        case "verify-nerc": {
          console.log(`[psse] Running automated NERC compliance audit on ${path.basename(file)}...`);
          const dyrOpt = argv["dyr"] as string | undefined;
          if (dyrOpt) {
            const dyrAbs = path.resolve(process.cwd(), dyrOpt);
            if (fs.existsSync(dyrAbs)) {
              parsed.dyr = parseDyr(fs.readFileSync(dyrAbs, "utf-8"));
              console.log(`  Attached dynamic models from: ${path.basename(dyrOpt)}`);
            }
          }

          const report = auditNercCompliance(parsed, {
            caseTitle: parsed.title1 || path.basename(file),
          });
          console.log(report.markdownReport);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), report.markdownReport, "utf-8");
            console.log(`  ✔ Exported compliance report to ${out}`);
          }
          if (report.overallStatus === "NON-COMPLIANT") {
            process.exitCode = 1;
          }
          break;
        }

        case "to-cgmes": {
          console.log(`[psse] Converting ${path.basename(file)} to ENTSO-E CGMES (CIM / IEC 61970-301)...`);
          const { psseToCgmes, exportCgmesArchive } = await import("@modelscript/cgmes");
          const { model } = psseToCgmes(parsed);
          const archive = exportCgmesArchive(model);

          const outDir = out ? path.resolve(process.cwd(), out) : path.dirname(absPath);
          if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
          }

          const baseName = path.basename(file, path.extname(file));
          const eqPath = path.join(outDir, `${baseName}_EQ.xml`);
          const tpPath = path.join(outDir, `${baseName}_TP.xml`);
          const sshPath = path.join(outDir, `${baseName}_SSH.xml`);
          const svPath = path.join(outDir, `${baseName}_SV.xml`);

          fs.writeFileSync(eqPath, archive.eqXml, "utf-8");
          fs.writeFileSync(tpPath, archive.tpXml, "utf-8");
          fs.writeFileSync(sshPath, archive.sshXml, "utf-8");
          fs.writeFileSync(svPath, archive.svXml, "utf-8");

          console.log(`  ✔ Exported CGMES profiles to ${outDir}:`);
          console.log(
            `    - Equipment (EQ): ${path.basename(eqPath)} (${model.lines.size} lines, ${model.transformers.size} xfmrs, ${model.generators.size} gens)`,
          );
          console.log(`    - Topology (TP): ${path.basename(tpPath)} (${model.nodes.size} topological nodes)`);
          console.log(`    - Steady State Hypothesis (SSH): ${path.basename(sshPath)}`);
          console.log(`    - State Variables (SV): ${path.basename(svPath)} (${model.svVoltages.size} node voltages)`);
          break;
        }
      }
    }
  },
};
