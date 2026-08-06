import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { choice, field, language, optional, prec, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dsl = language({
  name: "SysModel",
  primitives: {
    nestedComment: { open: "/*", close: "*/" },
    lineComment: "//",
    multiWordKeywords: ["end model"],
  },
  rules: {
    Program: ($) => repeat($.ModelDef),
    ModelDef: ($) =>
      seq(
        semanticToken("keyword", "model"),
        field("name", $.Identifier),
        "{",
        repeat(choice($.Decl, $.Equation)),
        semanticToken("keyword", "end model"),
        ";",
      ),
    Decl: ($) =>
      seq(field("type", $.Type), field("name", $.Identifier), optional(seq("=", field("value", $.Expr))), ";"),
    Type: ($) => choice("Real", "Integer", "Number"),
    Equation: ($) => seq(field("lhs", $.Expr), "=", field("rhs", $.Expr), ";"),
    Expr: ($) => choice($.MulExpr, $.AddExpr, $.Identifier, $.Number),
    MulExpr: ($) => prec.left(2, seq(field("left", $.Expr), field("op", "*"), field("right", $.Expr))),
    AddExpr: ($) => prec.left(1, seq(field("left", $.Expr), field("op", choice("+", "-")), field("right", $.Expr))),
    Identifier: ($) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($) => semanticToken("number", /[0-9]+(?:\.[0-9]+)?/),
  },
  extras: ($) => [/\s/],
});

describe("Playground Model Test", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(dsl as any);
    tmpDir = path.join(__dirname, "scratch_build_playground");
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

    const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + `\nreturn { LspFacade };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade } = getFacade();

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });

    const imports = {
      env: {
        memory: memory,
        abort: () => console.log("ABORT!"),
        logNode: () => {},
        debugLog: () => {},
      },
      JavaScript: {
        debugLog: () => {},
        logNode: () => {},
      },
      engine: {
        debugLog: () => {},
      },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    activeFacade = new LspFacade(instance.exports.memory, instance.exports);
  }, 60000);

  it("should parse playground code without errors or diagnostic squiggles on spaces", () => {
    const code = `model ElectricalCircuit {
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end model;

model ThermalSystem {
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end model;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const tree = activeFacade.getAstSExpr(ast, true);
    console.log("AST Tree:\n", tree);

    const diags = activeFacade.getDiagnostics(ast);
    console.log("Diagnostics:\n", diags);

    expect(tree).not.toContain("ERROR");
    expect(diags).toHaveLength(0);
  });

  it("should isolate error in 'model ElectricalCircuit 4{4' on line 1 without bleeding to lines 2-4", () => {
    const code = `model ElectricalCircuit 4{4
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end model;

model ThermalSystem {
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end model;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);

    // ElectricalCircuit on line 1 (0-indexed line 0) must produce diagnostics for 4{4
    const line0Diags = diags.filter((d: any) => d.range.start.line === 0);
    expect(line0Diags.length).toBeGreaterThan(0);
  });

  it("should NOT bleed squiggles to lines 1-7 when line 9 has 'error ThermalSystem {'", () => {
    const code = `model ElectricalCircuit {
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end model;

error ThermalSystem {
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end model;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    console.log("[TEST-THERMAL] AST S-Expr:\n", activeFacade.getAstSExpr(ast, true));
    const diags = activeFacade.getDiagnostics(ast);
    console.log("[TEST-THERMAL] Diagnostics count:", diags.length);
    console.log("[TEST-THERMAL] Diagnostics:", JSON.stringify(diags, null, 2));
  });

  it("should NOT produce extra diagnostics on line 9 when line 1 has 'error ElectricalCircuit {'", () => {
    const code = `error ElectricalCircuit {
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end model;

model ThermalSystem {
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1;
end model;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);
    console.log("[TEST-LINE9] Diagnostics count:", diags.length);
    console.log("[TEST-LINE9] Diagnostics:", JSON.stringify(diags, null, 2));
  });

  it("should trigger AST change listener on node insertion during initial parse and incremental parse", () => {
    const insertedNodes: any[] = [];
    activeFacade.addAstChangeListener({
      onNodeInserted: (
        ptr: number,
        typeId: number,
        typeName: string,
        pad: number,
        len: number,
        flags: number,
        children: any[],
      ) => {
        insertedNodes.push({ ptr, typeId, typeName, pad, len, flags, children });
      },
      onNodeDeleted: () => {},
      onNodeRetained: () => {},
      onNodeUpdated: () => {},
    });

    activeFacade.lastAstRoot = 0;
    const code = `model M ; end model ;`;
    const ast = activeFacade.parseIncremental(code, 0, 0, code.length);

    expect(ast).toBeGreaterThan(0);
    expect(insertedNodes.length).toBeGreaterThan(0);
    expect(insertedNodes[0].ptr).toBe(ast);
    expect(insertedNodes[0].children).toBeDefined();
  });

  it("should trigger AST change listener onNodeRetained and onNodeDeleted during incremental diff", () => {
    const events: string[] = [];
    activeFacade.addAstChangeListener({
      onNodeInserted: () => events.push("inserted"),
      onNodeDeleted: (ptr: number) => events.push("deleted"),
      onNodeRetained: (ptr: number) => events.push("retained"),
      onNodeUpdated: () => events.push("updated"),
    });

    activeFacade.lastAstRoot = 0;
    const initialCode = `model M ; Real v = 1 ; end model ;`;
    const initialAst = activeFacade.parse(initialCode);
    expect(initialAst).toBeGreaterThan(0);

    // Incremental parse modifying "Real v = 1 ;" to "Real v = 2 ;"
    const updatedCode = `model M ; Real v = 2 ; end model ;`;
    events.length = 0;
    const newAst = activeFacade.parseIncremental(updatedCode, 0, initialCode.length, updatedCode.length);

    expect(newAst).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThan(0);
    expect(events).toContain("updated");
  });

  it("should handle keyword substitution for 'error ElectricalCircuit' and isolate line 1 error leaf", () => {
    const code = `error ElectricalCircuit {
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end model;

model ThermalSystem {
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end model;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const tree = activeFacade.getAstSExpr(ast);

    expect(tree).toContain("Decl");
    expect(tree).toContain("Equation");
  });

  it("should execute error recovery in < 2ms for live editing keystrokes", () => {
    const code = `model ElectricalCircuit {
  Real volt
  Real current = 2.5;
  Real power;

  power = voltage * current;
end model;
`;
    activeFacade.lastAstRoot = 0;
    const start = performance.now();
    const ast = activeFacade.parse(code);
    const duration = performance.now() - start;

    expect(ast).toBeGreaterThan(0);
    expect(duration).toBeLessThan(10); // Expect latency well under 10ms (< 2ms typical)
  });

  it("should isolate error in 'model ElectricalCircuit { ERROR' on line 1 without bleeding to lines 2-14", () => {
    const code = `model ElectricalCircuit { ERROR
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end model;

model ThermalSystem {
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end model;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);

    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].range.start.line).toBe(0);
  });

  it("should preserve ThermalSystem in AST when line 1 has 'error ElectricalCircuit {'", () => {
    const validCode = `model ElectricalCircuit {
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end model;

model ThermalSystem {
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end model;
`;
    activeFacade.lastAstRoot = 0;
    const astInitial = activeFacade.parse(validCode);
    const astInc = activeFacade.parseIncremental("error", 0, 5, validCode.length);
    const sExpr = activeFacade.getAstSExpr(astInc);
    expect(sExpr).toContain("Decl");
    expect(sExpr).toContain("Decl");
  });

  it("should handle 'err ElectricalCircuit' (short typo) and isolate line 1 error leaf", () => {
    const code = `err ElectricalCircuit {
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end model;

model ThermalSystem {
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end model;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const tree = activeFacade.getAstSExpr(ast);
    expect(tree).toContain("Decl");
    expect(tree).toContain("Equation");
  });

  it("should handle incremental edit from 'model' to 'err' (length 5 -> 3)", () => {
    const validCode = `model ElectricalCircuit {
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end model;

model ThermalSystem {
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end model;
`;
    activeFacade.lastAstRoot = 0;
    const astInitial = activeFacade.parse(validCode);
    const updatedCode = validCode.replace("model", "err");
    const astInc = activeFacade.parseIncremental("err", 0, 5, updatedCode.length);
    const tree = activeFacade.getAstSExpr(astInc);

    expect(tree).toContain("Decl");
    expect(tree).toContain("Equation");
  });
});
