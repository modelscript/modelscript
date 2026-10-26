// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseReqIf, verifyReqIfMultiDomain } from "../src/index.js";

describe("@modelscript/reqif Multi-Domain Formal Verification (Nelson-Oppen Coordinator)", () => {
  const OFFSHORE_WIND_REQIF = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="HDR-01"><TITLE>Floating Offshore Wind System Requirements</TITLE></REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-GRID-VOLT" LONG-NAME="Grid Interconnection Voltage">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <THE-VALUE>Interconnection bus voltage must be &gt;= 0.95 p.u.</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-MOOR-SF" LONG-NAME="Mooring Line Safety Factor">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <THE-VALUE>Mooring line intact safety_factor must be &gt;= 1.67</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-TOWER-STRESS" LONG-NAME="Tower Base Stress">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <THE-VALUE>Tower base von_mises_stress must be &lt;= 250 MPa</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-AERO-DRAG" LONG-NAME="Nacelle Aerodynamic Drag">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <THE-VALUE>Nacelle drag_coeff must be &lt;= 0.32</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
      <SPECIFICATIONS>
        <SPECIFICATION IDENTIFIER="SPEC-SYSTEM">
          <CHILDREN>
            <SPEC-HIERARCHY IDENTIFIER="SH-1"><OBJECT><SPEC-OBJECT-REF>REQ-GRID-VOLT</SPEC-OBJECT-REF></OBJECT></SPEC-HIERARCHY>
            <SPEC-HIERARCHY IDENTIFIER="SH-2"><OBJECT><SPEC-OBJECT-REF>REQ-MOOR-SF</SPEC-OBJECT-REF></OBJECT></SPEC-HIERARCHY>
            <SPEC-HIERARCHY IDENTIFIER="SH-3"><OBJECT><SPEC-OBJECT-REF>REQ-TOWER-STRESS</SPEC-OBJECT-REF></OBJECT></SPEC-HIERARCHY>
            <SPEC-HIERARCHY IDENTIFIER="SH-4"><OBJECT><SPEC-OBJECT-REF>REQ-AERO-DRAG</SPEC-OBJECT-REF></OBJECT></SPEC-HIERARCHY>
          </CHILDREN>
        </SPECIFICATION>
      </SPECIFICATIONS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

  it("proves complete multi-domain compliance when all 4 physics domains satisfy ReqIF contracts", () => {
    const doc = parseReqIf(OFFSHORE_WIND_REQIF);

    const compliantDecks = {
      powerGrid: {
        busOverrides: [{ busId: 101, busName: "Substation_PCC", actualVm: 1.02, minVm: 0.95, maxVm: 1.05 }],
      },
      marineMooring: {
        lineOverrides: [
          { lineId: "ML_1", lineName: "Bow Line", mbl: 15e6, tensionIntact: 6.2e6, consequenceClass: 2 as const },
        ],
        floaterOffset: { floaterId: "FOWT_Spar", actualOffsetMeters: 4.8, maxAllowableOffsetMeters: 12.0 },
      },
      fea: {
        parts: [{ partName: "TowerBase", maxVonMisesStressPa: 195e6, yieldStrengthPa: 250e6 }],
      },
      cfd: {
        aerodynamics: [{ partName: "NacelleAssembly", dragCoeff: 0.27, maxDragCoeff: 0.32 }],
      },
    };

    const report = verifyReqIfMultiDomain(doc, compliantDecks);

    assert.strictEqual(report.isCertified, true);
    assert.strictEqual(report.status, "CERTIFIED_SAFE");
    assert.strictEqual(report.summary.violatedRequirements, 0);
    assert.strictEqual(report.summary.satisfiedRequirements, 4);
    assert.ok(report.proofManifest !== undefined);
    assert.strictEqual(report.proofManifest!.isCertifiedCompliant, true);
    assert.strictEqual(report.proofManifest!.items[0]?.verificationStatus, "CERTIFIED_SAFE");
  });

  it("detects cross-theory requirement violation when marine mooring fails DNV safety factor", () => {
    const doc = parseReqIf(OFFSHORE_WIND_REQIF);

    const violatingDecks = {
      powerGrid: {
        busOverrides: [{ busId: 101, actualVm: 1.02 }],
      },
      marineMooring: {
        lineOverrides: [
          {
            lineId: "ML_1",
            lineName: "Over-tensioned Bow Line",
            mbl: 10e6,
            tensionIntact: 7.8e6, // SF = 10 / 7.8 = 1.28 < 1.67
            consequenceClass: 2 as const,
          },
        ],
      },
      fea: {
        parts: [{ partName: "TowerBase", maxVonMisesStressPa: 195e6, yieldStrengthPa: 250e6 }],
      },
      cfd: {
        aerodynamics: [{ partName: "NacelleAssembly", dragCoeff: 0.27, maxDragCoeff: 0.32 }],
      },
    };

    const report = verifyReqIfMultiDomain(doc, violatingDecks);

    assert.strictEqual(report.isCertified, false);
    assert.strictEqual(report.status, "CONTRACT_VIOLATION");
    assert.ok(report.summary.violatedRequirements > 0);
    assert.ok(
      report.diagnosticMessage?.includes("DNV-OS-E301 Mooring Compliance Failure") ||
        report.diagnosticMessage?.includes("ML_1"),
    );
  });

  it("detects cross-theory requirement violation when grid interconnection drops below voltage bound", () => {
    const doc = parseReqIf(OFFSHORE_WIND_REQIF);

    const lowVoltageDecks = {
      powerGrid: {
        busOverrides: [
          { busId: 101, busName: "Substation_PCC", actualVm: 0.91 }, // 0.91 < 0.95 p.u.
        ],
      },
      marineMooring: {
        lineOverrides: [{ lineId: "ML_1", mbl: 15e6, tensionIntact: 6.2e6, consequenceClass: 2 as const }],
      },
      fea: {
        parts: [{ partName: "TowerBase", maxVonMisesStressPa: 195e6, yieldStrengthPa: 250e6 }],
      },
      cfd: {
        aerodynamics: [{ partName: "NacelleAssembly", dragCoeff: 0.27, maxDragCoeff: 0.32 }],
      },
    };

    const report = verifyReqIfMultiDomain(doc, lowVoltageDecks);

    assert.strictEqual(report.isCertified, false);
    assert.strictEqual(report.status, "CONTRACT_VIOLATION");
    assert.ok(report.diagnosticMessage?.includes("under-voltage") || report.diagnosticMessage?.includes("voltage"));
  });
});
