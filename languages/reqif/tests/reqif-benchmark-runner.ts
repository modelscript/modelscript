// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { parseReqIf, verifyReqIfEntailment } from "../src/index.js";

const REQIF_ENTAILMENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER><REQ-IF-HEADER IDENTIFIER="H1"><TITLE>Entailment Pass Test</TITLE></REQ-IF-HEADER></THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-MAX-POWER" LONG-NAME="Total Power">
          <VALUES><ATTRIBUTE-VALUE-STRING><THE-VALUE>Total electrical power consumption must be &lt;= 150 kW.</THE-VALUE></ATTRIBUTE-VALUE-STRING></VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-MOTOR-POWER" LONG-NAME="Motor Power">
          <VALUES><ATTRIBUTE-VALUE-STRING><THE-VALUE>Traction motor power consumption must be &lt;= 120 kW.</THE-VALUE></ATTRIBUTE-VALUE-STRING></VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
      <SPECIFICATIONS>
        <SPECIFICATION IDENTIFIER="SPEC-01">
          <CHILDREN>
            <SPEC-HIERARCHY IDENTIFIER="H1">
              <OBJECT><SPEC-OBJECT-REF>REQ-MAX-POWER</SPEC-OBJECT-REF></OBJECT>
              <CHILDREN>
                <SPEC-HIERARCHY IDENTIFIER="H2"><OBJECT><SPEC-OBJECT-REF>REQ-MOTOR-POWER</SPEC-OBJECT-REF></OBJECT></SPEC-HIERARCHY>
              </CHILDREN>
            </SPEC-HIERARCHY>
          </CHILDREN>
        </SPECIFICATION>
      </SPECIFICATIONS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

export const reqifBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "reqif",
  referenceTool: "Z3 SMT LRA / Nelson-Oppen Requirement Entailment",
  defaultTolerance: 0,
  metricKind: "exact",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const doc = parseReqIf(REQIF_ENTAILMENT_XML);
    const report = verifyReqIfEntailment(doc);
    const d1 = performance.now() - t0;

    return [
      {
        id: "reqif-lra-entailment",
        name: "Hierarchical Requirement Bound Entailment (SMT LRA)",
        scale: "micro",
        referenceTool: "Z3 SMT LRA / Nelson-Oppen Requirement Entailment",
        metricKind: "exact",
        threshold: 0,
        measuredError: report.gapCount,
        passed: report.totalQueries === 1 && report.certifiedCount === 1 && report.gapCount === 0,
        durationMs: d1,
        details: `certified=${report.certifiedCount}/${report.totalQueries}, gaps=${report.gapCount}`,
      },
    ];
  },
};
