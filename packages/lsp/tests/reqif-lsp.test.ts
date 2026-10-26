// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getReqifDocumentSymbols,
  getReqifHover,
  reqifLanguage,
  ReqIfWorkspaceIndex,
  validateReqif,
} from "@modelscript/reqif";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";

const SAMPLE_REQIF = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="H-01">
      <REQ-IF-VERSION>1.0</REQ-IF-VERSION>
      <TITLE>Powertrain Requirements</TITLE>
    </REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-TYPES>
        <SPEC-OBJECT-TYPE IDENTIFIER="ST-SPEC" LONG-NAME="Specification Item">
          <SPEC-ATTRIBUTES>
            <ATTRIBUTE-DEFINITION-STRING IDENTIFIER="AD-DESC" LONG-NAME="Description" />
          </SPEC-ATTRIBUTES>
        </SPEC-OBJECT-TYPE>
      </SPEC-TYPES>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-TORQUE" LONG-NAME="Max Wheel Torque">
          <TYPE>
            <SPEC-OBJECT-TYPE-REF>ST-SPEC</SPEC-OBJECT-TYPE-REF>
          </TYPE>
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <DEFINITION>
                <ATTRIBUTE-DEFINITION-STRING-REF>AD-DESC</ATTRIBUTE-DEFINITION-STRING-REF>
              </DEFINITION>
              <THE-VALUE>Maximum wheel torque must exceed 450 Nm. ASIL-C.</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-MOTOR-TRQ" LONG-NAME="Motor Torque Capacity">
          <TYPE>
            <SPEC-OBJECT-TYPE-REF>ST-SPEC</SPEC-OBJECT-TYPE-REF>
          </TYPE>
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <DEFINITION>
                <ATTRIBUTE-DEFINITION-STRING-REF>AD-DESC</ATTRIBUTE-DEFINITION-STRING-REF>
              </DEFINITION>
              <THE-VALUE>Electric motor peak torque must be &gt;= 500 Nm.</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
      <SPEC-RELATIONS>
        <SPEC-RELATION IDENTIFIER="REL-01" LONG-NAME="refines">
          <SOURCE><SPEC-OBJECT-REF>REQ-MOTOR-TRQ</SPEC-OBJECT-REF></SOURCE>
          <TARGET><SPEC-OBJECT-REF>REQ-TORQUE</SPEC-OBJECT-REF></TARGET>
        </SPEC-RELATION>
      </SPEC-RELATIONS>
      <SPECIFICATIONS>
        <SPECIFICATION IDENTIFIER="SPEC-PWR" LONG-NAME="Powertrain Specification">
          <CHILDREN>
            <SPEC-HIERARCHY IDENTIFIER="SH-01" OBJECT-REF="REQ-TORQUE">
              <CHILDREN>
                <SPEC-HIERARCHY IDENTIFIER="SH-02" OBJECT-REF="REQ-MOTOR-TRQ" />
              </CHILDREN>
            </SPEC-HIERARCHY>
          </CHILDREN>
        </SPECIFICATION>
      </SPECIFICATIONS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

describe("ReqIF LSP Language Server Integration", () => {
  it("registers and resolves ReqIF language plugin for .reqif and .reqifz", () => {
    globalLanguageRegistry.register({
      id: "reqif",
      name: "ReqIF",
      extensions: [".reqif", ".reqifz"],
      languageDef: reqifLanguage,
      workspaceIndex: new ReqIfWorkspaceIndex(),
      customHandlers: {
        symbols: (text: string) => getReqifDocumentSymbols(text),
        hover: (offset: number, text: string) => getReqifHover(text, 0, offset),
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateReqif(text);
        },
      },
      actionHandlers: {
        lint_reqif: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseReqIf, lintReqIf } = await import("@modelscript/reqif");
          const doc = parseReqIf(text);
          return lintReqIf(doc);
        },
        verify_reqif_entailment: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseReqIf, verifyReqIfEntailment } = await import("@modelscript/reqif");
          const doc = parseReqIf(text);
          return verifyReqIfEntailment(doc);
        },
        export_reqif_sysml2: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseReqIf, reqifToSysml2 } = await import("@modelscript/reqif");
          const doc = parseReqIf(text);
          return reqifToSysml2(doc);
        },
        export_reqif_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseReqIf, reqifToModelicaVerifier } = await import("@modelscript/reqif");
          const doc = parseReqIf(text);
          return reqifToModelicaVerifier(doc);
        },
      },
    });

    const pluginReqif = globalLanguageRegistry.getPluginForUri("file:///workspace/spec.reqif");
    assert.ok(pluginReqif, "Should find plugin for .reqif");
    assert.equal(pluginReqif.id, "reqif");

    const pluginReqifz = globalLanguageRegistry.getPluginForUri("file:///workspace/bundle.reqifz");
    assert.ok(pluginReqifz, "Should find plugin for .reqifz");
    assert.equal(pluginReqifz.id, "reqif");
  });

  it("provides document symbols and diagnostics through registry custom handlers", () => {
    const plugin = globalLanguageRegistry.get("reqif");
    assert.ok(plugin);
    assert.ok(plugin.customHandlers?.symbols);
    assert.ok(plugin.customHandlers?.validate);

    const symbols = plugin.customHandlers.symbols(SAMPLE_REQIF);
    assert.ok(Array.isArray(symbols));
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0].name, "Powertrain Specification");

    const diags = plugin.customHandlers.validate({ getText: () => SAMPLE_REQIF });
    assert.ok(Array.isArray(diags));
    const errors = diags.filter((d: any) => d.severity === 1);
    assert.equal(errors.length, 0);
  });

  it("executes ReqIF action handlers for lint, entailment verification, and projections", async () => {
    const plugin = globalLanguageRegistry.get("reqif");
    assert.ok(plugin);
    assert.ok(plugin.actionHandlers);

    // 1. lint_reqif
    const lintResults = await plugin.actionHandlers.lint_reqif({}, { documentText: SAMPLE_REQIF });
    assert.ok(Array.isArray(lintResults));

    // 2. verify_reqif_entailment
    const entailReport = await plugin.actionHandlers.verify_reqif_entailment({}, { documentText: SAMPLE_REQIF });
    assert.ok(entailReport && typeof entailReport === "object");
    assert.ok(Array.isArray(entailReport.results));
    assert.ok(typeof entailReport.totalQueries === "number");

    // 3. export_reqif_sysml2
    const sysmlCode = await plugin.actionHandlers.export_reqif_sysml2({}, { documentText: SAMPLE_REQIF });
    assert.ok(typeof sysmlCode === "string");
    assert.ok(sysmlCode.includes("requirement def REQ_TORQUE") || sysmlCode.includes("requirement"));

    // 4. export_reqif_modelica
    const modelicaCode = await plugin.actionHandlers.export_reqif_modelica({}, { documentText: SAMPLE_REQIF });
    assert.ok(typeof modelicaCode === "string");
    assert.ok(modelicaCode.includes("block RequirementsVerifier") || modelicaCode.includes("block"));
  });
});
