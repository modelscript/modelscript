// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { auditCpsArchitectureCompliance } from "../src/cps-bridge/index.js";
import { parseOscal } from "../src/parser/index.js";
import { oscalToReqif, oscalToSysML2 } from "../src/projections/index.js";

describe("CPS Architecture Compliance Bridge & Projections", () => {
  const sspJson = JSON.stringify({
    "system-security-plan": {
      uuid: "11111111-2222-4333-8444-555555555555",
      metadata: {
        title: "Microgrid Protection SSP",
        version: "1.0.0",
      },
      "system-implementation": {
        components: [
          {
            uuid: "22222222-2222-4333-8444-555555555555",
            title: "FeederRelayIED",
            type: "ied",
          },
        ],
      },
      "control-implementation": {
        "implemented-requirements": [
          {
            uuid: "33333333-2222-4333-8444-555555555555",
            "control-id": "sc-7",
            description: "Substation firewall enforces IEC 61850 zone isolation.",
          },
          {
            uuid: "44444444-2222-4333-8444-555555555555",
            "control-id": "ac-3",
            description: "Role-based access enforced on IED engineering port.",
          },
          {
            uuid: "55555555-2222-4333-8444-555555555555",
            "control-id": "si-7",
            description: "Signed firmware verification enabled on IED.",
          },
          {
            uuid: "66666666-2222-4333-8444-555555555555",
            "control-id": "pe-3",
            description: "Substation control house keycard access control.",
          },
        ],
      },
    },
  });

  it("verifies compliant CPS architecture components and flags unmapped blocks with synthesized POA&M and by-component items", () => {
    const doc = parseOscal(sspJson);

    const compliantAudit = auditCpsArchitectureCompliance(doc, [
      { name: "FeederRelayIED", kind: "ied", isSafetyCritical: true },
    ]);
    assert.strictEqual(compliantAudit.compliant, true);
    assert.strictEqual(compliantAudit.coveragePercentage, 100);
    assert.strictEqual(compliantAudit.unmappedArchitectureComponents.length, 0);

    const gapAudit = auditCpsArchitectureCompliance(doc, [
      { name: "FeederRelayIED", kind: "ied", isSafetyCritical: true },
      { name: "BatteryInverterPLC", kind: "plc", isSafetyCritical: true, networkPorts: ["TCP/502"] },
    ]);
    assert.strictEqual(gapAudit.compliant, false);
    assert.strictEqual(gapAudit.coveragePercentage, 50);
    assert.deepStrictEqual(gapAudit.unmappedArchitectureComponents, ["BatteryInverterPLC"]);
    assert.strictEqual(gapAudit.synthesizedComponents.length, 1);
    assert.strictEqual(gapAudit.synthesizedComponents[0]?.type, "plc");
    assert(gapAudit.synthesizedByComponents.length >= 4);
    assert(gapAudit.synthesizedPoamItems.length >= 1);
  });

  it("projects OSCAL SSP into SysML v2 requirement def, part def, and satisfy statements and OMG ReqIF XML", () => {
    const doc = parseOscal(sspJson);

    const sysml = oscalToSysML2(doc);
    assert(sysml.includes("package Microgrid_Protection_SSP"));
    assert(sysml.includes("requirement def Control_SC_7"));
    assert(sysml.includes("part def FeederRelayIED_Component"));
    assert(sysml.includes("satisfy requirement Control_SC_7 by securityBoundary;"));

    const reqif = oscalToReqif(doc);
    assert(reqif.includes("<REQ-IF "));
    assert(reqif.includes('IDENTIFIER="so-sc-7"'));
    assert(reqif.includes('LONG-NAME="Boundary Protection"'));
  });
});
