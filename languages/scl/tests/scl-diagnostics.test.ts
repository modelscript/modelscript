// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintSclDocument } from "../src/lints/index.js";
import { parseSclXml } from "../src/parser/scl-parser.js";

describe("IEC 61850 SCL Diagnostic Linter", () => {
  it("should flag SCL1001 when Header ID is empty", () => {
    const invalidHeaderScd = `<SCL xmlns="http://www.iec.ch/61850/2003/SCL"><Header id="" version="1.0" revision="0"/></SCL>`;
    const doc = parseSclXml(invalidHeaderScd);
    const diags = lintSclDocument(doc);
    const scl1001 = diags.find((d) => d.code === "SCL1001");
    assert.ok(scl1001, "Expected SCL1001 for empty Header ID");
  });

  it("should flag SCL2001 when IED is missing mandatory LLN0 logical node", () => {
    const missingLln0Scd = `<?xml version="1.0"?>
<SCL xmlns="http://www.iec.ch/61850/2003/SCL">
  <Header id="TEST_SCL" version="1.0" revision="0"/>
  <IED name="BAD_IED">
    <AccessPoint name="AP1">
      <Server>
        <LDevice inst="LD0">
          <LN lnClass="XCBR" inst="1" lnType="T_XCBR"/>
        </LDevice>
      </Server>
    </AccessPoint>
  </IED>
</SCL>`;

    const doc = parseSclXml(missingLln0Scd);
    const diags = lintSclDocument(doc);
    const scl2001 = diags.find((d) => d.code === "SCL2001");
    assert.ok(scl2001, "Expected SCL2001 for missing LLN0 in IED");
  });

  it("should flag SCL2002 when GSEControl references a non-existent DataSet", () => {
    const unboundDsScd = `<?xml version="1.0"?>
<SCL xmlns="http://www.iec.ch/61850/2003/SCL">
  <Header id="TEST_SCL" version="1.0" revision="0"/>
  <IED name="RELAY1">
    <AccessPoint name="AP1">
      <Server>
        <LDevice inst="LD0">
          <LN0 lnClass="LLN0" inst="" lnType="T_LLN0">
            <GSEControl name="GC1" appID="APP1" datSet="DS_NON_EXISTENT" confRev="1"/>
          </LN0>
        </LDevice>
      </Server>
    </AccessPoint>
  </IED>
</SCL>`;

    const doc = parseSclXml(unboundDsScd);
    const diags = lintSclDocument(doc);
    const scl2002 = diags.find((d) => d.code === "SCL2002");
    assert.ok(scl2002, "Expected SCL2002 for unbound DataSet reference");
  });

  it("should flag SCL3002 when GOOSE trip latency exceeds IEC 61850-5 Type 1A limit", () => {
    const slowTripScd = `<?xml version="1.0"?>
<SCL xmlns="http://www.iec.ch/61850/2003/SCL">
  <Header id="TEST_SCL" version="1.0" revision="0"/>
  <IED name="RELAY1">
    <AccessPoint name="AP1">
      <Server>
        <LDevice inst="LD0">
          <LN0 lnClass="LLN0" inst="" lnType="T_LLN0">
            <DataSet name="DS_TRIP">
              <FCDA ldInst="LD0" lnClass="PTRC" doName="Op" fc="ST"/>
            </DataSet>
            <GSEControl name="GC_SLOW_TRIP" appID="APP_TRIP" datSet="DS_TRIP" confRev="1" minTime="15.0"/>
          </LN0>
        </LDevice>
      </Server>
    </AccessPoint>
  </IED>
</SCL>`;

    const doc = parseSclXml(slowTripScd);
    const diags = lintSclDocument(doc);
    const scl3002 = diags.find((d) => d.code === "SCL3002");
    assert.ok(scl3002, "Expected SCL3002 for trip latency minTime=15ms exceeding 4ms limit");
  });

  it("should flag SCL4001 when ConductingEquipment is declared without Terminals", () => {
    const noTerminalScd = `<?xml version="1.0"?>
<SCL xmlns="http://www.iec.ch/61850/2003/SCL">
  <Header id="TEST_SCL" version="1.0" revision="0"/>
  <Substation name="SUB1">
    <VoltageLevel name="110kV">
      <Bay name="BAY1">
        <ConductingEquipment name="FLOATING_CBR" type="CBR"/>
      </Bay>
    </VoltageLevel>
  </Substation>
</SCL>`;

    const doc = parseSclXml(noTerminalScd);
    const diags = lintSclDocument(doc);
    const scl4001 = diags.find((d) => d.code === "SCL4001");
    assert.ok(scl4001, "Expected SCL4001 for conducting equipment missing terminals");
  });
});
