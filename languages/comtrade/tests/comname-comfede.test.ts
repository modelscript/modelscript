// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  correlateComfedeWithComtrade,
  crossCheckComnameWithComtrade,
  formatComname,
  parseComfede,
  parseComfedeXml,
  parseComname,
  serializeComfede,
  serializeComfedeXml,
  validateComname,
  type ComtradeConfig,
  type ComtradeRecord,
} from "../src/index.js";

test("IEEE C37.232 COMNAME parse, format, and validate", () => {
  const sample = "2026-11-14,13-45-00-123,-5T,SPRINGFIELD_345,DFR_01,CITY_UTILITIES,FAULT_1.cfg";
  const parsed = parseComname(sample);
  assert.strictEqual(parsed.startDate, "2026-11-14");
  assert.strictEqual(parsed.startTime, "13-45-00-123");
  assert.strictEqual(parsed.timeCode, "-5T");
  assert.strictEqual(parsed.stationName, "SPRINGFIELD_345");
  assert.strictEqual(parsed.deviceId, "DFR_01");
  assert.strictEqual(parsed.companyName, "CITY_UTILITIES");
  assert.deepStrictEqual(parsed.userFields, ["FAULT_1"]);
  assert.strictEqual(parsed.extension, "cfg");
  assert.strictEqual(formatComname(parsed), sample);

  const ok = validateComname(sample);
  assert.strictEqual(ok.valid, true);
  assert.strictEqual(ok.errors.length, 0);

  const bad = validateComname("not_a_comname.cfg");
  assert.strictEqual(bad.valid, false);
  assert.ok(bad.errors.length > 0);

  const badDate = validateComname("2026-13-45,25-00-00,-5T,STN,DEV,CO.cfg");
  assert.strictEqual(badDate.valid, false);
  assert.strictEqual(badDate.errors.length, 2);

  const mockCfg = { stationName: "SPRINGFIELD_345", recordingDeviceId: "DFR_99" } as ComtradeConfig;
  const warnings = crossCheckComnameWithComtrade(parsed, mockCfg);
  assert.strictEqual(warnings.length, 1);
  assert.ok(warnings[0]!.includes("deviceId"));
});

test("IEEE C37.239 COMFEDE XML and CSV round-trip + COMTRADE correlation", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<COMFEDE revisionYear="2010">
  <Header stationName="ERCOT_WEST_345" deviceId="SEL_421_1" startTimestamp="2026-11-14T13:45:00.000Z" timeCode="-6T" />
  <Events>
    <Event sequenceNumber="1" timestamp="2026-11-14T13:45:00.020Z" offsetMs="20.000" channelId="50P" description="Zone 1 Trip" state="TRIP" phase="3P" />
    <Event sequenceNumber="2" timestamp="2026-11-14T13:45:00.055Z" offsetMs="55.000" channelId="52A" description="Breaker Open" state="OPEN" phase="A" />
  </Events>
</COMFEDE>`;

  const doc = parseComfede(xml);
  assert.strictEqual(doc.header.stationName, "ERCOT_WEST_345");
  assert.strictEqual(doc.header.deviceId, "SEL_421_1");
  assert.strictEqual(doc.events.length, 2);
  assert.strictEqual(doc.events[0]?.state, "TRIP");
  assert.strictEqual(doc.events[1]?.offsetMs, 55);

  // XML round-trip
  const reXml = serializeComfedeXml(doc);
  const reparsedXml = parseComfedeXml(reXml);
  assert.strictEqual(reparsedXml.events.length, 2);
  assert.strictEqual(reparsedXml.events[1]?.channelId, "52A");

  // CSV round-trip
  const csv = serializeComfede(doc);
  const reparsedCsv = parseComfede(csv);
  assert.strictEqual(reparsedCsv.header.stationName, "ERCOT_WEST_345");
  assert.strictEqual(reparsedCsv.events.length, 2);
  assert.strictEqual(reparsedCsv.events[0]?.description, "Zone 1 Trip");

  // Correlation with C37.111 COMTRADE waveform
  const comtrade: ComtradeRecord = {
    timeSec: new Float64Array([0.0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06]),
    analogData: new Map(),
    digitalData: new Map(),
  };
  const corr = correlateComfedeWithComtrade(doc, comtrade);
  assert.strictEqual(corr.length, 2);
  assert.strictEqual(corr[0]?.nearestSampleIndex, 2); // 20 ms -> 0.02 s
  assert.strictEqual(corr[0]?.inWindow, true);
  assert.strictEqual(corr[1]?.nearestSampleIndex, 5); // 55 ms -> nearest 0.05 s (index 5)
});
