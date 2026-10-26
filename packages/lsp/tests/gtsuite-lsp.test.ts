// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getGtsuiteDocumentSymbols,
  getGtsuiteHover,
  gtsuiteLanguage,
  gtsuiteToDae,
  gtsuiteToModelica,
  GtSuiteWorkspaceIndex,
  parseGtmModel,
  validateGtsuite,
} from "@modelscript/gtsuite";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";

const SAMPLE_GTM_MODEL = `MODEL: Test_Turbo_4Cyl
SPEED: 3000.0
LAMBDA: 1.0

COMPONENTS:
  INLET = environment_inlet (P = 101325, T = 298.15)
  COMP = turbo_compressor (PR = 2.0, EFF = 0.76, MASS_FLOW = 0.14)
  PLENUM_IN = plenum (VOL = 0.0035, P = 180000, T = 315)
  RUNNER1 = intake_runner (D = 0.045, L = 0.35)
  CYL1 = cylinder (BORE = 0.0825, STROKE = 0.0928, ROD = 0.144, CR = 10.0, ANCHOR = 15, DURATION = 45)
  EXH = exhaust_runner (D = 0.040, L = 0.40)
  TURB = turbo_turbine (ER = 1.9, EFF = 0.72)
  OUTLET = environment_outlet (P = 101325, T = 298.15)

CONNECTIONS:
  INLET.out -> COMP.in
  COMP.out -> PLENUM_IN.in
  PLENUM_IN.port1 -> RUNNER1.in
  RUNNER1.out -> CYL1.intake
  CYL1.exhaust -> EXH.in
  EXH.out -> TURB.in
  TURB.out -> OUTLET.in
`;

describe("GT-SUITE LSP Integration Suite (@modelscript/lsp)", () => {
  it("resolves GT-SUITE language plugin for engine models", () => {
    globalLanguageRegistry.register({
      id: "gtsuite",
      name: "GT-SUITE",
      extensions: [".gtm", ".gtd", ".gtx", ".gt"],
      languageDef: gtsuiteLanguage,
      workspaceIndex: new GtSuiteWorkspaceIndex(),
      customHandlers: {
        symbols: (text: string) => getGtsuiteDocumentSymbols(text),
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getGtsuiteHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateGtsuite(text);
        },
      },
      actionHandlers: {
        lint_gtsuite_model: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          return validateGtsuite(text);
        },
        project_gtsuite_modelica: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          const model = parseGtmModel(text);
          return gtsuiteToModelica(model);
        },
        export_gtsuite_dae: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          const model = parseGtmModel(text);
          const dae = gtsuiteToDae(model);
          return { varCount: dae.varCount, eqCount: dae.eqCount };
        },
      },
      disposables: [],
    });

    const pluginGtm = globalLanguageRegistry.getPluginForUri("file:///workspace/engine.gtm");
    assert.ok(pluginGtm);
    assert.equal(pluginGtm.id, "gtsuite");
  });

  it("extracts document symbols and handles hover via registered handlers", () => {
    const plugin = globalLanguageRegistry.get("gtsuite");
    assert.ok(plugin);
    assert.ok(plugin.customHandlers?.symbols);

    const symbols = plugin.customHandlers.symbols(SAMPLE_GTM_MODEL) as any[];
    assert.ok(symbols.length > 0);
    assert.ok(symbols[0].children && symbols[0].children.length >= 5);

    assert.ok(plugin.customHandlers?.hover);
    const offset = SAMPLE_GTM_MODEL.indexOf("CYL1 = cylinder");
    const hover = plugin.customHandlers.hover(offset, SAMPLE_GTM_MODEL);
    assert.ok(hover);
  });

  it("executes export_gtsuite_dae and project_gtsuite_modelica actions through registry", async () => {
    const plugin = globalLanguageRegistry.get("gtsuite");
    assert.ok(plugin);
    assert.ok(plugin.actionHandlers?.export_gtsuite_dae);

    const daeRes = await plugin.actionHandlers.export_gtsuite_dae({}, { documentText: SAMPLE_GTM_MODEL });
    assert.ok(daeRes.varCount > 0);
    assert.ok(daeRes.eqCount > 0);

    assert.ok(plugin.actionHandlers?.project_gtsuite_modelica);
    const moRes = await plugin.actionHandlers.project_gtsuite_modelica({}, { documentText: SAMPLE_GTM_MODEL });
    assert.ok(typeof moRes === "string");
    assert.ok(moRes.includes("model Test_Turbo_4Cyl"));
  });
});
