// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getRocetsDocumentSymbols,
  getRocetsHover,
  parseRocetsDeck,
  rocetsLanguage,
  rocetsToDae,
  rocetsToModelica,
  RocetsWorkspaceIndex,
  validateRocets,
} from "@modelscript/rocets";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";

const SAMPLE_ROCETS_DECK = `DECK: EngineCore
TITLE: "Expander Cycle Rocket Engine"
CYCLE: expander

COMPONENTS:
  CHAMBER TYPE=CHAMBER TITLE="Main Combustion Chamber"
    PARAMS: PC=10.0E6, AT=0.02, CSTAR=1780.0, VC=0.015
    S0: PC=10.0E6

  PUMP01 TYPE=PUMP TITLE="LH2 Main Pump"
    PARAMS: DELTA_P=15.0E6, ETA=0.75, RHO=71.0

  TURB01 TYPE=TURBINE TITLE="Drive Turbine"
    PARAMS: ETA=0.78, PR=2.2

  SHAFT01 TYPE=SHAFT TITLE="Turbopump Shaft"
    PARAMS: INERTIA=0.05, SPEED_RPM=35000.0

CONNECTIONS:
  PUMP01.OUT_P -> CHAMBER.IN_FUEL
`;

describe("ROCETS LSP Integration Suite (@modelscript/lsp)", () => {
  it("resolves ROCETS language plugin for rocket engine simulation decks", () => {
    globalLanguageRegistry.register({
      id: "rocets",
      name: "ROCETS",
      extensions: [".roc", ".deck"],
      languageDef: rocetsLanguage,
      workspaceIndex: new RocetsWorkspaceIndex(),
      customHandlers: {
        symbols: (text: string) => getRocetsDocumentSymbols(text),
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getRocetsHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateRocets(text);
        },
      },
      actionHandlers: {
        lint_rocets_deck: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          return validateRocets(text);
        },
        export_rocets_modelica: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          const model = parseRocetsDeck(text);
          return rocetsToModelica(model);
        },
        export_rocets_dae: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          const model = parseRocetsDeck(text);
          const dae = rocetsToDae(model);
          return { varCount: dae.varCount, eqCount: dae.eqCount };
        },
      },
      disposables: [],
    });

    const pluginRoc = globalLanguageRegistry.getPluginForUri("file:///workspace/engine.roc");
    assert.ok(pluginRoc);
    assert.equal(pluginRoc.id, "rocets");
  });

  it("extracts document symbols and handles hover via registered handlers", () => {
    const plugin = globalLanguageRegistry.get("rocets");
    assert.ok(plugin);
    assert.ok(plugin.customHandlers?.symbols);

    const symbols = plugin.customHandlers.symbols(SAMPLE_ROCETS_DECK) as any[];
    assert.ok(symbols.length > 0);
    assert.ok(symbols[0].children && symbols[0].children.length >= 4);

    assert.ok(plugin.customHandlers?.hover);
    const offset = SAMPLE_ROCETS_DECK.indexOf("CHAMBER TYPE=CHAMBER");
    const hover = plugin.customHandlers.hover(offset, SAMPLE_ROCETS_DECK);
    assert.ok(hover);
  });

  it("executes export_rocets_dae and export_rocets_modelica actions through registry", async () => {
    const plugin = globalLanguageRegistry.get("rocets");
    assert.ok(plugin);
    assert.ok(plugin.actionHandlers?.export_rocets_dae);

    const daeRes = await plugin.actionHandlers.export_rocets_dae({}, { documentText: SAMPLE_ROCETS_DECK });
    assert.ok(daeRes.varCount > 0);
    assert.ok(daeRes.eqCount > 0);

    assert.ok(plugin.actionHandlers?.export_rocets_modelica);
    const moRes = await plugin.actionHandlers.export_rocets_modelica({}, { documentText: SAMPLE_ROCETS_DECK });
    assert.ok(typeof moRes === "string");
    assert.ok(moRes.includes("model EngineCore"));
  });
});
