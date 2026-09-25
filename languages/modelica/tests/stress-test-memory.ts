import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const wasmPath = resolve(repoRoot, "languages/modelica/dist/parser.wasm");
const wasmBytes = readFileSync(wasmPath);

function generateModelicaModel(targetLines: number): string {
  const lines: string[] = [];
  lines.push("package StressBenchmark");
  lines.push("  model BenchmarkModel");
  lines.push("    import Modelica.Constants.pi;");
  lines.push('    parameter Real globalScale = 1.0 "Global scaling factor";');
  lines.push('    parameter Integer numStages = 10 "Stage count";');

  let currentLine = lines.length;
  let compId = 0;

  // We add components, parameters, equations, annotations in chunks of ~10 lines
  while (currentLine < targetLines - 15) {
    compId++;
    lines.push(`    // --- Block Component ${compId} ---`);
    lines.push(`    parameter Real gain_${compId} = ${(1.0 + (compId % 10) * 0.1).toFixed(2)};`);
    lines.push(`    parameter Real bias_${compId} = ${(0.05 * (compId % 5)).toFixed(2)};`);
    lines.push(`    Real u_${compId}(start = 0.0);`);
    lines.push(`    Real y_${compId}(start = 1.0);`);
    lines.push(`    Real x_${compId}(start = 0.5);`);
    currentLine = lines.length;
  }

  lines.push("  equation");
  let eqIdx = 1;
  while (lines.length < targetLines - 2) {
    const i = (eqIdx % compId) + 1;
    const prev = i > 1 ? i - 1 : compId;
    if (lines.length < targetLines - 5) {
      lines.push(`    u_${i} = y_${prev} * gain_${i} + bias_${i};`);
      lines.push(`    der(x_${i}) = (u_${i} - x_${i}) * globalScale;`);
      lines.push(`    y_${i} = x_${i} * gain_${i};`);
    } else {
      lines.push(`    y_${i} = x_${i};`);
    }
    eqIdx++;
  }

  lines.push("  end BenchmarkModel;");
  lines.push("end StressBenchmark;");

  return lines.join("\n");
}

async function runBenchmarkForSource(name: string, source: string) {
  const lineCount = source.split("\n").length;
  const inputKB = (source.length / 1024).toFixed(1);
  const inputBytes = source.length * 2; // UTF-16 bytes

  const imports = {
    env: {
      abort: (msg: any, file: any, line: any, col: any) => {
        console.error(`WASM ABORT: line ${line}:${col}`);
      },
    },
    parser: { logInt: () => {} },
    engine: { debugLog: () => {} },
    host: { runHostQuery: () => 0 },
  };

  const wasmModule = await WebAssembly.instantiate(wasmBytes, imports);
  const exports: any = wasmModule.instance.exports;
  const mem = exports.memory as WebAssembly.Memory;

  exports.initCompiler?.();

  const bufPtr = exports.ensureInputBuffer(inputBytes);
  const bufArr = new Uint16Array(mem.buffer, bufPtr, source.length);
  for (let i = 0; i < source.length; i++) {
    bufArr[i] = source.charCodeAt(i);
  }
  exports.lsp_setInputLength(inputBytes);

  const t0 = performance.now();
  let root = 0;
  let errorMsg = "";
  try {
    root = exports.parse(0, 0, 0, inputBytes);
  } catch (err: any) {
    errorMsg = err.message;
  }
  const t1 = performance.now();
  const parseMs = (t1 - t0).toFixed(1);

  const wasmMB = (mem.buffer.byteLength / (1024 * 1024)).toFixed(1);
  const arenaBytes = exports.arena_getMemoryUsage ? exports.arena_getMemoryUsage() : 0;
  const arenaMB = (arenaBytes / (1024 * 1024)).toFixed(1);
  const errors = exports.errorCount ? exports.errorCount.value : "?";

  const sPtr = exports.S ? exports.S() : 0;
  const u32 = new Uint32Array(mem.buffer);
  const gen1Chunks = sPtr ? u32[sPtr / 4 + 1] : 0;
  const gen0Chunks = sPtr ? u32[sPtr / 4 + 7] : 0;
  const allocCount = sPtr ? u32[sPtr / 4 + 17] : 0;
  const g0MB = ((gen0Chunks * 256) / 1024).toFixed(1);
  const g1MB = ((gen1Chunks * 256) / 1024).toFixed(1);

  const ampl = (parseFloat(wasmMB) / (source.length / (1024 * 1024))).toFixed(1);

  return {
    name,
    lineCount,
    inputKB,
    parseMs,
    wasmMB,
    arenaMB,
    g0MB,
    g1MB,
    allocCount,
    errors,
    ampl,
    root,
    errorMsg,
  };
}

async function main() {
  console.log(
    "\n=======================================================================================================",
  );
  console.log("                       MODELICA WASM PARSER STRESS TEST & MEMORY PROFILE                              ");
  console.log(
    "=======================================================================================================\n",
  );

  const targetLineSizes = [100, 1000, 10000, 100000];

  console.log(
    "Lines".padEnd(8) +
      " | " +
      "Input".padEnd(9) +
      " | " +
      "Time".padEnd(9) +
      " | " +
      "WASM Mem".padEnd(10) +
      " | " +
      "Arena Total (Gen0 / Gen1)".padEnd(28) +
      " | " +
      "Allocs".padEnd(10) +
      " | " +
      "Ampl".padEnd(8) +
      " | " +
      "Errors",
  );
  console.log("-".repeat(103));

  for (const target of targetLineSizes) {
    const src = generateModelicaModel(target);
    const res = await runBenchmarkForSource(`Synth-${target}`, src);

    if (res.errorMsg) {
      console.log(`${res.lineCount.toString().padEnd(8)} | CRASH: ${res.errorMsg} (WASM: ${res.wasmMB} MB)`);
      continue;
    }

    const arenaStr = `${res.arenaMB} MB (G0:${res.g0MB}M, G1:${res.g1MB}M)`;
    console.log(
      res.lineCount.toString().padEnd(8) +
        " | " +
        `${res.inputKB} KB`.padEnd(9) +
        " | " +
        `${res.parseMs} ms`.padEnd(9) +
        " | " +
        `${res.wasmMB} MB`.padEnd(10) +
        " | " +
        arenaStr.padEnd(28) +
        " | " +
        res.allocCount.toString().padEnd(10) +
        " | " +
        `${res.ampl}x`.padEnd(8) +
        " | " +
        res.errors,
    );
  }

  console.log(
    "\n=======================================================================================================",
  );
  console.log("                        REAL MSL (MODELICA STANDARD LIBRARY) BENCHMARKS                               ");
  console.log(
    "=======================================================================================================\n",
  );

  const mslFiles = [
    {
      name: "Blocks/Continuous.mo",
      lines: 4542,
      path: "data/libraries/Modelica/4.1.0/extracted/Modelica/Blocks/Continuous.mo",
    },
    {
      name: "Electrical/Spice3.mo",
      lines: 10513,
      path: "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/Spice3.mo",
    },
    {
      name: "Fluid/Dissipation.mo",
      lines: 13155,
      path: "data/libraries/Modelica/4.1.0/extracted/Modelica/Fluid/Dissipation.mo",
    },
    {
      name: "IdealGases/SingleGases.mo",
      lines: 17493,
      path: "data/libraries/Modelica/4.1.0/extracted/Modelica/Media/IdealGases/Common/SingleGasesData.mo",
    },
  ];

  for (const msl of mslFiles) {
    try {
      const fullPath = resolve(repoRoot, msl.path);
      const src = readFileSync(fullPath, "utf-8");
      const res = await runBenchmarkForSource(msl.name, src);

      const arenaStr = `${res.arenaMB} MB (G0:${res.g0MB}M, G1:${res.g1MB}M)`;
      console.log(
        res.lineCount.toString().padEnd(8) +
          " | " +
          `${res.inputKB} KB`.padEnd(9) +
          " | " +
          `${res.parseMs} ms`.padEnd(9) +
          " | " +
          `${res.wasmMB} MB`.padEnd(10) +
          " | " +
          arenaStr.padEnd(28) +
          " | " +
          res.allocCount.toString().padEnd(10) +
          " | " +
          `${res.ampl}x`.padEnd(8) +
          " | " +
          res.errors +
          ` (${msl.name})`,
      );
    } catch (e: any) {
      console.log(`Failed to run ${msl.name}: ${e.message}`);
    }
  }

  console.log(
    "\n=======================================================================================================\n",
  );
}

main().catch(console.error);
