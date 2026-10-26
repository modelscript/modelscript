// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  autosarLanguage,
  AutosarWorkspaceIndex,
  getAutosarDocumentSymbols,
  getAutosarHover,
  validateAutosar,
} from "@modelscript/autosar";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";

const SAMPLE_ARXML = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Powertrain</SHORT-NAME>
      <ELEMENTS>
        <SENDER-RECEIVER-INTERFACE>
          <SHORT-NAME>PedalIf</SHORT-NAME>
          <DATA-ELEMENTS>
            <VARIABLE-DATA-PROTOTYPE>
              <SHORT-NAME>Pos</SHORT-NAME>
              <TYPE-TREF>/AUTOSAR/Platform/ImplementationDataTypes/float32</TYPE-TREF>
              <INIT-VALUE>0.0</INIT-VALUE>
            </VARIABLE-DATA-PROTOTYPE>
          </DATA-ELEMENTS>
        </SENDER-RECEIVER-INTERFACE>

        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>PedalSensor</SHORT-NAME>
          <PORTS>
            <P-PORT-PROTOTYPE>
              <SHORT-NAME>PedalOut</SHORT-NAME>
              <PROVIDED-INTERFACE-TREF>/Powertrain/PedalIf</PROVIDED-INTERFACE-TREF>
            </P-PORT-PROTOTYPE>
          </PORTS>
          <INTERNAL-BEHAVIORS>
            <SWC-INTERNAL-BEHAVIOR>
              <SHORT-NAME>Pedal_IB</SHORT-NAME>
              <RUNNABLES>
                <RUNNABLE-ENTITY>
                  <SHORT-NAME>RE_ReadPedal</SHORT-NAME>
                  <DATA-READ-ACCESSS/>
                  <DATA-WRITE-ACCESSS>
                    <VARIABLE-ACCESS>
                      <PORT-PROTOTYPE-REF>PedalOut</PORT-PROTOTYPE-REF>
                      <TARGET-DATA-PROTOTYPE-REF>Pos</TARGET-DATA-PROTOTYPE-REF>
                    </VARIABLE-ACCESS>
                  </DATA-WRITE-ACCESSS>
                </RUNNABLE-ENTITY>
              </RUNNABLES>
              <EVENTS>
                <TIMING-EVENT>
                  <SHORT-NAME>TE_10ms</SHORT-NAME>
                  <START-ON-EVENT-REF>RE_ReadPedal</START-ON-EVENT-REF>
                  <PERIOD>0.010</PERIOD>
                </TIMING-EVENT>
              </EVENTS>
            </SWC-INTERNAL-BEHAVIOR>
          </INTERNAL-BEHAVIORS>
        </APPLICATION-SW-COMPONENT-TYPE>

        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>EngineECU</SHORT-NAME>
          <PORTS>
            <R-PORT-PROTOTYPE>
              <SHORT-NAME>PedalIn</SHORT-NAME>
              <REQUIRED-INTERFACE-TREF>/Powertrain/PedalIf</REQUIRED-INTERFACE-TREF>
            </R-PORT-PROTOTYPE>
          </PORTS>
          <INTERNAL-BEHAVIORS>
            <SWC-INTERNAL-BEHAVIOR>
              <SHORT-NAME>Engine_IB</SHORT-NAME>
              <RUNNABLES>
                <RUNNABLE-ENTITY>
                  <SHORT-NAME>RE_ComputeThrottle</SHORT-NAME>
                  <DATA-READ-ACCESSS>
                    <VARIABLE-ACCESS>
                      <PORT-PROTOTYPE-REF>PedalIn</PORT-PROTOTYPE-REF>
                      <TARGET-DATA-PROTOTYPE-REF>Pos</TARGET-DATA-PROTOTYPE-REF>
                    </VARIABLE-ACCESS>
                  </DATA-READ-ACCESSS>
                  <DATA-WRITE-ACCESSS/>
                </RUNNABLE-ENTITY>
              </RUNNABLES>
              <EVENTS>
                <TIMING-EVENT>
                  <SHORT-NAME>TE_20ms</SHORT-NAME>
                  <START-ON-EVENT-REF>RE_ComputeThrottle</START-ON-EVENT-REF>
                  <PERIOD>0.020</PERIOD>
                </TIMING-EVENT>
              </EVENTS>
            </SWC-INTERNAL-BEHAVIOR>
          </INTERNAL-BEHAVIORS>
        </APPLICATION-SW-COMPONENT-TYPE>

        <COMPOSITION-SW-COMPONENT-TYPE>
          <SHORT-NAME>VehicleComposition</SHORT-NAME>
          <COMPONENTS>
            <SW-COMPONENT-PROTOTYPE>
              <SHORT-NAME>Pedal</SHORT-NAME>
              <TYPE-TREF>/Powertrain/PedalSensor</TYPE-TREF>
            </SW-COMPONENT-PROTOTYPE>
            <SW-COMPONENT-PROTOTYPE>
              <SHORT-NAME>Engine</SHORT-NAME>
              <TYPE-TREF>/Powertrain/EngineECU</TYPE-TREF>
            </SW-COMPONENT-PROTOTYPE>
          </COMPONENTS>
          <CONNECTORS>
            <ASSEMBLY-SW-CONNECTOR>
              <SHORT-NAME>Conn_Pedal_Engine</SHORT-NAME>
              <PROVIDER-IREF>
                <CONTEXT-COMPONENT-REF>Pedal</CONTEXT-COMPONENT-REF>
                <TARGET-P-PORT-REF>PedalOut</TARGET-P-PORT-REF>
              </PROVIDER-IREF>
              <REQUESTER-IREF>
                <CONTEXT-COMPONENT-REF>Engine</CONTEXT-COMPONENT-REF>
                <TARGET-R-PORT-REF>PedalIn</TARGET-R-PORT-REF>
              </REQUESTER-IREF>
            </ASSEMBLY-SW-CONNECTOR>
          </CONNECTORS>
        </COMPOSITION-SW-COMPONENT-TYPE>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`;

describe("AUTOSAR LSP Integration Suite (@modelscript/lsp)", () => {
  it("resolves AUTOSAR language plugin for .arxml files", () => {
    globalLanguageRegistry.register({
      id: "autosar",
      name: "AUTOSAR Classic & Adaptive",
      extensions: [".arxml"],
      languageDef: autosarLanguage,
      workspaceIndex: new AutosarWorkspaceIndex(),
      customHandlers: {
        symbols: (text: string) => getAutosarDocumentSymbols(text),
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getAutosarHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateAutosar(text);
        },
      },
      actionHandlers: {
        lint_autosar_model: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseArxml, lintAutosarModel } = await import("@modelscript/autosar");
          const model = parseArxml(text);
          return lintAutosarModel(model);
        },
        export_autosar_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseArxml, autosarToModelica } = await import("@modelscript/autosar");
          const model = parseArxml(text);
          return autosarToModelica(model);
        },
        export_autosar_sysml: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseArxml, autosarToSysml } = await import("@modelscript/autosar");
          const model = parseArxml(text);
          return autosarToSysml(model);
        },
        export_autosar_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseArxml, lowerAutosarToDae } = await import("@modelscript/autosar");
          const model = parseArxml(text);
          const dae = lowerAutosarToDae(model);
          return {
            varCount: dae.varCount,
            eqCount: dae.eqCount,
          };
        },
        simulate_autosar_rte: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseArxml, VirtualRte } = await import("@modelscript/autosar");
          const model = parseArxml(text);
          const rte = new VirtualRte(model);
          const duration = params?.duration ?? 0.05;
          const step = params?.step ?? 0.01;
          return rte.runUntil(duration, step);
        },
      },
    });

    const pluginArxml = globalLanguageRegistry.getPluginForUri("file:///workspace/system.arxml");
    assert.ok(pluginArxml, "Should find plugin for .arxml");
    assert.equal(pluginArxml.id, "autosar");
  });

  it("extracts document symbols and validates clean model", () => {
    const plugin = globalLanguageRegistry.get("autosar");
    assert.ok(plugin);
    assert.ok(plugin.customHandlers?.symbols);
    assert.ok(plugin.customHandlers?.validate);

    const symbols = plugin.customHandlers.symbols(SAMPLE_ARXML);
    assert.ok(Array.isArray(symbols));
    assert.ok(symbols.length > 0);

    const diags = plugin.customHandlers.validate({ getText: () => SAMPLE_ARXML });
    assert.ok(Array.isArray(diags));
    const errors = diags.filter((d: any) => d.severity === 1);
    assert.equal(errors.length, 0);
  });

  it("generates markdown hover for SWC elements", () => {
    const plugin = globalLanguageRegistry.get("autosar");
    assert.ok(plugin);
    assert.ok(plugin.customHandlers?.hover);

    const offset = SAMPLE_ARXML.indexOf("PedalSensor");
    assert.ok(offset > 0);

    const hover = plugin.customHandlers.hover(offset, SAMPLE_ARXML);
    assert.ok(hover);
    assert.ok(hover.contents);
    const md = typeof hover.contents === "string" ? hover.contents : hover.contents.value;
    assert.ok(md.includes("PedalSensor"));
  });

  it("executes AUTOSAR action handlers for lint, modelica, sysml, dae, and rte simulation", async () => {
    const plugin = globalLanguageRegistry.get("autosar");
    assert.ok(plugin);
    assert.ok(plugin.actionHandlers);

    // 1. Lint action
    const diagnostics = await plugin.actionHandlers.lint_autosar_model({}, { documentText: SAMPLE_ARXML });
    assert.ok(Array.isArray(diagnostics));
    assert.equal(diagnostics.length, 0);

    // 2. Export to Modelica
    const mo = await plugin.actionHandlers.export_autosar_modelica({}, { documentText: SAMPLE_ARXML });
    assert.ok(typeof mo === "string");
    assert.ok(mo.includes("model VehicleComposition"));
    assert.ok(mo.includes("connect(Pedal.PedalOut, Engine.PedalIn)"));

    // 3. Export to SysML v2
    const sysml = await plugin.actionHandlers.export_autosar_sysml({}, { documentText: SAMPLE_ARXML });
    assert.ok(typeof sysml === "string");
    assert.ok(sysml.includes("part def VehicleComposition {"));
    assert.ok(sysml.includes("connect Pedal.PedalOut to Engine.PedalIn;"));

    // 4. Export to DAE
    const daeInfo = await plugin.actionHandlers.export_autosar_dae({}, { documentText: SAMPLE_ARXML });
    assert.ok(daeInfo);
    assert.ok(daeInfo.varCount > 0);

    // 5. Simulate Virtual RTE
    const rteLog = await plugin.actionHandlers.simulate_autosar_rte(
      {},
      { documentText: SAMPLE_ARXML, duration: 0.05, step: 0.01 },
    );
    assert.ok(Array.isArray(rteLog));
    assert.ok(rteLog.length > 0);
  });
});
