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

    const ascPath =
      [
        path.resolve(__dirname, "../../node_modules/.bin/asc"),
        path.resolve(__dirname, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const [ascBin, ...ascPrefixArgs] = ascPath.startsWith("npx") ? ["npx", "asc"] : [ascPath];
    childProcess.execFileSync(
      ascBin,
      [...ascPrefixArgs, parserTs, "-o", outWasm, "--exportRuntime", "--enable", "threads", "-O0", "--runtime", "stub"],
      { stdio: "inherit" },
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

    function setBuffer(bytes: number[]): number {
      const bufPtr = exports().getInputBuffer();
      const u8 = new Uint8Array(exports().memory.buffer, bufPtr, bytes.length + 16);
      for (let i = 0; i < bytes.length; i++) {
        u8[i] = bytes[i];
      }
      exports().setInputLength(bytes.length);
      return bufPtr;
    }

    it("decodes UTF-8 sequences (1-byte, 2-byte, 3-byte, 4-byte)", () => {
      exports().setInputEncoding(0); // UTF-8

      // ASCII 'A' (0x41)
      setBuffer([0x41]);
      expect(exports().peekChar(0)).toBe(0x41);
      expect(exports().peekCharLen(0)).toBe(1);

      // 2-byte Greek 'β' (U+03B2: 0xCE 0xB2)
      setBuffer([0xce, 0xb2]);
      expect(exports().peekChar(0)).toBe(0x03b2);
      expect(exports().peekCharLen(0)).toBe(2);

      // 3-byte Euro '€' (U+20AC: 0xE2 0x82 0xAC)
      setBuffer([0xe2, 0x82, 0xac]);
      expect(exports().peekChar(0)).toBe(0x20ac);
      expect(exports().peekCharLen(0)).toBe(3);

      // 3-byte CJK '世' (U+4E16: 0xE4 0xB8 0x96)
      setBuffer([0xe4, 0xb8, 0x96]);
      expect(exports().peekChar(0)).toBe(0x4e16);
      expect(exports().peekCharLen(0)).toBe(3);

      // 4-byte Rocket '🚀' (U+1F680: 0xF0 0x9F 0x9A 0x80)
      setBuffer([0xf0, 0x9f, 0x9a, 0x80]);
      expect(exports().peekChar(0)).toBe(0x1f680);
      expect(exports().peekCharLen(0)).toBe(4);
    });

    it("enforces buffer bounds and prevents overreads on truncated UTF-8 at EOF", () => {
      exports().setInputEncoding(0); // UTF-8

      // Truncated 4-byte sequence with only 2 bytes in buffer
      setBuffer([0xf0, 0x9f]);
      expect(exports().peekCharLen(0)).toBe(2); // must not return 4!

      // Truncated 3-byte sequence with only 1 byte in buffer
      setBuffer([0xe2]);
      expect(exports().peekCharLen(0)).toBe(1); // must not return 3!

      // Truncated 2-byte sequence with only 1 byte in buffer
      setBuffer([0xce]);
      expect(exports().peekCharLen(0)).toBe(1); // must not return 2!
    });

    it("decodes UTF-16LE surrogate pairs including code points >= U+20000", () => {
      exports().setInputEncoding(1); // UTF-16LE

      // U+20000: high surrogate 0xD840, low surrogate 0xDC00
      // In LE: 0x40, 0xD8, 0x00, 0xDC
      setBuffer([0x40, 0xd8, 0x00, 0xdc]);
      expect(exports().peekChar(0)).toBe(0x20000);
      expect(exports().peekCharLen(0)).toBe(4);

      // U+100000: high surrogate 0xDBC0, low surrogate 0xDC00
      // In LE: 0xC0, 0xDB, 0x00, 0xDC
      setBuffer([0xc0, 0xdb, 0x00, 0xdc]);
      expect(exports().peekChar(0)).toBe(0x100000);
      expect(exports().peekCharLen(0)).toBe(4);
    });

    it("does not swallow non-surrogates following high surrogate in UTF-16", () => {
      exports().setInputEncoding(1); // UTF-16LE

      // High surrogate 0xD800 followed by ASCII space 0x0020
      // In LE: 0x00, 0xD8, 0x20, 0x00
      setBuffer([0x00, 0xd8, 0x20, 0x00]);
      // Should NOT decode as a 4-byte pair
      expect(exports().peekCharLen(0)).toBe(2);
      expect(exports().peekChar(0)).toBe(0xd800);
      // Next character is space (0x20)
      expect(exports().peekChar(2)).toBe(0x20);
      expect(exports().peekCharLen(2)).toBe(2);
    });

    it("prevents UTF-16 buffer overread on high surrogate at EOF", () => {
      exports().setInputEncoding(1); // UTF-16LE

      // Only 2 bytes remaining in buffer: high surrogate 0xD800
      setBuffer([0x00, 0xd8]);
      expect(exports().peekCharLen(0)).toBe(2); // must not return 4!
      expect(exports().peekChar(0)).toBe(0xd800);
    });

    it("decodes UTF-16BE characters and surrogate pairs", () => {
      exports().setInputEncoding(2); // UTF-16BE

      // ASCII 'A': 0x00 0x41
      setBuffer([0x00, 0x41]);
      expect(exports().peekChar(0)).toBe(0x41);
      expect(exports().peekCharLen(0)).toBe(2);

      // U+20000: 0xD8 0x40, 0xDC 0x00
      setBuffer([0xd8, 0x40, 0xdc, 0x00]);
      expect(exports().peekChar(0)).toBe(0x20000);
      expect(exports().peekCharLen(0)).toBe(4);
    });

    it("decodes UTF-32LE and UTF-32BE characters with boundary validation", () => {
      exports().setInputEncoding(3); // UTF-32LE

      // U+1F680 in LE: 0x80, 0xF6, 0x01, 0x00
      setBuffer([0x80, 0xf6, 0x01, 0x00]);
      expect(exports().peekChar(0)).toBe(0x1f680);
      expect(exports().peekCharLen(0)).toBe(4);

      // Truncated at EOF (only 3 bytes)
      setBuffer([0x80, 0xf6, 0x01]);
      expect(exports().peekChar(0)).toBe(0);
      expect(exports().peekCharLen(0)).toBe(3);

      exports().setInputEncoding(4); // UTF-32BE

      // U+1F680 in BE: 0x00, 0x01, 0xF6, 0x80
      setBuffer([0x00, 0x01, 0xf6, 0x80]);
      expect(exports().peekChar(0)).toBe(0x1f680);
      expect(exports().peekCharLen(0)).toBe(4);
    });

    it("steps backwards correctly with peekPrevChar and peekPrevCharLen", () => {
      // UTF-8
      exports().setInputEncoding(0);
      // 'A' (1 byte), 'β' (2 bytes), '€' (3 bytes), '🚀' (4 bytes)
      setBuffer([0x41, 0xce, 0xb2, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x9a, 0x80]);

      // At pos 1 (after 'A')
      expect(exports().peekPrevChar(1)).toBe(0x41);
      expect(exports().peekPrevCharLen(1)).toBe(1);

      // At pos 3 (after 'β')
      expect(exports().peekPrevChar(3)).toBe(0x03b2);
      expect(exports().peekPrevCharLen(3)).toBe(2);

      // At pos 6 (after '€')
      expect(exports().peekPrevChar(6)).toBe(0x20ac);
      expect(exports().peekPrevCharLen(6)).toBe(3);

      // At pos 10 (after '🚀')
      expect(exports().peekPrevChar(10)).toBe(0x1f680);
      expect(exports().peekPrevCharLen(10)).toBe(4);

      // UTF-16LE
      exports().setInputEncoding(1);
      // 'A' (2 bytes: 0x41, 0x00), '🚀' (4 bytes: 0x3D, 0xD8, 0x80, 0xDE)
      setBuffer([0x41, 0x00, 0x3d, 0xd8, 0x80, 0xde]);
      expect(exports().peekPrevChar(2)).toBe(0x41);
      expect(exports().peekPrevCharLen(2)).toBe(2);
      expect(exports().peekPrevChar(6)).toBe(0x1f680);
      expect(exports().peekPrevCharLen(6)).toBe(4);

      // UTF-32LE
      exports().setInputEncoding(3);
      // '🚀' (4 bytes)
      setBuffer([0x80, 0xf6, 0x01, 0x00]);
      expect(exports().peekPrevChar(4)).toBe(0x1f680);
      expect(exports().peekPrevCharLen(4)).toBe(4);
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
  });
});
