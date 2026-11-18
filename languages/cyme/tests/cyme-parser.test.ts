// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCyme } from "../src/parser/cyme-parser.js";
import { projectCymeToOpenDss } from "../src/projections/cyme-to-opendss.js";

const SAMPLE_SXST = `
<CymeStudy>
  <NetworkID>Feeder_12_47</NetworkID>
  <Frequency>60</Frequency>
  <Node><NodeID>SUB_1</NodeID><NominalKV>12.47</NominalKV></Node>
  <Node><NodeID>N_2</NodeID><NominalKV>12.47</NominalKV></Node>
  <Source><SourceID>SRC_1</SourceID><NodeID>SUB_1</NodeID><NominalKV>12.47</NominalKV><OperatingKV>12.72</OperatingKV></Source>
  <Section>
    <SectionID>SEC_1_2</SectionID>
    <FromNodeID>SUB_1</FromNodeID>
    <ToNodeID>N_2</ToNodeID>
    <Phase>ABC</Phase>
    <Length>500</Length>
    <DeviceType>OverheadLine</DeviceType>
    <R1>0.2</R1>
    <X1>0.4</X1>
  </Section>
  <SpotLoad><LoadID>L_2</LoadID><NodeID>N_2</NodeID><Phase>ABC</Phase><KW>350</KW><KVAR>120</KVAR></SpotLoad>
</CymeStudy>
`;

describe("CYME Parser & OpenDSS Projection", () => {
  it("parses .sxst XML and ASCII networks and exports to OpenDSS", () => {
    const net = parseCyme(SAMPLE_SXST);
    assert.equal(net.networkId, "Feeder_12_47");
    assert.equal(net.nodes.length, 2);
    assert.equal(net.sources.length, 1);
    assert.equal(net.sections.length, 1);
    assert.equal(net.loads.length, 1);

    const dss = projectCymeToOpenDss(net);
    assert.ok(dss.includes("New Circuit.Feeder_12_47"));
    assert.ok(dss.includes("New Line.SEC_1_2"));
    assert.ok(dss.includes("New Load.L_2"));

    const ascii = parseCyme(`
[NODES]
N1 0 0 12.47
N2 100 0 12.47
[SOURCES]
S1 N1 12.47 12.47
[SECTIONS]
L1 N1 N2 ABC 250 OverheadLine 0.2 0.4
[LOADS]
LD1 N2 ABC 100 20
`);
    assert.equal(ascii.nodes.length, 2);
    assert.equal(ascii.sections.length, 1);
  });
});
