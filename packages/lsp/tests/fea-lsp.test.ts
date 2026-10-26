// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  feaLanguage,
  feaToDae,
  feaToModelica,
  FeaWorkspaceIndex,
  getFeaDocumentSymbols,
  getFeaHover,
  parseFeaDeck,
  validateFea,
} from "@modelscript/fea";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";

const SAMPLE_FEA_MODEL = `*HEADING
Structural Cantilever Bracket Analysis
*NODE
1, 0.0, 0.0, 0.0
2, 1.0, 0.0, 0.0
3, 2.0, 0.0, 0.0
4, 0.0, 1.0, 0.0
5, 1.0, 1.0, 0.0
6, 2.0, 1.0, 0.0
7, 0.0, 0.0, 1.0
8, 1.0, 0.0, 1.0
*ELEMENT, TYPE=C3D8, ELSET=BRACKET_ELEMS
1, 1, 2, 5, 4, 7, 8, 6, 3
*NSET, NSET=CLAMPED_NODES
1, 4, 7
*MATERIAL, NAME=TITANIUM
*ELASTIC
110000000000.0, 0.34
*DENSITY
4430.0
*SOLID SECTION, ELSET=BRACKET_ELEMS, MATERIAL=TITANIUM
*BOUNDARY
CLAMPED_NODES, 1, 3, 0.0
*CLOAD
3, 2, -5000.0
`;

describe("FEA LSP Integration Suite (@modelscript/lsp)", () => {
  it("resolves FEA language plugin for finite element models", () => {
    globalLanguageRegistry.register({
      id: "fea",
      name: "FEA",
      extensions: [".fea", ".inp", ".inpt", ".bdf", ".dat"],
      languageDef: feaLanguage,
      workspaceIndex: new FeaWorkspaceIndex(),
      customHandlers: {
        symbols: (text: string) => getFeaDocumentSymbols(text),
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getFeaHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateFea(text);
        },
      },
      actionHandlers: {
        lint_fea_model: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          return validateFea(text);
        },
        export_fea_modelica: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          const model = parseFeaDeck(text);
          return feaToModelica(model);
        },
        export_fea_dae: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          const model = parseFeaDeck(text);
          const dae = feaToDae(model);
          return { varCount: dae.varCount, eqCount: dae.eqCount };
        },
      },
      disposables: [],
    });

    const plugin = globalLanguageRegistry.get("fea");
    assert.ok(plugin, "FEA plugin should be registered in language registry");
    assert.equal(plugin.name, "FEA");
    assert.ok(plugin.extensions.includes(".inp"));
    assert.ok(plugin.extensions.includes(".bdf"));
  });

  it("extracts document symbols and handles hover via registered handlers", () => {
    const plugin = globalLanguageRegistry.get("fea");
    assert.ok(plugin?.customHandlers?.symbols, "Plugin should provide symbols handler");
    assert.ok(plugin?.customHandlers?.hover, "Plugin should provide hover handler");
    assert.ok(plugin?.customHandlers?.validate, "Plugin should provide validate handler");

    const symbols = plugin.customHandlers.symbols(SAMPLE_FEA_MODEL);
    assert.ok(symbols.length > 0, "Symbols array should not be empty");
    assert.ok(symbols[0].children && symbols[0].children.length > 0);

    const hover = plugin.customHandlers.hover(50, SAMPLE_FEA_MODEL);
    assert.ok(hover, "Hover should return markdown contents");
    assert.ok(hover.contents.value.includes("FEA Structural Model"));

    const diagnostics = plugin.customHandlers.validate(SAMPLE_FEA_MODEL);
    const errors = diagnostics.filter((d: any) => d.severity === 1);
    assert.equal(errors.length, 0, "Valid FEA deck should produce 0 errors");
  });

  it("executes export_fea_dae and export_fea_modelica actions through registry", async () => {
    const plugin = globalLanguageRegistry.get("fea");
    assert.ok(plugin?.actionHandlers?.export_fea_dae);
    assert.ok(plugin?.actionHandlers?.export_fea_modelica);

    const daeResult = await plugin.actionHandlers.export_fea_dae({}, { documentText: SAMPLE_FEA_MODEL });
    assert.ok(daeResult.varCount > 0, "DAE variables should be non-zero");
    assert.ok(daeResult.eqCount > 0, "DAE equations should be non-zero");

    const moResult = await plugin.actionHandlers.export_fea_modelica({}, { documentText: SAMPLE_FEA_MODEL });
    assert.ok(moResult.includes("model"), "Modelica projection should contain model declaration");
    assert.ok(moResult.includes("E = 110000000000"), "Modelica projection should define Young's modulus");
  });
});
