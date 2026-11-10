// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateGooseStreams } from "../src/analysis/goose-validator.js";
import { parseSclXml } from "../src/parser/scl-parser.js";

describe("IEC 61850 GOOSE Stream Latency Benchmark & Tolerance Verification", () => {
  const multiIedScd = `<?xml version="1.0" encoding="UTF-8"?>
<SCL xmlns="http://www.iec.ch/61850/2003/SCL" version="2007" revision="B">
  <Header id="GOOSE_BENCHMARK" version="2.0" revision="1.0"/>
  <Communication>
    <SubNetwork name="STATION_BUS">
      <ConnectedAP iedName="BAY1_PROT" apName="AP1">
        <GSE ldInst="LD0" cbName="GC_FAST_TRIP">
          <Address>
            <P type="MAC-Address">01-0C-CD-01-00-10</P>
            <P type="APPID">0010</P>
          </Address>
        </GSE>
      </ConnectedAP>
      <ConnectedAP iedName="BAY2_PROT" apName="AP1">
        <GSE ldInst="LD0" cbName="GC_INTERLOCK">
          <Address>
            <P type="MAC-Address">01-0C-CD-01-00-20</P>
            <P type="APPID">0020</P>
          </Address>
        </GSE>
      </ConnectedAP>
    </SubNetwork>
  </Communication>
  <IED name="BAY1_PROT">
    <AccessPoint name="AP1">
      <Server>
        <LDevice inst="LD0">
          <LN0 lnClass="LLN0" inst="" lnType="LLN0_1">
            <DataSet name="DS_TRIP">
              <FCDA ldInst="LD0" lnClass="PTRC" lnInst="1" doName="Op" fc="ST"/>
            </DataSet>
            <GSEControl name="GC_FAST_TRIP" appID="TRIP_BAY1" datSet="DS_TRIP" confRev="1" minTime="3.0" maxTime="1000.0"/>
          </LN0>
          <LN lnClass="PTRC" inst="1" lnType="PTRC_1"/>
        </LDevice>
      </Server>
    </AccessPoint>
  </IED>
  <IED name="BAY2_PROT">
    <AccessPoint name="AP1">
      <Server>
        <LDevice inst="LD0">
          <LN0 lnClass="LLN0" inst="" lnType="LLN0_1">
            <DataSet name="DS_INTERLOCK">
              <FCDA ldInst="LD0" lnClass="CSWI" lnInst="1" doName="Pos" fc="ST"/>
            </DataSet>
            <GSEControl name="GC_INTERLOCK" appID="INT_BAY2" datSet="DS_INTERLOCK" confRev="1" minTime="8.0" maxTime="2000.0"/>
          </LN0>
          <LN lnClass="CSWI" inst="1" lnType="CSWI_1"/>
          <LN lnClass="XCBR" inst="1" lnType="XCBR_1">
            <Inputs>
              <ExtRef iedName="BAY1_PROT" ldInst="LD0" lnClass="PTRC" doName="Op"/>
            </Inputs>
          </LN>
        </LDevice>
      </Server>
    </AccessPoint>
  </IED>
</SCL>`;

  it("should benchmark GOOSE stream latency against IEC 61850-5 Type 1A tolerance limits", () => {
    const doc = parseSclXml(multiIedScd);
    const report = validateGooseStreams(doc);

    assert.equal(report.totalGooseStreams, 2);
    assert.equal(report.totalPublishers, 2);
    assert.equal(report.totalSubscribers, 1);
    assert.ok(report.isValid);

    // Fast trip stream validation
    const tripStream = report.streams.find((s) => s.gseControlName === "GC_FAST_TRIP");
    assert.ok(tripStream);
    assert.equal(tripStream.isTripSignal, true);
    assert.equal(tripStream.performanceClass, "Type1A_FastTrip");

    // Benchmark tolerance: IEC 61850-5 Class Type 1A trip latency must satisfy minTimeMs <= 4.0 ms
    const latencyTolerance = 4.0; // 4.0 ms hard requirement
    const latencyMargin = latencyTolerance - tripStream.minTimeMs;
    assert.ok(
      latencyMargin >= 0,
      `Trip stream latency ${tripStream.minTimeMs}ms must converge within standard tolerance ${latencyTolerance}ms`,
    );

    const residual = Math.abs(tripStream.minTimeMs - 3.0);
    assert.ok(residual < 1e-4, `Timing residual ${residual} must be zero`);
  });

  it("should correctly resolve publisher-to-subscriber binding matrix", () => {
    const doc = parseSclXml(multiIedScd);
    const report = validateGooseStreams(doc);

    const tripStream = report.streams.find((s) => s.gseControlName === "GC_FAST_TRIP");
    assert.ok(tripStream);
    assert.equal(tripStream.subscribers.length, 1);
    assert.equal(tripStream.subscribers[0]?.subscriberIed, "BAY2_PROT");
    assert.equal(tripStream.subscribers[0]?.subscriberLn, "XCBR1");
    assert.equal(tripStream.subscribers[0]?.subscribedSignal, "Op");
  });

  it("should benchmark interlock streams against Type 1B timing tolerances", () => {
    const doc = parseSclXml(multiIedScd);
    const report = validateGooseStreams(doc);

    const interlockStream = report.streams.find((s) => s.gseControlName === "GC_INTERLOCK");
    assert.ok(interlockStream);
    assert.equal(interlockStream.isTripSignal, false);
    assert.equal(interlockStream.performanceClass, "Type1B_Interlock");

    const maxAllowableInterlockMs = 10.0;
    const residual = interlockStream.minTimeMs - maxAllowableInterlockMs;
    assert.ok(
      residual <= 0,
      `Interlock timing ${interlockStream.minTimeMs}ms must not exceed tolerance ${maxAllowableInterlockMs}ms`,
    );
  });
});
