import fs from "node:fs";
import path from "node:path";
import { createWasmParser } from "../src-gen/bindings.js";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

async function main() {
  const wasmPath = path.resolve(import.meta.dirname, "../dist/parser.wasm");
  const { parser } = await createWasmParser(wasmPath);
  Context.registerParser(".mo", parser);

  const argFile = process.argv[2];
  const testFile = argFile
    ? path.resolve(import.meta.dirname, "../testsuite", argFile.replace(/^OpenModelica\//, "OpenModelica/"))
    : path.resolve(import.meta.dirname, "../testsuite/OpenModelica/flattening/modelica/expandable/07.mo");
  const content = fs.readFileSync(testFile, "utf-8");
  const base = path.basename(testFile, ".mo");
  const models = Array.from(content.matchAll(/(?:model|class)\s+([A-Za-z0-9_]+)/g)).map((m) => m[1]);
  const modelName = models.includes(base) ? base : (models[models.length - 1] ?? "Test07");
  const lines = content.split("\n");
  const resultStartIdx = lines.findIndex((l) => /^\/\/\s*Result:/.test(l));
  const sourceEnd = resultStartIdx >= 0 ? resultStartIdx : lines.length;
  const source = lines.slice(0, sourceEnd).join("\n").trim();
  console.log("sourceLen:", source.length);
  const context = new Context(new NodeFileSystem());
  context.load(source, testFile);

  const lints = Array.from(context.queryEngine.runAllLints());
  console.log("Lints:", lints);

  /*
  const db = context.queryEngine.toQueryDB();
  const rootSym = db.byName(modelName).find((s) => s.kind === "Class");
  if (rootSym) {
    const elemIds = db.query("instantiate", rootSym.id) as number[];
    console.log("Root elemIds:", elemIds);
    for (const eid of elemIds || []) {
      const ci = db.query("componentInstance", eid);
      console.log(`compInst[${eid}]:`, JSON.stringify(ci, null, 2));
    }
  }
  */

  const arena = context.flattenArena(modelName, undefined, undefined, { omcCompatibility: true });
  console.log("Arena diagnostics:", arena?.diagnostics);
  if (arena) {
    for (let i = 0; i < arena.eqCount; i++) {
      const k = arena.getEqKind(i);
      const lhs = arena.getEqLhs(i);
      const rhs = arena.getEqRhs(i);
      const lhsStr =
        lhs >= 0
          ? arena.getExprKind(lhs) === 0
            ? arena.interner.resolve(arena.getExprData1(lhs))
            : arena.getExprKind(lhs)
          : "";
      const rhsStr =
        rhs >= 0
          ? arena.getExprKind(rhs) === 0
            ? arena.interner.resolve(arena.getExprData1(rhs))
            : arena.getExprKind(rhs)
          : "";
      console.log(`eq[${i}]: kind=${k} lhs=${lhsStr} rhs=${rhsStr}`);
    }
    for (let i = 0; i < arena.varCount; i++) {
      const name = arena.getVarName(i);
      const exprId = arena.getVarExpression(i);
      const kind = exprId >= 0 ? arena.getExprKind(exprId) : -1;
      console.log(`var[${i}]: ${name} exprId=${exprId} kind=${kind}`);
    }
    const { ArenaDAEPrinter } = await import("@modelscript/runtime");
    const { StringWriter } = await import("@modelscript/dsl/utils");
    const out = new StringWriter();
    const printer = new ArenaDAEPrinter(out, arena, true);
    printer.printDAE(arena);
    const actual = out.toString().trim();

    // Extract expected from content
    const resIdx = content.indexOf("// Result:");
    const expected =
      resIdx >= 0
        ? content
            .slice(resIdx + 10)
            .split("\n")
            .map((l) => l.replace(/^\/\/\s?/, ""))
            .join("\n")
            .trim()
        : "";

    const actLines = actual.split("\n");
    const expLines = expected.split("\n");
    console.log("ACTUAL:\n" + actual);
    console.log(`actLines: ${actLines.length}, expLines: ${expLines.length}`);
    for (let i = 0; i < Math.max(actLines.length, expLines.length); i++) {
      if (actLines[i] !== expLines[i]) {
        console.log(`Diff at line ${i + 1}:`);
        console.log(`  EXP: "${expLines[i]}"`);
        console.log(`  ACT: "${actLines[i]}"`);
      }
    }
  }
}

main().catch(console.error);
