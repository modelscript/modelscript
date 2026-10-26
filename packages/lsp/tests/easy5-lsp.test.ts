// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  easy5Language,
  easy5ToDae,
  easy5ToModelica,
  Easy5WorkspaceIndex,
  getEasy5DocumentSymbols,
  getEasy5Hover,
  parseEasy5,
  validateEasy5,
} from "@modelscript/easy5";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";

const SAMPLE_EASY5_MODEL = `MODEL: PitchControl
TITLE: "Aircraft Pitch Rate Feedback Controller"

COMPONENTS:
  IN01 TYPE=GP/IN TITLE="Forward Integrator"
    XP: GAIN=5.0, S0=0.0

  GA01 TYPE=GP/GA TITLE="Pitch Rate Gain"
    XP: K=2.5

  SJ01 TYPE=GP/SJ TITLE="Error Summer"
    XP: SGN1=1.0, SGN2=-1.0

CONNECTIONS:
  SJ01.OUT -> GA01.IN
  GA01.OUT -> IN01.IN
`;

describe("EASY5 LSP Integration Suite (@modelscript/lsp)", () => {
  it("resolves EASY5 language plugin for control models", () => {
    globalLanguageRegistry.register({
      id: "easy5",
      name: "EASY5",
      extensions: [".ez5", ".ezm", ".ezd", ".eas"],
      languageDef: easy5Language,
      workspaceIndex: new Easy5WorkspaceIndex(),
      customHandlers: {
        symbols: (text: string) => getEasy5DocumentSymbols(text),
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getEasy5Hover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateEasy5(text);
        },
      },
      actionHandlers: {
        lint_easy5_model: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          return validateEasy5(text);
        },
        export_easy5_modelica: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          const model = parseEasy5(text);
          return easy5ToModelica(model);
        },
        export_easy5_dae: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          const model = parseEasy5(text);
          const dae = easy5ToDae(model);
          return { varCount: dae.varCount, eqCount: dae.eqCount };
        },
      },
      disposables: [],
    });

    const pluginEz5 = globalLanguageRegistry.getPluginForUri("file:///workspace/pitch.ez5");
    assert.ok(pluginEz5);
    assert.equal(pluginEz5.id, "easy5");
  });

  it("extracts document symbols and handles hover via registered handlers", () => {
    const plugin = globalLanguageRegistry.get("easy5");
    assert.ok(plugin);
    assert.ok(plugin.customHandlers?.symbols);

    const symbols = plugin.customHandlers.symbols(SAMPLE_EASY5_MODEL) as any[];
    assert.ok(symbols.length > 0);
    assert.ok(symbols[0].children && symbols[0].children.length >= 3);

    assert.ok(plugin.customHandlers?.hover);
    const offset = SAMPLE_EASY5_MODEL.indexOf("GA01 TYPE=GP/GA");
    const hover = plugin.customHandlers.hover(offset, SAMPLE_EASY5_MODEL);
    assert.ok(hover);
  });

  it("executes export_easy5_dae and export_easy5_modelica actions through registry", async () => {
    const plugin = globalLanguageRegistry.get("easy5");
    assert.ok(plugin);
    assert.ok(plugin.actionHandlers?.export_easy5_dae);

    const daeRes = await plugin.actionHandlers.export_easy5_dae({}, { documentText: SAMPLE_EASY5_MODEL });
    assert.ok(daeRes.varCount > 0);
    assert.ok(daeRes.eqCount > 0);

    assert.ok(plugin.actionHandlers?.export_easy5_modelica);
    const moRes = await plugin.actionHandlers.export_easy5_modelica({}, { documentText: SAMPLE_EASY5_MODEL });
    assert.ok(typeof moRes === "string");
    assert.ok(moRes.includes("model PitchControl"));
  });
});
