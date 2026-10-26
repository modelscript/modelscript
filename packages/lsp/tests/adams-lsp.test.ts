// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  adamsLanguage,
  AdamsWorkspaceIndex,
  getAdamsDocumentSymbols,
  getAdamsHover,
  validateAdams,
} from "@modelscript/adams";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";

const SAMPLE_ADAMS = `! Four Bar Linkage
ADAMS/
PART/1, GROUND
PART/2, MASS = 2.0, IP = 0.05, 0.05, 0.05
MARKER/1, PART = 1, QP = 0, 0, 0
MARKER/2, PART = 2, QP = 0, 0, 0
JOINT/1, REVOLUTE, I = 1, J = 2
SIMULATE/DYNAMIC, END = 1.0, DTOUT = 0.01
END
`;

describe("MSC Adams LSP Integration Suite", () => {
  it("resolves MSC Adams language plugin for .adm, .cmd, and .acf files", () => {
    globalLanguageRegistry.register({
      id: "adams",
      name: "MSC Adams",
      extensions: [".adm", ".cmd", ".acf"],
      languageDef: adamsLanguage,
      workspaceIndex: new AdamsWorkspaceIndex(),
      customHandlers: {
        symbols: (text: string) => getAdamsDocumentSymbols(text),
        hover: (offset: number, text: string) => getAdamsHover(text, offset),
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateAdams(text);
        },
      },
      actionHandlers: {
        lint_adams_model: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseAdams, lintAdamsModel } = await import("@modelscript/adams");
          const dataset = parseAdams(text);
          return lintAdamsModel(dataset);
        },
        analyze_adams_mobility: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseAdams, analyzeAdamsMobility } = await import("@modelscript/adams");
          const dataset = parseAdams(text);
          return analyzeAdamsMobility(dataset);
        },
        export_adams_simpack: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseAdams, adamsToSimpack } = await import("@modelscript/adams");
          const dataset = parseAdams(text);
          return adamsToSimpack(dataset);
        },
        export_adams_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseAdams, adamsToModelica } = await import("@modelscript/adams");
          const dataset = parseAdams(text);
          return adamsToModelica(dataset);
        },
        simulate_adams: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseAdams, lowerAdamsToDae } = await import("@modelscript/adams");
          const { initBltWasm } = await import("@modelscript/runtime");
          const { simulateArena } = await import("@modelscript/simulate");
          await initBltWasm();
          const dataset = parseAdams(text);
          const dae = lowerAdamsToDae(dataset);
          return simulateArena(dae, {
            startTime: params?.startTime ?? 0,
            stopTime: params?.stopTime ?? dataset.simulation?.endTime ?? 5.0,
            step: params?.step ?? dataset.simulation?.dtOut ?? 0.005,
          });
        },
      },
    });

    const pluginAdm = globalLanguageRegistry.getPluginForUri("file:///workspace/mechanism.adm");
    assert.ok(pluginAdm, "Should find plugin for .adm");
    assert.equal(pluginAdm.id, "adams");

    const pluginCmd = globalLanguageRegistry.getPluginForUri("file:///workspace/model.cmd");
    assert.ok(pluginCmd, "Should find plugin for .cmd");
    assert.equal(pluginCmd.id, "adams");

    const pluginAcf = globalLanguageRegistry.getPluginForUri("file:///workspace/sim.acf");
    assert.ok(pluginAcf, "Should find plugin for .acf");
    assert.equal(pluginAcf.id, "adams");
  });

  it("extracts document symbols and validates clean model", () => {
    const plugin = globalLanguageRegistry.get("adams");
    assert.ok(plugin);
    assert.ok(plugin.customHandlers?.symbols);
    assert.ok(plugin.customHandlers?.validate);

    const symbols = plugin.customHandlers.symbols(SAMPLE_ADAMS);
    assert.ok(Array.isArray(symbols));
    assert.ok(symbols.length > 0);

    const diags = plugin.customHandlers.validate({ getText: () => SAMPLE_ADAMS });
    assert.ok(Array.isArray(diags));
    const errors = diags.filter((d: any) => d.severity === 1);
    assert.equal(errors.length, 0);
  });

  it("executes MSC Adams action handlers for mobility, simpack export, and simulation", async () => {
    const plugin = globalLanguageRegistry.get("adams");
    assert.ok(plugin);
    assert.ok(plugin.actionHandlers);

    // 1. Mobility analysis
    const mobility = await plugin.actionHandlers.analyze_adams_mobility({}, { documentText: SAMPLE_ADAMS });
    assert.ok(mobility);
    assert.equal(mobility.numBodies, 2);
    assert.equal(mobility.numJoints, 1);

    // 2. Export to SIMPACK
    const simpack = await plugin.actionHandlers.export_adams_simpack({}, { documentText: SAMPLE_ADAMS });
    assert.ok(simpack);
    assert.ok(simpack.bodies && simpack.bodies.size > 0);

    // 3. Export to Modelica
    const mo = await plugin.actionHandlers.export_adams_modelica({}, { documentText: SAMPLE_ADAMS });
    assert.ok(typeof mo === "string");
    assert.ok(mo.includes("model"));

    // 4. Simulate DAE
    const simResult = await plugin.actionHandlers.simulate_adams(
      {},
      { documentText: SAMPLE_ADAMS, stopTime: 0.05, step: 0.01 },
    );
    assert.ok(simResult);
    assert.ok(simResult.t.length > 0);
  });
});
