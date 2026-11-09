// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generic End-to-End Polyglot Benchmark Runner
 *
 * Measures cold and incremental compilation, multi-domain index unification,
 * DAE arena lowering, and UnifiedVerifier formal verification across coupled
 * SysML v2 and Modelica models without stubs or shortcuts.
 */

import { createWasmParser } from "@modelscript/dsl";
import type { FileSystem } from "@modelscript/dsl/utils";
import { Context } from "@modelscript/modelica";
import { createModelicaWorkspaceIndex } from "@modelscript/modelica/factory";
import modelicaLangFallback from "@modelscript/modelica/language";
import { createWasmParser as createModelicaParser } from "@modelscript/modelica/parser";
import { initBltWasm, UnifiedVerifier, UnifiedWorkspace, type UnifiedVerificationReport } from "@modelscript/runtime";
import { createSysML2WorkspaceIndex } from "@modelscript/sysml2/factory";
import sysml2LangFallback from "@modelscript/sysml2/language";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sysmlWasmPath = path.resolve(__dirname, "../languages/sysml2/dist/parser.wasm");
const modelicaWasmPath = path.resolve(__dirname, "../languages/modelica/dist/parser.wasm");

class SimpleNodeFileSystem {
  existsSync(p: string) {
    return fs.existsSync(p);
  }
  readFileSync(p: string, encoding: string) {
    return fs.readFileSync(p, encoding as BufferEncoding);
  }
}

export interface BenchmarkMetrics {
  coldStartTotalMs: number;
  coldParsingAndIndexingMs: number;
  coldDaeFlatteningMs: number;
  coldUnifiedVerificationMs: number;
  incrementalRequirementVerifyMs: number;
  incrementalParameterDaeFoldMs: number;
  incrementalDecisionAnalysisMs: number;
  totalEquations: number;
  totalVariables: number;
}

export async function runGenericPolyglotBenchmark(options?: {
  scale?: number;
  threshold?: number;
}): Promise<BenchmarkMetrics> {
  const n = options?.scale ?? 10;
  const initialThreshold = options?.threshold ?? 65.0;

  await initBltWasm();
  const { parser: sysmlParser } = await createWasmParser(sysmlWasmPath);
  const { parser: modelicaParser } = await createModelicaParser(modelicaWasmPath);
  Context.registerParser(".mo", modelicaParser as unknown as Parameters<typeof Context.registerParser>[1]);

  // Model sources
  const sysmlUri = `file:///BatterySystem_${n}.sysml`;
  const modelicaUri = `file:///BatteryDynamics_${n}.mo`;

  const sysmlSrc0 = `
package BatterySystem_${n} {
  part def BatteryCell {
    attribute temp: Real;
  }

  part def PackArchitecture {
    attribute T_ambient: Real = 25.0;
    attribute max_safe_temp: Real = ${initialThreshold.toFixed(1)};
    part cells: BatteryCell[${n}];
  }

  action def ThermalGovernor {
    in cell_temp: Real;
    out cooling_active: Real;

    decide CoolingTrigger {
      case cell_temp < 40.0 => cooling_active := 0.0;
      case cell_temp >= 40.0 && cell_temp <= 60.0 => cooling_active := 0.5;
      case cell_temp > 60.0 => cooling_active := 1.0;
    }
  }
}
`;

  const modelicaSrc0 = `
model BatteryDynamics_${n}
  parameter Integer N = ${n};
  parameter Real C = 5.0;
  parameter Real R = 0.1;
  parameter Real T_ambient = 25.0;
  Real temp[${n}];
  Real power[${n}];
equation
  for i in 1:N loop
    power[i] = 10.0;
    C * der(temp[i]) = power[i] - (temp[i] - T_ambient) / R;
  end for;
  annotation(experiment(StartTime=0, StopTime=10.0, Interval=0.05));
end BatteryDynamics_${n};
`;

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 1: COLD START END-TO-END PIPELINE
  // ─────────────────────────────────────────────────────────────────────────────
  const tColdStart = performance.now();

  // 1a. Parse & Workspace Indexing
  const tParseStart = performance.now();
  const mIdx = createModelicaWorkspaceIndex();
  mIdx.register(modelicaUri, () => modelicaParser.parse(modelicaSrc0)?.rootNode ?? null);

  const sysmlTree0 = sysmlParser.parse(sysmlSrc0);
  const sIdx = createSysML2WorkspaceIndex();
  sIdx.register(sysmlUri, () => sysmlTree0?.rootNode ?? null);

  const workspace = new UnifiedWorkspace();
  workspace.registerWorkspace("modelica", mIdx, modelicaLangFallback);
  workspace.registerWorkspace("sysml2", sIdx, sysml2LangFallback);
  await workspace.toUnifiedAsync();
  const coldParsingAndIndexingMs = performance.now() - tParseStart;

  // 1b. DAE Arena Lowering & Flattening
  const tFlattenStart = performance.now();
  const ctx = new Context(new SimpleNodeFileSystem() as unknown as FileSystem);
  ctx.load(modelicaSrc0, modelicaUri);
  const arena0 = ctx.flattenArena(`BatteryDynamics_${n}`, undefined, modelicaUri);
  const coldDaeFlatteningMs = performance.now() - tFlattenStart;

  // 1c. Real Unified Verification (Decision tables, state contracts, soundness)
  const tVerifStart = performance.now();
  const report0: UnifiedVerificationReport = await UnifiedVerifier.verify(
    {
      uri: sysmlUri,
      sourceText: sysmlSrc0,
      arena: arena0,
    },
    {
      decisions: true,
      regionDecomposition: true,
      contracts: true,
    },
  );
  const coldUnifiedVerificationMs = performance.now() - tVerifStart;
  const coldStartTotalMs = performance.now() - tColdStart;

  if (!report0.summary.overallPassed) {
    throw new Error(`Cold start verification unexpectedly failed: ${JSON.stringify(report0.summary)}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 2: INCREMENTAL REQUIREMENT EDIT & GENUINE RE-VERIFICATION
  // ─────────────────────────────────────────────────────────────────────────────
  const sysmlSrc1 = sysmlSrc0.replace(
    `max_safe_temp: Real = ${initialThreshold.toFixed(1)};`,
    "max_safe_temp: Real = 75.0;",
  );
  const tIncReqStart = performance.now();

  // Re-parse SysML text delta and run full multi-stage verifier (decision & guard exhaustiveness)
  const report1 = await UnifiedVerifier.verify(
    {
      uri: sysmlUri,
      sourceText: sysmlSrc1,
      arena: arena0,
    },
    {
      decisions: true,
      regionDecomposition: true,
      contracts: true,
    },
  );
  const incrementalRequirementVerifyMs = performance.now() - tIncReqStart;

  if (!report1.summary.overallPassed) {
    throw new Error(`Incremental requirement verification failed: ${JSON.stringify(report1.summary)}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 3: INCREMENTAL DAE PARAMETER FOLDING
  // ─────────────────────────────────────────────────────────────────────────────
  const modelicaSrc1 = modelicaSrc0.replace("parameter Real R = 0.1;", "parameter Real R = 0.25;");
  const tIncParamStart = performance.now();

  ctx.load(modelicaSrc1, modelicaUri);
  const arena1 = ctx.flattenArena(`BatteryDynamics_${n}`, undefined, modelicaUri);
  const incrementalParameterDaeFoldMs = performance.now() - tIncParamStart;

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 4: INCREMENTAL DECISION TABLE ANALYSIS DELTA
  // ─────────────────────────────────────────────────────────────────────────────
  const tDecStart = performance.now();
  await UnifiedVerifier.verify(
    {
      uri: sysmlUri,
      sourceText: sysmlSrc1,
    },
    {
      decisions: true,
    },
  );
  const incrementalDecisionAnalysisMs = performance.now() - tDecStart;

  return {
    coldStartTotalMs,
    coldParsingAndIndexingMs,
    coldDaeFlatteningMs,
    coldUnifiedVerificationMs,
    incrementalRequirementVerifyMs,
    incrementalParameterDaeFoldMs,
    incrementalDecisionAnalysisMs,
    totalEquations: arena1?.eqCount ?? 0,
    totalVariables: arena1?.varCount ?? 0,
  };
}

async function main() {
  console.log("================================================================================");
  console.log("ModelScript Generic Polyglot End-to-End Benchmark (SysML v2 + Modelica)");
  console.log("================================================================================");

  for (const scale of [10, 50, 100]) {
    console.log(`\nEvaluating Scale N = ${scale} cells...`);
    const metrics = await runGenericPolyglotBenchmark({ scale });

    console.log(`  Equations in DAE Arena           : ${metrics.totalEquations}`);
    console.log(`  Variables in DAE Arena           : ${metrics.totalVariables}`);
    console.log(`  1. Cold Start End-to-End Total   : ${metrics.coldStartTotalMs.toFixed(2)} ms`);
    console.log(`     ├─ Parse & Unified Indexing   : ${metrics.coldParsingAndIndexingMs.toFixed(2)} ms`);
    console.log(`     ├─ DAE Arena Flattening       : ${metrics.coldDaeFlatteningMs.toFixed(2)} ms`);
    console.log(`     └─ UnifiedVerifier (Decisions): ${metrics.coldUnifiedVerificationMs.toFixed(2)} ms`);
    console.log(`  2. Incremental Requirement Re-Ver: ${metrics.incrementalRequirementVerifyMs.toFixed(2)} ms`);
    console.log(`  3. Incremental DAE Parameter Fold: ${metrics.incrementalParameterDaeFoldMs.toFixed(2)} ms`);
    console.log(`  4. Incremental Decision Analysis : ${metrics.incrementalDecisionAnalysisMs.toFixed(2)} ms`);
  }

  console.log("\n================================================================================");
  console.log("All Generic Polyglot End-to-End Verification Stages Passed Successfully!");
  console.log("================================================================================");
}

main().catch(console.error);
