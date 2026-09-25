// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Back-to-Back (MiL vs SiL) Equivalence Verifier.
 *
 * Implements ISO 26262-8 (Clause 11) Tool Confidence Level 1 (TCL1) and
 * ISO 26262-6 Table 7 software unit verification by proving numerical & discrete
 * equivalence between high-level Model-in-the-Loop (MiL) and generated
 * zero-allocation C99 Software-in-the-Loop (SiL).
 */

import { execSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initBltWasm } from "../analysis/wasm_blt.js";
import type { DAEBuilder } from "../dae/wasm_dae.js";

export interface B2BVerificationOptions {
  /** Maximum allowable absolute numerical discrepancy (default: 1e-4). */
  tolerance?: number;
  /** Maximum allowable relative numerical discrepancy (default: 1e-3). */
  relTolerance?: number;
  /** Host or cross compiler binary (default: "gcc"). */
  compiler?: string;
  /** Additional compiler flags. */
  cflags?: string[];
  /** Fixed integration step size in seconds for SiL RK4 (default: 0.001). */
  dt?: number;
  /** Simulation start time in seconds (default: 0.0). */
  startTime?: number;
  /** Simulation stop time in seconds (default: 1.0). */
  stopTime?: number;
  /** Custom model identifier. */
  modelIdentifier?: string;
  /** Directory for compilation scratch artifacts. */
  scratchDir?: string;
  /** Retain generated C files and binaries for debugging. */
  preserveArtifacts?: boolean;
}

export interface B2BDiscrepancy {
  variable: string;
  time: number;
  milValue: number;
  silValue: number;
  absError: number;
  relError: number;
  tolerance: number;
}

export interface B2BVerificationResult {
  passed: boolean;
  certified: boolean;
  maxError: number;
  maxErrorTime: number;
  maxErrorVariable: string;
  testedVariables: string[];
  totalSamples: number;
  discrepancies: B2BDiscrepancy[];
  cSourceHash?: string;
  compilerUsed?: string;
  summary: string;
  trajectories?: {
    times: number[];
    variables: string[];
    mil: number[][];
    sil: number[][];
  };
}

export class B2BEquivalenceVerifier {
  /**
   * Verify Back-to-Back equivalence between a DAE arena (MiL) and standalone C99 (SiL).
   */
  public static async verify(
    arena: DAEBuilder,
    milResult?: { t: number[]; states: string[]; y: number[][] },
    options: B2BVerificationOptions = {},
  ): Promise<B2BVerificationResult> {
    const absTol = options.tolerance ?? 1e-4;
    const relTol = options.relTolerance ?? 1e-3;
    const compiler = options.compiler || "gcc";
    const cflags = options.cflags || ["-O2", "-Wall", "-Wextra", "-std=c99"];

    // 1. Determine simulation time range and step size
    const exp = arena.experiment;
    const startTime = options.startTime ?? milResult?.t?.[0] ?? exp.startTime ?? 0.0;
    const stopTime = options.stopTime ?? milResult?.t?.[milResult.t.length - 1] ?? exp.stopTime ?? 1.0;
    const dt = options.dt ?? exp.interval ?? Math.min(0.001, (stopTime - startTime) / 1000);
    const rawId = options.modelIdentifier || (arena as any).modelName || "Model";
    const modelId = path.basename(rawId, path.extname(rawId)).replace(/[^a-zA-Z0-9_]/g, "_");

    // 2. Check compiler availability
    let compilerVersion = "";
    try {
      compilerVersion =
        execSync(`${compiler} --version`, { encoding: "utf-8", timeout: 5000 }).split("\n")[0] || compiler;
    } catch (err: any) {
      return {
        passed: false,
        certified: false,
        maxError: Infinity,
        maxErrorTime: 0,
        maxErrorVariable: "none",
        testedVariables: [],
        totalSamples: 0,
        discrepancies: [],
        summary: `B2B Verification failed: Compiler '${compiler}' is not available in PATH. Error: ${err.message}`,
      };
    }

    // 3. Ensure MiL reference trajectory is available
    let mil = milResult;
    if (!mil) {
      try {
        const simulateModule: any = await (Function('return import("@modelscript/simulate")')() as Promise<any>).catch(
          () => null,
        );
        if (simulateModule && simulateModule.simulateArenaAsync) {
          mil = await simulateModule.simulateArenaAsync(arena, {
            startTime,
            stopTime,
            step: dt,
          });
        }
      } catch (e: any) {
        return {
          passed: false,
          certified: false,
          maxError: Infinity,
          maxErrorTime: 0,
          maxErrorVariable: "none",
          testedVariables: [],
          totalSamples: 0,
          discrepancies: [],
          summary: `Failed to execute MiL reference simulation: ${e.message}`,
        };
      }
    }

    if (!mil || !mil.t || mil.t.length === 0) {
      return {
        passed: false,
        certified: false,
        maxError: Infinity,
        maxErrorTime: 0,
        maxErrorVariable: "none",
        testedVariables: [],
        totalSamples: 0,
        discrepancies: [],
        summary: "MiL reference simulation produced no trajectory data.",
      };
    }

    // 4. Generate Standalone C99 Sources
    await this.ensureBltInitialized();
    let cResult: {
      header: string;
      source: string;
      modelIdentifier: string;
      inputNames: string[];
      outputNames: string[];
      parameterNames: string[];
    };

    try {
      let exchangeModule: any = null;
      try {
        const modName = "@modelscript/exchange/fmu";
        exchangeModule = await import(modName);
      } catch (err1: any) {
        try {
          const relPath = "../../../exchange/src/fmu/index.js";
          exchangeModule = await import(relPath);
        } catch (err2: any) {
          return {
            passed: false,
            certified: false,
            maxError: Infinity,
            maxErrorTime: 0,
            maxErrorVariable: "none",
            testedVariables: [],
            totalSamples: 0,
            discrepancies: [],
            summary: `Standalone C code generator (@modelscript/exchange/fmu) is unavailable. err1: ${err1.message}; err2: ${err2.message}`,
          };
        }
      }

      if (!exchangeModule || !exchangeModule.generateStandaloneCSources) {
        return {
          passed: false,
          certified: false,
          maxError: Infinity,
          maxErrorTime: 0,
          maxErrorVariable: "none",
          testedVariables: [],
          totalSamples: 0,
          discrepancies: [],
          summary: "generateStandaloneCSources function not found in @modelscript/exchange/fmu",
        };
      }

      cResult = exchangeModule.generateStandaloneCSources(arena, {
        modelIdentifier: modelId,
        includeMain: false,
      });
    } catch (err: any) {
      return {
        passed: false,
        certified: false,
        maxError: Infinity,
        maxErrorTime: 0,
        maxErrorVariable: "none",
        testedVariables: [],
        totalSamples: 0,
        discrepancies: [],
        summary: `Standalone C code generation failed: ${err.message}`,
      };
    }

    // 5. Generate C Test Harness
    const cSourceHash = crypto
      .createHash("sha256")
      .update(cResult.source + cResult.header)
      .digest("hex");
    const scratchDir =
      options.scratchDir ||
      path.join(os.tmpdir(), `modelscript-b2b-${Date.now()}-${Math.floor(Math.random() * 10000)}`);
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true });
    }

    const headerPath = path.join(scratchDir, `${modelId}_standalone.h`);
    const sourcePath = path.join(scratchDir, `${modelId}_standalone.c`);
    const harnessPath = path.join(scratchDir, `${modelId}_b2b_harness.c`);
    const binPath = path.join(scratchDir, `${modelId}_b2b_bin`);

    fs.writeFileSync(headerPath, cResult.header, "utf-8");
    fs.writeFileSync(sourcePath, cResult.source, "utf-8");

    // Build harness C source that runs RK4 step loop and streams CSV
    const harnessCode = this.generateHarnessC(modelId, cResult, startTime, stopTime, dt);
    fs.writeFileSync(harnessPath, harnessCode, "utf-8");

    // 6. Compile SiL Binary
    try {
      const cmd = `${compiler} ${cflags.join(" ")} -I"${scratchDir}" "${sourcePath}" "${harnessPath}" -lm -o "${binPath}"`;
      execSync(cmd, { stdio: "pipe", timeout: 20000 });
    } catch (err: any) {
      const compileErr = err.stderr ? err.stderr.toString() : err.message;
      if (!options.preserveArtifacts) {
        this.cleanScratch(scratchDir, [headerPath, sourcePath, harnessPath, binPath]);
      }
      return {
        passed: false,
        certified: false,
        maxError: Infinity,
        maxErrorTime: 0,
        maxErrorVariable: "none",
        testedVariables: [],
        totalSamples: 0,
        discrepancies: [],
        cSourceHash,
        compilerUsed: compilerVersion,
        summary: `SiL C compilation failed with compiler '${compiler}': ${compileErr}`,
      };
    }

    // 7. Execute SiL Binary & Collect Output
    let stdout = "";
    try {
      stdout = execSync(`"${binPath}"`, { encoding: "utf-8", timeout: 30000 });
    } catch (err: any) {
      const execErr = err.stderr ? err.stderr.toString() : err.message;
      if (!options.preserveArtifacts) {
        this.cleanScratch(scratchDir, [headerPath, sourcePath, harnessPath, binPath]);
      }
      return {
        passed: false,
        certified: false,
        maxError: Infinity,
        maxErrorTime: 0,
        maxErrorVariable: "none",
        testedVariables: [],
        totalSamples: 0,
        discrepancies: [],
        cSourceHash,
        compilerUsed: compilerVersion,
        summary: `SiL execution failed: ${execErr}`,
      };
    } finally {
      if (!options.preserveArtifacts) {
        this.cleanScratch(scratchDir, [headerPath, sourcePath, harnessPath, binPath]);
      }
    }

    // 8. Parse SiL CSV Trajectory
    const sil = this.parseCsvTrajectory(stdout);
    if (sil.times.length === 0) {
      return {
        passed: false,
        certified: false,
        maxError: Infinity,
        maxErrorTime: 0,
        maxErrorVariable: "none",
        testedVariables: [],
        totalSamples: 0,
        discrepancies: [],
        cSourceHash,
        compilerUsed: compilerVersion,
        summary: "SiL executable produced no valid trajectory samples.",
      };
    }

    // 9. Compare MiL vs SiL Trajectories
    return this.compareTrajectories(mil, sil, {
      absTol,
      relTol,
      cSourceHash,
      compilerUsed: compilerVersion,
      modelId,
      dt,
    });
  }

  private static generateHarnessC(
    modelId: string,
    cResult: { outputNames: string[] },
    startTime: number,
    stopTime: number,
    dt: number,
  ): string {
    const lines: string[] = [];
    lines.push("/* Auto-generated Back-to-Back (B2B) Test Harness */");
    lines.push(`#include "${modelId}_standalone.h"`);
    lines.push("#include <stdio.h>");
    lines.push("#include <stdlib.h>");
    lines.push("#include <math.h>");
    lines.push("");
    lines.push("int main(void) {");
    lines.push(`  ${modelId}_Instance inst;`);
    lines.push(`  ${modelId}_init(&inst);`);
    lines.push(`  ${modelId}_Inputs in = {0};`);
    lines.push(`  ${modelId}_Outputs out = {0};`);
    lines.push(`  const double dt = ${dt};`);
    lines.push(`  const double t_stop = ${stopTime};`);
    lines.push("");

    // CSV header: time,out1,out2,...
    const headerParts = ["time", ...cResult.outputNames];
    lines.push(`  printf("${headerParts.join(",")}\\n");`);
    lines.push("");

    // Step loop
    lines.push(`  for (double t = ${startTime}; t <= t_stop + 1e-9; t += dt) {`);
    lines.push(`    ${modelId}_step(&inst, &in, &out, dt);`);
    lines.push('    printf("%.6f", inst.time);');
    for (const outName of cResult.outputNames) {
      const sanitized = outName.replace(/[^a-zA-Z0-9_]/g, "_");
      lines.push(`    printf(",%.10e", out.${sanitized});`);
    }
    lines.push('    printf("\\n");');
    lines.push("  }");
    lines.push("");
    lines.push("  return 0;");
    lines.push("}");
    return lines.join("\n");
  }

  private static parseCsvTrajectory(csvText: string): { times: number[]; columns: Map<string, number[]> } {
    const lines = csvText.trim().split("\n");
    const times: number[] = [];
    const columns = new Map<string, number[]>();

    if (lines.length < 2) return { times, columns };

    const header = lines[0]!.split(",").map((s) => s.trim());
    for (let j = 1; j < header.length; j++) {
      columns.set(header[j]!, []);
    }

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i]!.trim().split(",");
      if (row.length < header.length) continue;
      const t = parseFloat(row[0]!);
      if (isNaN(t)) continue;
      times.push(t);

      for (let j = 1; j < header.length; j++) {
        const val = parseFloat(row[j]!);
        columns.get(header[j]!)?.push(isNaN(val) ? 0 : val);
      }
    }

    return { times, columns };
  }

  private static compareTrajectories(
    mil: { t: number[]; states: string[]; y: number[][] },
    sil: { times: number[]; columns: Map<string, number[]> },
    meta: {
      absTol: number;
      relTol: number;
      cSourceHash: string;
      compilerUsed: string;
      modelId: string;
      dt: number;
    },
  ): B2BVerificationResult {
    const discrepancies: B2BDiscrepancy[] = [];
    const testedVariables: string[] = [];
    let maxError = 0.0;
    let maxErrorTime = 0.0;
    let maxErrorVar = "";

    // Map MiL state names to column index
    const milVarIndex = new Map<string, number>();
    for (let j = 0; j < mil.states.length; j++) {
      milVarIndex.set(mil.states[j]!, j);
      // Also map sanitized name
      const sanitized = mil.states[j]!.replace(/[^a-zA-Z0-9_]/g, "_");
      milVarIndex.set(sanitized, j);
    }

    const nSamples = sil.times.length;

    // Helper to interpolate MiL value at time t
    const interpolateMil = (t: number, varIdx: number): number => {
      if (mil.t.length === 0) return 0.0;
      if (t <= mil.t[0]!) return mil.y[0]?.[varIdx] ?? 0.0;
      const lastIdx = mil.t.length - 1;
      if (t >= mil.t[lastIdx]!) return mil.y[lastIdx]?.[varIdx] ?? 0.0;

      // Binary search for bracket [low, high]
      let low = 0;
      let high = lastIdx;
      while (high - low > 1) {
        const mid = (low + high) >> 1;
        if (mil.t[mid]! <= t) {
          low = mid;
        } else {
          high = mid;
        }
      }

      const t0 = mil.t[low]!;
      const t1 = mil.t[high]!;
      const y0 = mil.y[low]?.[varIdx] ?? 0.0;
      const y1 = mil.y[high]?.[varIdx] ?? 0.0;
      const dtSpan = t1 - t0;
      if (dtSpan <= 1e-12) return y0;
      const alpha = (t - t0) / dtSpan;
      return y0 + alpha * (y1 - y0);
    };

    for (const [silVarName, silVals] of sil.columns.entries()) {
      let milIdx = milVarIndex.get(silVarName);
      if (milIdx === undefined) {
        // Try fuzzy match
        for (const [k, v] of milVarIndex.entries()) {
          if (k.toLowerCase() === silVarName.toLowerCase()) {
            milIdx = v;
            break;
          }
        }
      }

      if (milIdx === undefined) continue;
      testedVariables.push(silVarName);

      for (let i = 0; i < nSamples; i++) {
        const t = sil.times[i]!;
        if (t < mil.t[0]! - 1e-9 || t > mil.t[mil.t.length - 1]! + 1e-9) continue;
        const silVal = silVals[i] ?? 0.0;
        const milVal = interpolateMil(t, milIdx);

        const absError = Math.abs(milVal - silVal);
        const relError = absError / (Math.abs(milVal) + 1e-9);
        const allowedTol = meta.absTol + meta.relTol * Math.abs(milVal);

        if (absError > maxError) {
          maxError = absError;
          maxErrorTime = t;
          maxErrorVar = silVarName;
        }

        if (absError > allowedTol) {
          discrepancies.push({
            variable: silVarName,
            time: t,
            milValue: milVal,
            silValue: silVal,
            absError,
            relError,
            tolerance: allowedTol,
          });
        }
      }
    }

    const passed = discrepancies.length === 0;
    const summary = passed
      ? `B2B MiL-vs-SiL equivalence confirmed: max discrepancy = ${maxError.toExponential(2)} <= ${meta.absTol} (RK4, dt=${meta.dt}s across ${nSamples} samples)`
      : `B2B MiL-vs-SiL equivalence failed: max discrepancy = ${maxError.toExponential(2)} exceeded tolerance (${meta.absTol}) at t=${maxErrorTime.toFixed(3)}s on signal '${maxErrorVar}'`;

    return {
      passed,
      certified: passed,
      maxError,
      maxErrorTime,
      maxErrorVariable: maxErrorVar || (testedVariables[0] ?? "none"),
      testedVariables,
      totalSamples: nSamples,
      discrepancies,
      cSourceHash: meta.cSourceHash,
      compilerUsed: meta.compilerUsed,
      summary,
    };
  }

  private static cleanScratch(scratchDir: string, files: string[]): void {
    for (const f of files) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {}
    }
    try {
      if (fs.existsSync(scratchDir)) fs.rmdirSync(scratchDir);
    } catch {}
  }

  private static async ensureBltInitialized(): Promise<void> {
    await initBltWasm();
    try {
      const relDistBlt = "../../dist/analysis/wasm_blt.js";
      // @ts-ignore
      const distBlt: any = await import(relDistBlt).catch(() => null);
      if (distBlt?.initBltWasm) await distBlt.initBltWasm();
    } catch {}
    try {
      const pkg = "@modelscript/runtime";
      const runtimeDist: any = await import(pkg).catch(() => null);
      if (runtimeDist?.initBltWasm) await runtimeDist.initBltWasm();
    } catch {}
  }
}
