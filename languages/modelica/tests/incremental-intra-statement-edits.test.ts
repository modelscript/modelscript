// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import expect from "expect";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
const { parser, facade } = await createWasmParser(modelicaWasm);
Context.registerParser(".mo", parser as any);

describe("Incremental Intra-Statement & Boundary Edits Suite", () => {
  it("should incrementally parse keystroke edits inside declarations without falling back to full reparse", async () => {
    const fs = new NodeFileSystem();
    const ctx = new Context(fs);
    const uri = "file:///test/BouncingBall.mo";

    const steps = [
      // Step 0: Base model with empty description on 'Real v ;'
      `model BouncingBall
  parameter Real e = 0.7 "coefficient of restitution";
  parameter Real g = 9.81 "gravity acceleration";
  Real h(start = 1);
  Real v ;
equation
  der(h) = v;
  der(v) = -g;
end BouncingBall;`,

      // Step 1: Insert "" between identifier 'v' and semicolon ';'
      `model BouncingBall
  parameter Real e = 0.7 "coefficient of restitution";
  parameter Real g = 9.81 "gravity acceleration";
  Real h(start = 1);
  Real v "";
equation
  der(h) = v;
  der(v) = -g;
end BouncingBall;`,

      // Step 2: Type string contents inside "" -> "velocity"
      `model BouncingBall
  parameter Real e = 0.7 "coefficient of restitution";
  parameter Real g = 9.81 "gravity acceleration";
  Real h(start = 1);
  Real v "velocity";
equation
  der(h) = v;
  der(v) = -g;
end BouncingBall;`,

      // Step 3: Insert modifier clause before description -> (start = 0)
      `model BouncingBall
  parameter Real e = 0.7 "coefficient of restitution";
  parameter Real g = 9.81 "gravity acceleration";
  Real h(start = 1);
  Real v(start = 0) "velocity";
equation
  der(h) = v;
  der(v) = -g;
end BouncingBall;`,

      // Step 4: Edit equation inside equation section
      `model BouncingBall
  parameter Real e = 0.7 "coefficient of restitution";
  parameter Real g = 9.81 "gravity acceleration";
  Real h(start = 1);
  Real v(start = 0) "velocity";
equation
  der(h) = 2.0 * v;
  der(v) = -g;
end BouncingBall;`,

      // Step 5: Add multi-line when equation
      `model BouncingBall
  parameter Real e = 0.7 "coefficient of restitution";
  parameter Real g = 9.81 "gravity acceleration";
  Real h(start = 1);
  Real v(start = 0) "velocity";
equation
  der(h) = 2.0 * v;
  der(v) = -g;
  when h < 0.0 then
    reinit(v, -e * pre(v));
  end when;
end BouncingBall;`,
    ];

    for (let i = 0; i < steps.length; i++) {
      const code = steps[i];
      const tree = ctx.load(code, uri);
      const rootPtr = (tree.rootNode as any).id ?? (tree.rootNode as any).ptr ?? 0;
      const diags = facade.getDiagnostics(rootPtr);
      const hasErr = (tree.rootNode as any).hasError();

      expect(hasErr).toBe(false);
      expect(diags).toHaveLength(0);

      // Verify Salsa / QueryEngine semantic linter has zero false positives
      const linterDiags = await ctx.queryEngine.runAllLintsAsync(uri);
      expect(linterDiags).toHaveLength(0);

      // Verify 100% CST structural parity with fresh cold parse
      const freshCtx = new Context(fs);
      const freshTree = freshCtx.load(code, `file:///test/fresh_${i}.mo`);
      expect((tree.rootNode as any).toString()).toBe((freshTree.rootNode as any).toString());
    }
  });

  it("should cleanly handle keystroke-by-keystroke typing inside component modifiers and comments with fresh-parse parity", async () => {
    const fs = new NodeFileSystem();
    const ctx = new Context(fs);
    const uri = "file:///test/ModifiersTyping.mo";

    let src = `model M\n  Real x;\nend M;\n`;
    ctx.load(src, uri);

    // Keystroke by keystroke inserting "(start = 1.0)" right after 'x'
    const insertStr = "(start = 1.0)";
    const insertOffset = src.indexOf("x") + 1;

    for (let k = 1; k <= insertStr.length; k++) {
      const sub = insertStr.slice(0, k);
      const currentText = src.slice(0, insertOffset) + sub + src.slice(insertOffset);
      const tree = ctx.load(currentText, uri);

      const freshCtx = new Context(fs);
      const freshTree = freshCtx.load(currentText, `file:///test/fresh_mod_${k}.mo`);
      expect((tree.rootNode as any).toString()).toBe((freshTree.rootNode as any).toString());
    }

    // Complete text must be clean with 0 syntax errors
    const finalTree = ctx.getTree(uri)!;
    const finalRootPtr = (finalTree.rootNode as any).id ?? (finalTree.rootNode as any).ptr ?? 0;
    const finalDiags = facade.getDiagnostics(finalRootPtr);
    expect((finalTree.rootNode as any).hasError()).toBe(false);
    expect(finalDiags).toHaveLength(0);
  });
});
