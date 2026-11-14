// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { auditCpsArchitectureCompliance } from "../src/cps-bridge/index.js";
import { parseOscal } from "../src/parser/index.js";

const MICROGRID_SSP = JSON.stringify({
  "system-security-plan": {
    uuid: "11111111-2222-4333-8444-555555555555",
    metadata: { title: "Microgrid Protection SSP", version: "1.0.0" },
    "system-implementation": {
      components: [{ uuid: "22222222-2222-4333-8444-555555555555", title: "FeederRelayIED", type: "ied" }],
    },
    "control-implementation": {
      "implemented-requirements": [
        {
          uuid: "33333333-2222-4333-8444-555555555555",
          "control-id": "sc-7",
          description: "IEC 61850 zone isolation.",
        },
        {
          uuid: "44444444-2222-4333-8444-555555555555",
          "control-id": "ac-3",
          description: "Role-based access control.",
        },
        {
          uuid: "55555555-2222-4333-8444-555555555555",
          "control-id": "si-7",
          description: "Signed firmware verification.",
        },
        { uuid: "66666666-2222-4333-8444-555555555555", "control-id": "pe-3", description: "Physical access control." },
      ],
    },
  },
});

export const oscalBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "oscal",
  referenceTool: "NIST OSCAL 1.1.2 / CPS Compliance Audit",
  defaultTolerance: 0,
  metricKind: "exact",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const doc = parseOscal(MICROGRID_SSP);
    const audit = auditCpsArchitectureCompliance(doc, [{ name: "FeederRelayIED", kind: "ied" }]);
    const d1 = performance.now() - t0;

    return [
      {
        id: "oscal-ssp-cps-audit",
        name: "NIST OSCAL 1.1.2 Microgrid SSP Control Compliance Audit",
        scale: "micro",
        referenceTool: "NIST OSCAL 1.1.2 / CPS Compliance Audit",
        metricKind: "exact",
        threshold: 0,
        measuredError: audit.mappedComponents.length === 1 ? 0 : 1,
        passed: audit.mappedComponents.length === 1 && audit.diagnostics.length >= 0,
        durationMs: d1,
        details: `mapped=${audit.mappedComponents.length}, coverage=${audit.coveragePercentage}%, compliant=${String(audit.compliant)}`,
      },
    ];
  },
};
