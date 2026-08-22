import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { choice, field, flow, language, optional, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// DSL with control flow structures to produce CFGs
const ssaTestDsl = language({
  name: "SSADominatorTest",
  rules: {
    Program: ($: any) => repeat($.Stmt),
    Stmt: ($: any) => choice($.IfStmt, $.WhileStmt, $.AssignStmt),
    IfStmt: ($: any) =>
      seq(
        "if",
        field("cond", $.Expr),
        "then",
        field("thenBody", $.Stmt),
        optional(seq("else", field("elseBody", $.Stmt))),
        "end",
        ";",
      ),
    WhileStmt: ($: any) => seq("while", field("cond", $.Expr), "do", field("body", $.Stmt), "end", ";"),
    AssignStmt: ($: any) => seq(field("lhs", $.Identifier), "=", field("rhs", $.Expr), ";"),
    Expr: ($: any) => choice($.Identifier, $.Number),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($: any) => semanticToken("number", /[0-9]+/),
  },
  extras: ($: any) => [/\s+/],

  cfgNodes: flow.rules({
    IfStmt: flow.branch({
      cond: flow.field("cond"),
      then: flow.field("thenBody"),
      else: flow.field("elseBody"),
    }),
    WhileStmt: flow.loop({
      cond: flow.field("cond"),
      body: flow.field("body"),
    }),
  }),
});

describe("SSA Form, Dominator Tree & Phi Node Placement in WASM Linear Memory", () => {
  let tmpDir: string;
  let wasmExports: any;

  beforeAll(async () => {
    const result = buildParser(ssaTestDsl as any);
    tmpDir = path.join(__dirname, "scratch_build_ssa");
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const imports = {
      env: { memory: memory, abort: () => {} },
      JavaScript: { debugLog: () => {}, logNode: () => {} },
      engine: { debugLog: () => {} },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    wasmExports = instance.exports;
  }, 60000);

  it("should export SSA and dominator routines from generated WASM module", () => {
    expect(typeof wasmExports.computeSSAPostOrder).toBe("function");
    expect(typeof wasmExports.computeDominators).toBe("function");
    expect(typeof wasmExports.computeDominanceFrontiers).toBe("function");
    expect(typeof wasmExports.getDominanceFrontier).toBe("function");
    expect(typeof wasmExports.placePhiNodes).toBe("function");
    expect(typeof wasmExports.allocBlock).toBe("function");
  });

  it("should correctly compute dominators and dominance frontiers for an If-Else diamond CFG", () => {
    // Layout offsets from ir_layout
    const BLOCK_FIRST_INSTR = 0;
    const BLOCK_TRUE_BRANCH = 8;
    const BLOCK_FALSE_BRANCH = 12;
    const BLOCK_DOMINATOR = 36;
    const BLOCK_POST_ORDER = 48;
    const IR_OPCODE_PHI = 100;

    // Construct Diamond CFG:
    // B0 (entry) -> B1 (true), B2 (false)
    // B1 -> B3 (join)
    // B2 -> B3 (join)
    const b0 = wasmExports.allocBlock();
    const b1 = wasmExports.allocBlock();
    const b2 = wasmExports.allocBlock();
    const b3 = wasmExports.allocBlock();

    const getMem = () => new DataView(wasmExports.memory.buffer);

    getMem().setUint32(b0 + BLOCK_TRUE_BRANCH, b1, true);
    getMem().setUint32(b0 + BLOCK_FALSE_BRANCH, b2, true);
    getMem().setUint32(b1 + BLOCK_TRUE_BRANCH, b3, true);
    getMem().setUint32(b2 + BLOCK_TRUE_BRANCH, b3, true);

    // 1. Post-Order & RPO
    const numBlocks = wasmExports.computeSSAPostOrder(b0);
    expect(numBlocks).toBe(4);

    const po0 = getMem().getUint32(b0 + BLOCK_POST_ORDER, true);
    const po3 = getMem().getUint32(b3 + BLOCK_POST_ORDER, true);
    expect(po0).toBe(3); // Entry finishes last in post-order DFS
    expect(po3).toBe(0); // Leaf/join finishes first in post-order DFS

    // 2. Immediate Dominators
    wasmExports.computeDominators(b0);
    const idom0 = getMem().getUint32(b0 + BLOCK_DOMINATOR, true);
    const idom1 = getMem().getUint32(b1 + BLOCK_DOMINATOR, true);
    const idom2 = getMem().getUint32(b2 + BLOCK_DOMINATOR, true);
    const idom3 = getMem().getUint32(b3 + BLOCK_DOMINATOR, true);

    expect(idom0).toBe(b0); // Entry dominates itself
    expect(idom1).toBe(b0); // B0 idom B1
    expect(idom2).toBe(b0); // B0 idom B2
    expect(idom3).toBe(b0); // B0 idom B3 (since B1 and B2 merge)

    // 3. Dominance Frontiers
    wasmExports.computeDominanceFrontiers(b0);

    const df1Ptr = wasmExports.getDominanceFrontier(b1);
    expect(df1Ptr).toBeGreaterThan(0);
    const df1Count = getMem().getUint32(df1Ptr, true);
    expect(df1Count).toBe(1);
    const df1Target = getMem().getUint32(df1Ptr + 8, true);
    expect(df1Target).toBe(b3); // DF(B1) = { B3 }

    const df2Ptr = wasmExports.getDominanceFrontier(b2);
    expect(df2Ptr).toBeGreaterThan(0);
    const df2Count = getMem().getUint32(df2Ptr, true);
    expect(df2Count).toBe(1);
    const df2Target = getMem().getUint32(df2Ptr + 8, true);
    expect(df2Target).toBe(b3); // DF(B2) = { B3 }

    // 4. Phi Node Placement
    wasmExports.placePhiNodes(b0);

    const firstInstrB3 = getMem().getUint32(b3 + BLOCK_FIRST_INSTR, true);
    expect(firstInstrB3).toBeGreaterThan(0);
    const opcodeB3 = getMem().getUint16(firstInstrB3, true);
    expect(opcodeB3).toBe(IR_OPCODE_PHI);
  });

  it("should correctly compute dominators and dominance frontiers for a While Loop CFG with back-edges", () => {
    const BLOCK_FIRST_INSTR = 0;
    const BLOCK_TRUE_BRANCH = 8;
    const BLOCK_FALSE_BRANCH = 12;
    const BLOCK_DOMINATOR = 36;
    const IR_OPCODE_PHI = 100;

    // While Loop CFG:
    // B0 (header) -> B1 (body, true), B2 (exit, false)
    // B1 -> B0 (back-edge)
    const b0 = wasmExports.allocBlock();
    const b1 = wasmExports.allocBlock();
    const b2 = wasmExports.allocBlock();

    const getMem = () => new DataView(wasmExports.memory.buffer);

    getMem().setUint32(b0 + BLOCK_TRUE_BRANCH, b1, true);
    getMem().setUint32(b0 + BLOCK_FALSE_BRANCH, b2, true);
    getMem().setUint32(b1 + BLOCK_TRUE_BRANCH, b0, true);

    wasmExports.computeDominators(b0);

    const idom0 = getMem().getUint32(b0 + BLOCK_DOMINATOR, true);
    const idom1 = getMem().getUint32(b1 + BLOCK_DOMINATOR, true);
    const idom2 = getMem().getUint32(b2 + BLOCK_DOMINATOR, true);

    expect(idom0).toBe(b0);
    expect(idom1).toBe(b0);
    expect(idom2).toBe(b0);

    wasmExports.computeDominanceFrontiers(b0);

    const df1Ptr = wasmExports.getDominanceFrontier(b1);
    expect(df1Ptr).toBeGreaterThan(0);
    const df1Count = getMem().getUint32(df1Ptr, true);
    expect(df1Count).toBe(1);
    const df1Target = getMem().getUint32(df1Ptr + 8, true);
    expect(df1Target).toBe(b0); // DF(B1) = { B0 }

    wasmExports.placePhiNodes(b0);

    const firstInstrB0 = getMem().getUint32(b0 + BLOCK_FIRST_INSTR, true);
    expect(firstInstrB0).toBeGreaterThan(0);
    const opcodeB0 = getMem().getUint16(firstInstrB0, true);
    expect(opcodeB0).toBe(IR_OPCODE_PHI);
  });
});
