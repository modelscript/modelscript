// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { mapSclToPowerFactory, parseSclXml, validateGooseStreams } from "../src/iec61850/index.js";
import { parsePowerFactoryText } from "../src/parser/powerfactory-parser.js";
import { assessPowerFactoryCables } from "../src/solvers/powerfactory-cable.js";
import { solvePowerFactoryReliability } from "../src/solvers/powerfactory-reliability.js";

const SAMPLE_SCL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<SCL xmlns="http://www.iec.ch/61850/2003/SCL" version="2007" revision="B">
  <Header id="Substation_Alpha_SCD" version="1" revision="0" toolID="DIgSILENT PowerFactory"/>
  <Substation name="Alpha_Substation" desc="400/110 kV Transmission Substation">
    <VoltageLevel name="400kV" nomFreq="50">
      <Voltage unit="V" multiplier="k">400</Voltage>
      <Bay name="Bay_Line1" desc="Overhead Line 1 Bay">
        <ConductingEquipment name="Q0_Breaker" type="CBR">
          <LNode iedName="IED_Prot1" lnClass="XCBR" lnInst="1"/>
          <LNode iedName="IED_Prot1" lnClass="CSWI" lnInst="1"/>
        </ConductingEquipment>
        <ConductingEquipment name="Q1_Disconnector" type="DIS"/>
        <ConnectivityNode name="CN_Line1"/>
      </Bay>
      <Bay name="Bay_Trafo1" desc="400/110 kV Autotransformer Bay">
        <ConductingEquipment name="T1_AutoTrafo" type="PTR">
          <LNode iedName="IED_Trafo" lnClass="PDIF" lnInst="1"/>
        </ConductingEquipment>
        <ConductingEquipment name="Q0_Trafo_Breaker" type="CBR">
          <LNode iedName="IED_Trafo" lnClass="XCBR" lnInst="1"/>
        </ConductingEquipment>
      </Bay>
    </VoltageLevel>
  </Substation>
  <Communication>
    <SubNetwork name="ProcessBus_Alpha" type="8-MMS">
      <ConnectedAP iedName="IED_Prot1" apName="P1">
        <Address>
          <P type="IP">192.168.1.10</P>
          <P type="IP-SUBNET">255.255.255.0</P>
        </Address>
      </ConnectedAP>
      <ConnectedAP iedName="IED_BreakerCtrl" apName="P1">
        <Address>
          <P type="IP">192.168.1.20</P>
        </Address>
      </ConnectedAP>
    </SubNetwork>
  </Communication>
  <IED name="IED_Prot1" type="LineProtection" manufacturer="Siemens" configVersion="V8.4">
    <AccessPoint name="P1">
      <Server>
        <LDevice inst="PROT">
          <LN0 lnClass="LLN0" inst="">
            <DataSet name="ds_Trip">
              <FCDA ldInst="PROT" lnClass="PTOC" lnInst="1" doName="Op" daName="general" fc="ST"/>
              <FCDA ldInst="PROT" lnClass="PDIS" lnInst="1" doName="Op" daName="general" fc="ST"/>
            </DataSet>
            <GSEControl name="gse_Trip" appID="ALPHA_LINE1_TRIP" datSet="ds_Trip" confRev="1" type="GOOSE"/>
          </LN0>
          <LN lnClass="PTOC" inst="1" prefix="OvrCur"/>
          <LN lnClass="PDIS" inst="1" prefix="Dist"/>
        </LDevice>
      </Server>
    </AccessPoint>
  </IED>
  <IED name="IED_BreakerCtrl" type="BayController" manufacturer="ABB" configVersion="V2.1">
    <AccessPoint name="P1">
      <Server>
        <LDevice inst="CTRL">
          <LN lnClass="XCBR" inst="1">
            <Inputs>
              <ExtRef iedName="IED_Prot1" ldInst="PROT" lnClass="PTOC" lnInst="1" doName="Op" daName="general" serviceType="GOOSE"/>
            </Inputs>
          </LN>
        </LDevice>
      </Server>
    </AccessPoint>
  </IED>
</SCL>`;

test("parseSclXml: parses SCD digital substation with topology, IEDs, and Logical Nodes", () => {
  const scl = parseSclXml(SAMPLE_SCL_XML);

  assert.equal(scl.header.id, "Substation_Alpha_SCD");
  assert.equal(scl.substation?.name, "Alpha_Substation");
  assert.equal(scl.substation?.voltageLevels.length, 1);

  assert.ok(scl.substation);
  const vl = scl.substation.voltageLevels[0];
  assert.ok(vl);
  assert.equal(vl.name, "400kV");
  assert.equal(vl.nomVoltageKv, 400.0);
  assert.equal(vl.bays.length, 2);

  // Line Bay
  const lineBay = vl.bays[0]!;
  assert.equal(lineBay.name, "Bay_Line1");
  assert.equal(lineBay.conductingEquipment.length, 2);
  assert.equal(lineBay.conductingEquipment[0]!.type, "CBR");
  assert.equal(lineBay.conductingEquipment[0]!.lNodes.length, 2);

  // IEDs
  assert.equal(scl.ieds.size, 2);
  const protIed = scl.ieds.get("IED_Prot1")!;
  assert.equal(protIed.manufacturer, "Siemens");

  const ctrlIed = scl.ieds.get("IED_BreakerCtrl")!;
  assert.equal(ctrlIed.manufacturer, "ABB");
});

test("validateGooseStreams: verifies GOOSE datasets, subscriber bindings, and trip latency", () => {
  const scl = parseSclXml(SAMPLE_SCL_XML);
  const report = validateGooseStreams(scl);

  assert.equal(report.totalPublishers, 1);
  assert.equal(report.totalSubscribers, 1);
  assert.equal(report.totalGooseStreams, 1);
  assert.equal(report.isValid, true);

  const stream = report.streams[0]!;
  assert.equal(stream.publisherIed, "IED_Prot1");
  assert.equal(stream.appId, "ALPHA_LINE1_TRIP");
  assert.equal(stream.isTripSignal, true);
  assert.equal(stream.performanceClass, "Type1A_FastTrip");
  assert.equal(stream.latencyValid, true);

  // Subscriber binding must be resolved to IED_BreakerCtrl
  assert.equal(stream.subscribers.length, 1);
  assert.equal(stream.subscribers[0]!.subscriberIed, "IED_BreakerCtrl");
  assert.equal(stream.subscribers[0]!.subscriberLn, "XCBR1");
});

test("mapSclToPowerFactory: maps digital substation into PowerFactory network model", () => {
  const scl = parseSclXml(SAMPLE_SCL_XML);
  const mapped = mapSclToPowerFactory(scl);

  assert.equal(mapped.mappedSubstations, 1);
  assert.equal(mapped.mappedBays, 2);
  assert.ok(mapped.mappedBreakers >= 2, "Must map at least 2 circuit breakers / disconnectors");
  assert.ok(mapped.mappedTransformers >= 1, "Must map power transformer");

  const pfModel = mapped.model;
  assert.ok(pfModel.substations.has("Alpha_Substation"));
  assert.ok(pfModel.terminals.size > 0);
  assert.ok(pfModel.switches.size >= 2);
  assert.ok(pfModel.transformers2w.size >= 1);
});

test("assessPowerFactoryCables: evaluates IEC 60287 ampacity and thermal ratings", () => {
  const pfXml = `<?xml version="1.0" encoding="UTF-8"?>
<PowerFactory version="2024">
  <ElmSubstat loc_name="Sub1" id="sub_1" />
  <ElmTerm loc_name="Bus_1" id="bus_1" uknom="110.0" />
  <ElmTerm loc_name="Bus_2" id="bus_2" uknom="110.0" />
  <ElmLne loc_name="Cable_110kV_XLPE" id="line_1" bus1="bus_1" bus2="bus_2" dline="5.0" r1="0.045" x1="0.12" />
</PowerFactory>`;

  const model = parsePowerFactoryText(pfXml, "CableGrid");
  const assessments = assessPowerFactoryCables(model);

  assert.equal(assessments.length, 1);
  const c = assessments[0]!;
  assert.equal(c.lineId, "line_1");
  assert.equal(c.nominalVoltageKv, 110.0);
  assert.ok(
    c.ratedContinuousAmpacityA > 400 && c.ratedContinuousAmpacityA < 1500,
    `Ampacity ${c.ratedContinuousAmpacityA} A must be in realistic range`,
  );
  assert.ok(c.shortCircuitWithstandCurrentKa > 20, "Short circuit withstand must be calculated");
});

test("solvePowerFactoryReliability: calculates IEEE 1366 reliability indices on PowerFactory grid", () => {
  const pfXml = `<?xml version="1.0" encoding="UTF-8"?>
<PowerFactory version="2024">
  <ElmSubstat loc_name="Substation" id="sub_1" />
  <ElmTerm loc_name="Bus_Head" id="bus_head" uknom="20.0" />
  <ElmTerm loc_name="Bus_Mid" id="bus_mid" uknom="20.0" />
  <ElmTerm loc_name="Bus_End" id="bus_end" uknom="20.0" />
  <ElmSym loc_name="GridInfeed" id="gen_1" bus1="bus_head" pgini="10.0" />
  <ElmLne loc_name="Feeder_Section1" id="line_1" bus1="bus_head" bus2="bus_mid" dline="2.5" />
  <ElmLne loc_name="Feeder_Section2" id="line_2" bus1="bus_mid" bus2="bus_end" dline="3.0" />
  <ElmLod loc_name="Load_Mid" id="lod_1" bus1="bus_mid" pl_act="1.5" />
  <ElmLod loc_name="Load_End" id="lod_2" bus1="bus_end" pl_act="2.0" />
  <StaSwitch loc_name="Breaker_Head" id="brk_1" bus1="line_1" on_off="1" />
</PowerFactory>`;

  const model = parsePowerFactoryText(pfXml, "DistributionFeeder");
  const rel = solvePowerFactoryReliability(model);

  assert.ok(rel.system.totalCustomers > 0, "Total customers must be > 0");
  assert.ok(rel.system.saifi > 0, `SAIFI must be positive, got ${rel.system.saifi}`);
  assert.ok(rel.system.saidi > 0, `SAIDI must be positive, got ${rel.system.saidi}`);
  assert.ok(rel.system.asai > 0.99, `ASAI must be > 0.99, got ${rel.system.asai}`);
  assert.ok(rel.criticalBranches.length === 2);
});
