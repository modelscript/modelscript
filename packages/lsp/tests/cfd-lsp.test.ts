// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  cfdLanguage,
  cfdToDae,
  cfdToModelica,
  CfdWorkspaceIndex,
  getCfdDocumentSymbols,
  getCfdHover,
  parseCfdConfig,
  validateCfd,
} from "@modelscript/cfd";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";

const SAMPLE_CFD_MODEL = `%
% SU2 Aerodynamic Configuration: NACA 0012 Airfoil
%
PHYSICAL_PROBLEM= NAVIER_STOKES
MATH_PROBLEM= EULER
KIND_TURB_MODEL= NONE
MACH_NUMBER= 0.8
AOA= 1.25
REYNOLDS_NUMBER= 6.5E6
REF_AREA= 1.0
REF_LENGTH= 1.0
MESH_FILENAME= naca0012.su2
%
MARKER_EULER= ( airfoil )
MARKER_FAR= ( farfield )
MARKER_INLET= ( inlet, 101325.0, 288.15, 1.0, 0.0, 0.0 )
MARKER_OUTLET= ( outlet, 101325.0 )
`;

describe("CFD LSP Integration Suite (@modelscript/lsp)", () => {
  it("resolves CFD language plugin for aerodynamic configurations", () => {
    globalLanguageRegistry.register({
      id: "cfd",
      name: "CFD",
      extensions: [".cfd", ".cfg", ".cfgt", ".su2", ".foam"],
      languageDef: cfdLanguage,
      workspaceIndex: new CfdWorkspaceIndex(),
      customHandlers: {
        symbols: (text: string) => getCfdDocumentSymbols(text),
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getCfdHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateCfd(text);
        },
      },
      actionHandlers: {
        lint_cfd_model: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          return validateCfd(text);
        },
        export_cfd_modelica: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          const model = parseCfdConfig(text);
          return cfdToModelica(model);
        },
        export_cfd_dae: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          const model = parseCfdConfig(text);
          const dae = cfdToDae(model);
          return { varCount: dae.varCount, eqCount: dae.eqCount };
        },
      },
      disposables: [],
    });

    const plugin = globalLanguageRegistry.get("cfd");
    assert.ok(plugin, "CFD plugin should be registered in language registry");
    assert.equal(plugin.name, "CFD");
    assert.ok(plugin.extensions.includes(".cfg"));
    assert.ok(plugin.extensions.includes(".su2"));
  });

  it("extracts document symbols and handles hover via registered handlers", () => {
    const plugin = globalLanguageRegistry.get("cfd");
    assert.ok(plugin?.customHandlers?.symbols, "Plugin should provide symbols handler");
    assert.ok(plugin?.customHandlers?.hover, "Plugin should provide hover handler");
    assert.ok(plugin?.customHandlers?.validate, "Plugin should provide validate handler");

    const symbols = plugin.customHandlers.symbols(SAMPLE_CFD_MODEL);
    assert.ok(symbols.length > 0, "Symbols array should not be empty");
    assert.ok(symbols[0].children && symbols[0].children.length > 0);

    const hover = plugin.customHandlers.hover(50, SAMPLE_CFD_MODEL);
    assert.ok(hover, "Hover should return markdown contents");
    assert.ok(hover.contents.value.includes("CFD Domain"));

    const diagnostics = plugin.customHandlers.validate(SAMPLE_CFD_MODEL);
    const errors = diagnostics.filter((d: any) => d.severity === 1);
    assert.equal(errors.length, 0, "Valid CFD deck should produce 0 errors");
  });

  it("executes export_cfd_dae and export_cfd_modelica actions through registry", async () => {
    const plugin = globalLanguageRegistry.get("cfd");
    assert.ok(plugin?.actionHandlers?.export_cfd_dae);
    assert.ok(plugin?.actionHandlers?.export_cfd_modelica);

    const daeResult = await plugin.actionHandlers.export_cfd_dae({}, { documentText: SAMPLE_CFD_MODEL });
    assert.ok(daeResult.varCount > 0, "DAE variables should be non-zero");
    assert.ok(daeResult.eqCount > 0, "DAE equations should be non-zero");

    const moResult = await plugin.actionHandlers.export_cfd_modelica({}, { documentText: SAMPLE_CFD_MODEL });
    assert.ok(moResult.includes("model"), "Modelica projection should contain model declaration");
    assert.ok(moResult.includes("Lift"), "Modelica projection should define Lift force");
  });
});
