// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getPsseDocumentSymbols,
  getPsseHover,
  lowerPsseToDae,
  parseRaw,
  psseLanguage,
  psseToEmtNetlist,
  psseToModelica,
  PsseWorkspaceIndex,
  solvePowerFlow,
  validatePsse,
} from "@modelscript/psse";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";

const IEEE_14_RAW = `0, 100.00, 33, 0, 0, 60.00 / PSS/E-33.0 IEEE 14 BUS TEST CASE
IEEE 14 BUS TEST CASE
TRANSMISSION PLANNING MODEL
1, 'BUS 1       ', 0.6900, 3, 1, 1, 1, 1.0600, 0.0000
2, 'BUS 2       ', 0.6900, 2, 1, 1, 1, 1.0450, -4.9800
3, 'BUS 3       ', 0.6900, 2, 1, 1, 1, 1.0100, -12.7200
4, 'BUS 4       ', 0.6900, 1, 1, 1, 1, 1.0190, -10.3300
5, 'BUS 5       ', 0.6900, 1, 1, 1, 1, 1.0200, -8.7800
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 21.700, 12.700, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
3, '1 ', 1, 1, 1, 94.200, 19.000, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
4, '1 ', 1, 1, 1, 47.800, -3.900, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
5, '1 ', 1, 1, 1, 7.600, 1.600, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 232.400, -16.900, 10.000, -9999.000, 1.0600, 0, 100.00, 0.00000, 1.00000, 0.00000, 0.00000, 1.0000, 1, 100.0, 9999.000, -9999.000
2, '1 ', 40.000, 42.400, 50.000, -40.000, 1.0450, 0, 100.00, 0.00000, 1.00000, 0.00000, 0.00000, 1.0000, 1, 100.0, 9999.000, -9999.000
3, '1 ', 0.000, 23.400, 40.000, 0.000, 1.0100, 0, 100.00, 0.00000, 1.00000, 0.00000, 0.00000, 1.0000, 1, 100.0, 9999.000, -9999.000
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.01938, 0.05917, 0.05280, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
1, 5, '1 ', 0.05403, 0.22304, 0.04920, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
2, 3, '1 ', 0.04699, 0.19797, 0.04380, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
2, 4, '1 ', 0.05811, 0.17632, 0.03400, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
2, 5, '1 ', 0.05695, 0.17388, 0.03460, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
3, 4, '1 ', 0.06701, 0.17103, 0.01280, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
4, 5, '1 ', 0.01335, 0.04211, 0.00000, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
`;

describe("PSS/E LSP Integration Suite (@modelscript/lsp)", () => {
  it("resolves PSS/E language plugin for power flow cases", () => {
    globalLanguageRegistry.register({
      id: "psse",
      name: "PSSE",
      extensions: [".raw", ".dyr", ".sav"],
      languageDef: psseLanguage,
      workspaceIndex: new PsseWorkspaceIndex(),
      customHandlers: {
        symbols: (text: string) => getPsseDocumentSymbols(text),
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getPsseHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validatePsse(text);
        },
      },
      actionHandlers: {
        lint_psse_case: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          return validatePsse(text);
        },
        export_psse_modelica: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          const model = parseRaw(text);
          return psseToModelica(model);
        },
        export_psse_pscad: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          const model = parseRaw(text);
          return psseToEmtNetlist(model);
        },
        export_psse_dae: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          const model = parseRaw(text);
          const dae = lowerPsseToDae(model);
          return { varCount: dae.varCount, eqCount: dae.eqCount };
        },
        solve_powerflow: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          const model = parseRaw(text);
          return solvePowerFlow(model, params);
        },
      },
      disposables: [],
    });

    const pluginRaw = globalLanguageRegistry.getPluginForUri("file:///workspace/grid.raw");
    assert.ok(pluginRaw);
    assert.equal(pluginRaw.id, "psse");
  });

  it("extracts document symbols and handles hover via registered handlers", () => {
    const plugin = globalLanguageRegistry.get("psse");
    assert.ok(plugin);
    assert.ok(plugin.customHandlers?.symbols);

    const symbols = plugin.customHandlers.symbols(IEEE_14_RAW) as any[];
    assert.ok(symbols.length > 0);
    assert.ok(symbols[0].name.includes("IEEE 14 BUS TEST CASE"));

    assert.ok(plugin.customHandlers?.hover);
    const offset = IEEE_14_RAW.indexOf("BUS 1");
    const hover = plugin.customHandlers.hover(offset, IEEE_14_RAW);
    assert.ok(hover);
  });

  it("executes export_psse_dae and solve_powerflow actions through registry", async () => {
    const plugin = globalLanguageRegistry.get("psse");
    assert.ok(plugin);
    assert.ok(plugin.actionHandlers?.export_psse_dae);

    const daeRes = await plugin.actionHandlers.export_psse_dae({}, { documentText: IEEE_14_RAW });
    assert.ok(daeRes.varCount > 0);
    assert.ok(daeRes.eqCount > 0);

    assert.ok(plugin.actionHandlers?.solve_powerflow);
    const pfRes = await plugin.actionHandlers.solve_powerflow({}, { documentText: IEEE_14_RAW });
    assert.ok(pfRes.converged);
  });
});
