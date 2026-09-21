import path from "node:path";
import { createWasmParser } from "../src-gen/bindings.js";
import { Context } from "../src/context.js";

async function main() {
  const wasmPath = path.resolve(import.meta.dirname, "../dist/parser.wasm");
  const { parser, facade } = await createWasmParser(wasmPath);
  Context.registerParser(".mo", parser);

  const modelSrc = `
model ArrayRange
  Integer intArray[7,1];
equation
  intArray = [1:2:14];
end ArrayRange;
`;

  // Inspect CST
  const tree = parser.parse(modelSrc);
  function printNode(node: any, indent = 0) {
    const rawCount = node.childCount ?? 0;
    console.log(
      " ".repeat(indent) +
        node.type +
        " [" +
        node.text +
        "] (raw children: " +
        rawCount +
        ", isNamed: " +
        node.isNamed +
        ")",
    );
    for (let i = 0; i < rawCount; i++) {
      printNode(node.child(i), indent + 2);
    }
  }
  const expNode = tree.rootNode.descendantForIndex(modelSrc.indexOf("1:2:14"), modelSrc.indexOf("1:2:14") + 6);
  const c0Node = expNode.child(0);
  const ptr = (c0Node as any).ptr ?? (c0Node as any)._ptr ?? (c0Node as any).nodePtr;
  const offset = c0Node.startIndex;
  const loc = (BigInt(offset) << 32n) | BigInt(ptr);
  console.log("c0 ptr:", ptr, "offset:", offset, "loc:", loc);
  if (typeof facade.exports.locNonEmptyChildCount === "function") {
    const cnt = facade.exports.locNonEmptyChildCount(loc);
    console.log("locNonEmptyChildCount(c0) =", cnt);
  }
  if (typeof facade.exports.locChild === "function") {
    let curr = loc;
    while (true) {
      const cnt = facade.exports.locNonEmptyChildCount(curr);
      console.log("curr:", curr, "nonEmptyCount:", cnt);
      if (cnt === 1) {
        curr = facade.exports.locChild(curr, 0);
      } else {
        break;
      }
    }
    console.log("Unwrapped c0:", curr);
    const uCnt = facade.exports.locNonEmptyChildCount(curr);
    console.log("Unwrapped count:", uCnt);
    for (let i = 0; i < uCnt; i++) {
      const uCh = facade.exports.locChild(curr, i);
      console.log(`  uCh[${i}]:`, uCh);
    }
  }

  // WASM directly
  console.log("\n=== Testing WASM backend directly ===");
  const ctx = new Context();
  ctx.load(modelSrc, "ArrayRange.mo");
  const dae = ctx.flattenArena("ArrayRange", undefined, undefined, {
    omcCompatibility: true,
    backend: "wasm",
  });
  console.log("diagnostics:", dae?.diagnostics);
  console.log("wasmErrorCode:", (dae as any)?.wasmErrorCode);
  if (dae) {
    console.log("varCount:", dae.varCount, "eqCount:", dae.eqCount);
  }

  // Also test flattener directly
  const wasmExports = facade.exports;
  const rootNode = tree.rootNode;
  const classNode = rootNode.descendantForIndex(
    modelSrc.indexOf("model ArrayRange"),
    modelSrc.indexOf("end ArrayRange") + 14,
  );
  const DAEBuilder = (await import("@modelscript/runtime")).DAEBuilder;
  const testDae = new DAEBuilder(wasmExports, "ArrayRange", "");
  const wf = testDae.exports.flattener_create(testDae.ptr);
  console.log("wf pointer:", wf);
  const varCount = testDae.exports.flattener_flatten(
    wf,
    (classNode as any).ptr ?? (classNode as any)._ptr ?? (classNode as any).nodePtr,
    (rootNode as any).ptr ?? (rootNode as any)._ptr ?? (rootNode as any).nodePtr,
  );
  console.log("direct flattener_flatten returned varCount:", varCount, "eqCount:", testDae.eqCount);
  const errCode = testDae.exports.flattener_getErrorCode
    ? testDae.exports.flattener_getErrorCode(wf)
    : "no getErrorCode";
  console.log("errorCode:", errCode);
  console.log("testDae exprCount:", testDae.exprCount, "varCount:", testDae.varCount);
  for (let i = 0; i < testDae.exprCount; i++) {
    const kind = testDae.getExprKind(i);
    const d1 = testDae.getExprData1(i);
    const left = testDae.getExprLeft(i);
    const right = testDae.getExprRight(i);
    console.log(`Expr[${i}]: kind=${kind} d1=${d1} left=${left} right=${right}`);
  }
  for (let i = 0; i < testDae.varCount; i++) {
    console.log(`Var[${i}]: name="${testDae.getVarName(i)}"`);
  }
}

main().catch(console.error);
