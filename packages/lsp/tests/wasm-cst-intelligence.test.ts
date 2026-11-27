// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import type { Tree } from "@modelscript/dsl/utils";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, describe, it } from "node:test";
import { CompletionItemKind } from "vscode-languageserver";
import { formatWasmCstDocument } from "../src/providers/cst-formatter.js";
import {
  getWasmCstCompletions,
  getWasmCstDefinition,
  getWasmCstHover,
  getWasmCstReferences,
} from "../src/providers/wasm-cst-intelligence.js";

const require = createRequire(import.meta.url);

describe("Generic WASM CST Intelligence & Formatting", () => {
  let sysmlParser: { parse(input: string): Tree };
  let sysmlSyntaxNames: string[] | undefined;

  const sampleSysml = [
    "package Propulsion {",
    "  // Motor comment mentioning Motor and { brace }",
    "  part def Motor {",
    "    attribute mass;",
    "  }",
    "",
    "  part def Vehicle {",
    "    part drive : Motor;",
    "    part backup : Motor;",
    "  }",
    "}",
    "",
  ].join("\n");

  before(async () => {
    const sysmlWasmPath = require.resolve("@modelscript/sysml2/parser.wasm");
    const loaded = await createWasmParser(sysmlWasmPath);
    sysmlParser = loaded.parser as unknown as { parse(input: string): Tree };
    sysmlSyntaxNames = (loaded.facade as { syntaxNames?: string[] } | undefined)?.syntaxNames;
  });

  describe("formatWasmCstDocument", () => {
    it("normalizes CST block indentation, trims trailing whitespace, collapses 3+ blank lines, and ensures trailing newline", () => {
      const messy = [
        "package Propulsion {   ",
        "part def Motor {  ",
        "        attribute mass;   ",
        "}",
        "",
        "",
        "",
        "   part def Vehicle {",
        "part drive : Motor;   ",
        "   }",
        "   }",
      ].join("\n");

      const tree = sysmlParser.parse(messy);
      const formatted = formatWasmCstDocument(tree, messy, { tabSize: 2, insertSpaces: true });

      const expected = [
        "package Propulsion {",
        "  part def Motor {",
        "    attribute mass;",
        "  }",
        "",
        "  part def Vehicle {",
        "    part drive : Motor;",
        "  }",
        "}",
        "",
      ].join("\n");

      assert.strictEqual(formatted, expected);
    });

    it("does not let braces inside comments corrupt indentation", () => {
      const src = [
        "package Demo {",
        "// comment with unmatched { { {",
        "part def Sensor {",
        "attribute value;",
        "}",
        "}",
      ].join("\n");

      const tree = sysmlParser.parse(src);
      const formatted = formatWasmCstDocument(tree, src, { tabSize: 2, insertSpaces: true });

      const expected = [
        "package Demo {",
        "  // comment with unmatched { { {",
        "  part def Sensor {",
        "    attribute value;",
        "  }",
        "}",
        "",
      ].join("\n");

      assert.strictEqual(formatted, expected);
    });

    it("supports tab indentation when insertSpaces is false", () => {
      const src = "package TabTest {\npart def Foo {\nattribute x;\n}\n}";
      const tree = sysmlParser.parse(src);
      const formatted = formatWasmCstDocument(tree, src, { tabSize: 4, insertSpaces: false });
      assert.strictEqual(formatted, "package TabTest {\n\tpart def Foo {\n\t\tattribute x;\n\t}\n}\n");
    });

    it("skips formatting for fixed-column languages (fortran, psse, nastran, bdf, las)", () => {
      const src = "      PROGRAM HELLO\n      PRINT *, 'HI'   \n      END";
      const tree = sysmlParser.parse(sampleSysml);
      for (const lang of ["fortran", "psse", "nastran", "bdf", "las"]) {
        assert.strictEqual(formatWasmCstDocument(tree, src, { languageId: lang }), src);
      }
    });

    it("skips formatting when CST has an ERROR node at root", () => {
      const broken = "package Broken {\n   @@@   ";
      const errorTree = {
        rootNode: {
          type: "source_file",
          isError: false,
          childCount: 1,
          children: [{ type: "ERROR", isError: true, text: broken }],
          child: () => ({ type: "ERROR", isError: true, text: broken }),
        },
      } as unknown as Tree;

      assert.strictEqual(formatWasmCstDocument(errorTree, broken), broken);
    });
  });

  describe("getWasmCstHover", () => {
    it("resolves declaration hover for an identifier usage in a real WASM CST", () => {
      const tree = sysmlParser.parse(sampleSysml);
      // Line 7: "    part drive : Motor;" -> 'Motor' starts at column 17
      const hover = getWasmCstHover(tree, sampleSysml, { line: 7, character: 18 }, "sysml2");
      assert.ok(hover, "Expected non-null hover on 'Motor' reference");
      const content =
        typeof hover.contents === "string" ? hover.contents : "value" in hover.contents ? hover.contents.value : "";
      assert.match(content, /Motor/, "Hover should include symbol name 'Motor'");
      assert.match(content, /part def Motor/, "Hover should include declaration snippet");
      assert.ok(hover.range, "Hover should include token range");
      assert.strictEqual(hover.range.start.line, 7);
    });
  });

  describe("getWasmCstDefinition", () => {
    it("jumps from identifier usage to its CST declaration", () => {
      const uri = "file:///workspace/propulsion.sysml";
      const tree = sysmlParser.parse(sampleSysml);
      // Line 7: "    part drive : Motor;" -> 'Motor' is at col 17..22
      const def = getWasmCstDefinition(tree, uri, { line: 7, character: 18 });
      assert.ok(def, "Expected non-null definition for 'Motor'");
      assert.strictEqual(def.uri, uri);
      // Line 2: "  part def Motor {" -> 'Motor' is at line 2, col 11..16
      assert.strictEqual(def.range.start.line, 2);
      assert.strictEqual(def.range.start.character, 11);
      assert.strictEqual(def.range.end.character, 16);
    });
  });

  describe("getWasmCstReferences", () => {
    it("finds all CST identifier occurrences and ignores comment occurrences", () => {
      const uri = "file:///workspace/propulsion.sysml";
      const tree = sysmlParser.parse(sampleSysml);
      // Line 2: "  part def Motor {" -> 'Motor' at col 11
      const refs = getWasmCstReferences(tree, uri, { line: 2, character: 12 });
      const lines = refs.map((r) => r.range.start.line);
      // Should find lines 2 (decl), 7 (drive : Motor), 8 (backup : Motor) — NOT line 1 (comment)
      assert.deepStrictEqual(lines, [2, 7, 8]);
      assert.ok(refs.every((r) => r.uri === uri));
    });
  });

  describe("getWasmCstCompletions", () => {
    it("extracts declared CST symbols and word-like quoted keywords from syntaxNames", () => {
      const tree = sysmlParser.parse(sampleSysml);
      const syntaxNames = sysmlSyntaxNames ?? ['"package"', '"part"', '"def"', '"{"', '"}"', '";"', "identifier"];
      const items = getWasmCstCompletions(tree, syntaxNames);

      const labels = new Set(items.map((i) => i.label));
      assert.ok(labels.has("Propulsion"), "Should include declared package 'Propulsion'");
      assert.ok(labels.has("Motor"), "Should include declared part def 'Motor'");
      assert.ok(labels.has("Vehicle"), "Should include declared part def 'Vehicle'");
      assert.ok(labels.has("drive"), "Should include declared part usage 'drive'");
      assert.ok(labels.has("package"), "Should include quoted keyword 'package'");
      assert.ok(labels.has("part"), "Should include quoted keyword 'part'");

      // Must NOT include punctuation tokens from syntaxNames
      assert.ok(!labels.has("{"), "Should not include punctuation '{'");
      assert.ok(!labels.has(";"), "Should not include punctuation ';'");

      const pkgKw = items.find((i) => i.label === "package");
      assert.strictEqual(pkgKw?.kind, CompletionItemKind.Keyword);

      // Also verify null tree with syntaxNames still returns keywords
      const kwOnly = getWasmCstCompletions(null, ['"model"', '"end"', '"("', '"foo-bar"']);
      assert.deepStrictEqual(
        kwOnly.map((i) => i.label),
        ["model", "end", "foo-bar"],
      );
      assert.ok(kwOnly.every((i) => i.kind === CompletionItemKind.Keyword));
    });
  });
});
