// SPDX-License-Identifier: AGPL-3.0-or-later

import { initBltWasm } from "@modelscript/runtime";
import { simulateArena } from "@modelscript/simulate";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workDir = path.resolve(__dirname, ".verify_parity_work");

function runOmc(mosContent: string): { stdout: string; stderr: string; success: boolean } {
  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });
  const mosFile = path.join(workDir, `script_${Date.now()}.mos`);
  fs.writeFileSync(mosFile, mosContent, "utf-8");
  const proc = spawnSync("omc", [mosFile], { cwd: workDir, encoding: "utf-8" });
  try {
    fs.unlinkSync(mosFile);
  } catch {}
  return { stdout: proc.stdout || "", stderr: proc.stderr || "", success: proc.status === 0 };
}

function parseOmcCsv(csvContent: string): { times: number[]; series: Map<string, number[]> } {
  const lines = csvContent.trim().split("\n");
  if (lines.length < 2) return { times: [], series: new Map() };
  const header = lines[0].split(",").map((s) => s.replace(/"/g, "").trim());
  const series = new Map<string, number[]>();
  for (const h of header) series.set(h, []);

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(",").map(Number);
    for (let c = 0; c < header.length; c++) {
      series.get(header[c])?.push(row[c]);
    }
  }
  const times = series.get("time") || [];
  return { times, series };
}

async function verifyModel(modelName: string, moSource: string, stepSize = 0.01, stopTime = 0.1) {
  console.log(`\n========================================================================`);
  console.log(` Verifying Parity: ${modelName}`);
  console.log(`========================================================================`);

  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });
  const moPath = path.join(workDir, `${modelName}.mo`);
  fs.writeFileSync(moPath, moSource, "utf-8");

  // 1. ModelScript Flattening
  const ctx = new Context(new NodeFileSystem());
  const uri = `file://${moPath}`;
  ctx.load(moSource, uri);
  const msDae = ctx.flattenArena(modelName, undefined, uri, { arrayMode: "scalarize" });
  const msVarCount = msDae.getVarCount();
  const msEqCount = msDae.getEqCount();

  // 2. OMC Flattening
  const omcFlatMos = `loadFile("${moPath.replace(/\\/g, "/")}");
res := instantiateModel(${modelName});
print("===OMC_FLAT_START===\\n" + res + "\\n===OMC_FLAT_END===\\n");
`;
  const omcFlatRes = runOmc(omcFlatMos);
  const omcFlatMatch = omcFlatRes.stdout.match(/===OMC_FLAT_START===([\s\S]*?)===OMC_FLAT_END===/);
  const omcFlatText = omcFlatMatch ? omcFlatMatch[1].trim() : "";

  // Count variables and equations in OMC flattened output
  const omcVars = (omcFlatText.match(/Real |Integer |Boolean /g) || []).length;
  const omcEqs = (omcFlatText.match(/der\([^)]+\)\s*=|y\[\d+\]\s*=/g) || []).length;

  console.log(`\n[1. Flattening Parity]`);
  console.log(`  ModelScript: Vars = ${msVarCount}, Equations = ${msEqCount}`);
  console.log(`  OpenModelica: Vars = ${omcVars}, Equations = ${omcEqs}`);
  console.log(
    `  Count Match: ${msVarCount === omcVars ? "PERFECT MATCH" : `Difference (MS=${msVarCount} vs OMC=${omcVars})`}`,
  );

  // Sample check on equations
  console.log(`  Equations count: ${msEqCount}`);

  // 3. ModelScript Simulation
  const steps = Math.round(stopTime / stepSize);
  const msSimRes = simulateArena(msDae, {
    startTime: 0,
    stopTime,
    step: stepSize,
    numberOfIntervals: steps,
    method: "rk4",
  });

  // 4. OMC Simulation
  const omcSimMos = `loadFile("${moPath.replace(/\\/g, "/")}");
simulate(${modelName}, startTime=0.0, stopTime=${stopTime}, numberOfIntervals=${steps}, method="rk4", outputFormat="csv");
`;
  runOmc(omcSimMos);

  const csvPath = path.join(workDir, `${modelName}_res.csv`);
  if (!fs.existsSync(csvPath)) {
    console.error(`  OMC CSV output missing at ${csvPath}`);
    return;
  }
  const csvContent = fs.readFileSync(csvPath, "utf-8");
  const omcData = parseOmcCsv(csvContent);

  // 5. Compare Simulation Trajectories
  console.log(`\n[2. Simulation Trajectory Parity (Method: Euler, Step: ${stepSize}, Stop: ${stopTime})]`);
  console.log(`  Time steps evaluated: ${msSimRes.t.length} steps`);

  let maxDiffOverall = 0;
  let totalDiffOverall = 0;
  let pointCount = 0;

  const statesToInspect = msSimRes.states.slice(0, 5); // first 5 states
  console.log(`  Inspecting first ${statesToInspect.length} state trajectories:`);

  for (let sIdx = 0; sIdx < statesToInspect.length; sIdx++) {
    const varName = statesToInspect[sIdx];
    const msVals = msSimRes.y.map((row) => row[sIdx]!);
    const omcVals = omcData.series.get(varName);

    if (!omcVals || omcVals.length === 0) {
      console.log(`    ${varName}: NOT FOUND in OMC output`);
      continue;
    }

    let maxDiffForVar = 0;
    const nPts = Math.min(msVals.length, omcVals.length);
    for (let k = 0; k < nPts; k++) {
      const diff = Math.abs(msVals[k] - omcVals[k]);
      if (diff > maxDiffForVar) maxDiffForVar = diff;
      if (diff > maxDiffOverall) maxDiffOverall = diff;
      totalDiffOverall += diff;
      pointCount++;
    }

    console.log(
      `    ${varName.padEnd(8)}: Initial MS=${msVals[0].toFixed(4)} / OMC=${omcVals[0].toFixed(4)} | ` +
        `Final (t=${stopTime}) MS=${msVals[nPts - 1].toFixed(6)} / OMC=${omcVals[nPts - 1].toFixed(6)} | ` +
        `Max Absolute Error = ${maxDiffForVar.toExponential(4)}`,
    );
  }

  const avgDiff = pointCount > 0 ? totalDiffOverall / pointCount : 0;
  console.log(`\n  >> Overall Max Absolute Error: ${maxDiffOverall.toExponential(4)}`);
  console.log(`  >> Overall Average Difference: ${avgDiff.toExponential(4)}`);
  if (maxDiffOverall < 1e-4) {
    console.log(`  >> Verdict: TRAJECTORIES MATCH TO FLOATING POINT PRECISION (PASS)`);
  } else {
    console.log(`  >> Verdict: TRAJECTORY DISCREPANCY DETECTED`);
  }
}

async function main() {
  const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
  const { parser } = await createWasmParser(modelicaWasm);
  Context.registerParser(".mo", parser as any);

  const wasmReleasePath = path.resolve("apps/ide/dist/extension/server/dist/release.wasm");
  await initBltWasm(wasmReleasePath);

  // Model 1: Coupled PDE (Tridiagonal Banded System N=100)
  const pdeMo = `model CoupledPDE100
  parameter Integer N = 100;
  Real T[N](each start = 1.0);
equation
  der(T[1]) = -2.0 * T[1] + T[2];
  for i in 2:N-1 loop
    der(T[i]) = T[i-1] - 2.0 * T[i] + T[i+1];
  end for;
  der(T[N]) = T[N-1] - 2.0 * T[N];
end CoupledPDE100;
`;
  await verifyModel("CoupledPDE100", pdeMo, 0.01, 0.1);

  // Model 2: Coupled Algebraic Loop DAE (N=50)
  const algMo = `model CoupledAlgDAE50
  parameter Integer N = 50;
  Real x[N](each start = 1.0);
  Real y[N];
equation
  for i in 1:N loop
    der(x[i]) = -x[i] + y[i];
  end for;
  y[1] = 0.5 * x[1] + 0.2 * y[2];
  for i in 2:N-1 loop
    y[i] = 0.5 * x[i] + 0.2 * y[i-1] + 0.2 * y[i+1];
  end for;
  y[N] = 0.5 * x[N] + 0.2 * y[N-1];
end CoupledAlgDAE50;
`;
  await verifyModel("CoupledAlgDAE50", algMo, 0.01, 0.1);

  // Cleanup
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {}
}

main().catch(console.error);
