// SPDX-License-Identifier: AGPL-3.0-or-later

import * as childProcess from "child_process";
import expect from "expect";
import * as fs from "fs";
import { after as afterAll, before as beforeAll, describe, it } from "node:test";
import * as path from "path";
import { fileURLToPath } from "url";
import { compileRegexToDFA } from "../src/dsl/automata.js";
import { buildParser, choice, field, language, optional, repeat, semanticToken, seq } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const encodingGrammar = language({
  name: "EncodingTestDSL",
  word: ($) => $.Identifier,
  rules: {
    Program: ($) => repeat($.Statement),
    Statement: ($) => choice($.ModelDef, $.AssignStmt),
    ModelDef: ($) =>
      seq(
        semanticToken("keyword", "model"),
        field("name", $.Identifier),
        repeat($.Decl),
        semanticToken("keyword", "end"),
        field("endName", $.Identifier),
        ";",
      ),
    Decl: ($) =>
      seq(field("type", $.Identifier), field("name", $.Identifier), optional(seq("=", field("value", $.Expr))), ";"),
    AssignStmt: ($) => seq(field("lhs", $.Identifier), "=", field("rhs", $.Expr), ";"),
    Expr: ($) => choice($.StringLiteral, $.Identifier, $.Number),
    Identifier: ($) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    StringLiteral: ($) => semanticToken("string", /"(?:[^"\\]|\\.)*"/),
    Number: ($) => semanticToken("number", /[0-9]+(?:\.[0-9]+)?/),
  },
  extras: ($) => [/\s/],
});

describe("Character Encoding & Multi-Byte Subsystem", () => {
  let activeFacade: any;
  let TreeClass: any;
  let SyntaxNodeClass: any;
  let tmpDir: string;
  let wasmInstance: any;

  beforeAll(async () => {
    const result = buildParser(encodingGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_encoding_test");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      const filePath = path.join(tmpDir, file.filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, file.content);
    }

    const repoRoot = path.resolve(__dirname, "../../..");
    const ascJs = [
      path.resolve(__dirname, "../node_modules/assemblyscript/bin/asc.js"),
      path.resolve(__dirname, "../../node_modules/assemblyscript/bin/asc.js"),
      path.resolve(__dirname, "../../../node_modules/assemblyscript/bin/asc.js"),
      path.resolve(repoRoot, "node_modules", "assemblyscript", "bin", "asc.js"),
      path.resolve(repoRoot, "node_modules", ".bin", "asc"),
    ].find((p) => fs.existsSync(p));
    const [ascBin, ascPrefixArgs] = ascJs
      ? ascJs.endsWith(".js")
        ? [process.execPath, [ascJs]]
        : [ascJs, []]
      : ["npx", ["--yes", "assemblyscript", "asc"]];
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    childProcess.execFileSync(
      ascBin,
      [...ascPrefixArgs, parserTs, "-o", outWasm, "--exportRuntime", "--enable", "threads", "-O0", "--runtime", "stub"],
      { stdio: "inherit", timeout: 120000 },
    );

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc =
      result.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") +
      `\nreturn { LspFacade, Tree, TreeCursor, SyntaxNode, TreeSitterParser, FIELD_NAMES };`;
    const getExports = new Function(wrapperSrc);
    const exportsObj = getExports();
    const { LspFacade, Tree, SyntaxNode } = exportsObj;
    TreeClass = Tree;
    SyntaxNodeClass = SyntaxNode;

    const memory = new WebAssembly.Memory({ initial: 128, maximum: 1024, shared: true });
    const imports = {
      env: { memory, abort: () => {}, logNode: () => {}, debugLog: () => {} },
      JavaScript: { debugLog: () => {}, logNode: () => {} },
      engine: { debugLog: () => {} },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    wasmInstance = await WebAssembly.instantiate(wasmModule, imports);
    activeFacade = new LspFacade(wasmInstance.exports.memory, wasmInstance.exports);
  }, 120000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function parseToTree(code: string) {
    activeFacade.lastAstRoot = 0;
    const astRoot = activeFacade.parse(code);
    return new TreeClass(activeFacade, astRoot, code);
  }

  describe("Phase 2: Inverted Regex DFA Interval Partitioning", () => {
    it("partitions inverted character classes over [0, 0x10FFFF] compactly", () => {
      const dfa = compileRegexToDFA([
        { pattern: '"[^"]*"', tokenName: "STRING" },
        { pattern: "[a-zA-Z_][a-zA-Z0-9_]*", tokenName: "IDENT" },
      ]);

      expect(dfa.classRanges.length).toBeGreaterThan(0);
      expect(dfa.classRanges.length).toBeLessThan(100); // Compact interval partitioning!
      expect(dfa.classRanges[0].s).toBe(0);
      expect(dfa.classRanges[dfa.classRanges.length - 1].e).toBe(0x10ffff);

      // Verify that class ranges are contiguous
      for (let i = 0; i < dfa.classRanges.length - 1; i++) {
        expect(dfa.classRanges[i + 1].s).toBe(dfa.classRanges[i].e + 1);
      }
    });

    it("correctly handles dot regexes without state explosion", () => {
      const dfa = compileRegexToDFA([{ pattern: ".*", tokenName: "ANY" }]);
      expect(dfa.classRanges.length).toBeGreaterThan(0);
      expect(dfa.classRanges.length).toBeLessThan(20);
      expect(dfa.classRanges[dfa.classRanges.length - 1].e).toBe(0x10ffff);
    });
  });

  describe("Phase 1: WASM Kernel peekChar & peekCharLen Decoding", () => {
    const exports = () => wasmInstance.exports;

    function setCodeUnits(units: number[]): number {
      const bufPtr = exports().getInputBuffer();
      const u16 = new Uint16Array(exports().memory.buffer, bufPtr, units.length + 8);
      for (let i = 0; i < units.length; i++) {
        u16[i] = units[i];
      }
      exports().setInputLength(units.length);
      return bufPtr;
    }

    it("exports lsp_isCharOffsetKernel() === 1", () => {
      expect(typeof exports().lsp_isCharOffsetKernel).toBe("function");
      expect(exports().lsp_isCharOffsetKernel()).toBe(1);
    });

    it("decodes BMP and astral code points from UTF-16 code units", () => {
      // ASCII 'A' (0x41)
      setCodeUnits([0x41]);
      expect(exports().peekChar(0)).toBe(0x41);
      expect(exports().peekCharLen(0)).toBe(1);

      // Greek 'β' (U+03B2)
      setCodeUnits([0x03b2]);
      expect(exports().peekChar(0)).toBe(0x03b2);
      expect(exports().peekCharLen(0)).toBe(1);

      // Euro '€' (U+20AC)
      setCodeUnits([0x20ac]);
      expect(exports().peekChar(0)).toBe(0x20ac);
      expect(exports().peekCharLen(0)).toBe(1);

      // CJK '世' (U+4E16)
      setCodeUnits([0x4e16]);
      expect(exports().peekChar(0)).toBe(0x4e16);
      expect(exports().peekCharLen(0)).toBe(1);

      // Rocket '🚀' (U+1F680: 0xD83D, 0xDE80)
      setCodeUnits([0xd83d, 0xde80]);
      expect(exports().peekChar(0)).toBe(0x1f680);
      expect(exports().peekCharLen(0)).toBe(2);
    });

    it("decodes UTF-16LE surrogate pairs including code points >= U+20000", () => {
      // U+20000: high surrogate 0xD840, low surrogate 0xDC00
      setCodeUnits([0xd840, 0xdc00]);
      expect(exports().peekChar(0)).toBe(0x20000);
      expect(exports().peekCharLen(0)).toBe(2);

      // U+100000: high surrogate 0xDBC0, low surrogate 0xDC00
      setCodeUnits([0xdbc0, 0xdc00]);
      expect(exports().peekChar(0)).toBe(0x100000);
      expect(exports().peekCharLen(0)).toBe(2);
    });

    it("does not swallow non-surrogates following high surrogate in UTF-16", () => {
      // High surrogate 0xD800 followed by ASCII space 0x0020
      setCodeUnits([0xd800, 0x0020]);
      // Should NOT decode as a 2-unit surrogate pair
      expect(exports().peekCharLen(0)).toBe(1);
      expect(exports().peekChar(0)).toBe(0xd800);
      // Next character is space (0x20) at code-unit offset 1
      expect(exports().peekChar(1)).toBe(0x20);
      expect(exports().peekCharLen(1)).toBe(1);
    });

    it("prevents UTF-16 buffer overread on high surrogate at EOF", () => {
      // Only 1 code unit remaining in buffer: high surrogate 0xD800
      setCodeUnits([0xd800]);
      expect(exports().peekCharLen(0)).toBe(1); // must not return 2!
      expect(exports().peekChar(0)).toBe(0xd800);
    });

    it("steps backwards correctly with peekPrevChar and peekPrevCharLen", () => {
      // 'A' (1 unit: 0x0041), '🚀' (2 units: 0xD83D, 0xDE80)
      setCodeUnits([0x0041, 0xd83d, 0xde80]);
      expect(exports().peekPrevChar(1)).toBe(0x41);
      expect(exports().peekPrevCharLen(1)).toBe(1);
      expect(exports().peekPrevChar(3)).toBe(0x1f680);
      expect(exports().peekPrevCharLen(3)).toBe(2);
    });
  });

  describe("Phase 3 & 4: Host Bindings & Multi-Byte AST Parsing", () => {
    it("parses string literals with multi-byte CJK and astral plane emojis", () => {
      const code = `model M\n  String s1 = "Hello 世界";\n  String s2 = "Rocket 🚀 launch";\nend M;`;
      const tree = parseToTree(code);
      expect(tree.rootNode).toBeDefined();
      expect(tree.rootNode.hasError()).toBe(false);

      const s1Node = tree.rootNode.descendantsOfType("StringLiteral")[0];
      expect(s1Node).toBeDefined();
      expect(s1Node.text).toBe('"Hello 世界"');

      const s2Node = tree.rootNode.descendantsOfType("StringLiteral")[1];
      expect(s2Node).toBeDefined();
      expect(s2Node.text).toBe('"Rocket 🚀 launch"');
      expect(s2Node.startIndex).toBe(code.indexOf('"Rocket 🚀 launch"'));
      expect(s2Node.endIndex).toBe(code.indexOf('"Rocket 🚀 launch"') + '"Rocket 🚀 launch"'.length);
    });

    it("parses source code with leading BOM (0xFEFF) without errors", () => {
      const codeWithBom = `\uFEFFmodel MBom\nend MBom;`;
      const tree = parseToTree(codeWithBom);
      expect(tree.rootNode).toBeDefined();
      expect(tree.rootNode.hasError()).toBe(false);
    });

    it("correctly converts positions on lines containing multi-byte characters", () => {
      const lineStarts = activeFacade.getLineStarts();
      expect(lineStarts.length).toBeGreaterThan(1);

      // Test offsetToPos and posToOffset symmetry
      const pos0 = activeFacade.offsetToPos(0, lineStarts);
      expect(pos0.line).toBe(0);
      expect(pos0.character).toBe(0);
      expect(activeFacade.posToOffset(pos0.line, pos0.character, lineStarts)).toBe(0);
    });

    it("handles incremental parse edits with 1:1 UTF-16 character offsets", () => {
      const code1 = `model M\n  String s1 = "Hello 世界";\n  Real x = 10;\nend M;`;
      const tree1 = parseToTree(code1);
      expect(tree1.rootNode.hasError()).toBe(false);

      const editPos = code1.indexOf("10");
      const code2 = code1.slice(0, editPos) + "42" + code1.slice(editPos + 2);
      activeFacade.parseIncremental("42", editPos, 2, code2.length);
      const tree2 = new TreeClass(activeFacade, activeFacade.lastAstRoot, code2);
      expect(tree2.rootNode.hasError()).toBe(false);
      const numNode = tree2.rootNode.descendantsOfType("Number")[0];
      expect(numNode).toBeDefined();
      expect(numNode.text).toBe("42");
      expect(numNode.startIndex).toBe(editPos);
      expect(numNode.endIndex).toBe(editPos + 2);
    });
  });
});
