// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOlgaDocumentSymbols,
  getOlgaHover,
  lowerOlgaToDae,
  olgaLanguage,
  OlgaWorkspaceIndex,
  parseOlga,
  simulateDriftFlux,
  validateOlga,
} from "@modelscript/olga";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";

const SAMPLE_OLGA = `CASE TITLE = "SubseaTieback"
FILES TABLE = "fluids.tab"
FLOWPATH NAME = TiebackLine
  PIPE LABEL = P-101, LENGTH = 1500.0 m, DIAMETER = 0.3 m, ROUGHNESS = 0.000045 m, NSEGMENT = 5
  VALVE NAME = Choke-1, POSITION = 1500.0 m, OPENING = 0.8
NODE NAME = InletWell, TYPE = MASS_SOURCE, FLOWPATH = TiebackLine, FRACTION = 0.0, PRESSURE = 120.0 bar, TEMPERATURE = 85.0 C, TOTALMASSRATE = 25.0 kg/s
NODE NAME = HostSeparator, TYPE = TERMINAL, FLOWPATH = TiebackLine, FRACTION = 1.0, PRESSURE = 35.0 bar, TEMPERATURE = 25.0 C
`;

describe("OLGA LSP Integration Suite (@modelscript/lsp)", () => {
  it("resolves OLGA language plugin for multiphase pipeline decks", () => {
    globalLanguageRegistry.register({
      id: "olga",
      name: "OLGA",
      extensions: [".genkey", ".key", ".opi", ".olga", ".pvt", ".tab"],
      languageDef: olgaLanguage,
      workspaceIndex: new OlgaWorkspaceIndex(),
      customHandlers: {
        symbols: (text: string) => getOlgaDocumentSymbols(text),
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getOlgaHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateOlga(text);
        },
      },
      actionHandlers: {
        lint_olga_case: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          const model = parseOlga(text);
          return validateOlga(text);
        },
        export_olga_dae: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          const model = parseOlga(text);
          const dae = lowerOlgaToDae(model);
          return { varCount: dae.varCount, eqCount: dae.eqCount };
        },
        simulate_drift_flux: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          const model = parseOlga(text);
          return simulateDriftFlux(model, { durationSeconds: params?.durationSeconds ?? 5.0 });
        },
      },
      disposables: [],
    });

    const pluginKey = globalLanguageRegistry.getPluginForUri("file:///workspace/pipeline.genkey");
    assert.ok(pluginKey);
    assert.equal(pluginKey.id, "olga");

    const pluginTab = globalLanguageRegistry.getPluginForUri("file:///workspace/fluids.tab");
    assert.ok(pluginTab);
    assert.equal(pluginTab.id, "olga");
  });

  it("extracts document symbols and handles hover via registered handlers", () => {
    const plugin = globalLanguageRegistry.get("olga");
    assert.ok(plugin);
    assert.ok(plugin.customHandlers?.symbols);

    const symbols = plugin.customHandlers.symbols(SAMPLE_OLGA) as any[];
    assert.ok(symbols.length > 0);
    assert.equal(symbols[0].name, "SubseaTieback");

    assert.ok(plugin.customHandlers?.hover);
    const offset = SAMPLE_OLGA.indexOf("TiebackLine");
    const hover = plugin.customHandlers.hover(offset, SAMPLE_OLGA);
    assert.ok(hover);
  });

  it("executes export_olga_dae and simulate_drift_flux actions through registry", async () => {
    const plugin = globalLanguageRegistry.get("olga");
    assert.ok(plugin);
    assert.ok(plugin.actionHandlers?.export_olga_dae);

    const daeRes = await plugin.actionHandlers.export_olga_dae({}, { documentText: SAMPLE_OLGA });
    assert.ok(daeRes.varCount > 0);
    assert.ok(daeRes.eqCount > 0);

    assert.ok(plugin.actionHandlers?.simulate_drift_flux);
    const simRes = await plugin.actionHandlers.simulate_drift_flux(
      {},
      { documentText: SAMPLE_OLGA, durationSeconds: 2.0 },
    );
    assert.ok(simRes);
  });
});
