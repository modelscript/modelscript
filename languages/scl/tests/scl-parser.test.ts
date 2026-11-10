// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSclXml } from "../src/parser/scl-parser.js";

describe("IEC 61850 SCL Parser", () => {
  const sampleScd = `<?xml version="1.0" encoding="UTF-8"?>
<SCL xmlns="http://www.iec.ch/61850/2003/SCL" version="2007" revision="B">
  <Header id="SUBSTATION_ALPHA_SCD" version="2.0" revision="1.0" toolID="ModelScript"/>
  <Substation name="ALPHA_SUB" desc="220kV/110kV Substation">
    <VoltageLevel name="220kV" desc="High Voltage Transmission">
      <Voltage unit="V" multiplier="k">220.0</Voltage>
      <Bay name="BAY_L1" desc="Line 1 Feeder">
        <ConductingEquipment name="QA1" type="CBR" desc="Main Circuit Breaker">
          <Terminal name="T1" connectivityNode="ALPHA_SUB/220kV/BAY_L1/CN1"/>
          <Terminal name="T2" connectivityNode="ALPHA_SUB/220kV/BAY_L1/CN2"/>
          <LNode iedName="RELAY_01" lnClass="XCBR" lnInst="1"/>
        </ConductingEquipment>
        <ConductingEquipment name="QB1" type="DIS" desc="Busbar Disconnector">
          <Terminal name="T1" connectivityNode="ALPHA_SUB/220kV/BAY_L1/CN1"/>
          <Terminal name="T2" connectivityNode="ALPHA_SUB/220kV/BAY_L1/BUS_A"/>
        </ConductingEquipment>
        <ConnectivityNode name="CN1" pathName="ALPHA_SUB/220kV/BAY_L1/CN1"/>
        <ConnectivityNode name="CN2" pathName="ALPHA_SUB/220kV/BAY_L1/CN2"/>
      </Bay>
    </VoltageLevel>
  </Substation>
  <Communication>
    <SubNetwork name="STATION_BUS" type="8-MMS">
      <ConnectedAP iedName="RELAY_01" apName="AP1">
        <GSE ldInst="PROT" cbName="GC_TRIP">
          <Address>
            <P type="MAC-Address">01-0C-CD-01-00-01</P>
            <P type="APPID">0001</P>
            <P type="VLAN-ID">100</P>
            <P type="VLAN-PRIORITY">4</P>
          </Address>
        </GSE>
      </ConnectedAP>
    </SubNetwork>
  </Communication>
  <IED name="RELAY_01" desc="Line Protection IED" type="SEL-421" manufacturer="SEL">
    <AccessPoint name="AP1">
      <Server>
        <LDevice inst="PROT">
          <LN0 lnClass="LLN0" lnType="LLN0_1" inst="">
            <DataSet name="DS_TRIP">
              <FCDA ldInst="PROT" lnClass="PTRC" lnInst="1" doName="Op" daName="general" fc="ST"/>
              <FCDA ldInst="PROT" lnClass="XCBR" lnInst="1" doName="Pos" daName="stVal" fc="ST"/>
            </DataSet>
            <GSEControl name="GC_TRIP" appID="TRIP_STREAM_01" datSet="DS_TRIP" confRev="1" minTime="2.0" maxTime="1000.0"/>
          </LN0>
          <LN lnClass="PTRC" inst="1" lnType="PTRC_Type">
            <Inputs>
              <ExtRef iedName="RELAY_02" ldInst="CTRL" lnClass="CSWI" doName="Pos"/>
            </Inputs>
          </LN>
          <LN lnClass="XCBR" inst="1" lnType="XCBR_Type"/>
          <LN lnClass="MMXU" inst="1" lnType="MMXU_Type"/>
        </LDevice>
      </Server>
    </AccessPoint>
  </IED>
</SCL>`;

  it("should parse SCL Header metadata correctly", () => {
    const doc = parseSclXml(sampleScd);
    assert.equal(doc.header.id, "SUBSTATION_ALPHA_SCD");
    assert.equal(doc.header.version, "2.0");
    assert.equal(doc.header.revision, "1.0");
    assert.equal(doc.header.toolId, "ModelScript");
  });

  it("should parse Substation single-line equipment and topology", () => {
    const doc = parseSclXml(sampleScd);
    assert.ok(doc.substation);
    assert.equal(doc.substation.name, "ALPHA_SUB");
    assert.equal(doc.substation.voltageLevels.length, 1);

    const vl = doc.substation.voltageLevels[0]!;
    assert.equal(vl.name, "220kV");
    assert.equal(vl.nominalVoltageKv, 220.0);
    assert.equal(vl.bays.length, 1);

    const bay = vl.bays[0]!;
    assert.equal(bay.name, "BAY_L1");
    assert.equal(bay.conductingEquipment.length, 2);

    const cbr = bay.conductingEquipment[0]!;
    assert.equal(cbr.name, "QA1");
    assert.equal(cbr.type, "CBR");
    assert.equal(cbr.terminals.length, 2);
    assert.equal(cbr.terminals[0]?.name, "T1");

    assert.equal(bay.connectivityNodes.length, 2);
  });

  it("should parse Communication subnetwork, ConnectedAPs, and GSE addresses", () => {
    const doc = parseSclXml(sampleScd);
    assert.ok(doc.communication);
    assert.equal(doc.communication.length, 1);

    const sn = doc.communication[0]!;
    assert.equal(sn.name, "STATION_BUS");
    assert.equal(sn.connectedAps.length, 1);

    const cap = sn.connectedAps[0]!;
    assert.equal(cap.iedName, "RELAY_01");
    assert.equal(cap.apName, "AP1");

    const gse = cap.gseAddresses?.get("GC_TRIP");
    assert.ok(gse);
    assert.equal(gse.mac, "01-0C-CD-01-00-01");
    assert.equal(gse.appId, "0001");
    assert.equal(gse.vlanId, "100");
    assert.equal(gse.vlanPriority, 4);
  });

  it("should parse IED Logical Devices, Logical Nodes, DataSets, and GSEControls", () => {
    const doc = parseSclXml(sampleScd);
    assert.equal(doc.ieds.size, 1);

    const ied = doc.ieds.get("RELAY_01")!;
    assert.ok(ied);
    assert.equal(ied.manufacturer, "SEL");

    const ap = ied.accessPoints.get("AP1")!;
    assert.ok(ap);
    assert.ok(ap.server);
    const ld = ap.server.logicalDevices.get("PROT");
    assert.ok(ld);

    // LLN0
    const lln0 = ld.logicalNodes.get("LLN0")!;
    assert.ok(lln0);
    assert.equal(lln0.dataSets.size, 1);

    const ds = lln0.dataSets.get("DS_TRIP")!;
    assert.ok(ds);
    assert.equal(ds.fcdaList.length, 2);
    assert.equal(ds.fcdaList[0]?.doName, "Op");
    assert.equal(ds.fcdaList[0]?.daName, "general");

    const gc = lln0.gseControls.get("GC_TRIP")!;
    assert.ok(gc);
    assert.equal(gc.appID, "TRIP_STREAM_01");
    assert.equal(gc.minTimeMs, 2.0);

    // Other LNs
    assert.ok(ld.logicalNodes.has("PTRC1"));
    assert.ok(ld.logicalNodes.has("XCBR1"));
    assert.ok(ld.logicalNodes.has("MMXU1"));
  });
});
