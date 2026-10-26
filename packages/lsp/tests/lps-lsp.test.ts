// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getLpsDocumentSymbols,
  getLpsHover,
  lowerLpsToDae,
  lpsLanguage,
  lpsToModelica,
  LpsWorkspaceIndex,
  parseLps,
  validateLps,
} from "@modelscript/lps";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";

const SAMPLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<PipelineStudio id="study_texas_trunk" title="Texas Gulf Coast Gas Trunkline" simulationType="TGNET">
  <Nodes>
    <Node name="Hub_Supply" type="SUPPLY" elevation="10m" pressure="75.0bar" flow="120.0" />
    <Node name="Mid_Compressor_Suction" type="JUNCTION" elevation="25m" />
    <Node name="Mid_Compressor_Discharge" type="JUNCTION" elevation="25m" />
    <Node name="City_Gate_Delivery" type="DELIVERY" elevation="5m" minDeliveryPressure="35.0bar" flow="120.0" />
  </Nodes>
  <Pipes>
    <Pipe name="Line_101" from="Hub_Supply" to="Mid_Compressor_Suction" length="80.0km" diameter="30inch" roughness="0.000045m" maop="95.0bar" />
    <Pipe name="Line_102" from="Mid_Compressor_Discharge" to="City_Gate_Delivery" length="110.0km" diameter="30inch" roughness="0.000045m" maop="95.0bar" />
  </Pipes>
  <Compressors>
    <Compressor name="Station_A" from="Mid_Compressor_Suction" to="Mid_Compressor_Discharge" type="CENTRIFUGAL" power="22000000" maxRatio="1.8" efficiency="0.84" mode="DISCHARGE_PRESSURE" setpoint="85.0bar" status="RUNNING" />
  </Compressors>
  <GasComposition ch4="0.91" c2h6="0.05" c3h8="0.018" co2="0.008" n2="0.014" h2="0.05" ghv="39.2" />
  <SimulationControls startTime="0" endTime="86400" timeStep="60" eos="AGA8" steadyStateFirst="true" />
</PipelineStudio>`;

describe("PipelineStudio LSP Integration Suite (@modelscript/lsp)", () => {
  it("resolves LPS language plugin for pipeline files", () => {
    globalLanguageRegistry.register({
      id: "lps",
      name: "PipelineStudio",
      extensions: [".lps", ".tgx", ".tlx", ".tgn", ".tln", ".psg", ".psl"],
      languageDef: lpsLanguage,
      workspaceIndex: new LpsWorkspaceIndex(),
      customHandlers: {
        symbols: (text: string) => getLpsDocumentSymbols(text),
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getLpsHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateLps(text);
        },
      },
      actionHandlers: {
        lint_lps_network: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          return validateLps(text);
        },
        export_lps_modelica: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          const model = parseLps(text);
          return lpsToModelica(model);
        },
        export_lps_dae: async (_ctx: any, params: any) => {
          const text = params?.documentText ?? "";
          const model = parseLps(text);
          const dae = lowerLpsToDae(model);
          return { varCount: dae.varCount, eqCount: dae.eqCount };
        },
      },
      disposables: [],
    });

    const pluginLps = globalLanguageRegistry.getPluginForUri("file:///workspace/network.lps");
    assert.ok(pluginLps);
    assert.equal(pluginLps.id, "lps");

    const pluginTgx = globalLanguageRegistry.getPluginForUri("file:///workspace/model.tgx");
    assert.ok(pluginTgx);
    assert.equal(pluginTgx.id, "lps");
  });

  it("extracts document symbols and handles hover via registered handlers", () => {
    const plugin = globalLanguageRegistry.get("lps");
    assert.ok(plugin);
    assert.ok(plugin.customHandlers?.symbols);

    const symbols = plugin.customHandlers.symbols(SAMPLE_XML) as any[];
    assert.ok(symbols.length > 0);
    assert.equal(symbols[0].name, "Texas Gulf Coast Gas Trunkline");

    assert.ok(plugin.customHandlers?.hover);
    const offset = SAMPLE_XML.indexOf("Line_101");
    const hover = plugin.customHandlers.hover(offset, SAMPLE_XML);
    assert.ok(hover);
  });

  it("executes export_lps_dae and export_lps_modelica actions through registry", async () => {
    const plugin = globalLanguageRegistry.get("lps");
    assert.ok(plugin);
    assert.ok(plugin.actionHandlers?.export_lps_dae);

    const daeRes = await plugin.actionHandlers.export_lps_dae({}, { documentText: SAMPLE_XML });
    assert.ok(daeRes.varCount > 0);
    assert.ok(daeRes.eqCount > 0);

    assert.ok(plugin.actionHandlers?.export_lps_modelica);
    const moRes = await plugin.actionHandlers.export_lps_modelica({}, { documentText: SAMPLE_XML });
    assert.ok(typeof moRes === "string" && moRes.includes("model"));
  });
});
