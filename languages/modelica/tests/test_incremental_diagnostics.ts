import { createWasmParser } from "@modelscript/modelica/parser";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

async function testIncrementalEdits(N: number) {
  const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
  const { parser, facade } = await createWasmParser(modelicaWasm);
  Context.registerParser(".mo", parser as any);

  const baseSrc = generateHeatConduction1D(N);
  const uri = `file:///HeatConduction1D_${N}.mo`;

  console.log(`\n======================================================`);
  console.log(`Testing 8 Incremental Conditions on WASM Framework (N=${N})`);
  console.log(`======================================================`);

  const runCondition = async (name: string, src: string, resetFirst = false) => {
    const ctx = new Context(new NodeFileSystem());
    if (resetFirst) {
      ctx.load(baseSrc, uri);
      await ctx.queryEngine.runAllLintsAsync(uri);
    }

    // If not resetFirst, we test incremental transition from baseSrc -> src on same ctx
    const testCtx = resetFirst ? ctx : new Context(new NodeFileSystem());
    if (!resetFirst) {
      testCtx.load(baseSrc, uri);
      await testCtx.queryEngine.runAllLintsAsync(uri);
    }

    const t0 = performance.now();
    try {
      testCtx.load(src, uri);
      const t1 = performance.now();
      const diags = await testCtx.queryEngine.runAllLintsAsync(uri);
      const t2 = performance.now();
      const tree = testCtx.getTree(uri);
      const cstDiags =
        tree && facade
          ? (facade as any).getDiagnostics((tree.rootNode as any).id ?? (tree.rootNode as any).ptr ?? 0)
          : [];
      const t3 = performance.now();
      let flattenResult = null;
      let flattenError = null;
      try {
        flattenResult = testCtx.flattenArena(`HeatConduction1D_${N}`, undefined, uri);
      } catch (fe: any) {
        flattenError = fe.message || fe;
      }
      const t4 = performance.now();
      const arenaDiags = flattenResult ? flattenResult.diagnostics : [];
      const allDiags = [...cstDiags, ...diags, ...arenaDiags];
      console.log(
        `[${name}] SUCCESS: load=${(t1 - t0).toFixed(2)}ms, salsa=${(t2 - t1).toFixed(2)}ms, cstDiags=${(t3 - t2).toFixed(2)}ms, flatten=${(t4 - t3).toFixed(2)}ms, total=${(t4 - t0).toFixed(2)}ms`,
      );
      console.log(
        `  Diagnostics count: all=${allDiags.length} (cst=${cstDiags.length}, engine=${diags.length}, arena=${arenaDiags.length}), Flatten success: ${flattenResult !== null}`,
      );
      for (const d of allDiags.slice(0, 5)) {
        console.log(
          `    - [${d.severity || d.type || "diag"}] code=${d.code} message=${d.message || d.lintName || JSON.stringify(d)}`,
        );
      }
      return { success: true, diags: allDiags, time: t3 - t0 };
    } catch (e: any) {
      console.error(`[${name}] FAILED with exception:`, e.message || e);
      if (e.stack) console.error(e.stack.split("\n").slice(0, 5).join("\n"));
      return { success: false, error: e };
    }
  };

  // 1. Cold Start
  await runCondition("1. Cold Start", baseSrc, true);

  // 2. Root Parameter Rename
  const mutatedRootRename = baseSrc
    .replace("parameter Real L = 1.0;", "parameter Real L_new = 1.0;")
    .replace("dx = L / N;", "dx = L_new / N;");
  await runCondition("2. Root Parameter Rename", mutatedRootRename);

  // 3. Global State Modifier
  const mutatedStateMod = baseSrc.replace("start=zeros(N)", "start=ones(N)");
  await runCondition("3. Global State Modifier", mutatedStateMod);

  // 4. Isolated Equation Edit
  const mutatedEq = baseSrc.replace("100.0 - 2.0*T[1]", "200.0 - 2.0*T[1]");
  await runCondition("4. Isolated Equation Edit", mutatedEq);

  // 5. Isolated Structural Edit
  const mutatedStruct = baseSrc.replace("equation\n", "equation\n  T[1] = T[N];\n");
  await runCondition("5. Isolated Structural Edit", mutatedStruct);

  // 6. Local Variable Rename
  const mutatedLocalVar = baseSrc
    .replace("parameter Real alpha = 1e-4;", "parameter Real my_alpha = 1e-4;")
    .replace(/alpha \*/g, "my_alpha *");
  await runCondition("6. Local Variable Rename", mutatedLocalVar);

  // 7a. Introduce Type Error (single-quote)
  const mutatedTypeErrorSingle = baseSrc.replace("1e-4", "'string_value'");
  await runCondition("7a. Introduce Type Error (single-quote)", mutatedTypeErrorSingle);

  // 7b. Introduce Type Error (double-quote)
  const mutatedTypeErrorDouble = baseSrc.replace("1e-4", '"string_value"');
  await runCondition("7b. Introduce Type Error (double-quote)", mutatedTypeErrorDouble);

  // 8. Introduce Syntax Error
  const mutatedSyntaxError = baseSrc.replace("parameter Real dx = L / N;", "parameter Real dx = L / N");
  await runCondition("8. Introduce Syntax Error", mutatedSyntaxError);
}

testIncrementalEdits(10)
  .then(() => testIncrementalEdits(100))
  .catch(console.error);
