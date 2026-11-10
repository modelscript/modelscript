import * as path from "node:path";
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import { NodeFileSystem } from "./node-filesystem.js";
import { createWasmParser } from "../src-gen/bindings.js";
import { Context } from "../src/context.js";
import {
  initBltWasm,
  printArenaDAE,
} from "@modelscript/runtime";
import { simulateArena } from "@modelscript/simulate";

const cacheDir = path.resolve(import.meta.dirname, "../../../.cache/openipsl-omc");

function getOmcSim(modelName: string, stopTime = 10, intervals = 500): {
  durationMs: number;
  headers: string[];
  rows: number[][];
} {
  fs.mkdirSync(cacheDir, { recursive: true });
  const csvCache = path.join(cacheDir, `${modelName}.csv`);
  const metaCache = path.join(cacheDir, `${modelName}.meta.json`);
  if (fs.existsSync(csvCache) && fs.existsSync(metaCache)) {
    const csv = fs.readFileSync(csvCache, "utf-8");
    const meta = JSON.parse(fs.readFileSync(metaCache, "utf-8"));
    return parseCsv(csv, meta.durationMs);
  }

  const tmpDir = path.join(cacheDir, `tmp_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const mos = `
loadFile("/home/omar/.openmodelica/libraries/Complex 4.0.0+maint.om/package.mo");
loadFile("/home/omar/.openmodelica/libraries/ModelicaServices 4.0.0+maint.om/package.mo");
loadFile("/home/omar/.openmodelica/libraries/Modelica 4.0.0+maint.om/package.mo");
loadFile("/home/omar/.openmodelica/libraries/OpenIPSL 3.1.0/package.mo");
simulate(${modelName}, startTime=0, stopTime=${stopTime}, numberOfIntervals=${intervals}, tolerance=1e-6, outputFormat="csv");
print(getErrorString());
`;
  const mosPath = path.join(tmpDir, "run.mos");
  fs.writeFileSync(mosPath, mos, "utf-8");
  const t0 = performance.now();
  const res = spawnSync("omc", [mosPath], { cwd: tmpDir, encoding: "utf-8", timeout: 60000 });
  const durationMs = performance.now() - t0;
  const csvPath = path.join(tmpDir, `${modelName}_res.csv`);
  if (!fs.existsSync(csvPath)) {
    throw new Error(`OMC failed for ${modelName}: ${res.stdout}\n${res.stderr}`);
  }
  const csv = fs.readFileSync(csvPath, "utf-8");
  fs.writeFileSync(csvCache, csv, "utf-8");
  fs.writeFileSync(metaCache, JSON.stringify({ durationMs }), "utf-8");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return parseCsv(csv, durationMs);
}

function parseCsv(csv: string, durationMs: number) {
  const lines = csv.trim().split("\n");
  const headers = lines[0]!.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows = lines.slice(1).map((l) => l.split(",").map(Number));
  return { durationMs, headers, rows };
}

async function main() {
  await initBltWasm();
  const wasmPath = path.resolve(import.meta.dirname, "../dist/parser.wasm");
  const { parser } = await createWasmParser(wasmPath);
  Context.registerParser(".mo", parser as any);

  const ctx = new Context(new NodeFileSystem());
  const complexDir = "/home/omar/.openmodelica/libraries/Complex 4.0.0+maint.om";
  const servicesDir = "/home/omar/.openmodelica/libraries/ModelicaServices 4.0.0+maint.om";
  const mslDir = "/home/omar/.openmodelica/libraries/Modelica 4.0.0+maint.om";
  const openipslDir = "/home/omar/.openmodelica/libraries/OpenIPSL 3.1.0";
  await ctx.addLibrary(complexDir, { skipIndex: true });
  await ctx.addLibrary(servicesDir, { skipIndex: true });
  await ctx.addLibrary(mslDir, { skipIndex: true });
  await ctx.addLibrary(openipslDir, { skipIndex: true });
  await ctx.finalizeLibraries();

  const models = [
    "OpenIPSL.Examples.KundurSMIB.SMIB",
    "OpenIPSL.Examples.KundurSMIB.SMIB_AVR",
    "OpenIPSL.Examples.KundurSMIB.SMIB_AVR_PSS",
    "OpenIPSL.Examples.TwoAreas.Two_Areas_PSSE",
    "OpenIPSL.Examples.SevenBus.Network",
  ];

  for (const modelName of models) {
    console.log(`\n=== ${modelName} ===`);
    const omc = getOmcSim(modelName, 10, 500);
    console.log(`OMC Sim: ${omc.durationMs.toFixed(1)} ms (rows=${omc.rows.length})`);

    const t0 = performance.now();
    const dae = ctx.flattenArena(modelName)!;
    const t1 = performance.now();
    console.log(`MS Flatten: ${(t1 - t0).toFixed(1)} ms (vars=${dae.varCount}, eqs=${dae.eqCount})`);


    const t2 = performance.now();
    const res = simulateArena(dae, {
      startTime: 0,
      stopTime: 10,
      step: 0.02,
      solver: "dopri5",
      tolerance: 1e-6,
    });
    const t3 = performance.now();
    const msSimMs = t3 - t2;
    const speedup = omc.durationMs / msSimMs;
    console.log(
      `MS Sim: ${msSimMs.toFixed(1)} ms (${speedup.toFixed(2)}x faster than OMC, steps=${res.t.length}, tEnd=${res.t[res.t.length - 1]}, states=${res.states.length})`,
    );

    for (let sIdx = 0; sIdx < res.states.length; sIdx++) {
      const stateName = res.states[sIdx]!;
      const omcCol = omc.headers.indexOf(stateName);
      if (omcCol < 0) {
        console.log(`  [${stateName}] (not in OMC headers) t=0: ${res.y[0]?.[sIdx]} | end: ${res.y[res.y.length - 1]?.[sIdx]}`);
        continue;
      }

      const sampleTimes = [0, 0.5, 0.56, 0.6, 1.0, 2.0, 5.0, 10.0];
      const diffs: string[] = [];
      for (const st of sampleTimes) {
        const msIdx = res.t.findIndex((t) => t >= st - 1e-4);
        const omcRow = omc.rows.find((r) => r[0]! >= st - 1e-4);
        const msVal = msIdx >= 0 ? res.y[msIdx]?.[sIdx] : undefined;
        const omcVal = omcRow?.[omcCol];
        diffs.push(`t=${st}: MS=${msVal?.toFixed(4)} vs OMC=${omcVal?.toFixed(4)}`);
      }
      console.log(`  [${stateName}]\n    ${diffs.join(" | ")}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
