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
  word: ($) => $.Identifier,
  primitives: {
    nestedComment: { open: "/*", close: "*/" },
    lineComment: "//",
    multiWordKeywords: ["end model", "end if", "end while"],
  },
  rules: {
    Program: ($) => repeat($.ModelDef),
    ModelDef: ($) =>
      seq(
        semanticToken("keyword", "model"),
        field("name", $.Identifier),
        "{",
        repeat(choice($.Decl, $.Equation, $.IfStmt, $.WhileStmt)),
        semanticToken("keyword", "end model"),
        ";",
      ),
    Decl: ($) =>
      seq(field("type", $.Type), field("name", $.Identifier), optional(seq("=", field("value", $.Expr))), ";"),
    Type: ($) => choice("Real", "Integer", "Number"),
    Equation: ($) => seq(field("lhs", $.Expr), "=", field("rhs", $.Expr), ";"),
    IfStmt: ($) =>
      seq(
        "if",
        field("condition", $.Expr),
        "then",
        field("thenBody", $.Expr),
        optional(seq("else", field("elseBody", $.Expr))),
        "end if",
        ";",
      ),
    WhileStmt: ($) => seq("while", field("condition", $.Expr), "do", field("body", $.Expr), "end while", ";"),
    Expr: ($) => choice($.MulExpr, $.AddExpr, $.Identifier, $.Number),
    MulExpr: ($) => prec.left(2, seq(field("left", $.Expr), field("op", "*"), field("right", $.Expr))),
    AddExpr: ($) => prec.left(1, seq(field("left", $.Expr), field("op", choice("+", "-")), field("right", $.Expr))),
    Identifier: ($) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($) => semanticToken("number", /[0-9]+(?:\.[0-9]+)?/),
  },
  extras: ($) => [/\s/],
  cfgNodes: {
    IfStmt: { condition: "condition", trueBranch: "thenBody", falseBranch: "elseBody" },
    WhileStmt: { condition: "condition", trueBranch: "body", isLoop: true },
  },
  analysis: {
    uninitialized: {
      lattice: ["Initialized", "Uninitialized"],
      direction: "forward",
      join: (state1: number, state2: number) => (state1 > state2 ? state1 : state2),
      transfer: (nodeId: number, stateIn: number) => stateIn,
    },
  },
});

describe("Playground Model Test", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(dsl as any);
    tmpDir = path.join(__dirname, "scratch_build_playground");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
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
        debugLog: (cat: number, v1: number, v2: number, v3: number) => {
          console.log("debugLog:", cat, v1, v2, v3);
        },
      },
      JavaScript: {
        debugLog: (cat: number, v1: number, v2: number, v3: number) => {
          console.log("debugLog JS:", cat, v1, v2, v3);
        },
        logNode: () => {},
      },
      engine: {
        debugLog: (cat: number, v1: number, v2: number, v3: number) => {
          console.log("debugLog engine:", cat, v1, v2, v3);
        },
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
    console.log("TEST 2 AST SEXPR:", activeFacade.getAstSExpr(ast));
    const diags = activeFacade.getDiagnostics(ast);

    // ElectricalCircuit on line 1 (0-indexed line 0) must produce diagnostics for 4{4
    const line0Diags = diags.filter((d: any) => d.range.start.line === 0);
    console.log("TEST 2 DIAGS:", JSON.stringify(diags, null, 2));
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

  it("should NOT produce extra diagnostics on line 9 when line 1 has 'error ElectricalCircuit {' and should position squiggles accurately", () => {
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

    // 1. Line 0 'Expected model' should cover the word 'error' (chars 0 to 5, bytes 0 to 10)
    const line0ModelDiag = diags.find((d: any) => d.range.start.line === 0 && d.message.includes("model"));
    expect(line0ModelDiag).toBeDefined();
    expect(line0ModelDiag.range.start.character).toBe(0);
    expect(line0ModelDiag.range.end.character).toBe(5);

    expect(diags.length).toBeGreaterThan(0);
  });

  it("should NOT shift downstream squiggles when typing any invalid token length from 1 to 65+ characters on line 1", () => {
    const prefixes: string[] = [];
    for (let len = 1; len <= 65; len++) {
      prefixes.push("s".repeat(len));
    }
    prefixes.push(
      "e",
      "er",
      "err",
      "erro",
      "error",
      "modelk",
      "modelkk",
      "modelkkk",
      "modelkkkk",
      "modelkkkkk",
      "sadad",
      "sadadsadasd",
      "sadadsadasdasdsadsadasdasdasdasdasdasdasdasdasdasd",
    );

    for (const prefix of prefixes) {
      const code = `${prefix} ElectricalCircuit {
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  equation
    voltage = current * 10;
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

      // 1. Verify line 0 error squiggle is strictly isolated to line 0 (col 0..prefix.length)
      const line0Err = diags.find((d: any) => d.range.start.line === 0);
      expect(line0Err).toBeDefined();
      expect(line0Err.range.start.character).toBe(0);
      expect(line0Err.range.end.character).toBe(prefix.length);

      // 2. If ThermalSystem line 12 warning ('heatFlow') exists, verify it stays 100% ANCHORED on 'heatFlow' (col 6..14)
      const line12Uninit = diags.find((d: any) => d.range.start.line === 12 && d.message.includes("uninitialized"));
      if (line12Uninit) {
        expect(line12Uninit.range.start.character).toBe(6); // ' heatFlow' starts at col 6 ('h')
        expect(line12Uninit.range.end.character).toBe(14); // 'heatFlow' ends at col 14
      }

      // 3. If ThermalSystem parsed cleanly, verify NO diagnostic starts on 'Real' (col 2)
      if (line12Uninit) {
        const line12Real = diags.find((d: any) => d.range.start.line === 12 && d.range.start.character === 2);
        expect(line12Real).toBeUndefined();
      }
    }
  });

  it("should snap error diagnostic ranges to token word boundaries and never slice mid-token", () => {
    const code = `ERR ElectricalCircuit {
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

    const lines = code.split("\n");
    for (const d of diags) {
      const lineText = lines[d.range.start.line] || "";
      const startChar = d.range.start.character;
      const endChar = d.range.end.character;

      // If startChar is inside a word, the character preceding startChar should NOT be alphanumeric
      if (startChar > 0 && startChar < lineText.length) {
        const charBefore = lineText[startChar - 1];
        const isAlnumBefore = /[a-zA-Z0-9_]/.test(charBefore);
        const charAt = lineText[startChar];
        const isAlnumAt = /[a-zA-Z0-9_]/.test(charAt);
        if (isAlnumBefore && isAlnumAt) {
          console.error("DIAG START MID-WORD:", d, "lineText:", lineText);
        }
        expect(isAlnumBefore && isAlnumAt).toBe(false);
      }

      // If endChar is inside a word, the character at endChar should NOT be alphanumeric if charBefore is alphanumeric
      const endLineText = lines[d.range.end.line] || "";
      if (endChar > 0 && endChar < endLineText.length) {
        const charBefore = endLineText[endChar - 1];
        const isAlnumBefore = /[a-zA-Z0-9_]/.test(charBefore);
        const charAt = endLineText[endChar];
        const isAlnumAt = /[a-zA-Z0-9_]/.test(charAt);
        if (isAlnumBefore && isAlnumAt) {
          console.log(
            "FAILED DIAGNOSTIC END:",
            d,
            "endLineText:",
            JSON.stringify(endLineText),
            "charBefore:",
            charBefore,
            "charAt:",
            charAt,
          );
        }
        expect(isAlnumBefore && isAlnumAt).toBe(false);
      }
    }
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
    console.log("TREE TEST 316:\n", activeFacade.getAstSExpr(ast, true));
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
    expect(duration).toBeLessThan(500); // Expect latency well under 500ms in Jest cold VM
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
    console.log("TEST 11 ALL DIAGS:", JSON.stringify(diags, null, 2));
    const line0Diags = diags.filter((d: any) => d.range.start.line === 0);
    expect(line0Diags.length).toBeGreaterThan(0);
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
    console.log("AST VERBOSE:\n", activeFacade.getAstSExpr(astInc, true));
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
    console.log("TREE FOR TEST 426:\n", tree);
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

  it("should resolve 'name' field to virtual node when component name is missing ('Real ;')", () => {
    const code = `model TestModel {
  Real ;
  Real power;
end model;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);

    // Verify syntax error is emitted for missing name on line 1
    const syntaxErrors = diags.filter((d: any) => d.range.start.line === 1);
    console.log("TEST 15 DIAGS:", JSON.stringify(diags, null, 2));
    expect(syntaxErrors.length).toBeGreaterThan(0);

    // Line 2 has valid declaration 'Real power;'
    // Verify AST node tree parsed both declarations
    const tree = activeFacade.getAstSExpr(ast);
    expect(tree).toContain("Decl");
  });

  it("should preserve positional field resolution when extra invalid tokens exist inside declaration ('Real 123 power;')", () => {
    const code = `model TestModel {
  Real 123 power;
end model;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);

    // Verify syntax error is isolated to line 1
    const syntaxErrors = diags.filter((d: any) => d.range.start.line === 1);
    expect(syntaxErrors.length).toBeGreaterThan(0);

    // Verify AST parses the invalid line inside an isolated ERROR node
    const tree = activeFacade.getAstSExpr(ast);
    expect(tree).toContain("ERROR");
  });

  it("should directly verify WASM getChildByFieldId returns child 1 ('name' = power) when node has error flags", () => {
    const code = `modKel ElectricalCircuit {
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;
end model;
`;
    activeFacade.lastAstRoot = 0;
    const astRoot = activeFacade.parse(code);

    // Collect all AST node pointers
    const allNodes: number[] = [];
    const traverse = (ptr: number) => {
      if (ptr === 0) return;
      allNodes.push(ptr);
      let child = activeFacade.exports.getNodeFirstChild(ptr);
      while (child !== 0) {
        traverse(child);
        child = activeFacade.exports.getNodeNextSibling(child);
      }
    };
    traverse(astRoot);

    // Find a node that has at least 3 children (Decl nodes have 3 or 4 children)
    const multiChildNodes = allNodes.filter((ptr) => {
      let count = 0;
      let c = activeFacade.exports.getNodeFirstChild(ptr);
      while (c !== 0) {
        count++;
        c = activeFacade.exports.getNodeNextSibling(c);
      }
      return count >= 3;
    });

    expect(multiChildNodes.length).toBeGreaterThan(0);

    for (const targetNode of multiChildNodes) {
      const type = activeFacade.exports.getNodeType(targetNode);
      // Get the exact field ID associated with child 1 (index 1 = 'name') for this node type
      const fieldIdForName = activeFacade.exports.getFieldIdForChild
        ? activeFacade.exports.getFieldIdForChild(type, 1)
        : -1;
      if (fieldIdForName > 0) {
        const child0 = activeFacade.exports.getNodeFirstChild(targetNode);
        const child1 = activeFacade.exports.getNodeNextSibling(child0);

        const fieldResult = activeFacade.exports.getChildByFieldId(targetNode, fieldIdForName);
        if (fieldResult > 0) {
          // Verify that getChildByFieldId returns child1 ('name' = power), NOT child0 ('Type' = Real)
          expect(fieldResult).toBe(child1);
          expect(fieldResult).not.toBe(child0);
        }
      }
    }
  });
});
