// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerSclToDae } from "../src/dae/scl-to-dae.js";
import { parseSclXml } from "../src/parser/scl-parser.js";

describe("IEC 61850 SCL Lowering to Linear-Memory DAE Arena", () => {
  const scdWithAutomation = `<?xml version="1.0" encoding="UTF-8"?>
<SCL xmlns="http://www.iec.ch/61850/2003/SCL" version="2007" revision="B">
  <Header id="DAE_AUTOMATION_TEST" version="1.0" revision="0"/>
  <Substation name="NORTH_SUB">
    <VoltageLevel name="110kV">
      <Bay name="BAY1">
        <ConductingEquipment name="QA1" type="CBR">
          <Terminal name="T1" connectivityNode="NORTH_SUB/110kV/BAY1/CN1"/>
        </ConductingEquipment>
        <ConductingEquipment name="QB1" type="DIS">
          <Terminal name="T1" connectivityNode="NORTH_SUB/110kV/BAY1/CN2"/>
        </ConductingEquipment>
      </Bay>
    </VoltageLevel>
  </Substation>
  <IED name="IED_PROT">
    <AccessPoint name="AP1">
      <Server>
        <LDevice inst="LD0">
          <LN0 lnClass="LLN0" inst="" lnType="T_LLN0"/>
          <LN lnClass="XCBR" inst="1" lnType="T_XCBR"/>
          <LN lnClass="PTOC" inst="1" lnType="T_PTOC"/>
          <LN lnClass="MMXU" inst="1" lnType="T_MMXU"/>
        </LDevice>
      </Server>
    </AccessPoint>
  </IED>
</SCL>`;

  it("should compile SCL physical and logical equipment into DAE arena variables and equations", () => {
    const doc = parseSclXml(scdWithAutomation);
    const dae = lowerSclToDae(doc);

    // Expected variables:
    // 1 time var ('time')
    // 2 physical conducting equipment states ('110kV_BAY1_QA1_Pos', '110kV_BAY1_QB1_Pos')
    // 1 XCBR trip state ('IED_PROT_LD0_XCBR1_Trip')
    // 1 PTOC overcurrent trip command ('IED_PROT_LD0_PTOC1_Op')
    // 4 MMXU measurements ('IED_PROT_LD0_MMXU1_V_mag', 'I_mag', 'P_total', 'Q_total')
    // Total = 1 + 2 + 1 + 1 + 4 = 9 variables
    assert.equal(dae.varCount, 9, "Expected 9 variables in linear memory DAE arena");

    // Expected equations:
    // 2 physical equipment initial status equations
    // 1 XCBR equation
    // 1 PTOC equation
    // 4 MMXU measurement equations
    // Total = 2 + 1 + 1 + 4 = 8 equations
    assert.equal(dae.eqCount, 8, "Expected 8 equations in linear memory DAE arena");
  });

  it("should compile empty SCL document without crashing", () => {
    const minimalScd = `<SCL xmlns="http://www.iec.ch/61850/2003/SCL"><Header id="MINIMAL" version="1.0" revision="0"/></SCL>`;
    const doc = parseSclXml(minimalScd);
    const dae = lowerSclToDae(doc);

    assert.equal(dae.varCount, 1); // time
    assert.equal(dae.eqCount, 0);
  });
});
