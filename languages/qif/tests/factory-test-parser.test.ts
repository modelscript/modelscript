// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { correlateSpcToSimulationParameters, parseIctCsv, parseSpiAoiCsv } from "../src/ingest/factory-test-parser.js";
import { evaluateQifSpc, lowerQifToDae } from "../src/spc/index.js";

describe("Closed-Loop Factory Metrology & SPC Ingestion", () => {
  const sampleIctCsv = `
# SerialNumber, TestId, Type, Nominal, LowLimit, HighLimit, Measured, Unit, Status
SN-2026-0001, R12, RESISTANCE, 100.0, 95.0, 105.0, 99.8, Ohm, PASS
SN-2026-0002, R12, RESISTANCE, 100.0, 95.0, 105.0, 100.2, Ohm, PASS
SN-2026-0003, R12, RESISTANCE, 100.0, 95.0, 105.0, 100.1, Ohm, PASS
SN-2026-0004, R12, RESISTANCE, 100.0, 95.0, 105.0, 99.9, Ohm, PASS
SN-2026-0005, R12, RESISTANCE, 100.0, 95.0, 105.0, 100.0, Ohm, PASS
SN-2026-0001, C45, CAPACITANCE, 10.0, 8.0, 12.0, 10.1, uF, PASS
SN-2026-0002, C45, CAPACITANCE, 10.0, 8.0, 12.0, 9.9, uF, PASS
SN-2026-0003, C45, CAPACITANCE, 10.0, 8.0, 12.0, 10.0, uF, PASS
SN-2026-0004, C45, CAPACITANCE, 10.0, 8.0, 12.0, 10.2, uF, PASS
SN-2026-0005, C45, CAPACITANCE, 10.0, 8.0, 12.0, 10.0, uF, PASS
`;

  it("parses ICT flying probe test logs into normalized QIF AST", () => {
    const doc = parseIctCsv(sampleIctCsv, "IOT-BOARD-REV-B");

    assert.equal(doc.characteristics.length, 2);
    assert.equal(doc.features.length, 2);
    assert.equal(doc.actuals.length, 10);
    assert.equal(doc.header.partNumber, "IOT-BOARD-REV-B");

    const rChar = doc.characteristics.find((c) => c.name.includes("R12"))!;
    assert.ok(rChar);
    assert.equal(rChar.nominalValue, 100.0);
    assert.equal(rChar.toleranceZone, 10.0); // 105 - 95

    const cChar = doc.characteristics.find((c) => c.name.includes("C45"))!;
    assert.ok(cChar);
    assert.equal(cChar.nominalValue, 10.0);
    assert.equal(cChar.toleranceZone, 4.0); // 12 - 8
  });

  it("computes process capability (Cp, Cpk) and pass rates from factory ICT actuals", () => {
    const doc = parseIctCsv(sampleIctCsv);
    const spc = evaluateQifSpc(doc);

    assert.equal(spc.totalCharacteristics, 2);
    assert.equal(spc.totalActuals, 10);
    assert.equal(spc.overallPassRate, 1.0);

    const rReport = spc.characteristics.find((c) => c.characteristicName.includes("R12"))!;
    assert.ok(rReport);
    assert.equal(rReport.sampleCount, 5);
    assert.ok(Math.abs(rReport.mean - 100.0) < 0.1);
    assert.ok(rReport.stdDev < 0.5);
    assert.ok(rReport.cp > 3.0, "High capability for tightly centered resistor");
    assert.ok(rReport.cpk > 3.0);
  });

  it("correlates factory SPC distributions to ModelScript simulation parameters", () => {
    const doc = parseIctCsv(sampleIctCsv);
    const spc = evaluateQifSpc(doc);
    const variances = correlateSpcToSimulationParameters(spc);

    assert.equal(variances.length, 2);

    const rVar = variances.find((v) => v.component === "R12")!;
    assert.ok(rVar);
    assert.equal(rVar.parameter, "R");
    assert.equal(rVar.unit, "Ohm");
    assert.equal(rVar.distribution, "normal");
    assert.ok(Math.abs(rVar.factoryMean - 100.0) < 0.1);
    assert.ok(rVar.cpk > 1.33);

    const cVar = variances.find((v) => v.component === "C45")!;
    assert.ok(cVar);
    assert.equal(cVar.parameter, "C");
    assert.equal(cVar.unit, "F");
    assert.ok(Math.abs(cVar.factoryMean - 10.0) < 0.1);
  });

  it("lowers factory test inspection QIF document into DAEBuilder linear memory arena", () => {
    const doc = parseIctCsv(sampleIctCsv);
    const arena = lowerQifToDae(doc);

    assert.ok(arena.getVarCount() > 0);
    assert.ok(arena.getEqCount() > 0);
  });

  it("parses SPI/AOI paste inspection logs and calculates volume capability", () => {
    const sampleSpiCsv = `
SerialNumber, ComponentRef, PadId, VolumePercent, MinVol, MaxVol, OffsetX, OffsetY, Status
SN-001, U1, 1, 98.5, 75.0, 130.0, 0.01, 0.02, PASS
SN-002, U1, 1, 101.2, 75.0, 130.0, -0.01, 0.00, PASS
SN-003, U1, 1, 99.0, 75.0, 130.0, 0.00, 0.01, PASS
`;
    const doc = parseSpiAoiCsv(sampleSpiCsv);
    assert.equal(doc.characteristics.length, 1);
    assert.equal(doc.actuals.length, 3);

    const spc = evaluateQifSpc(doc);
    assert.equal(spc.overallPassRate, 1.0);
    assert.equal(spc.characteristics[0]!.sampleCount, 3);
  });
});
