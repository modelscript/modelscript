// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMagicDrawDiagram, createRawZipArchive, parseMagicDraw, renderMagicDrawDiagramSvg } from "../src/index.js";

describe("@modelscript/magicdraw — 2D Diagram Engine & SVG Renderer", () => {
  it("renders custom third-party profile stereotypes and tags generically in BDD compartments", () => {
    const customProfileXml = `<?xml version="1.0" encoding="UTF-8"?>
      <xmi:XMI xmi:version="2.5"
        xmlns:xmi="http://www.omg.org/spec/XMI/20131001"
        xmlns:uml="http://www.omg.org/spec/UML/20131001"
        xmlns:uaf="http://www.omg.org/spec/UAF/1.2">
        <uml:Model xmi:id="m_uaf" name="EnterpriseArch">
          <packagedElement xmi:type="uml:Class" xmi:id="res_1" name="GroundStation"/>
        </uml:Model>
        <uaf:ResourcePerformer xmi:id="st_uaf_1" base_Class="res_1" criticality="DAL-A"/>
      </xmi:XMI>`;

    const doc = parseMagicDraw(customProfileXml);
    const bdd = buildMagicDrawDiagram(doc, { diagramKind: "BDD" });
    assert.strictEqual(bdd.nodes.length, 1);
    assert.ok(bdd.nodes[0]?.stereotype.includes("resourcePerformer"));
    assert.ok(bdd.nodes[0]?.compartments.some((c) => c.title === "tags" && c.entries.some((e) => e.includes("DAL-A"))));

    const svg = renderMagicDrawDiagramSvg(doc, { diagramKind: "BDD" });
    assert.ok(svg.includes("GroundStation"));
    assert.ok(svg.includes("DAL-A"));
  });

  it("renders Activity (ACT) and Sequence (SEQ) diagrams and preserves mdOwnedViews edge bendpoints", () => {
    const behavioralXml = `<?xml version="1.0" encoding="UTF-8"?>
      <xmi:XMI xmi:version="2.5"
        xmlns:xmi="http://www.omg.org/spec/XMI/20131001"
        xmlns:uml="http://www.omg.org/spec/UML/20131001">
        <uml:Model xmi:id="m_beh" name="BehavioralModel">
          <packagedElement xmi:type="uml:Activity" xmi:id="act_1" name="StartupSequence">
            <node xmi:type="uml:InitialNode" xmi:id="an_init" name="Start"/>
            <node xmi:type="uml:OpaqueAction" xmi:id="an_check" name="SelfCheck"/>
            <node xmi:type="uml:ActivityFinalNode" xmi:id="an_end" name="Done"/>
            <edge xmi:type="uml:ControlFlow" xmi:id="ae_1" source="an_init" target="an_check"/>
            <edge xmi:type="uml:ControlFlow" xmi:id="ae_2" source="an_check" target="an_end">
              <guard xmi:type="uml:OpaqueExpression"><body>ok == true</body></guard>
            </edge>
          </packagedElement>
          <packagedElement xmi:type="uml:Interaction" xmi:id="int_1" name="CommandHandshake">
            <lifeline xmi:id="ll_pilot" name="Pilot"/>
            <lifeline xmi:id="ll_fcc" name="FlightComputer"/>
            <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="f_s1" covered="ll_pilot"/>
            <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="f_r1" covered="ll_fcc"/>
            <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="f_s2" covered="ll_fcc"/>
            <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="f_r2" covered="ll_pilot"/>
            <message xmi:id="msg_1" name="armAutopilot()" sendEvent="f_s1" receiveEvent="f_r1" messageSort="synchCall"/>
            <message xmi:id="msg_2" name="ack" sendEvent="f_s2" receiveEvent="f_r2" messageSort="reply"/>
          </packagedElement>
          <xmi:Extension extender="MagicDraw UML 2024x">
            <ownedDiagram xmi:id="d_act" name="Startup ACT" type="SysML Activity Diagram">
              <mdOwnedViews>
                <mdElement elementClass="ControlFlowView">
                  <elementID xmi:idref="ae_1"/>
                  <breakpoints>68,88; 160,88; 160,120; 280,120</breakpoints>
                </mdElement>
              </mdOwnedViews>
            </ownedDiagram>
          </xmi:Extension>
        </uml:Model>
      </xmi:XMI>`;

    const doc = parseMagicDraw(behavioralXml);
    const act = buildMagicDrawDiagram(doc, { diagramKind: "ACT" });
    assert.strictEqual(act.nodes.length, 3);
    assert.strictEqual(act.edges.length, 2);
    assert.strictEqual(act.edges[0]?.points?.length, 4);
    const actSvg = renderMagicDrawDiagramSvg(doc, { diagramKind: "ACT" });
    assert.ok(actSvg.includes("<polyline "));
    assert.ok(actSvg.includes("SelfCheck"));

    const seq = buildMagicDrawDiagram(doc, { diagramKind: "SEQ" });
    assert.strictEqual(seq.nodes.length, 2);
    assert.strictEqual(seq.edges.length, 2);
    assert.strictEqual(seq.edges[1]?.dashed, true);
    const seqSvg = renderMagicDrawDiagramSvg(doc, { diagramKind: "SEQ" });
    assert.ok(seqSvg.includes("armAutopilot()"));
    assert.ok(seqSvg.includes('stroke-dasharray="6,6"'));
  });

  it("merges split .shared_model and .model entries inside a single .mdzip archive", () => {
    const sharedXml = `<?xml version="1.0" encoding="UTF-8"?>
      <xmi:XMI xmi:version="2.5" xmlns:xmi="http://www.omg.org/spec/XMI/20131001" xmlns:uml="http://www.omg.org/spec/UML/20131001" xmlns:sysml="http://www.omg.org/spec/SysML/20181001/SysML">
        <uml:Model xmi:id="m_shared" name="SharedTypes">
          <packagedElement xmi:type="uml:Class" xmi:id="shared_blk_1" name="SharedSensor"/>
        </uml:Model>
        <sysml:Block xmi:id="st_sb1" base_Class="shared_blk_1"/>
      </xmi:XMI>`;
    const mainXml = `<?xml version="1.0" encoding="UTF-8"?>
      <xmi:XMI xmi:version="2.5" xmlns:xmi="http://www.omg.org/spec/XMI/20131001" xmlns:uml="http://www.omg.org/spec/UML/20131001" xmlns:sysml="http://www.omg.org/spec/SysML/20181001/SysML">
        <uml:Model xmi:id="m_main" name="MainSystem">
          <packagedElement xmi:type="uml:Class" xmi:id="main_blk_1" name="Drone">
            <ownedAttribute xmi:type="uml:Property" xmi:id="p_sens" name="sensor" aggregation="composite">
              <type href="shared#shared_blk_1"/>
            </ownedAttribute>
          </packagedElement>
        </uml:Model>
        <sysml:Block xmi:id="st_mb1" base_Class="main_blk_1"/>
      </xmi:XMI>`;

    const mdzip = createRawZipArchive([
      { name: "com.nomagic.magicdraw.uml_model.model", data: new TextEncoder().encode(mainXml) },
      { name: "com.nomagic.magicdraw.uml_model.shared_model", data: new TextEncoder().encode(sharedXml) },
    ]);

    const doc = parseMagicDraw(mdzip);
    assert.ok(doc.classifiers.has("shared_blk_1"));
    assert.ok(doc.classifiers.has("main_blk_1"));
    assert.strictEqual(doc.classifiers.get("main_blk_1")?.properties[0]?.typeRef?.resolvedName, "SharedSensor");
  });
});
