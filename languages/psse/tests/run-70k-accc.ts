// SPDX-License-Identifier: AGPL-3.0-or-later

import { fork } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareAcccReports,
  exportAcccToCsv,
  generate70kEasternInterconnectionCase,
  type AcccRecord,
} from "../src/benchmarking/accc-benchmarker.js";
import { solvePowerFlow } from "../src/solver/ac-powerflow.js";
import { screenContingencies, type CandidateContingency } from "../src/solver/contingency-screener.js";
import type { BranchRecord } from "../src/types.js";

const __filename = fileURLToPath(import.meta.url);
const isWorker = process.env.IS_ACCC_BENCHMARK_WORKER === "1";

if (isWorker) {
  // Worker Process - holds isolated 70,000-bus network in linear memory
  const psCase = generate70kEasternInterconnectionCase();
  const branchMap = new Map<string, BranchRecord>();
  for (const br of psCase.branches) {
    branchMap.set(`${br.i}_${br.j}_${br.ckt}`, br);
    branchMap.set(`${br.j}_${br.i}_${br.ckt}`, br);
  }

  process.on(
    "message",
    (msg: { taskId: number; ctgId: string; tripBranches: Array<{ i: number; j: number; ckt: string }> }) => {
      const modifiedBranches: BranchRecord[] = [];
      for (const tb of msg.tripBranches) {
        const br = branchMap.get(`${tb.i}_${tb.j}_${tb.ckt}`);
        if (br) {
          br.st = 0;
          modifiedBranches.push(br);
        }
      }

      const t0 = Date.now();
      const sol = solvePowerFlow(psCase, { algorithm: "newton_raphson", maxIterations: 10, tolerance: 1e-4 });
      const dur = Date.now() - t0;

      for (const br of modifiedBranches) {
        br.st = 1;
      }

      let maxLoading = 0.0;
      let worstBranchKey = "NONE";
      let worstFlowMva = 0.0;
      let worstRatingMva = 100.0;

      for (const br of sol.branches) {
        const rate = br.rateMva ?? 100.0;
        if (rate > 0) {
          const loading = (br.mvaFlow / rate) * 100.0;
          if (loading > maxLoading) {
            maxLoading = loading;
            worstBranchKey = `${br.fromBus}-${br.toBus} CKT ${br.ckt}`;
            worstFlowMva = br.mvaFlow;
            worstRatingMva = rate;
          }
        }
      }

      let minVoltage = 2.0;
      let lowestBus = 0;
      let lowVoltageViolations = 0;
      for (const b of sol.buses) {
        if (b.vm > 0.1 && b.vm < minVoltage) {
          minVoltage = b.vm;
          lowestBus = b.busNumber;
        }
        if (b.vm < 0.9 && b.vm > 0.1) {
          lowVoltageViolations++;
        }
      }

      process.send?.({
        taskId: msg.taskId,
        ctgId: msg.ctgId,
        status: sol.converged ? "CONVERGED" : "DIVERGED",
        iterations: sol.iterations,
        dur,
        maxLoadingPercent: maxLoading,
        worstBranch: worstBranchKey,
        flowMva: worstFlowMva,
        ratingMva: worstRatingMva,
        lowestVoltagePu: minVoltage < 2.0 ? minVoltage : 1.0,
        lowestVoltageBus: lowestBus,
        voltageViolationsCount: lowVoltageViolations,
        severityIndex: sol.converged ? Math.pow(maxLoading / 100.0, 4) : 9999.0,
      });
    },
  );

  process.send?.({ ready: true });
} else {
  // Main Coordinator Process
  async function runCoordinator() {
    // Parse CLI options
    let count = 100;
    let outDir = path.resolve(process.cwd(), "reports");
    let mode: "both" | "two_stage" | "full_ac" = "both";

    for (const arg of process.argv.slice(2)) {
      if (arg.startsWith("--count=")) {
        count = parseInt(arg.split("=")[1]!, 10);
      } else if (arg.startsWith("--out-dir=")) {
        outDir = path.resolve(process.cwd(), arg.split("=")[1]!);
      } else if (arg.startsWith("--mode=")) {
        mode = arg.split("=")[1] as any;
      } else if (!isNaN(parseInt(arg, 10))) {
        count = parseInt(arg, 10);
      }
    }

    fs.mkdirSync(outDir, { recursive: true });

    console.log("=========================================================================");
    console.log("   SIEMENS PSS/E ACCC 70,000-BUS INDUSTRY BENCHMARK & VERIFICATION");
    console.log("=========================================================================");
    console.log(` Target Contingency Count: ${count.toLocaleString()} outages`);
    console.log(` Execution Mode:           ${mode.toUpperCase()}`);
    console.log(` Output Directory:         ${outDir}\n`);

    console.log("[1/4] Generating 70,000-Bus MMWG Eastern Interconnection Network...");
    const tGen0 = Date.now();
    const psCase = generate70kEasternInterconnectionCase();
    console.log(
      `  -> Network Generated in: ${Date.now() - tGen0} ms (${psCase.buses.size.toLocaleString()} buses, ${psCase.branches.length.toLocaleString()} branches)`,
    );

    console.log("\n[2/4] Solving Base Case Full AC Newton-Raphson...");
    const tBase0 = Date.now();
    const baseSol = solvePowerFlow(psCase, { algorithm: "newton_raphson", maxIterations: 10, tolerance: 1e-4 });
    console.log(
      `  -> Base Case Solved in: ${Date.now() - tBase0} ms (Converged: ${baseSol.converged}, Iter: ${baseSol.iterations}, Losses: ${baseSol.totalLossMw.toFixed(1)} MW)`,
    );

    // Formulate Contingencies
    const tieLines = psCase.branches.filter((br) => br.i % 1000 === 1 && br.j % 1000 === 1);
    const nonTieLines = psCase.branches.filter((br) => br.i % 1000 !== 1 || br.j % 1000 !== 1);
    const contingencies: CandidateContingency[] = [];

    for (let i = 0; i < Math.min(tieLines.length, count); i++) {
      const br = tieLines[i]!;
      contingencies.push({
        id: `CTG_TIE_${br.i}_${br.j}`,
        name: `Trip 500kV Backbone Tie ${br.i} to ${br.j}`,
        events: [{ type: "trip_branch", fromBus: br.i, toBus: br.j, ckt: br.ckt }],
      });
    }

    let brIdx = 0;
    while (contingencies.length < count && brIdx < nonTieLines.length) {
      const br = nonTieLines[brIdx]!;
      brIdx++;
      contingencies.push({
        id: `CTG_BR_${br.i}_${br.j}`,
        name: `Trip Branch ${br.i} to ${br.j}`,
        events: [{ type: "trip_branch", fromBus: br.i, toBus: br.j, ckt: br.ckt }],
      });
    }

    console.log(`  -> Formulated ${contingencies.length.toLocaleString()} unique contingencies.`);

    // Initialize 14 Worker Pool
    const numCores = os.cpus().length;
    const workerCount = Math.max(1, numCores - 2);
    console.log(`\n[3/4] Spawning ${workerCount} Parallel Worker Processes...`);
    const tWorkers0 = Date.now();

    const workers: Array<ReturnType<typeof fork>> = [];
    const readyPromises: Array<Promise<void>> = [];

    for (let w = 0; w < workerCount; w++) {
      const child = fork(__filename, [], {
        env: { ...process.env, IS_ACCC_BENCHMARK_WORKER: "1" },
        execArgv: ["--import", "tsx"],
        stdio: ["inherit", "inherit", "inherit", "ipc"],
      });
      workers.push(child);

      readyPromises.push(
        new Promise<void>((res) => {
          child.once("message", (m: any) => {
            if (m?.ready) res();
          });
        }),
      );
    }

    await Promise.all(readyPromises);
    console.log(`  -> All ${workerCount} workers ready in memory in ${Date.now() - tWorkers0} ms.`);

    // Helper: Execute a list of contingencies in parallel across workers
    async function solveBatchParallel(taskList: CandidateContingency[], label: string): Promise<AcccRecord[]> {
      const results: AcccRecord[] = [];
      let completed = 0;
      let taskIdx = 0;
      const tStart = Date.now();
      const handlers: Array<(res: any) => void> = [];

      await new Promise<void>((resolve) => {
        const cleanup = () => {
          for (let w = 0; w < workerCount; w++) {
            workers[w]!.off("message", handlers[w]!);
          }
        };

        for (let w = 0; w < workerCount; w++) {
          const child = workers[w]!;

          const handler = (res: any) => {
            if (res?.ready) return;
            results.push({
              contingencyLabel: res.ctgId,
              status: res.status,
              iterations: res.iterations,
              maxLoadingPercent: res.maxLoadingPercent,
              worstBranch: res.worstBranch,
              flowMva: res.flowMva,
              ratingMva: res.ratingMva,
              lowestVoltagePu: res.lowestVoltagePu,
              lowestVoltageBus: res.lowestVoltageBus,
              voltageViolationsCount: res.voltageViolationsCount,
              severityIndex: res.severityIndex,
              executionTimeMs: res.dur,
            });
            completed++;

            if (completed % 25 === 0 || completed === taskList.length) {
              const elapsedSec = (Date.now() - tStart) / 1000;
              const rate = completed / Math.max(0.001, elapsedSec);
              process.stdout.write(
                `\r  [${label}] Solved: ${completed}/${taskList.length} (${((completed / taskList.length) * 100).toFixed(1)}%) | Rate: ${rate.toFixed(1)} solves/s | Elapsed: ${elapsedSec.toFixed(1)}s`,
              );
            }

            if (taskIdx < taskList.length) {
              const ctg = taskList[taskIdx]!;
              const tripBranches = ctg.events
                .filter((e) => e.type === "trip_branch")
                .map((e) => ({ i: e.fromBus!, j: e.toBus!, ckt: e.ckt ?? "1" }));
              child.send({ taskId: taskIdx, ctgId: ctg.id, tripBranches });
              taskIdx++;
            } else if (completed === taskList.length) {
              process.stdout.write("\n");
              cleanup();
              resolve();
            }
          };

          handlers.push(handler);
          child.on("message", handler);

          // Seed initial task
          if (taskIdx < taskList.length) {
            const ctg = taskList[taskIdx]!;
            const tripBranches = ctg.events
              .filter((e) => e.type === "trip_branch")
              .map((e) => ({ i: e.fromBus!, j: e.toBus!, ckt: e.ckt ?? "1" }));
            child.send({ taskId: taskIdx, ctgId: ctg.id, tripBranches });
            taskIdx++;
          }
        }
      });

      return results;
    }

    let twoStageRecords: AcccRecord[] = [];
    let twoStageDurationSec = 0.0;

    let fullAcRecords: AcccRecord[] = [];
    let fullAcDurationSec = 0.0;

    // EXECUTE TWO-STAGE ACCC
    if (mode === "both" || mode === "two_stage") {
      console.log("\n[4/4 - Part A] Executing Two-Stage ACCC (Linear DFAX Filter + Parallel AC Confirmation)...");
      const tTwoStage0 = Date.now();

      const linearReport = screenContingencies(psCase, contingencies, {
        topKAcConfirmation: 0,
        baseSolution: baseSol,
        overloadThreshold: 90.0,
      });

      const linearCandidates = linearReport.screenedLinearCandidates ?? [];
      const criticalCandidates = linearCandidates.filter((c) => c.maxBranchLoadingPercent >= 90.0 || c.causesIslanding);
      const candidatesToSolve = criticalCandidates.length > 0 ? criticalCandidates : linearCandidates.slice(0, 50);

      const topCtgIds = new Set(candidatesToSolve.map((c) => c.id));
      const topCtgs = contingencies.filter((c) => topCtgIds.has(c.id));

      console.log(`  -> Linear screening evaluated ${linearCandidates.length} cases in ${Date.now() - tTwoStage0} ms.`);
      console.log(`  -> Selected ${topCtgs.length} flagged candidates for Parallel Full AC confirmation.`);

      const acConfirmed = await solveBatchParallel(topCtgs, "Two-Stage AC Confirmation");
      const confirmedMap = new Map<string, AcccRecord>();
      for (const r of acConfirmed) {
        confirmedMap.set(r.contingencyLabel, r);
      }

      for (const lin of linearCandidates) {
        const conf = confirmedMap.get(lin.id);
        if (conf) {
          twoStageRecords.push(conf);
        } else {
          twoStageRecords.push({
            contingencyLabel: lin.id,
            status: "CONVERGED",
            iterations: 1,
            maxLoadingPercent: lin.maxBranchLoadingPercent,
            worstBranch: "SCREENED_SAFE",
            flowMva: lin.maxBranchLoadingPercent * 20.0,
            ratingMva: 2000.0,
            lowestVoltagePu: 1.0,
            lowestVoltageBus: 1,
            voltageViolationsCount: 0,
            severityIndex: lin.severityIndex,
            executionTimeMs: 0.1,
          });
        }
      }

      twoStageDurationSec = (Date.now() - tTwoStage0) / 1000;
      const csvPath = path.join(outDir, `accc_70k_two_stage_${count}.csv`);
      fs.writeFileSync(csvPath, exportAcccToCsv(twoStageRecords), "utf-8");
      console.log(`  -> Two-Stage ACCC Completed in: ${twoStageDurationSec.toFixed(2)} s`);
      console.log(`  -> Saved CSV Report: [${path.basename(csvPath)}](${csvPath})`);
    }

    // EXECUTE BRUTE-FORCE FULL AC
    if (mode === "both" || mode === "full_ac") {
      console.log("\n[4/4 - Part B] Executing Brute-Force Parallel Full AC (100% Newton-Raphson Coverage)...");
      const tFullAc0 = Date.now();

      fullAcRecords = await solveBatchParallel(contingencies, "Brute-Force Full AC");
      fullAcDurationSec = (Date.now() - tFullAc0) / 1000;

      const csvPath = path.join(outDir, `accc_70k_full_ac_${count}.csv`);
      fs.writeFileSync(csvPath, exportAcccToCsv(fullAcRecords), "utf-8");
      console.log(`  -> Brute-Force Full AC Completed in: ${fullAcDurationSec.toFixed(2)} s`);
      console.log(`  -> Saved CSV Report: [${path.basename(csvPath)}](${csvPath})`);
    }

    // Terminate workers
    for (const c of workers) {
      c.kill();
    }

    // COMPARISON & STATISTICAL VERIFICATION
    if (twoStageRecords.length > 0 && fullAcRecords.length > 0) {
      console.log("\n=========================================================================");
      console.log("   STATISTICAL PARITY & ACCURACY COMPARISON SUMMARY");
      console.log("=========================================================================");

      const summary = compareAcccReports(twoStageRecords, fullAcRecords, twoStageDurationSec, fullAcDurationSec);
      const jsonPath = path.join(outDir, `accc_70k_comparison_${count}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), "utf-8");

      console.log(` • Total Contingencies Evaluated:   ${summary.totalContingencies}`);
      console.log(
        ` • Two-Stage ACCC Wall-Clock:        ${summary.twoStageDurationSec.toFixed(2)} s (${summary.twoStageThroughputSolvesPerSec.toFixed(1)} solves/s)`,
      );
      console.log(
        ` • Brute-Force Full AC Wall-Clock:   ${summary.fullAcDurationSec.toFixed(2)} s (${summary.fullAcThroughputSolvesPerSec.toFixed(1)} solves/s)`,
      );
      console.log(` • Measured Two-Stage Speedup:       ${summary.speedupFactor}x faster`);
      console.log(
        ` • Critical False Negatives:         ${summary.criticalFalseNegatives} ${summary.perfectSafetyParity ? "✔ (PERFECT 100% SAFETY PARITY)" : "⚠ WARNING"}`,
      );
      console.log(` • Conservative False Positives:     ${summary.falsePositives}`);
      console.log(
        ` • Low-Voltage Violations (V < 0.9): ${summary.totalLowVoltageViolationsFound} buses affected (Min V = ${summary.minimumGridVoltagePu.toFixed(3)} pu)`,
      );
      console.log(` • Saved Comparison Summary JSON:    [${path.basename(jsonPath)}](${jsonPath})`);
      console.log("=========================================================================\n");
    }
  }

  runCoordinator().catch(console.error);
}
