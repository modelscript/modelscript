import { createWasmParser } from "@modelscript/modelica/parser";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Context, computeEditRanges } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

function generateHeatConduction1D(n: number): string {
  let code = `model HeatConduction1D_${n}\n`;
  code += `  parameter Integer N = ${n};\n`;
  code += `  parameter Real L = 1.0;\n`;
  code += `  parameter Real dx = L / N;\n`;
  code += `  parameter Real alpha = 1e-4;\n\n`;
  code += `  Real T[N] (start=zeros(N));\n\n`;
  code += `equation\n`;
  code += `  der(T[1]) = alpha * (100.0 - 2.0*T[1] + T[2]) / (dx^2);\n`;
  for (let i = 2; i <= n - 1; i++) {
    code += `  der(T[${i}]) = alpha * (T[${i - 1}] - 2.0*T[${i}] + T[${i + 1}]) / (dx^2);\n`;
  }
  if (n > 1) {
    code += `  der(T[${n}]) = 2.0 * alpha * (T[${n - 1}] - T[${n}]) / (dx^2);\n`;
  }
  code += `end HeatConduction1D_${n};`;
  return code;
}

interface ConditionResult {
  name: string;
  loadMs: number;
  salsaMs: number;
  cstDiagsMs: number;
  flattenMs: number;
  totalMs: number;
  diagCount: number;
  flattenSuccess: boolean;
  diagnostics: any[];
}

export async function testIncrementalEdits(N: number): Promise<ConditionResult[]> {
  const baseSrc = generateHeatConduction1D(N);
  const uri = `file:///benchmark/HeatConduction1D_${N}.mo`;

  console.log(`\n${"=".repeat(80)}`);
  console.log(`Testing 8 AMC 2026 Incremental Editing Conditions on WASM Framework (N=${N})`);
  console.log(`${"=".repeat(80)}`);

  const results: ConditionResult[] = [];

  const runCondition = async (name: string, mutator?: (src: string) => string): Promise<ConditionResult> => {
    const { parser, facade } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    // 1. Establish pristine baseline for incremental conditions
    if (mutator) {
      ctx.load(baseSrc, uri);
      ctx.flattenArena(`HeatConduction1D_${N}`, undefined, uri);
    }

    // 2. Perform incremental mutation from baseline
    const src = mutator ? mutator(baseSrc) : baseSrc;
    const editRanges = mutator ? computeEditRanges(baseSrc, src) : [];
    const t0 = performance.now();
    ctx.load(src, uri);
    const t1 = performance.now();

    // 3. Salsa memoized query engine & lint validation
    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const t2 = performance.now();

    // 4. WASM Linear Memory CST diagnostics (range-bounded for keystroke edits, full for cold start)
    const tree = ctx.getTree(uri);
    const rootPtr = tree ? ((tree.rootNode as any).id ?? (tree.rootNode as any).ptr ?? (tree as any).rootPtr ?? 0) : 0;
    let cstDiags: any[] = [];
    if (rootPtr && facade) {
      if (editRanges.length > 0) {
        const editStart = editRanges[0].startByte;
        const editNewEnd = editRanges[editRanges.length - 1].endByte;
        cstDiags = (facade as any).getDiagnostics(rootPtr, editStart, editNewEnd);
      } else {
        cstDiags = (facade as any).getDiagnostics(rootPtr);
      }
    }
    const t3 = performance.now();

    // 5. Direct Arena DAE lowering & flattening
    let flattenResult = null;
    try {
      flattenResult = ctx.flattenArena(`HeatConduction1D_${N}`, undefined, uri);
    } catch {
      /* ignore flattening errors for invalid models */
    }
    const t4 = performance.now();

    // Reset parser linear memory state
    if (typeof (parser as any).reset === "function") {
      (parser as any).reset();
    }

    const arenaDiags = flattenResult ? flattenResult.diagnostics : [];
    const allDiags = [...cstDiags, ...diags, ...arenaDiags];

    const res: ConditionResult = {
      name,
      loadMs: t1 - t0,
      salsaMs: t2 - t1,
      cstDiagsMs: t3 - t2,
      flattenMs: t4 - t3,
      totalMs: t4 - t0,
      diagCount: allDiags.length,
      flattenSuccess: flattenResult !== null,
      diagnostics: allDiags,
    };
    results.push(res);

    console.log(
      `[${name}] ${res.totalMs.toFixed(2)}ms (load=${res.loadMs.toFixed(2)}ms, salsa=${res.salsaMs.toFixed(2)}ms, cstDiags=${res.cstDiagsMs.toFixed(2)}ms, flatten=${res.flattenMs.toFixed(2)}ms) | Diags: ${res.diagCount} | Flatten: ${res.flattenSuccess}`,
    );
    for (const d of allDiags.slice(0, 3)) {
      console.log(
        `    - [${d.severity || d.type || "diag"}] code=${d.code} ${d.message || d.lintName || ""} [range=${d.start ?? d.range?.start?.line}:${d.end ?? d.range?.end?.line}]`,
      );
    }

    return res;
  };

  // 1. Cold Start
  await runCondition("1. Cold Start");

  // 2. Root Parameter Rename
  await runCondition("2. Root Parameter Rename", (s) =>
    s.replace("parameter Real L = 1.0;", "parameter Real L_new = 1.0;").replace("dx = L / N;", "dx = L_new / N;"),
  );

  // 3. Global State Modifier
  await runCondition("3. Global State Modifier", (s) => s.replace("start=zeros(N)", "start=ones(N)"));

  // 4. Isolated Equation Edit
  await runCondition("4. Isolated Equation Edit", (s) => s.replace("100.0 - 2.0*T[1]", "200.0 - 2.0*T[1]"));

  // 5. Isolated Structural Edit
  await runCondition("5. Isolated Structural Edit", (s) => s.replace("equation\n", "equation\n  T[1] = T[N];\n"));

  // 6. Local Variable Rename
  await runCondition("6. Local Variable Rename", (s) =>
    s.replace("parameter Real alpha = 1e-4;", "parameter Real my_alpha = 1e-4;").replace(/alpha \*/g, "my_alpha *"),
  );

  // 7. Introduce Type Error
  await runCondition("7. Introduce Type Error", (s) => s.replace("1e-4", '"string_value"'));

  // 8. Introduce Syntax Error
  await runCondition("8. Introduce Syntax Error", (s) =>
    s.replace("parameter Real dx = L / N;", "parameter Real dx = L / N"),
  );

  return results;
}

async function main() {
  const args = process.argv
    .slice(2)
    .map(Number)
    .filter((n) => !isNaN(n) && n > 0);
  const Ns = args.length > 0 ? args : [10, 100, 1000, 5000];

  const allScalesResults: Record<number, ConditionResult[]> = {};

  for (const n of Ns) {
    allScalesResults[n] = await testIncrementalEdits(n);
  }

  console.log(`\n\n================================================================================`);
  console.log(`AMC 2026 INCREMENTAL EDITING CONDITIONS VERIFICATION SUMMARY`);
  console.log(`================================================================================`);
  console.log(
    `Condition                        | N=10       | N=100      | N=1000     | N=5000     | Diags (OMC Expected)`,
  );
  console.log(
    `---------------------------------+------------+------------+------------+------------+---------------------`,
  );

  const conditionNames = [
    "1. Cold Start",
    "2. Root Parameter Rename",
    "3. Global State Modifier",
    "4. Isolated Equation Edit",
    "5. Isolated Structural Edit",
    "6. Local Variable Rename",
    "7. Introduce Type Error",
    "8. Introduce Syntax Error",
  ];

  const expectedDiags = [
    "0 (clean)",
    "0 (clean)",
    "0 (clean)",
    "0 (clean)",
    "1 (unbalanced)",
    "0 (clean)",
    "1 (type error)",
    "2 (syntax error)",
  ];

  for (let i = 0; i < conditionNames.length; i++) {
    const name = conditionNames[i];
    const padName = name.padEnd(32, " ");
    const n10 = allScalesResults[10]?.[i]?.totalMs ? `${allScalesResults[10][i].totalMs.toFixed(1)}ms` : "N/A";
    const n100 = allScalesResults[100]?.[i]?.totalMs ? `${allScalesResults[100][i].totalMs.toFixed(1)}ms` : "N/A";
    const n1000 = allScalesResults[1000]?.[i]?.totalMs ? `${allScalesResults[1000][i].totalMs.toFixed(1)}ms` : "N/A";
    const n5000 = allScalesResults[5000]?.[i]?.totalMs ? `${allScalesResults[5000][i].totalMs.toFixed(1)}ms` : "N/A";
    console.log(
      `${padName} | ${n10.padEnd(10, " ")} | ${n100.padEnd(10, " ")} | ${n1000.padEnd(10, " ")} | ${n5000.padEnd(10, " ")} | ${expectedDiags[i]}`,
    );
  }
  console.log(`================================================================================`);
}

main().catch(console.error);
