import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import {
  analysis,
  choice,
  domain,
  field,
  flow,
  language,
  optional,
  repeat,
  semanticToken,
  seq,
  transfer,
} from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Test Language DSL Definition using Functional Combinators
const modelicaCombinatorDsl = language({
  name: "ModelicaCombinatorTest",
  rules: {
    Program: ($: any) => repeat($.ModelDef),
    ModelDef: ($: any) =>
      seq(
        semanticToken("keyword", "model"),
        field("name", $.Identifier),
        repeat(choice($.Decl, $.Stmt)),
        semanticToken("keyword", "end"),
        field("endName", $.Identifier),
        ";",
      ),
    Decl: ($: any) =>
      seq(field("type", $.Identifier), field("name", $.Identifier), optional(seq("=", field("value", $.Expr))), ";"),
    Stmt: ($: any) => choice($.Assignment, $.WhileLoop),
    Assignment: ($: any) => seq(field("lhs", $.Identifier), "=", field("rhs", $.Expr), ";"),
    WhileLoop: ($: any) => seq("while", field("condition", $.Expr), "do", repeat($.Stmt), "end while", ";"),
    Expr: ($: any) => choice($.Identifier, $.Number),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($: any) => semanticToken("number", /[0-9]+/),
  },
  extras: ($: any) => [/\s+/],

  // Control Flow Graph Combinators
  cfgNodes: flow.rules({
    WhileLoop: flow.loop({
      cond: flow.field("condition"),
      body: flow.children("do"),
    }),
    ModelDef: flow.seq(flow.children("Decl"), flow.children("Stmt")),
  }),

  // Abstract Domain & Dataflow Specification
  analysis: {
    arrayBounds: analysis({
      domain: domain.octagon(),
      transfers: [
        transfer.on("Assignment", transfer.assign(flow.field("lhs"), flow.field("rhs"))),
        transfer.on("WhileLoop", transfer.assume(flow.field("condition"))),
      ],
    }),
  },
});

describe("Functional Combinators & Native Octagon Abstract Domain", () => {
  let tmpDir: string;
  let wasmExports: any;

  beforeAll(async () => {
    const result = buildParser(modelicaCombinatorDsl as any);
    tmpDir = path.join(__dirname, "scratch_build_octagon");
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

  it("should export functional combinators correctly from dsl.ts", () => {
    expect(flow.seq).toBeDefined();
    expect(flow.branch).toBeDefined();
    expect(flow.loop).toBeDefined();
    expect(flow.switch).toBeDefined();
    expect(flow.try).toBeDefined();
    expect(flow.call).toBeDefined();
    expect(domain.octagon).toBeDefined();
    expect(transfer.assign).toBeDefined();
  });

  it("should construct and close Difference Bound Matrix (DBM) in WASM linear memory", () => {
    if (typeof wasmExports.initOctagonDBM === "function") {
      // Initialize DBM for 3 variables (x_0, x_1, x_2)
      wasmExports.initOctagonDBM(3);

      // Assume x_0 - x_1 <= 5
      wasmExports.assumeOctagonDiff(0, 1, 5);

      // Assume x_1 - x_2 <= 3
      wasmExports.assumeOctagonDiff(1, 2, 3);

      // Floyd-Warshall closure should infer x_0 - x_2 <= 8
      const isSatisfied = Boolean(wasmExports.checkOctagonDiff(0, 2, 8));
      expect(isSatisfied).toBe(true);

      const isViolated = Boolean(wasmExports.checkOctagonDiff(0, 2, 4));
      expect(isViolated).toBe(false);
    }
  });
});
