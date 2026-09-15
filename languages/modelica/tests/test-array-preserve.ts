import { createWasmParser } from "@modelscript/modelica/parser";
import { initBltWasm } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
const { parser } = await createWasmParser(modelicaWasm);
Context.registerParser(".mo", parser as any);

await initBltWasm();

const tempMoPath = path.resolve(__dirname, "VectorODE.mo");
const modelContent = `model VectorODE
  parameter Integer N = 10;
  Real x[N](start = ones(N));
equation
  der(x) = -x;
end VectorODE;
`;

fs.writeFileSync(tempMoPath, modelContent, "utf8");

try {
  console.log("=== Testing Array Preservation in Modelica WASM Flattener ===");

  // 1. Test preserve mode
  const contextPreserve = Context.createBatch(new NodeFileSystem());
  await contextPreserve.addLibrary(tempMoPath);
  const daePreserve = contextPreserve.flattenArena("VectorODE", undefined, undefined, { arrayMode: "preserve" });
  if (!daePreserve) throw new Error("Failed to flatten VectorODE with arrayMode='preserve'");

  console.log("Preserve Mode: varCount =", daePreserve.varCount);
  for (let i = 0; i < daePreserve.varCount; i++) {
    console.log(
      `  Var ${i}: name=${daePreserve.getVarName(i)}, shape=[${daePreserve.getVarShape(i).join(", ")}], elements=${daePreserve.getVarShapeElementCount(i)}`,
    );
  }
  console.log("Preserve Mode: eqCount =", daePreserve.eqCount);
  console.log("Preserve Mode: totalScalarElements =", daePreserve.getVarTotalScalarElements());
  console.log("Preserve Mode: diagnostics =", daePreserve.diagnostics);

  // Assertions for preserve mode
  const xVarIdx = daePreserve.getVarIdxByName("x");
  if (xVarIdx < 0) throw new Error("Variable 'x' not found in preserve mode DAE!");
  const shape = daePreserve.getVarShape(xVarIdx);
  if (shape.length !== 1 || shape[0] !== 10) {
    throw new Error(`Expected shape [10], but got [${shape.join(", ")}]`);
  }
  if (daePreserve.getVarShapeElementCount(xVarIdx) !== 10) {
    throw new Error(`Expected element count 10, got ${daePreserve.getVarShapeElementCount(xVarIdx)}`);
  }
  // Check that no scalarized x[1] exists
  if (daePreserve.getVarIdxByName("x[1]") >= 0) {
    throw new Error("Unexpected scalarized variable 'x[1]' found in preserve mode!");
  }

  // 2. Test scalarize mode
  const contextScalarize = Context.createBatch(new NodeFileSystem());
  await contextScalarize.addLibrary(tempMoPath);
  const daeScalarize = contextScalarize.flattenArena("VectorODE", undefined, undefined, { arrayMode: "scalarize" });
  if (!daeScalarize) throw new Error("Failed to flatten VectorODE with arrayMode='scalarize'");

  console.log("Scalarize Mode: varCount =", daeScalarize.varCount);
  if (daeScalarize.getVarIdxByName("x[1]") < 0) {
    throw new Error("Expected scalarized variable 'x[1]' in scalarize mode!");
  }

  console.log("✔ Array preservation and scalarization modes verified successfully!");
} finally {
  if (fs.existsSync(tempMoPath)) {
    fs.unlinkSync(tempMoPath);
  }
}
