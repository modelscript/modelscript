// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getSimaDocumentSymbols,
  getSimaHover,
  lowerSimaToDae,
  parseSimaFile,
  simaLanguage,
  simaToModelica,
  SimaWorkspaceIndex,
  validateSima,
} from "@modelscript/sima";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";

const SAMPLE_SIMO_DECK = `! SIMO / RIFLEX Benchmark: OC4 Semi-Submersible Floating Offshore Wind
SYS 200.0 1025.0 9.81
BODY semi_hull OC4_Semi 13444000 13989 0.0 0.0 -13.46 32.0 32.0 34.0 4.5 5.0
FAIRLEAD fl_1 semi_hull 40.868 0.0 -14.0
FAIRLEAD fl_2 semi_hull -20.434 35.393 -14.0
FAIRLEAD fl_3 semi_hull -20.434 -35.393 -14.0

CRS chain_type 0.137 385.5 3200 1.25e9 1.0e5 1.8e7 1.2 2.0
LINE line_1 catenary fl_1 837.6 0.0 -200.0
SEGM chain_type 835.5 1.8e7
LINE line_2 catenary fl_2 -418.8 725.4 -200.0
SEGM chain_type 835.5 1.8e7
LINE line_3 catenary fl_3 -418.8 -725.4 -200.0
SEGM chain_type 835.5 1.8e7

WAVE JONSWAP 8.0 12.5 3.3 0.0
WIND 20.0 0.0
CURR 1.2 0.0
TIME 0.05 3600.0
`;

describe("SIMA LSP Integration Suite (@modelscript/lsp)", () => {
  it("resolves SIMA language plugin for marine simulation decks", () => {
    globalLanguageRegistry.register({
      id: "sima",
      name: "SIMA",
      extensions: [".inp", ".sima", ".sys", ".hyd"],
      languageDef: simaLanguage,
      workspaceIndex: new SimaWorkspaceIndex(),
      customHandlers: {
        symbols: (text: string) => getSimaDocumentSymbols(text),
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getSimaHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateSima(text);
        },
      },
      actionHandlers: {
        lint_sima_model: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          return validateSima(text);
        },
        project_sima_modelica: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          const model = parseSimaFile(text);
          return simaToModelica(model);
        },
        export_sima_dae: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          const model = parseSimaFile(text);
          const dae = lowerSimaToDae(model);
          return { varCount: dae.varCount, eqCount: dae.eqCount };
        },
      },
      disposables: [],
    });

    const pluginInp = globalLanguageRegistry.getPluginForUri("file:///workspace/platform.inp");
    assert.ok(pluginInp);
    assert.equal(pluginInp.id, "sima");

    const pluginSima = globalLanguageRegistry.getPluginForUri("file:///workspace/platform.sima");
    assert.ok(pluginSima);
    assert.equal(pluginSima.id, "sima");
  });

  it("extracts document symbols and handles hover via registered handlers", () => {
    const plugin = globalLanguageRegistry.get("sima");
    assert.ok(plugin);
    assert.ok(plugin.customHandlers?.symbols);

    const symbols = plugin.customHandlers.symbols(SAMPLE_SIMO_DECK) as any[];
    assert.ok(symbols.length > 0);
    assert.ok(symbols[0].children && symbols[0].children.length > 0);

    assert.ok(plugin.customHandlers?.hover);
    const offset = SAMPLE_SIMO_DECK.indexOf("OC4_Semi");
    const hover = plugin.customHandlers.hover(offset, SAMPLE_SIMO_DECK);
    assert.ok(hover);
  });

  it("executes export_sima_dae and project_sima_modelica actions through registry", async () => {
    const plugin = globalLanguageRegistry.get("sima");
    assert.ok(plugin);
    assert.ok(plugin.actionHandlers?.export_sima_dae);

    const daeRes = await plugin.actionHandlers.export_sima_dae({}, { documentText: SAMPLE_SIMO_DECK });
    assert.ok(daeRes.varCount > 0);
    assert.ok(daeRes.eqCount > 0);

    assert.ok(plugin.actionHandlers?.project_sima_modelica);
    const moRes = await plugin.actionHandlers.project_sima_modelica({}, { documentText: SAMPLE_SIMO_DECK });
    assert.ok(typeof moRes === "string");
    assert.ok(moRes.includes("model OffshoreSystem"));
  });
});
