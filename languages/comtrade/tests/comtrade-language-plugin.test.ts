// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAllComtradeModels } from "../src/indexing.js";
import { comtradeLanguage } from "../src/language.js";
import { getComtradeDiagnostics, getComtradeDocumentSymbols } from "../src/lsp.js";

describe("COMTRADE Language Plugin & LSP Services", () => {
  const sampleCff = `--- file type: CFG ---
STATION_ALPHA,SUB_DFR,2013
3,2A,1D
1,VA,A,,kV,1.0,0.0,0,-32768,32767,1,1,S
2,IA,A,,A,0.1,0.0,0,-32768,32767,1,1,S
1,TRIP,0,0
60
1
5000,3
01/01/2026,00:00:00.000000
01/01/2026,00:00:00.000600
ASCII
1.0
--- file type: DAT ---
1,0,120.0,5.0,0
2,200,120.5,5.1,0
3,400,121.0,5.2,1
`;

  it("should declare valid language metadata matching Beta tier", () => {
    assert.equal(comtradeLanguage.name, "comtrade");
    assert.ok(comtradeLanguage.fileExtensions.includes(".cfg"));
    assert.ok(comtradeLanguage.fileExtensions.includes(".dat"));
    assert.ok(comtradeLanguage.fileExtensions.includes(".cff"));
  });

  it("should extract LSP outline symbols with station, analog, and digital channels", () => {
    const symbols = getComtradeDocumentSymbols(sampleCff, "record.cff");
    assert.equal(symbols.length, 1);
    const root = symbols[0];
    assert.ok(root?.name.includes("STATION_ALPHA"));
    assert.equal(root?.children?.length, 2); // Analog Channels group and Digital Channels group

    const analogGroup = root?.children?.[0];
    assert.ok(analogGroup?.name.includes("Analog Channels"));
    assert.equal(analogGroup?.children?.length, 2);

    const digitalGroup = root?.children?.[1];
    assert.ok(digitalGroup?.name.includes("Digital Channels"));
    assert.equal(digitalGroup?.children?.length, 1);
  });

  it("should provide LSP diagnostics for valid and invalid records", () => {
    const diags = getComtradeDiagnostics(sampleCff, "record.cff");
    assert.equal(diags.length, 0);

    const badDiags = getComtradeDiagnostics("corrupted content", "bad.cfg");
    assert.ok(badDiags.length > 0);
  });

  it("should execute comtradeLanguage actions successfully", async () => {
    // 1. extract_comtrade_phasor
    const phasorAction = comtradeLanguage.actions?.find((a) => a.id === "extract_comtrade_phasor");
    assert.ok(phasorAction);
    const phasorRes = (await phasorAction.execute({}, { documentText: sampleCff, channelIndex: 0 })) as {
      magnitudeRms: number;
    } | null;
    assert.ok(phasorRes);
    assert.ok(phasorRes.magnitudeRms >= 0);

    // 2. lint_comtrade_record
    const lintAction = comtradeLanguage.actions?.find((a) => a.id === "lint_comtrade_record");
    assert.ok(lintAction);
    const lintRes = (await lintAction.execute({}, { documentText: sampleCff })) as unknown[];
    assert.equal(lintRes.length, 0);

    // 3. lower_comtrade_dae
    const daeAction = comtradeLanguage.actions?.find((a) => a.id === "lower_comtrade_dae");
    assert.ok(daeAction);
    const daeRes = (await daeAction.execute({}, { documentText: sampleCff })) as {
      variableCount: number;
      equationCount: number;
    };
    assert.ok(daeRes.variableCount > 0);
    assert.ok(daeRes.equationCount > 0);

    // 4. export_comtrade_cff
    const cffAction = comtradeLanguage.actions?.find((a) => a.id === "export_comtrade_cff");
    assert.ok(cffAction);
    const cffRes = (await cffAction.execute({}, { documentText: sampleCff })) as string;
    assert.ok(cffRes.includes("--- file type: CFG ---"));
  });

  it("should index records in UnifiedWorkspace", () => {
    const ws = new UnifiedWorkspace(comtradeLanguage);
    ws.setDocument("sub_a.cff", sampleCff);
    const models = getAllComtradeModels(ws);
    assert.equal(models.length, 1);
    assert.equal(models[0]?.stationName, "STATION_ALPHA");
    assert.equal(models[0]?.analogChannelCount, 2);
    assert.equal(models[0]?.digitalChannelCount, 1);
    assert.ok(ws.findSymbolsByName("STATION_ALPHA").length >= 1);
    assert.ok(ws.findSymbolsByName("VA").length >= 1);
  });
});
