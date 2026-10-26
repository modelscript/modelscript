// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getSpiceDocumentSymbols,
  getSpiceHover,
  spiceLanguage,
  SpiceWorkspaceIndex,
  validateSpice,
} from "@modelscript/spice";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";

const SAMPLE_SPICE = `* Voltage Divider Test
R1 in out 1k
R2 out 0 2k
V1 in 0 10
.OP
.TRAN 1u 10m
.AC DEC 10 1 100k
.END
`;

describe("SPICE LSP Language Server Integration", () => {
  it("registers and resolves SPICE language plugin for .cir, .sp, .net, and .lib", () => {
    globalLanguageRegistry.register({
      id: "spice",
      name: "SPICE",
      extensions: [".cir", ".sp", ".net", ".lib"],
      languageDef: spiceLanguage,
      workspaceIndex: new SpiceWorkspaceIndex(),
      customHandlers: {
        symbols: (text: string) => getSpiceDocumentSymbols(text),
        hover: (offset: number, text: string) => {
          let line = 0;
          let lastLineStart = 0;
          for (let i = 0; i < offset && i < text.length; i++) {
            if (text[i] === "\n") {
              line++;
              lastLineStart = i + 1;
            }
          }
          return getSpiceHover(text, line, offset - lastLineStart);
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateSpice(text);
        },
      },
      actionHandlers: {
        spice_run_op: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseSpice, solveOp } = await import("@modelscript/spice");
          const circuit = parseSpice(text);
          return solveOp(circuit);
        },
        spice_run_tran: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseSpice, solveTran } = await import("@modelscript/spice");
          const circuit = parseSpice(text);
          return solveTran(circuit, params);
        },
        spice_run_ac: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseSpice, solveAc } = await import("@modelscript/spice");
          const circuit = parseSpice(text);
          return solveAc(circuit, params);
        },
        export_spice_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseSpice, spiceToModelica } = await import("@modelscript/spice");
          const circuit = parseSpice(text);
          return spiceToModelica(circuit);
        },
        export_spice_ecad: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseSpice, spiceToNetlistGraph } = await import("@modelscript/spice");
          const circuit = parseSpice(text);
          return spiceToNetlistGraph(circuit);
        },
      },
    });

    const pluginCir = globalLanguageRegistry.getPluginForUri("file:///workspace/filter.cir");
    assert.ok(pluginCir, "Should find plugin for .cir");
    assert.equal(pluginCir.id, "spice");

    const pluginSp = globalLanguageRegistry.getPluginForUri("file:///workspace/netlist.sp");
    assert.ok(pluginSp, "Should find plugin for .sp");
    assert.equal(pluginSp.id, "spice");

    const pluginNet = globalLanguageRegistry.getPluginForUri("file:///workspace/schematic.net");
    assert.ok(pluginNet, "Should find plugin for .net");
    assert.equal(pluginNet.id, "spice");

    const pluginLib = globalLanguageRegistry.getPluginForUri("file:///workspace/models.lib");
    assert.ok(pluginLib, "Should find plugin for .lib");
    assert.equal(pluginLib.id, "spice");
  });

  it("provides document symbols, diagnostics, and hover via custom handlers", () => {
    const plugin = globalLanguageRegistry.get("spice");
    assert.ok(plugin);
    assert.ok(plugin.customHandlers?.symbols);
    assert.ok(plugin.customHandlers?.validate);
    assert.ok(plugin.customHandlers?.hover);

    const symbols = plugin.customHandlers.symbols(SAMPLE_SPICE);
    assert.ok(Array.isArray(symbols));
    assert.equal(symbols.length, 1);
    assert.ok(symbols[0].children && symbols[0].children.length >= 3);

    const diags = plugin.customHandlers.validate({ getText: () => SAMPLE_SPICE });
    assert.ok(Array.isArray(diags));
    const errors = diags.filter((d: any) => d.severity === 1);
    assert.equal(errors.length, 0);

    const r1Offset = SAMPLE_SPICE.indexOf("R1");
    const hover = plugin.customHandlers.hover(r1Offset, SAMPLE_SPICE);
    assert.ok(hover);
    assert.ok(hover.contents.value.includes("R1"));
  });

  it("executes SPICE action handlers for OP, TRAN, AC solvers and Modelica/ECAD projections", async () => {
    const plugin = globalLanguageRegistry.get("spice");
    assert.ok(plugin);
    assert.ok(plugin.actionHandlers);

    // 1. spice_run_op
    const opResult = await plugin.actionHandlers.spice_run_op({}, { documentText: SAMPLE_SPICE });
    assert.ok(opResult);
    assert.ok(opResult.converged);
    const vOut = opResult.nodeVoltages.get("OUT") ?? opResult.nodeVoltages.get("out");
    assert.ok(vOut !== undefined);
    assert.ok(Math.abs(vOut - 6.666667) < 0.01, `Expected out ~6.67V, got ${vOut}`);

    // 2. spice_run_tran
    const tranResult = await plugin.actionHandlers.spice_run_tran({}, { documentText: SAMPLE_SPICE });
    assert.ok(tranResult);
    assert.ok(tranResult.time.length > 0);

    // 3. spice_run_ac
    const acResult = await plugin.actionHandlers.spice_run_ac({}, { documentText: SAMPLE_SPICE });
    assert.ok(acResult);
    assert.ok(acResult.frequency.length > 0);

    // 4. export_spice_modelica
    const modelicaCode = await plugin.actionHandlers.export_spice_modelica({}, { documentText: SAMPLE_SPICE });
    assert.ok(typeof modelicaCode === "string");
    assert.ok(modelicaCode.includes("model SPICE_Circuit") || modelicaCode.includes("model"));

    // 5. export_spice_ecad
    const ecadGraph = await plugin.actionHandlers.export_spice_ecad({}, { documentText: SAMPLE_SPICE });
    assert.ok(ecadGraph);
    assert.ok(ecadGraph.components && ecadGraph.components.length >= 3);
  });
});
