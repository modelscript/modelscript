// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCgmesRdf } from "../src/parser/cgmes-rdf-parser.js";
import { cgmesToOpenDss } from "../src/projections/cgmes-to-opendss.js";

const SAMPLE_CDPSM_EMS_RDF = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:cim="http://iec.ch/TC57/CIM100#">
  <cim:BaseVoltage rdf:ID="_BV_1247">
    <cim:BaseVoltage.nominalVoltage>12.47</cim:BaseVoltage.nominalVoltage>
  </cim:BaseVoltage>
  <cim:GeographicalRegion rdf:ID="_REG_NA">
    <cim:IdentifiedObject.name>WECC</cim:IdentifiedObject.name>
  </cim:GeographicalRegion>
  <cim:SubGeographicalRegion rdf:ID="_SUBREG_CA">
    <cim:IdentifiedObject.name>CAISO</cim:IdentifiedObject.name>
    <cim:SubGeographicalRegion.Region rdf:resource="#_REG_NA"/>
  </cim:SubGeographicalRegion>
  <cim:ControlArea rdf:ID="_CA_1">
    <cim:IdentifiedObject.name>CAISO_BA</cim:IdentifiedObject.name>
    <cim:ControlArea.type>AGC</cim:ControlArea.type>
    <cim:ControlArea.netInterchange>250.0</cim:ControlArea.netInterchange>
  </cim:ControlArea>
  <cim:Feeder rdf:ID="_FDR_1">
    <cim:IdentifiedObject.name>Feeder_12_47</cim:IdentifiedObject.name>
  </cim:Feeder>
  <cim:EnergySource rdf:ID="_SRC_1">
    <cim:IdentifiedObject.name>Sub_Source</cim:IdentifiedObject.name>
    <cim:ConductingEquipment.BaseVoltage rdf:resource="#_BV_1247"/>
    <cim:EnergySource.voltageMagnitude>12.72</cim:EnergySource.voltageMagnitude>
    <cim:EnergySource.voltageAngle>0.0</cim:EnergySource.voltageAngle>
  </cim:EnergySource>
  <cim:PerLengthSequenceImpedance rdf:ID="_IMP_1">
    <cim:IdentifiedObject.name>ACSR_336</cim:IdentifiedObject.name>
    <cim:PerLengthSequenceImpedance.r>0.18</cim:PerLengthSequenceImpedance.r>
    <cim:PerLengthSequenceImpedance.x>0.38</cim:PerLengthSequenceImpedance.x>
  </cim:PerLengthSequenceImpedance>
  <cim:ConnectivityNode rdf:ID="_CN_1"><cim:IdentifiedObject.name>N1</cim:IdentifiedObject.name></cim:ConnectivityNode>
  <cim:ConnectivityNode rdf:ID="_CN_2"><cim:IdentifiedObject.name>N2</cim:IdentifiedObject.name></cim:ConnectivityNode>
  <cim:ConnectivityNode rdf:ID="_CN_3"><cim:IdentifiedObject.name>N3</cim:IdentifiedObject.name></cim:ConnectivityNode>
  <cim:Breaker rdf:ID="_BRK_1">
    <cim:IdentifiedObject.name>Sub_Breaker</cim:IdentifiedObject.name>
    <cim:Switch.normalOpen>false</cim:Switch.normalOpen>
    <cim:Switch.ratedCurrent>1200</cim:Switch.ratedCurrent>
  </cim:Breaker>
  <cim:Terminal rdf:ID="_T_B1">
    <cim:Terminal.ConductingEquipment rdf:resource="#_BRK_1"/>
    <cim:Terminal.ConnectivityNode rdf:resource="#_CN_1"/>
    <cim:Terminal.sequenceNumber>1</cim:Terminal.sequenceNumber>
  </cim:Terminal>
  <cim:Terminal rdf:ID="_T_B2">
    <cim:Terminal.ConductingEquipment rdf:resource="#_BRK_1"/>
    <cim:Terminal.ConnectivityNode rdf:resource="#_CN_2"/>
    <cim:Terminal.sequenceNumber>2</cim:Terminal.sequenceNumber>
  </cim:Terminal>
  <cim:ACLineSegment rdf:ID="_LINE_1">
    <cim:IdentifiedObject.name>OH_Line_1</cim:IdentifiedObject.name>
    <cim:Conductor.length>0.5</cim:Conductor.length>
    <cim:ACLineSegment.r>0.09</cim:ACLineSegment.r>
    <cim:ACLineSegment.x>0.19</cim:ACLineSegment.x>
  </cim:ACLineSegment>
  <cim:Terminal rdf:ID="_T_L1">
    <cim:Terminal.ConductingEquipment rdf:resource="#_LINE_1"/>
    <cim:Terminal.ConnectivityNode rdf:resource="#_CN_2"/>
    <cim:Terminal.sequenceNumber>1</cim:Terminal.sequenceNumber>
  </cim:Terminal>
  <cim:Terminal rdf:ID="_T_L2">
    <cim:Terminal.ConductingEquipment rdf:resource="#_LINE_1"/>
    <cim:Terminal.ConnectivityNode rdf:resource="#_CN_3"/>
    <cim:Terminal.sequenceNumber>2</cim:Terminal.sequenceNumber>
  </cim:Terminal>
</rdf:RDF>
`;

describe("IEC 61968-13 CDPSM & North American EMS CIM", () => {
  it("parses Feeder, EnergySource, Breaker, PerLengthSequenceImpedance, ControlArea, and Regions", () => {
    const model = parseCgmesRdf(SAMPLE_CDPSM_EMS_RDF);

    assert.equal(model.regions?.size, 2);
    assert.equal(model.controlAreas?.get("_CA_1")?.netInterchangeMw, 250.0);
    assert.equal(model.feeders?.get("_FDR_1")?.name, "Feeder_12_47");
    assert.equal(model.energySources?.get("_SRC_1")?.nominalVoltageKv, 12.47);
    assert.equal(model.perLengthImpedances?.get("_IMP_1")?.r, 0.18);
    assert.equal(model.switches?.get("_BRK_1")?.switchType, "Breaker");
    assert.equal(model.switches?.get("_BRK_1")?.open, false);

    const dss = cgmesToOpenDss(model, "CDPSM_Test");
    assert.ok(dss.includes("basekv=12.47"));
    assert.ok(dss.includes("New Line.Sub_Breaker phases=3 bus1=_CN_1 bus2=_CN_2 switch=y"));
    assert.ok(dss.includes("New Line.OH_Line_1"));
  });
});
