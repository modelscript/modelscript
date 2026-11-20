// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import olgaLanguage from "../../../languages/olga/src/language.js";
import * as olgaLsp from "../../../languages/olga/src/lsp.js";
import { buildLanguagePluginFromModule, createLspRuntime } from "../src/core/index.js";

describe("@modelscript/lsp/core single-language runtime", () => {
  it("runs diagnostics, document symbols, hover, and custom actions for a single language plugin", async () => {
    const plugin = buildLanguagePluginFromModule({
      id: "olga",
      name: "OLGA",
      extensions: [".opi", ".key", ".genkey"],
      languageDef: olgaLanguage,
      lspModule: olgaLsp as unknown as Record<string, unknown>,
    });

    const runtime = createLspRuntime({ plugins: [plugin] });
    const sampleCode = [
      'CASE TITLE="Subsea Tieback"',
      "NODE LABEL=WELLHEAD, TYPE=TERMINAL, PRESSURE=85 bar",
      "NODE LABEL=TOPSIDE, TYPE=TERMINAL, PRESSURE=25 bar",
      "BRANCH LABEL=FLOWLINE, FROM=WELLHEAD, TO=TOPSIDE, DIAMETER=0.254 m, LENGTH=4500 m",
    ].join("\n");

    const diagRes = await runtime.handleRequest({
      method: "textDocument/diagnostic",
      code: sampleCode,
      documentUri: "file:///case.opi",
    });
    assert.strictEqual(diagRes.handled, true);
    assert.ok(Array.isArray(diagRes.result));

    const symRes = await runtime.handleRequest({
      method: "textDocument/documentSymbol",
      code: sampleCode,
      documentUri: "file:///case.opi",
    });
    assert.strictEqual(symRes.handled, true);
    assert.ok(Array.isArray(symRes.result));

    const hoverRes = await runtime.handleRequest({
      method: "textDocument/hover",
      code: sampleCode,
      documentUri: "file:///case.opi",
      params: { position: { line: 1, character: 2 } },
    });
    assert.strictEqual(hoverRes.handled, true);

    const actionRes = await runtime.handleRequest({
      method: "workspace/executeCommand",
      code: sampleCode,
      documentUri: "file:///case.opi",
      params: { command: "lint" },
    });
    assert.strictEqual(actionRes.handled, true);
    assert.ok(Array.isArray(actionRes.result));
  });

  it("extracts CST syntax errors and semantic tokens when a parser is attached", async () => {
    const fakeParser = {
      parse: (input: string) => ({
        rootNode: {
          type: "source_file",
          isNamed: true,
          startIndex: 0,
          endIndex: input.length,
          children: [
            {
              type: "keyword",
              isNamed: false,
              startIndex: 0,
              endIndex: 5,
              startPosition: { row: 0, column: 0 },
              endPosition: { row: 0, column: 5 },
              children: [],
            },
            {
              type: "ERROR",
              isError: true,
              isNamed: true,
              text: "???",
              startIndex: 6,
              endIndex: 9,
              startPosition: { row: 0, column: 6 },
              endPosition: { row: 0, column: 9 },
              children: [],
            },
          ],
        },
      }),
    };

    const plugin = buildLanguagePluginFromModule({
      id: "demo",
      name: "Demo",
      extensions: [".demo"],
      parser: fakeParser,
    });
    const runtime = createLspRuntime({ plugins: [plugin] });

    const diagRes = await runtime.handleRequest({
      method: "textDocument/diagnostic",
      code: "model ???",
      documentUri: "file:///test.demo",
    });
    assert.strictEqual(diagRes.handled, true);
    const diags = diagRes.result as Array<{ code?: string; severity?: number }>;
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0]?.code, "parse-error");
    assert.strictEqual(diags[0]?.severity, 1);

    const semRes = await runtime.handleRequest({
      method: "textDocument/semanticTokens/full",
      code: "model ???",
      documentUri: "file:///test.demo",
    });
    assert.strictEqual(semRes.handled, true);
    const semData = (semRes.result as { data: number[] }).data;
    assert.ok(Array.isArray(semData) && semData.length >= 5);
  });

  it("extracts and formats compiled WASM CST lints from facade.getDiagnostics", async () => {
    let loadedSource = "";
    const fakeParser = {
      parse: (input: string) => ({
        rootNode: {
          id: 42,
          type: "source_file",
          hasError: false,
          startIndex: 0,
          endIndex: input.length,
          children: [],
        },
      }),
    };
    const fakeFacade = {
      loadSource: (text: string) => {
        loadedSource = text;
      },
      getDiagnostics: (rootPtr: number) => {
        assert.strictEqual(rootPtr, 42);
        return [
          {
            code: 2005,
            startOffset: 10,
            endOffset: 11,
            message: "Linter Rule 2005",
          },
        ];
      },
    };

    const plugin = buildLanguagePluginFromModule({
      id: "demo",
      name: "Demo",
      extensions: [".demo"],
      languageDef: {
        name: "demo",
        lints: {
          identifierMismatch: {
            code: 2005,
            severity: "warning",
            nodes: ["class_definition"],
            message: (target: { text: string }) => `Mismatched end identifier '${target.text}'.`,
            query: () => {},
          },
        },
      } as unknown as Parameters<typeof buildLanguagePluginFromModule>[0]["languageDef"],
      parser: fakeParser,
      facade: fakeFacade,
    });

    const runtime = createLspRuntime({ plugins: [plugin] });
    const code = "model A\nend B;";
    const diagRes = await runtime.handleRequest({
      method: "textDocument/diagnostic",
      code,
      documentUri: "file:///mismatch.demo",
    });

    assert.strictEqual(diagRes.handled, true);
    assert.strictEqual(loadedSource, code);
    const diags = diagRes.result as Array<{
      code?: string | number;
      severity?: number;
      source?: string;
      message?: string;
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
    }>;
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0]?.code, 2005);
    assert.strictEqual(diags[0]?.severity, 2);
    assert.strictEqual(diags[0]?.source, "demo-lint");
    assert.strictEqual(diags[0]?.message, "Mismatched end identifier 'd'.");
    assert.deepStrictEqual(diags[0]?.range.start, { line: 1, character: 2 });
  });

  it("computes polyglot BLT incidence and block ordering via modelscript/analyzeBlt", async () => {
    const { BinOp, Causality, DAEBuilder, EqKind, ExprKind, StringInterner, Variability, VarType } =
      await import("@modelscript/runtime");
    const plugin = buildLanguagePluginFromModule({
      id: "dae-demo",
      name: "DAE Demo",
      extensions: [".ddemo"],
      lspModule: {
        toDae: () => {
          const interner = new StringInterner();
          const dae = new DAEBuilder(interner, "DemoSystem");
          dae.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 0);
          dae.addVariable("y", VarType.Real, Variability.Continuous, Causality.Local, 0);
          const xRef = dae.addExpression(ExprKind.Name, interner.intern("x"));
          const yRef = dae.addExpression(ExprKind.Name, interner.intern("y"));
          const one = dae.addRealLiteral(1);
          const two = dae.addRealLiteral(2);
          dae.addEquation(EqKind.Simple, xRef, one);
          dae.addEquation(EqKind.Simple, yRef, dae.addBinaryExpr(BinOp.Add, xRef, two));
          return dae;
        },
      },
    });

    const runtime = createLspRuntime({ plugins: [plugin] });
    const res = await runtime.handleRequest({
      method: "modelscript/analyzeBlt",
      code: "x = 1; y = x + 2;",
      documentUri: "file:///demo.ddemo",
    });

    assert.strictEqual(res.handled, true, res.error ?? res.note);
    const payload = res.result as {
      supported: boolean;
      data: {
        status: string;
        unknowns: string[];
        equations: { text: string }[];
        blocks: { blockIndex: number; variables: string[]; isAlgebraicLoop: boolean }[];
      } | null;
    };
    assert.strictEqual(payload.supported, true);
    assert.ok(payload.data);
    assert.strictEqual(payload.data.status, "balanced");
    assert.deepStrictEqual(payload.data.unknowns, ["x", "y"]);
    assert.strictEqual(payload.data.equations.length, 2);
    assert.strictEqual(payload.data.blocks.length, 2);
  });

  it("dispatches modelscript/getDiagramData, applyDiagramEdits, and getComponentProperties", async () => {
    const plugin = buildLanguagePluginFromModule({
      id: "diag-demo",
      name: "Diag Demo",
      extensions: [".diag"],
      lspModule: {
        getDiagramData: (code: string) => ({ nodes: [{ id: "R1", label: code.trim() }], edges: [] }),
        applyDiagramEdits: (_code: string, params: { action?: string }) => ({ applied: true, action: params?.action }),
        getComponentProperties: (_code: string, params: { componentName?: string }) => ({
          name: params?.componentName,
          parameters: [{ name: "R", value: "100" }],
        }),
      },
    });

    const runtime = createLspRuntime({ plugins: [plugin] });

    const diagRes = await runtime.handleRequest({
      method: "modelscript/getDiagramData",
      code: "Resistor R1(R=100);",
      documentUri: "file:///circuit.diag",
    });
    assert.strictEqual(diagRes.handled, true);
    assert.deepStrictEqual(diagRes.result, { nodes: [{ id: "R1", label: "Resistor R1(R=100);" }], edges: [] });

    const editRes = await runtime.handleRequest({
      method: "modelscript/applyDiagramEdits",
      code: "Resistor R1(R=100);",
      documentUri: "file:///circuit.diag",
      params: { action: "setParameter" },
    });
    assert.strictEqual(editRes.handled, true);
    assert.deepStrictEqual(editRes.result, { applied: true, action: "setParameter" });

    const propRes = await runtime.handleRequest({
      method: "modelscript/getComponentProperties",
      code: "Resistor R1(R=100);",
      documentUri: "file:///circuit.diag",
      params: { componentName: "R1" },
    });
    assert.strictEqual(propRes.handled, true);
    assert.deepStrictEqual(propRes.result, { name: "R1", parameters: [{ name: "R", value: "100" }] });
  });

  it("serves Modelica diagram, edits, properties, and BLT via languages/modelica/src/lsp.ts", async () => {
    const modelicaLsp = await import("../../../languages/modelica/src/lsp.js");
    const plugin = buildLanguagePluginFromModule({
      id: "modelica",
      name: "Modelica",
      extensions: [".mo"],
      lspModule: modelicaLsp as unknown as Record<string, unknown>,
    });

    const runtime = createLspRuntime({ plugins: [plugin] });
    const sample = [
      "model RC",
      "  Modelica.Electrical.Analog.Basic.Resistor R1(R=100);",
      "  Real x(start=1);",
      "equation",
      "  der(x) = -x;",
      "end RC;",
    ].join("\n");

    const diagRes = await runtime.handleRequest({
      method: "modelscript/getDiagramData",
      code: sample,
      documentUri: "file:///RC.mo",
    });
    assert.strictEqual(diagRes.handled, true);
    assert.ok(diagRes.result && typeof diagRes.result === "object");

    const propRes = await runtime.handleRequest({
      method: "modelscript/getComponentProperties",
      code: sample,
      documentUri: "file:///RC.mo",
      params: { componentName: "R1" },
    });
    assert.strictEqual(propRes.handled, true);
    const props = propRes.result as { componentName?: string; values?: Record<string, string> };
    assert.strictEqual(props.componentName, "R1");
    assert.strictEqual(props.values?.["R"], "100");

    const bltRes = await runtime.handleRequest({
      method: "modelscript/analyzeBlt",
      code: sample,
      documentUri: "file:///RC.mo",
    });
    assert.strictEqual(bltRes.handled, true);
    const bltPayload = bltRes.result as { supported: boolean; data: { status: string; states: string[] } };
    assert.strictEqual(bltPayload.supported, true);
    assert.strictEqual(bltPayload.data.status, "balanced");
    assert.deepStrictEqual(bltPayload.data.states, ["x"]);
  });
});
