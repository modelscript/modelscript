// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getSimulinkDocumentSymbols,
  getSimulinkHover,
  simulinkLanguage,
  SimulinkWorkspaceIndex,
  validateSimulink,
} from "@modelscript/simulink";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";

const SAMPLE_MDL = `Model {
  Name "EngineGovernor"
  System {
    Name "EngineGovernor"
    Block {
      BlockType Constant
      Name "TargetSpeed"
      Value 1500.0
    }
    Block {
      BlockType Gain
      Name "ControllerGain"
      Gain 2.5
    }
    Line {
      SrcBlock "TargetSpeed"
      SrcPort 1
      DstBlock "ControllerGain"
      DstPort 1
    }
  }
}`;

describe("Simulink LSP Integration Suite (@modelscript/lsp)", () => {
  it("resolves Simulink language plugin for .mdl and .slx files", () => {
    globalLanguageRegistry.register({
      id: "simulink",
      name: "MATLAB Simulink",
      extensions: [".mdl", ".slx"],
      languageDef: simulinkLanguage,
      workspaceIndex: new SimulinkWorkspaceIndex(),
      customHandlers: {
        symbols: (text: string) => getSimulinkDocumentSymbols(text, "model.mdl"),
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getSimulinkHover(text, { line, character }, "model.mdl");
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateSimulink(text, "model.mdl");
        },
      },
      actionHandlers: {
        lint_simulink_model: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseSimulink, lintSimulinkModel } = await import("@modelscript/simulink");
          const model = parseSimulink(text);
          return lintSimulinkModel(model);
        },
        export_simulink_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseSimulink, simulinkToModelica } = await import("@modelscript/simulink");
          const model = parseSimulink(text);
          return simulinkToModelica(model);
        },
        export_simulink_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseSimulink, lowerSimulinkToDae } = await import("@modelscript/simulink");
          const model = parseSimulink(text);
          const dae = lowerSimulinkToDae(model);
          return {
            varCount: dae.varCount,
            eqCount: dae.eqCount,
          };
        },
      },
    });

    const pluginMdl = globalLanguageRegistry.getPluginForUri("file:///workspace/system.mdl");
    assert.ok(pluginMdl, "Should find plugin for .mdl");
    assert.equal(pluginMdl.id, "simulink");

    const pluginSlx = globalLanguageRegistry.getPluginForUri("file:///workspace/system.slx");
    assert.ok(pluginSlx, "Should find plugin for .slx");
    assert.equal(pluginSlx.id, "simulink");
  });

  it("extracts document symbols and handles hover via registered handlers", () => {
    const plugin = globalLanguageRegistry.get("simulink");
    assert.ok(plugin);
    assert.ok(plugin.customHandlers?.symbols);

    const symbols = plugin.customHandlers.symbols(SAMPLE_MDL) as any[];
    assert.ok(symbols.length > 0);
    assert.equal(symbols[0].name, "EngineGovernor");

    assert.ok(plugin.customHandlers?.hover);
    const hover = plugin.customHandlers.hover(SAMPLE_MDL.indexOf("ControllerGain"), SAMPLE_MDL);
    assert.ok(hover);
  });

  it("executes simulink actions through language plugin action handlers", async () => {
    const plugin = globalLanguageRegistry.get("simulink");
    assert.ok(plugin);
    assert.ok(plugin.actionHandlers);

    const lints = await plugin.actionHandlers.lint_simulink_model({ documentText: SAMPLE_MDL }, {});
    assert.equal(lints.length, 0);

    const mo = await plugin.actionHandlers.export_simulink_modelica({ documentText: SAMPLE_MDL }, {});
    assert.ok(mo.includes("model EngineGovernor"));

    const dae = await plugin.actionHandlers.export_simulink_dae({ documentText: SAMPLE_MDL }, {});
    assert.ok(dae.varCount >= 2);
    assert.ok(dae.eqCount >= 2);
  });
});
