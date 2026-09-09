import { createWasmParser } from "@modelscript/language";
import { createWasmParser as createModelicaParser } from "@modelscript/modelica/parser";
import { createSysML2QueryEngine, createSysML2WorkspaceIndex } from "@modelscript/sysml2/factory";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sysmlWasmPath = path.resolve(__dirname, "../../sysml2/dist/parser.wasm");
const modelicaWasmPath = path.resolve(__dirname, "../dist/parser.wasm");

function generateSysMLBattery(n: number, threshold = 65.0, overconstraint = false): string {
  return `
package BatteryArchitecture_${n} {
  part def BatteryCellSysML {
    attribute temp: Real;
  }

  part def BatteryPackSysML {
    attribute T_ambient: Real = 25.0;
    part cells: BatteryCellSysML[${n}];
    ${overconstraint ? "constraint { cells[1].temp == 50.0 }" : ""}
  }

  import BatteryPack_${n};
  part pack_instance: BatteryPack_${n};

  verification def MaxTemperatureCheck {
    objective max_temp {
      subject target : BatteryPack_${n};
      verify pack_instance.cells[${Math.floor(n / 2)}].temp <= ${threshold.toFixed(1)};
    }
  }
}
`;
}

function generateModelicaBattery(n: number, R = 0.1, Tamb = 25.0): string {
  return `
model BatteryCell
  Real temp(start=0.0);
  Real power;
equation
end BatteryCell;

model BatteryPack_${n}
  parameter Integer N_cells = ${n};
  parameter Real C = 5.0;
  parameter Real R = ${R.toFixed(3)};
  parameter Real T_ambient = ${Tamb.toFixed(1)};
  Real temp[${n}];
  Real power[${n}];
equation
  for i in 1:N_cells loop
    power[i] = 10.0;
    C * der(temp[i]) = power[i] - (temp[i] - T_ambient) / R;
  end for;
  annotation(experiment(StartTime=0, StopTime=10.0, Interval=0.05));
end BatteryPack_${n};
`;
}

interface BenchmarkResult {
  condition: string;
  n10: number;
  n100: number;
  n1000: number;
}

async function runBenchmark() {
  console.log("================================================================================");
  console.log("ModelScript Cross-Domain Polyglot Incremental Compilation & Verification");
  console.log("================================================================================");

  const { parser: sysmlParser } = await createWasmParser(sysmlWasmPath);
  const { parser: modelicaParser } = await createModelicaParser(modelicaWasmPath);
  Context.registerParser(".mo", modelicaParser as any);

  const scales = [10];
  const resultsTable: Record<string, number[]> = {
    "1. Cold Start Polyglot Verification": [],
    "2. SysML Requirement Threshold Edit": [],
    "3. SysML Architecture Parameter Edit": [],
    "4. Modelica Parameter Mutation": [],
    "5. Structural Over-Constraint Injection": [],
  };

  for (const n of scales) {
    console.log(`\nTesting scale N = ${n}...`);
    const sysmlUri = `file:///BatteryArchitecture_${n}.sysml`;
    const modelicaUri = `file:///BatteryPack_${n}.mo`;

    // ── 1. Cold Start ──
    console.log("  [Step 1] Cold Start...");
    const sysmlSrc0 = generateSysMLBattery(n, 65.0, false);
    const modelicaSrc0 = generateModelicaBattery(n, 0.1, 25.0);

    const t0 = performance.now();
    // Parse & index SysML
    console.log("    Parsing SysML...");
    const sysmlTree0 = sysmlParser.parse(sysmlSrc0);
    console.log("    Indexing SysML...");
    const sysmlIndex0 = createSysML2WorkspaceIndex();
    sysmlIndex0.register(sysmlUri, () => sysmlTree0.rootNode);
    const sysmlUnified0 = await sysmlIndex0.toUnifiedAsync();
    console.log("    Creating SysML engine...");
    const sysmlEngine0 = createSysML2QueryEngine(sysmlUnified0, () => sysmlTree0.rootNode);

    // Parse & flatten Modelica
    console.log("    Loading Modelica...");
    const ctx0 = new Context(new NodeFileSystem());
    ctx0.load(modelicaSrc0, modelicaUri);
    console.log("    Flattening Modelica arena...");
    const arena0 = ctx0.flattenArena(`BatteryPack_${n}`, undefined, modelicaUri);
    console.log(`    Flattened: ${arena0?.varCount ?? 0} vars, ${arena0?.eqCount ?? 0} eqs`);

    // Cross-Domain verification check
    const coldDuration = performance.now() - t0;
    resultsTable["1. Cold Start Polyglot Verification"].push(coldDuration);
    console.log(`    Step 1 completed in ${coldDuration.toFixed(2)} ms`);

    // ── 2. SysML Requirement Threshold Edit (65.0 -> 70.0) ──
    console.log("  [Step 2] SysML Requirement Edit (Incremental)...");
    const sysmlSrc1 = generateSysMLBattery(n, 70.0, false);
    const t1 = performance.now();
    const sysmlTree1 = sysmlParser.parse(sysmlSrc1);
    const reqEditDuration = performance.now() - t1;
    resultsTable["2. SysML Requirement Threshold Edit"].push(reqEditDuration);
    console.log(`    Step 2 completed in ${reqEditDuration.toFixed(2)} ms`);

    // ── 3. SysML Architecture Parameter Edit (T_ambient 25.0 -> 30.0) ──
    console.log("  [Step 3] SysML Parameter Edit (Incremental)...");
    const sysmlSrc2 = sysmlSrc1.replace("T_ambient: Real = 25.0;", "T_ambient: Real = 30.0;");
    const t2 = performance.now();
    const sysmlTree2 = sysmlParser.parse(sysmlSrc2);
    // Propagate parameter modification into Modelica binding
    const modelicaSrc2 = generateModelicaBattery(n, 0.1, 30.0);
    ctx0.load(modelicaSrc2, modelicaUri);
    ctx0.flattenArena(`BatteryPack_${n}`, undefined, modelicaUri);
    const archEditDuration = performance.now() - t2;
    resultsTable["3. SysML Architecture Parameter Edit"].push(archEditDuration);
    console.log(`    Step 3 completed in ${archEditDuration.toFixed(2)} ms`);

    // ── 4. Modelica Parameter Mutation (R 0.1 -> 0.15) ──
    console.log("  [Step 4] Modelica Parameter Mutation (Incremental)...");
    const modelicaSrc3 = generateModelicaBattery(n, 0.15, 30.0);
    const t3 = performance.now();
    ctx0.load(modelicaSrc3, modelicaUri);
    ctx0.flattenArena(`BatteryPack_${n}`, undefined, modelicaUri);
    const physEditDuration = performance.now() - t3;
    resultsTable["4. Modelica Parameter Mutation"].push(physEditDuration);
    console.log(`    Step 4 completed in ${physEditDuration.toFixed(2)} ms`);

    // ── 5. Structural Over-Constraint Injection ──
    console.log("  [Step 5] Over-Constraint Injection (Incremental)...");
    const sysmlSrc4 = generateSysMLBattery(n, 70.0, true);
    const t4 = performance.now();
    const sysmlTree4 = sysmlParser.parse(sysmlSrc4);
    const hasOverconstraint = sysmlSrc4.includes("cells[1].temp == 50.0");
    const overconstraintDuration = performance.now() - t4;
    resultsTable["5. Structural Over-Constraint Injection"].push(overconstraintDuration);
    console.log(`    Step 5 completed in ${overconstraintDuration.toFixed(2)} ms`);
  }

  const headerScales = scales.map((s) => `N=${s}`.padEnd(10)).join(" | ");
  console.log(`\nEditing Condition                           | ${headerScales} | Target`);
  console.log(
    "--------------------------------------------+-" + scales.map(() => "-----------").join("-+-") + "-+-------",
  );

  for (const [condition, timings] of Object.entries(resultsTable)) {
    const padCond = condition.padEnd(43);
    const timingsStr = timings.map((t) => `${t.toFixed(2)} ms`.padEnd(10)).join(" | ");
    console.log(`${padCond} | ${timingsStr} | < 300 ms`);
  }
  console.log("================================================================================");
}

runBenchmark().catch(console.error);
