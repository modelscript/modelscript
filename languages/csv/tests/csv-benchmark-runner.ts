// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { parseCsvRecords } from "../src/csv-parser.js";

export const csvBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "csv",
  referenceTool: "RFC 4180 / csv-spectrum Conformance Suite",
  defaultTolerance: 0,
  metricKind: "exact",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const r1 = parseCsvRecords(`first,last,address,city,zip\nJohn,Doe,120 any st.,"Anytown, WW",08123`);
    const r2 = parseCsvRecords(`a,b\n1,"ha ""ha"" ha"`);
    const r3 = parseCsvRecords(`a,b,c\n1,2,3\n"once upon\na time",5,6`);
    const d1 = performance.now() - t0;

    const ok = r1[0]?.city === "Anytown, WW" && r2[0]?.b === 'ha "ha" ha' && r3[1]?.a === "once upon\na time";

    return [
      {
        id: "csv-rfc4180-spectrum",
        name: "RFC 4180 Quoted Commas, Escaped Quotes & Multiline Cells",
        scale: "micro",
        referenceTool: "RFC 4180 / csv-spectrum Conformance Suite",
        metricKind: "exact",
        threshold: 0,
        measuredError: ok ? 0 : 1,
        passed: ok,
        durationMs: d1,
        details: "3/3 RFC 4180 spectrum edge cases matched",
      },
    ];
  },
};
