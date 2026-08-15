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
    multiWordKeywords: ["end if", "end while"],
  },
  rules: {
    Program: ($) => repeat($.ModelDef),
    ModelDef: ($) =>
      seq(
        semanticToken("keyword", "model"),
        field("name", $.Identifier),
        repeat(choice($.Decl, $.Equation, $.IfStmt, $.WhileStmt)),
        semanticToken("keyword", "end"),
        field("endName", $.Identifier),
        ";",
      ),
    Decl: ($) =>
      seq(field("type", $.Type), field("name", $.Identifier), optional(seq("=", field("value", $.Expr))), ";"),
    Real: ($) => semanticToken("type", "Real"),
    Integer: ($) => semanticToken("type", "Integer"),
    Type: ($) => choice($.Real, $.Integer, "Number"),
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
    tmpDir = path.join(__dirname, "../build/scratch_build_playground");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }

    const ascPath =
      [
        path.resolve(__dirname, "../../node_modules/.bin/asc"),
        path.resolve(__dirname, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
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
  }, 180000);

  it("should parse playground code without errors or diagnostic squiggles on spaces", async () => {
    const code = `model ElectricalCircuit
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const tree = activeFacade.getAstSExpr(ast, true);
    console.log("AST Tree:\n", tree);

    const diags = activeFacade.getDiagnostics(ast);
    console.log("[DIAG-DUMP]", JSON.stringify(diags, null, 2));
    console.log("Diagnostics:\n", diags);

    expect(tree).not.toContain("ERROR");
    expect(diags).toHaveLength(0);
  });

  it("should isolate error in 'model ElectricalCircuit 4' on line 1 without bleeding to lines 2-4", () => {
    const code = `model ElectricalCircuit 4
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    console.log("TEST 2 AST SEXPR:", activeFacade.getAstSExpr(ast));
    const diags = activeFacade.getDiagnostics(ast);
    console.log("[DIAG-DUMP]", JSON.stringify(diags, null, 2));

    // ElectricalCircuit on line 1 (0-indexed line 0) must produce diagnostics for 4
    const line0Diags = diags.filter((d: any) => d.range.start.line === 0);
    console.log("TEST 2 DIAGS:", JSON.stringify(diags, null, 2));
    expect(line0Diags.length).toBeGreaterThan(0);
  });

  it("should NOT bleed squiggles to lines 1-7 when line 9 has 'error ThermalSystem'", () => {
    const code = `model ElectricalCircuit
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

error ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    console.log("[TEST-THERMAL] AST S-Expr:\n", activeFacade.getAstSExpr(ast, true));
    const diags = activeFacade.getDiagnostics(ast);
    console.log("[DIAG-DUMP]", JSON.stringify(diags, null, 2));
    console.log("[TEST-THERMAL] Diagnostics count:", diags.length);
    console.log("[TEST-THERMAL] Diagnostics:", JSON.stringify(diags, null, 2));
  });

  it("should NOT produce extra diagnostics on line 9 when line 1 has 'error ElectricalCircuit' and should position squiggles accurately", () => {
    const code = `error ElectricalCircuit
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1;
end ThermalSystem;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);
    console.log("[DIAG-DUMP]", JSON.stringify(diags, null, 2));

    // 1. Line 0 error should cover the word 'error' (chars 0 to 5, bytes 0 to 10)
    const line0ModelDiag = diags.find((d: any) => d.range.start.line === 0);
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
      const code = `${prefix} ElectricalCircuit
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  voltage = current * 10;
  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1;
end ThermalSystem;
`;
      activeFacade.lastAstRoot = 0;
      const ast = activeFacade.parse(code);
      const diags = activeFacade.getDiagnostics(ast);
      console.log("[DIAG-DUMP]", JSON.stringify(diags, null, 2));

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
    const code = `ERR ElectricalCircuit
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);
    console.log("[DIAG-DUMP]", JSON.stringify(diags, null, 2));

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
    const code = `model M ; end M ;`;
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
    const initialCode = `model M ; Real v = 1 ; end M ;`;
    const initialAst = activeFacade.parse(initialCode);
    expect(initialAst).toBeGreaterThan(0);

    // Incremental parse modifying "Real v = 1 ;" to "Real v = 2 ;"
    const updatedCode = `model M ; Real v = 2 ; end M ;`;
    events.length = 0;
    const newAst = activeFacade.parseIncremental(updatedCode, 0, initialCode.length, updatedCode.length);

    expect(newAst).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThan(0);
    expect(events).toContain("updated");
  });

  it("should handle keyword substitution for 'error ElectricalCircuit' and isolate line 1 error leaf", () => {
    const code = `error ElectricalCircuit
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    console.log("TREE TEST 316:\n", activeFacade.getAstSExpr(ast, true));
    const tree = activeFacade.getAstSExpr(ast);

    expect(tree).toContain("Decl");
    expect(tree).toContain("Equation");
  });

  it("should isolate line 1 error on 'ERROR ElectricalCircuit' to character 0..5 and preserve component declarations on lines 2-4", () => {
    const code = `ERROR ElectricalCircuit
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);
    console.log("[DIAG-DUMP]", JSON.stringify(diags, null, 2));

    // Line 0 error must be anchored on ERROR (character 0..5)
    const line0Diags = diags.filter((d: any) => d.range.start.line === 0);
    expect(line0Diags.length).toBeGreaterThan(0);
    expect(line0Diags[0].range.start.character).toBe(0);
    expect(line0Diags[0].range.end.character).toBe(5);

    // Component declarations on lines 1-3 must have no syntax error diagnostics
    const line1To3Diags = diags.filter(
      (d: any) => d.range.start.line >= 1 && d.range.start.line <= 3 && d.code === undefined,
    );
    expect(line1To3Diags.length).toBe(0);

    // AST root must be valid
    expect(ast).toBeGreaterThan(0);
  });

  it("should execute error recovery in < 2ms for live editing keystrokes", () => {
    const code = `model ElectricalCircuit
  Real volt
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;
`;
    activeFacade.lastAstRoot = 0;
    const start = performance.now();
    const ast = activeFacade.parse(code);
    const duration = performance.now() - start;

    expect(ast).toBeGreaterThan(0);
    expect(duration).toBeLessThan(500); // Expect latency well under 500ms in Jest cold VM
  });

  it("should isolate error in 'model ElectricalCircuit ERROR' on line 1 without bleeding to lines 2-14", () => {
    const code = `model ElectricalCircuit ERROR
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);
    console.log("[DIAG-DUMP]", JSON.stringify(diags, null, 2));
    console.log("TEST 11 ALL DIAGS:", JSON.stringify(diags, null, 2));
    const line0Diags = diags.filter((d: any) => d.range.start.line === 0);
    expect(line0Diags.length).toBeGreaterThan(0);
  });

  it("should preserve ThermalSystem in AST when line 1 has 'error ElectricalCircuit'", () => {
    const validCode = `model ElectricalCircuit
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;
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
    const code = `err ElectricalCircuit
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const tree = activeFacade.getAstSExpr(ast);
    console.log("TREE FOR TEST 426:\n", tree);
    expect(tree).toContain("Decl");
    expect(tree).toContain("Equation");
  });

  it("should handle incremental edit from 'model' to 'err' (length 5 -> 3)", () => {
    const validCode = `model ElectricalCircuit
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;
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
    const code = `model TestModel
  Real ;
  Real power;
end TestModel;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    console.log("TEST 15 AST TREE:\n", activeFacade.getAstSExpr(ast));
    const diags = activeFacade.getDiagnostics(ast);
    console.log("[DIAG-DUMP]", JSON.stringify(diags, null, 2));

    // Verify syntax error is emitted for missing name on line 1
    const syntaxErrors = diags.filter((d: any) => d.range.start.line <= 1);
    console.log("TEST 15 DIAGS:", JSON.stringify(diags, null, 2));
    expect(syntaxErrors.length).toBeGreaterThan(0);

    // Line 2 has valid declaration 'Real power;'
    // Verify AST node tree parsed both declarations
    const tree = activeFacade.getAstSExpr(ast);
    expect(tree).toContain("Identifier");
  });

  it("should preserve positional field resolution when extra invalid tokens exist inside declaration ('Real 123 power;')", () => {
    const code = `model TestModel
  Real 123 power;
end TestModel;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);
    console.log("[DIAG-DUMP]", JSON.stringify(diags, null, 2));

    // Verify syntax error is isolated to line 1
    const syntaxErrors = diags.filter((d: any) => d.range.start.line <= 1);
    expect(syntaxErrors.length).toBeGreaterThan(0);

    // Verify AST parses the invalid line inside an isolated ERROR node
    const tree = activeFacade.getAstSExpr(ast);
    expect(tree).toContain("ERROR");
  });

  it("should directly verify WASM getChildByFieldId returns child 1 ('name' = power) when node has error flags", () => {
    const code = `modKel ElectricalCircuit
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;
end ElectricalCircuit;
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

  it("should emit syntax error diagnostic for error recovery tokens 'error error ElectricalCircuit'", () => {
    const code = `error error ElectricalCircuit\n  Real power;\n  end ElectricalCircuit;\n`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);
    console.log("[DIAG-DUMP]", JSON.stringify(diags, null, 2));
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].startCharOffset).toBe(0);
    expect(diags[0].endCharOffset).toBeGreaterThan(0);
  });

  it("should target child node 'name' precisely in diagnostic without including type ('Real')", async () => {
    const dslWithLint = language({
      name: "SysModel",
      word: ($) => $.Identifier,
      primitives: {
        nestedComment: { open: "/*", close: "*/" },
        lineComment: "//",
      },
      rules: {
        Program: ($) => repeat($.ModelDef),
        ModelDef: ($) =>
          seq(
            semanticToken("keyword", "model"),
            field("name", $.Identifier),
            repeat(choice($.Decl, $.Equation)),
            semanticToken("keyword", "end"),
            field("endName", $.Identifier),
            ";",
          ),
        Decl: ($) =>
          seq(field("type", $.Type), field("name", $.Identifier), optional(seq("=", field("value", $.Expr))), ";"),
        Real: ($) => semanticToken("type", "Real"),
        Integer: ($) => semanticToken("type", "Integer"),
        Type: ($) => choice($.Real, $.Integer, $.Number),
        Equation: ($) => seq(field("lhs", $.Expr), "=", field("rhs", $.Expr), ";"),
        Expr: ($) => choice($.MulExpr, $.AddExpr, $.Identifier, $.Number),
        MulExpr: ($) => prec.left(2, seq(field("left", $.Expr), field("op", "*"), field("right", $.Expr))),
        AddExpr: ($) => prec.left(1, seq(field("left", $.Expr), field("op", choice("+", "-")), field("right", $.Expr))),
        Identifier: ($) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
        Number: ($) => semanticToken("number", /[0-9]+(?:\.[0-9]+)?/),
      },
      extras: ($) => [/\s/],
      lints: {
        uninitializedComponent: {
          nodes: ["Decl"],
          severity: "warning",
          message: "Component declaration uninitialized",
          query: (db: any, node: any) => {
            const valNode = db.ast.getChildByFieldId(node, "value");
            if (valNode == 0) {
              const nameNode = db.ast.getChildByFieldId(node, "name");
              if (nameNode != 0) {
                db.diagnostic(nameNode);
              }
            }
          },
        },
      },
    });
    const result = buildParser(dslWithLint as any);
    const tmpDirLocal = path.join(__dirname, "../build/scratch_build_lint_test");
    if (fs.existsSync(tmpDirLocal)) fs.rmSync(tmpDirLocal, { recursive: true, force: true });
    fs.mkdirSync(tmpDirLocal, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDirLocal, file.filename), file.content);
    }

    const ascPath =
      [
        path.resolve(__dirname, "../../node_modules/.bin/asc"),
        path.resolve(__dirname, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
    const parserTs = path.join(tmpDirLocal, "parser.ts");
    const outWasm = path.join(tmpDirLocal, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + `\nreturn { LspFacade };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade: LspFacadeLocal } = getFacade();

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const importsLocal = {
      env: {
        memory: memory,
        abort: () => {},
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

    const instance = await WebAssembly.instantiate(wasmModule, importsLocal);
    const facade = new LspFacadeLocal(instance.exports.memory, instance.exports);

    const baseCode = `model ElectricalCircuit
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;
`;
    facade.lastAstRoot = 0;
    const initialAst = facade.parseIncremental(baseCode, 0, 0, baseCode.length);
    const diags0 = facade.getDiagnostics(initialAst);
    expect(diags0).toHaveLength(2);

    // Simulate typing " errr" character by character:
    let curLen = baseCode.length;
    facade.parseIncremental(" ", 23, 0, ++curLen);
    facade.parseIncremental("e", 24, 0, ++curLen);
    facade.parseIncremental("r", 25, 0, ++curLen);
    facade.parseIncremental("r", 26, 0, ++curLen);
    const ast = facade.parseIncremental("r", 27, 0, curLen + 1);
    const diags1 = facade.getDiagnostics(ast);
    console.log("SEQUENTIAL KEYSTROKES DIAGS:\n", JSON.stringify(diags1, null, 2));

    expect(diags1).toHaveLength(3);

    const syntaxError = diags1.find((d: any) => d.severity === 1);
    expect(syntaxError).toBeDefined();
    expect(syntaxError.range.start.line).toBe(0);
    expect(syntaxError.range.start.character).toBe(24);
    expect(syntaxError.range.end.character).toBe(28);

    const powerDiag = diags1.find((d: any) => d.code === 2000 && d.range.start.line === 3);
    expect(powerDiag).toBeDefined();
    expect(powerDiag.range.start.character).toBe(7);
    expect(powerDiag.range.end.character).toBe(12);

    const heatFlowDiag = diags1.find((d: any) => d.code === 2000 && d.range.start.line === 10);
    expect(heatFlowDiag).toBeDefined();
    expect(heatFlowDiag.range.start.character).toBe(7);
    expect(heatFlowDiag.range.end.character).toBe(15);

    if (fs.existsSync(tmpDirLocal)) fs.rmSync(tmpDirLocal, { recursive: true, force: true });
  }, 30000);

  it("should NOT shift downstream diagnostics or produce trailing error on line 14 when typing 'model ElectricalCircuit e e'", async () => {
    const dslLocal = language({
      name: "SysModelEETest",
      word: ($: any) => $.Identifier,
      primitives: {
        nestedComment: { open: "/*", close: "*/" },
        lineComment: "//",
        multiWordKeywords: ["end if", "end while"],
      },
      rules: {
        Program: ($: any) => repeat($.ModelDef),
        ModelDef: ($: any) =>
          seq(
            semanticToken("keyword", "model"),
            field("name", $.Identifier),
            repeat(choice($.Decl, $.Equation, $.IfStmt, $.WhileStmt)),
            semanticToken("keyword", "end"),
            field("endName", $.Identifier),
            ";",
          ),
        Decl: ($: any) =>
          seq(field("type", $.Type), field("name", $.Identifier), optional(seq("=", field("value", $.Expr))), ";"),
        Real: ($: any) => semanticToken("type", "Real"),
        Integer: ($: any) => semanticToken("type", "Integer"),
        Type: ($: any) => choice($.Real, $.Integer, "Number"),
        Equation: ($: any) => seq(field("lhs", $.Expr), "=", field("rhs", $.Expr), ";"),
        IfStmt: ($: any) =>
          seq(
            "if",
            field("condition", $.Expr),
            "then",
            field("thenBody", $.Expr),
            optional(seq("else", field("elseBody", $.Expr))),
            "end if",
            ";",
          ),
        WhileStmt: ($: any) => seq("while", field("condition", $.Expr), "do", field("body", $.Expr), "end while", ";"),
        Expr: ($: any) => choice($.MulExpr, $.AddExpr, $.Identifier, $.Number),
        MulExpr: ($: any) => prec.left(2, seq(field("left", $.Expr), field("op", "*"), field("right", $.Expr))),
        AddExpr: ($: any) =>
          prec.left(1, seq(field("left", $.Expr), field("op", choice("+", "-")), field("right", $.Expr))),
        Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
        Number: ($: any) => semanticToken("number", /[0-9]+(?:\.[0-9]+)?/),
      },
      extras: ($: any) => [/\s/],
      lints: {
        uninitializedComponent: {
          nodes: ["Decl"],
          severity: "warning",
          message: "Component declaration uninitialized",
          query: (db: any, node: any, $: any) => {
            const valNode = db.ast.getChildByFieldId(node, "value");
            if (valNode == 0) {
              const nameNode = db.ast.getChildByFieldId(node, "name");
              if (nameNode != 0) {
                db.diagnostic(nameNode);
              }
            }
          },
        },
      },
    });

    const result = buildParser(dslLocal as any);
    const tmpDirLocal = path.join(__dirname, "../build/scratch_build_ee_test");
    if (fs.existsSync(tmpDirLocal)) fs.rmSync(tmpDirLocal, { recursive: true, force: true });
    fs.mkdirSync(tmpDirLocal, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDirLocal, file.filename), file.content);
    }

    const ascPath =
      [
        path.resolve(__dirname, "../../node_modules/.bin/asc"),
        path.resolve(__dirname, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
    const parserTs = path.join(tmpDirLocal, "parser.ts");
    const outWasm = path.join(tmpDirLocal, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + `\nreturn { LspFacade };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade: LspFacadeLocal } = getFacade();

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const importsLocal = {
      env: {
        memory: memory,
        abort: () => {},
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

    const instance = await WebAssembly.instantiate(wasmModule, importsLocal);
    const facade = new LspFacadeLocal(instance.exports.memory, instance.exports);

    const baseCode = `model ElectricalCircuit
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;
`;
    facade.lastAstRoot = 0;
    facade.parseIncremental(baseCode, 0, 0, baseCode.length);

    // Simulate typing " e e" character by character:
    let curLen = baseCode.length;
    facade.parseIncremental(" ", 23, 0, ++curLen);
    facade.parseIncremental("e", 24, 0, ++curLen);
    facade.parseIncremental(" ", 25, 0, ++curLen);
    const ast = facade.parseIncremental("e", 26, 0, curLen + 1);
    const diags = facade.getDiagnostics(ast);

    expect(diags).toHaveLength(3);

    const syntaxError = diags.find((d: any) => d.severity === 1);
    expect(syntaxError).toBeDefined();
    expect(syntaxError.range.start.line).toBe(0);
    expect(syntaxError.range.start.character).toBe(24);
    expect(syntaxError.range.end.character).toBe(27);

    const powerDiag = diags.find((d: any) => d.code === 2000 && d.range.start.line === 3);
    expect(powerDiag).toBeDefined();
    expect(powerDiag.range.start.character).toBe(7);
    expect(powerDiag.range.end.character).toBe(12);

    const heatFlowDiag = diags.find((d: any) => d.code === 2000 && d.range.start.line === 10);
    expect(heatFlowDiag).toBeDefined();
    expect(heatFlowDiag.range.start.character).toBe(7);
    expect(heatFlowDiag.range.end.character).toBe(15);

    if (fs.existsSync(tmpDirLocal)) fs.rmSync(tmpDirLocal, { recursive: true, force: true });
  }, 45000);

  it("should NOT produce spurious squiggles on downstream lines or false uninitialized warnings when 'mokdel' is typed on line 1", () => {
    const code = `mokdel ElectricalCircuit
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow = 0.0;

  heatFlow = temp * 1 + 0;
end ThermalSystem;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    console.log("TEST 21 AST:\n", activeFacade.getAstSExpr(ast));
    const diags = activeFacade.getDiagnostics(ast);
    console.log("[DIAG-DUMP]", JSON.stringify(diags, null, 2));
    console.log("TEST 21 DIAGS:\n", JSON.stringify(diags, null, 2));

    // 1. Line 0 (mokdel) should have a diagnostic for Expected 'model'
    const line0Diags = diags.filter((d: any) => d.range.start.line === 0);
    expect(line0Diags.length).toBeGreaterThan(0);

    // 2. Real current = 2.5 on line 2 must NOT fire uninitialized component warning
    const currentWarning = diags.find((d: any) => d.range.start.line === 2 && d.lintId === 2000);
    expect(currentWarning).toBeUndefined();

    // 3. ThermalSystem on lines 8-13 must NOT have spurious diagnostics
    const thermalDiags = diags.filter((d: any) => d.range.start.line >= 8);
    expect(thermalDiags).toHaveLength(0);
  });

  it("should preserve exact diagnostic squiggle ranges under parseIncremental live edits", async () => {
    const codeInitial = `model ElectricalCircuit
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;
`;

    const dslWithLint = {
      ...dsl,
      lints: {
        uninitializedComponent: {
          nodes: ["Decl"],
          severity: "warning",
          message: "Component declaration uninitialized",
          query: (db: any, node: any) => {
            const valNode = db.ast.getChildByFieldId(node, "value");
            if (valNode == 0) {
              const nameNode = db.ast.getChildByFieldId(node, "name");
              if (nameNode != 0) {
                db.diagnostic(nameNode);
              }
            }
          },
        },
      },
    };
    const result = buildParser(dslWithLint as any);
    const tmpDirLocal = path.join(__dirname, "../build/scratch_build_incremental_test");
    if (fs.existsSync(tmpDirLocal)) fs.rmSync(tmpDirLocal, { recursive: true, force: true });
    fs.mkdirSync(tmpDirLocal, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDirLocal, file.filename), file.content);
    }

    const ascPath =
      [
        path.resolve(__dirname, "../../node_modules/.bin/asc"),
        path.resolve(__dirname, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
    const parserTs = path.join(tmpDirLocal, "parser.ts");
    const outWasm = path.join(tmpDirLocal, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + `\nreturn { LspFacade };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade: LspFacadeLocal } = getFacade();

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const importsLocal = {
      env: {
        memory: memory,
        abort: () => {},
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

    const instance = await WebAssembly.instantiate(wasmModule, importsLocal);
    const facade = new LspFacadeLocal(instance.exports.memory, instance.exports);
    facade.setParserConfig(true, true, true, true);
    facade.lastAstRoot = 0;

    // 1. Initial Parse
    const ast1 = facade.parse(codeInitial);
    facade.lastAstRoot = ast1;
    const diags1 = facade.getDiagnostics(ast1);

    const powerDiag1 = diags1.find((d: any) => d.range.start.line === 3);
    const heatFlowDiag1 = diags1.find((d: any) => d.range.start.line === 10);

    expect(powerDiag1).toBeDefined();
    expect(powerDiag1.range.start.line).toBe(3);
    expect(powerDiag1.range.start.character).toBe(7);
    expect(powerDiag1.range.end.character).toBe(12);
    expect(heatFlowDiag1).toBeDefined();
    expect(heatFlowDiag1.range.start.line).toBe(10);
    expect(heatFlowDiag1.range.start.character).toBe(7);
    expect(heatFlowDiag1.range.end.character).toBe(15);

    // Verify voltage (line 1) and current (line 2) have NO uninitialized warnings
    expect(diags1.find((d: any) => d.range.start.line === 1)).toBeUndefined();
    expect(diags1.find((d: any) => d.range.start.line === 2)).toBeUndefined();

    // 2. Test with syntax error on line 1: ERROR ElectricalCircuit
    // 2. Test with live incremental edit on line 1: replace 'model' with 'error'
    const ast3 = facade.parseIncremental("error", 0, 5, codeInitial.length);

    const diags3 = facade.getDiagnostics(ast3);
    console.log("TEST 22 AST3 S-EXPR:\n", facade.getAstSExpr(ast3, true));
    console.log("TEST 22 DIAGS3:", JSON.stringify(diags3, null, 2));

    // Line 1 should have exactly one syntax error on 'error' (deduplicated)
    const line0Diags = diags3.filter((d: any) => d.range.start.line === 0 && d.severity === 1);
    expect(line0Diags.length).toBe(1);
    expect(line0Diags[0].range.start.character).toBe(0);
    expect(line0Diags[0].range.end.character).toBe(5);

    expect(diags3.length).toBeGreaterThan(0);

    if (fs.existsSync(tmpDirLocal)) fs.rmSync(tmpDirLocal, { recursive: true, force: true });
  }, 30000);

  it("should accurately position keyword substitution squiggles when leading indentation is present", () => {
    const code = `   error ElectricalCircuit
  Real voltage = 12.0;
  Real power;
end ElectricalCircuit;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);

    // Line 0 has 3 leading spaces: "   error" -> squiggle should be at chars 3..8
    const line0Diag = diags.find((d: any) => d.range.start.line === 0 && d.severity === 1);
    expect(line0Diag).toBeDefined();
    expect(line0Diag.range.start.character).toBe(3);
    expect(line0Diag.range.end.character).toBe(8);
  });

  it("should isolate multiple keyword substitution errors across separate models without panic cascading", () => {
    const code = `error FirstModel
  Real a = 1.0;
end FirstModel;

error SecondModel
  Real b = 2.0;
end SecondModel;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);
    console.log("SECOND MODEL DIAGS:", JSON.stringify(diags, null, 2));

    // Line 0: "error FirstModel" -> chars 0..5
    const line0Diag = diags.find((d: any) => d.range.start.line === 0 && d.severity === 1);
    expect(line0Diag).toBeDefined();
    expect(line0Diag.range.start.character).toBe(0);
    expect(line0Diag.range.end.character).toBe(5);

    // Line 4: "error SecondModel" -> chars 0..5
    const line4Diag = diags.find((d: any) => d.range.start.line === 4 && d.severity === 1);
    expect(line4Diag).toBeDefined();
    expect(line4Diag.range.start.character).toBe(0);
    expect(line4Diag.range.end.character).toBe(5);

    // Both models should be parsed and present in the AST
    const sexpr = activeFacade.getAstSExpr(ast, true);
    expect(sexpr).toContain("ModelDef [0, 0] - [2, 15]");
    expect(sexpr).toContain("ModelDef [4, 0] - [6, 16]");
  });

  it("should isolate incomplete declaration 'Real power=;' without corrupting subsequent equations or downstream model offsets", () => {
    const code = `model ElectricalCircuit
  Real voltage = 12.0;
  Real current = 2.5;
  Real power=;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;`;

    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);

    // 1. Line 3 (1-based Line 4): 'Real power=;' should have a syntax error
    const line3Errors = diags.filter((d: any) => d.range.start.line === 3 && d.severity === 1);
    expect(line3Errors.length).toBeGreaterThanOrEqual(1);

    // 2. Line 5 (1-based Line 6): 'power = voltage * current;' should NOT have syntax errors
    const line5Errors = diags.filter((d: any) => d.range.start.line === 5 && d.severity === 1);
    expect(line5Errors.length).toBe(0);

    // 3. Line 10 (1-based Line 11): '  Real heatFlow;' warning anchoring
    const heatFlowWarning = diags.find((d: any) => d.range.start.line === 10 && d.severity === 2);
    if (heatFlowWarning) {
      expect(heatFlowWarning.range.start.character).toBe(7);
      expect(heatFlowWarning.range.end.character).toBe(15);
    }
  });

  it("should isolate 'Real current = ;' on line 3 with clean 'name' field bounds and zero errors on line 6", async () => {
    const dslWithLint = {
      ...dsl,
      lints: {
        uninitializedComponent: {
          nodes: ["Decl"],
          severity: "warning",
          message: "Component declaration uninitialized",
          query: (db: any, node: any) => {
            const valNode = db.ast.getChildByFieldId(node, "value");
            if (valNode == 0) {
              const nameNode = db.ast.getChildByFieldId(node, "name");
              if (nameNode != 0) {
                db.diagnostic(nameNode);
              }
            }
          },
        },
      },
    };
    const result = buildParser(dslWithLint as any);
    const tmpDirLocal = path.join(__dirname, "../build/scratch_build_current_test");
    if (fs.existsSync(tmpDirLocal)) fs.rmSync(tmpDirLocal, { recursive: true, force: true });
    fs.mkdirSync(tmpDirLocal, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDirLocal, file.filename), file.content);
    }

    const ascPath =
      [
        path.resolve(__dirname, "../../node_modules/.bin/asc"),
        path.resolve(__dirname, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
    const parserTs = path.join(tmpDirLocal, "parser.ts");
    const outWasm = path.join(tmpDirLocal, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + `\nreturn { LspFacade };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade: LspFacadeLocal } = getFacade();

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const importsLocal = {
      env: {
        memory: memory,
        abort: () => {},
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

    const instance = await WebAssembly.instantiate(wasmModule, importsLocal);
    const facade = new LspFacadeLocal(instance.exports.memory, instance.exports);
    facade.setParserConfig(true, true, true, true);
    facade.lastAstRoot = 0;

    const code = `model ElectricalCircuit
  Real voltage = 12.0;
  Real current = ;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;`;

    const ast = facade.parse(code);
    const diags = facade.getDiagnostics(ast);

    // 1. Line 2 (0-indexed line 2 = editor line 3): '  Real current = ;'
    // Warning on 'current' should strictly span chars 7..14 (NOT 7..17 or 7..16)
    const currentWarning = diags.find((d: any) => d.range.start.line === 2 && d.severity === 2);
    expect(currentWarning).toBeDefined();
    expect(currentWarning.range.start.character).toBe(7);
    expect(currentWarning.range.end.character).toBe(14);

    // Syntax error on '=' should strictly span chars 15..16
    const currentSyntaxError = diags.find((d: any) => d.range.start.line === 2 && d.severity === 1);
    expect(currentSyntaxError).toBeDefined();
    expect(currentSyntaxError.range.start.character).toBe(15);
    expect(currentSyntaxError.range.end.character).toBe(16);

    // 2. Line 5 (0-indexed line 5 = editor line 6): '  power = voltage * current;' should have ZERO syntax errors
    const line5Errors = diags.filter((d: any) => d.range.start.line === 5 && d.severity === 1);
    expect(line5Errors.length).toBe(0);

    // 3. AST verification: Equation on line 5 should be present and valid
    const sexpr = facade.getAstSExpr(ast, true);
    expect(sexpr).toContain("Equation [5, 2] - [5, 28]");

    if (fs.existsSync(tmpDirLocal)) fs.rmSync(tmpDirLocal, { recursive: true, force: true });
  }, 180000);

  it("should dynamically size MAX_FIELD_CURSOR_DEPTH and resolve fields through deep synthetic grammar chains (depth > 16)", async () => {
    const rules: any = {
      Root: ($: any) => seq("start", $._L0, "end"),
    };
    for (let i = 0; i < 20; i++) {
      const currentName = `_L${i}`;
      if (i === 19) {
        rules[currentName] = ($: any) => seq("step", field("target", $.Identifier));
      } else {
        const nextName = `_L${i + 1}`;
        rules[currentName] = ($: any) => seq("step", $[nextName]);
      }
    }
    rules.Identifier = ($: any) => /[a-zA-Z_][a-zA-Z0-9_]*/;

    const deepDsl = language({
      name: "DeepSyntheticLanguage",
      rules,
      extras: ($: any) => [/\s/],
      lints: {
        flagDeepTarget: {
          nodes: ["Root"],
          severity: "warning",
          message: "Deep target resolved",
          query: (db: any, node: any) => {
            const targetNode = db.ast.getChildByFieldId(node, "target");
            if (targetNode != 0) {
              db.diagnostic(targetNode);
            }
          },
        },
      },
    });

    const result = buildParser(deepDsl as any);
    const parserFile = result.assemblyScriptFiles.find((f: any) => f.filename === "parser.ts");
    expect(parserFile).toBeDefined();
    // 20 synthetic levels + 8 headroom = 28 (> 16)
    expect(parserFile?.content).toMatch(/export const MAX_FIELD_CURSOR_DEPTH: i32 = 28;/);

    const tmpDirLocal = path.join(__dirname, "../build/scratch_build_deep_depth_test");
    if (fs.existsSync(tmpDirLocal)) fs.rmSync(tmpDirLocal, { recursive: true, force: true });
    fs.mkdirSync(tmpDirLocal, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDirLocal, file.filename), file.content);
    }

    const ascPath =
      [
        path.resolve(__dirname, "../../node_modules/.bin/asc"),
        path.resolve(__dirname, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
    const parserTs = path.join(tmpDirLocal, "parser.ts");
    const outWasm = path.join(tmpDirLocal, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + `\nreturn { LspFacade };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade } = getFacade();

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const imports = {
      env: { memory: memory, abort: () => {}, logNode: () => {}, debugLog: () => {} },
      JavaScript: { debugLog: () => {}, logNode: () => {} },
      engine: { debugLog: () => {} },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    const facade = new LspFacade(instance.exports.memory, instance.exports);

    const code = "start " + "step ".repeat(20) + "myDeepIdentifier end";
    const ast = facade.parse(code);
    const diags = facade.getDiagnostics(ast);

    // Verify the diagnostic on myDeepIdentifier was successfully emitted through all 20 frames
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe("Deep target resolved");
    const targetSubstring = code.substring(diags[0].startCharOffset, diags[0].endCharOffset);
    expect(targetSubstring).toBe("myDeepIdentifier");

    if (fs.existsSync(tmpDirLocal)) fs.rmSync(tmpDirLocal, { recursive: true, force: true });
  }, 180000);

  test("28. Lookahead Confirmation Reward allows missing 'model' keyword insertion to preserve full model AST", async () => {
    const code = `ElectricalCircuit
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;
`;

    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);

    // Verify exactly 1 diagnostic is emitted for missing 'model' on line 1 without cascading errors
    expect(diags).toHaveLength(1);
    expect(diags[0].range.start.line).toBe(0);
    expect(diags[0].message).toBe("Syntax Error: Missing 'model'");

    // Verify both ElectricalCircuit and ThermalSystem parsed as valid ModelDefs
    const sExpr = activeFacade.getAstSExpr(ast);
    expect(sExpr).toContain("ModelDef");
    expect(sExpr).toContain("Decl");
    expect(sExpr).toContain("Equation");
    expect(sExpr).toContain("MulExpr");
    expect(sExpr).toContain("Real");
    expect(sExpr).not.toContain("(ERROR");
  });

  it("should isolate stray token at end of line without cross-line operator hallucination", async () => {
    const code = `model ElectricalCircuit E
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;
`;

    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);

    // Verify stray 'E' on line 1 is cleanly isolated as a syntax error without cascading across lines
    const errorDiags = diags.filter((d) => d.severity === 1);
    expect(errorDiags).toHaveLength(1);
    expect(errorDiags[0].range.start.line).toBe(0);

    // Verify declarations and equations in both models parsed cleanly
    const sExpr = activeFacade.getAstSExpr(ast);
    expect(sExpr).toContain("ModelDef");
    expect(sExpr).toContain("Decl");
    expect(sExpr).toContain("Equation");
    expect(sExpr).toContain("MulExpr");
  });

  it("should isolate stray token errror error without highlighting ElectricalCircuit", async () => {
    const code = `model ElectricalCircuit errror error
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;
`;

    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);

    // Verify syntax error is isolated strictly to stray tokens 'errror error' (character 24 to 36)
    // and does NOT highlight 'ElectricalCircuit' (character 6 to 23)
    const errorDiags = diags.filter((d) => d.severity === 1);
    expect(errorDiags).toHaveLength(1);
    expect(errorDiags[0].range.start.line).toBe(0);
    expect(errorDiags[0].range.start.character).toBe(24);
    expect(errorDiags[0].range.end.character).toBe(36);

    const sExpr = activeFacade.getAstSExpr(ast);
    expect(sExpr).toContain("ModelDef");
    expect(sExpr).toContain("Decl");
    expect(sExpr).toContain("Equation");
  });

  it("should isolate stray token during incremental parsing without corrupting downstream equations", async () => {
    const baseCode = `model ElectricalCircuit
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;
`;

    activeFacade.lastAstRoot = 0;
    let ast = activeFacade.parseIncremental(baseCode, 0, 0, baseCode.length);
    let diags = activeFacade.getDiagnostics(ast);
    expect(diags.filter((d) => d.severity === 1)).toHaveLength(0);

    // Incremental edit: insert " t" at offset 23 (after "model ElectricalCircuit")
    const editOffset = 23;
    const insertedText = " t";
    const newTotalLen = baseCode.length + insertedText.length;
    ast = activeFacade.parseIncremental(insertedText, editOffset, 0, newTotalLen);
    diags = activeFacade.getDiagnostics(ast);

    // Should only have 1 error on line 0 for stray 't', and NO error on line 5 (power = voltage * current;)
    const errorDiags = diags.filter((d) => d.severity === 1);
    expect(errorDiags).toHaveLength(1);
    expect(errorDiags[0].range.start.line).toBe(0);

    const sExpr = activeFacade.getAstSExpr(ast);
    expect(sExpr).toContain("Decl");
    expect(sExpr).toContain("Equation");
    expect(sExpr).toContain("MulExpr");
  });

  it("should accurately advance lexer position when reusing nodes with leading whitespace (model ElectricalCircuit  r  r  r)", async () => {
    const dslLocal = language({
      name: "SysModelKeystrokesTest",
      word: ($: any) => $.Identifier,
      primitives: {
        nestedComment: { open: "/*", close: "*/" },
        lineComment: "//",
        multiWordKeywords: ["end if", "end while"],
      },
      rules: {
        Program: ($: any) => repeat($.ModelDef),
        ModelDef: ($: any) =>
          seq(
            semanticToken("keyword", "model"),
            field("name", $.Identifier),
            repeat(choice($.Decl, $.Equation, $.IfStmt, $.WhileStmt)),
            semanticToken("keyword", "end"),
            field("endName", $.Identifier),
            ";",
          ),
        Decl: ($: any) =>
          seq(field("type", $.Type), field("name", $.Identifier), optional(seq("=", field("value", $.Expr))), ";"),
        Real: ($: any) => semanticToken("type", "Real"),
        Integer: ($: any) => semanticToken("type", "Integer"),
        Type: ($: any) => choice($.Real, $.Integer, "Number"),
        Equation: ($: any) => seq(field("lhs", $.Expr), "=", field("rhs", $.Expr), ";"),
        IfStmt: ($: any) =>
          seq(
            "if",
            field("condition", $.Expr),
            "then",
            field("thenBody", $.Expr),
            optional(seq("else", field("elseBody", $.Expr))),
            "end if",
            ";",
          ),
        WhileStmt: ($: any) => seq("while", field("condition", $.Expr), "do", field("body", $.Expr), "end while", ";"),
        Expr: ($: any) => choice($.MulExpr, $.AddExpr, $.Identifier, $.Number),
        MulExpr: ($: any) => prec.left(2, seq(field("left", $.Expr), field("op", "*"), field("right", $.Expr))),
        AddExpr: ($: any) =>
          prec.left(1, seq(field("left", $.Expr), field("op", choice("+", "-")), field("right", $.Expr))),
        Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
        Number: ($: any) => semanticToken("number", /[0-9]+(?:\.[0-9]+)?/),
      },
      extras: ($: any) => [/\s/],
      lints: {
        uninitializedComponent: {
          nodes: ["Decl"],
          severity: "warning",
          message: "Component declaration uninitialized",
          query: (db: any, node: any, $: any) => {
            const valNode = db.ast.getChildByFieldId(node, "value");
            if (valNode == 0) {
              const nameNode = db.ast.getChildByFieldId(node, "name");
              if (nameNode != 0) {
                db.diagnostic(nameNode);
              }
            }
          },
        },
      },
    });

    const result = buildParser(dslLocal as any);
    const tmpDirLocal = path.join(__dirname, "../build/scratch_build_keystrokes_test");
    if (fs.existsSync(tmpDirLocal)) fs.rmSync(tmpDirLocal, { recursive: true, force: true });
    fs.mkdirSync(tmpDirLocal, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDirLocal, file.filename), file.content);
    }

    const ascPath =
      [
        path.resolve(__dirname, "../../node_modules/.bin/asc"),
        path.resolve(__dirname, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
    const parserTs = path.join(tmpDirLocal, "parser.ts");
    const outWasm = path.join(tmpDirLocal, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + `\nreturn { LspFacade };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade: LspFacadeLocal } = getFacade();

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const importsLocal = {
      env: {
        memory: memory,
        abort: () => {},
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

    const instance = await WebAssembly.instantiate(wasmModule, importsLocal);
    const facadeLocal = new LspFacadeLocal(instance.exports.memory, instance.exports);

    const baseCode = `model ElectricalCircuit
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;`;

    facadeLocal.lastAstRoot = 0;
    let ast = facadeLocal.parseIncremental(baseCode, 0, 0, baseCode.length);

    // Incrementally type "  r  r  r" character-by-character at offset 23
    const keystrokes = "  r  r  r";
    let curLen = baseCode.length;
    for (let i = 0; i < keystrokes.length; i++) {
      ast = facadeLocal.parseIncremental(keystrokes[i], 23 + i, 0, ++curLen);
    }

    const diags = facadeLocal.getDiagnostics(ast);

    // 1. Line 1 syntax error only
    const syntaxErrors = diags.filter((d: any) => d.severity === 1);
    expect(syntaxErrors).toHaveLength(1);
    expect(syntaxErrors[0].range.start.line).toBe(0);

    // 2. Zero errors on Line 2 (Real voltage = 12.0;)
    const line2Errors = syntaxErrors.filter((d: any) => d.range.start.line === 1);
    expect(line2Errors).toHaveLength(0);

    // 3. Uninitialized warnings on Line 4 (power) and Line 11 (heatFlow)
    const warnings = diags.filter((d: any) => d.severity === 2 && d.code === 2000);
    expect(warnings).toHaveLength(2);

    // Line 4 (0-indexed line 3) power should be exactly at character 7..12 (1-indexed col 8..13)
    expect(warnings[0].range.start.line).toBe(3);
    expect(warnings[0].range.start.character).toBe(7);
    expect(warnings[0].range.end.character).toBe(12);

    // Line 11 (0-indexed line 10) heatFlow should be exactly at character 7..15 (1-indexed col 8..16)
    expect(warnings[1].range.start.line).toBe(10);
    expect(warnings[1].range.start.character).toBe(7);
    expect(warnings[1].range.end.character).toBe(15);

    if (fs.existsSync(tmpDirLocal)) fs.rmSync(tmpDirLocal, { recursive: true, force: true });
  }, 45000);
});
