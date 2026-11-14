// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { validateGooseStreams } from "../src/analysis/goose-validator.js";
import { parseSclXml } from "../src/parser/scl-parser.js";

const GOOSE_SCD = `<?xml version="1.0" encoding="UTF-8"?>
<SCL xmlns="http://www.iec.ch/61850/2003/SCL" version="2007" revision="B">
  <Header id="GOOSE_BENCHMARK" version="2.0" revision="1.0"/>
  <Communication>
    <SubNetwork name="STATION_BUS">
      <ConnectedAP iedName="BAY1_PROT" apName="AP1">
        <GSE ldInst="LD0" cbName="GC_FAST_TRIP">
          <Address><P type="MAC-Address">01-0C-CD-01-00-10</P><P type="APPID">0010</P></Address>
        </GSE>
      </ConnectedAP>
    </SubNetwork>
  </Communication>
  <IED name="BAY1_PROT">
    <AccessPoint name="AP1">
      <Server>
        <LDevice inst="LD0">
          <LN0 lnClass="LLN0" inst="" lnType="LLN0_1">
            <DataSet name="DS_TRIP"><FCDA ldInst="LD0" lnClass="PTRC" lnInst="1" doName="Op" fc="ST"/></DataSet>
            <GSEControl name="GC_FAST_TRIP" appID="TRIP_BAY1" datSet="DS_TRIP" confRev="1" minTime="3.0" maxTime="1000.0"/>
          </LN0>
          <LN lnClass="PTRC" inst="1" lnType="PTRC_1"/>
        </LDevice>
      </Server>
    </AccessPoint>
  </IED>
</SCL>`;

export const sclBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "scl",
  referenceTool: "IEC 61850-5 Type 1A GOOSE Latency Verification",
  defaultTolerance: 1e-4,
  metricKind: "max-relative-error",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const doc = parseSclXml(GOOSE_SCD);
    const report = validateGooseStreams(doc);
    const d1 = performance.now() - t0;

    const trip = report.streams.find((s) => s.gseControlName === "GC_FAST_TRIP");
    const err = trip ? Math.abs(trip.minTimeMs - 3.0) : 1;

    return [
      {
        id: "scl-iec61850-goose-latency",
        name: "IEC 61850-5 Type 1A Fast-Trip GOOSE Stream Latency",
        scale: "micro",
        referenceTool: "IEC 61850-5 Type 1A GOOSE Latency Verification",
        metricKind: "max-relative-error",
        threshold: 1e-4,
        measuredError: err,
        passed: report.isValid && Boolean(trip?.isTripSignal) && (trip?.minTimeMs ?? 99) <= 4.0 && err < 1e-4,
        durationMs: d1,
        details: `minTime=${trip?.minTimeMs ?? -1}ms <= 4.0ms (${trip?.performanceClass ?? "n/a"})`,
      },
    ];
  },
};
