// SPDX-License-Identifier: AGPL-3.0-or-later

import { getSysmlParser } from "@modelscript/sysml2";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMagicDrawDiagram,
  buildMagicDrawMatrix,
  createRawZipArchive,
  diffMagicDrawDocuments,
  formatMagicDrawDiffMarkdown,
  loadDiagramView,
  lowerMagicDrawParametricsToDae,
  migrateMagicDrawToSysml2Workspace,
  parseMagicDraw,
  renderMagicDrawDiagramSvg,
} from "../src/index.js";

describe("@modelscript/magicdraw — Phase 2 Upgrades (Lazy Views, Fidelity, Diff, Migrate, Deep DAE)", () => {
  it("lazily decodes BINARY-<uuid> Cameo views with semicolon waypoints, SUPPRESS_* flags, colors, and DiagramFrame", () => {
    const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
      <xmi:XMI xmi:version="2.5" xmlns:xmi="http://www.omg.org/spec/XMI/20131001" xmlns:uml="http://www.omg.org/spec/UML/20131001" xmlns:sysml="http://www.omg.org/spec/SysML/20181001/SysML">
        <uml:Model xmi:id="m1" name="LazyTest">
          <packagedElement xmi:type="uml:Class" xmi:id="blk_a" name="SubsystemA">
            <ownedAttribute xmi:type="uml:Property" xmi:id="p1" name="sub" type="blk_b" aggregation="composite"/>
          </packagedElement>
          <packagedElement xmi:type="uml:Class" xmi:id="blk_b" name="SubsystemB"/>
          <packagedElement xmi:type="uml:Activity" xmi:id="act_1" name="MissionOps"/>
          <xmi:Extension extender="MagicDraw UML 2024x">
            <ownedDiagram xmi:type="uml:Diagram" xmi:id="d_bdd_1" name="Lazy BDD">
              <xmi:Extension extender="MagicDraw UML 2024x">
                <diagramRepresentation>
                  <diagram:DiagramRepresentationObject type="SysML Block Definition Diagram">
                    <diagramContents>
                      <binaryObject streamContentID="BINARY-test-view-1"/>
                      <usedObjects href="#blk_a"/>
                      <usedObjects href="#blk_b"/>
                      <usedObjects href="#act_1"/>
                    </diagramContents>
                  </diagram:DiagramRepresentationObject>
                </diagramRepresentation>
              </xmi:Extension>
            </ownedDiagram>
          </xmi:Extension>
        </uml:Model>
        <sysml:Block xmi:id="sb1" base_Class="blk_a"/>
        <sysml:Block xmi:id="sb2" base_Class="blk_b"/>
      </xmi:XMI>`;

    const binaryViewXml = `<?xml version="1.0" encoding="UTF-8"?>
      <mdOwnedViews>
        <mdElement elementClass="DiagramFrame">
          <geometry>5, 5, 600, 400</geometry>
        </mdElement>
        <mdElement elementClass="Class">
          <elementID xmi:idref="blk_a"/>
          <properties>
            <mdElement elementClass="ColorProperty">
              <propertyID>FILL_COLOR</propertyID>
              <value xmi:value="-2241122"/>
            </mdElement>
            <mdElement elementClass="BooleanProperty">
              <propertyID>SUPPRESS_PARTS_COMPARTMENT</propertyID>
              <value xmi:value="true"/>
            </mdElement>
          </properties>
          <geometry>40, 60, 200, 80</geometry>
        </mdElement>
        <mdElement elementClass="Association">
          <elementID xmi:idref="prop_rel_p1"/>
          <geometry>140, 140; 140, 200; 300, 200; </geometry>
        </mdElement>
      </mdOwnedViews>`;

    const mdzip = createRawZipArchive([
      { name: "com.nomagic.magicdraw.uml_model.model", data: new TextEncoder().encode(modelXml) },
      { name: "BINARY-test-view-1", data: new TextEncoder().encode(binaryViewXml) },
    ]);

    const doc = parseMagicDraw(mdzip);
    // Must NOT eagerly parse BINARY-* during parseMagicDraw()
    assert.strictEqual(doc.diagrams[0]?.viewLoaded, false);
    assert.strictEqual(doc.diagrams[0]?.viewBounds.length, 0);

    // Building the diagram lazily loads & caches the BINARY-* view
    const model = buildMagicDrawDiagram(doc, { diagramId: "d_bdd_1" });
    assert.strictEqual(doc.diagrams[0]?.viewLoaded, true);
    assert.ok(model.frameBounds);
    assert.strictEqual(model.frameBounds.width, 600);

    // Includes both Classifier blocks AND non-classifier Activity node in scopedIds
    assert.ok(model.nodes.some((n) => n.id === "act_1" && n.kind === "Activity"));
    const nodeA = model.nodes.find((n) => n.id === "blk_a");
    assert.ok(nodeA);
    assert.strictEqual(nodeA.x, 40);
    assert.strictEqual(nodeA.fillColor, "#ddcd9e");
    // SUPPRESS_PARTS_COMPARTMENT suppressed the parts compartment
    assert.strictEqual(
      nodeA.compartments.some((c) => c.title === "parts"),
      false,
    );

    // Cameo semicolon edge waypoints decoded
    const edge = model.edges.find((e) => e.id === "prop_rel_p1");
    assert.strictEqual(edge?.points?.length, 3);
    const svg = renderMagicDrawDiagramSvg(doc, { diagramId: "d_bdd_1" });
    assert.ok(svg.includes('fill="#ddcd9e"'));
    assert.ok(svg.includes("<polyline "));
    assert.ok(loadDiagramView(doc, "d_bdd_1")?.viewLoaded);
  });

  it("computes semantic .mdzip diffs, matrices, multi-file SysML v2 migration, and deep der()/Pow/NestedConnectorEnd DAE", async () => {
    const v1 = `<?xml version="1.0" encoding="UTF-8"?>
      <xmi:XMI xmi:version="2.5" xmlns:xmi="http://www.omg.org/spec/XMI/20131001" xmlns:uml="http://www.omg.org/spec/UML/20131001" xmlns:sysml="http://www.omg.org/spec/SysML/20181001/SysML">
        <uml:Model xmi:id="m1" name="Spacecraft">
          <packagedElement xmi:type="uml:Package" xmi:id="pkg_types" name="Types">
            <packagedElement xmi:type="uml:Class" xmi:id="blk_thruster" name="Thruster">
              <ownedAttribute xmi:type="uml:Property" xmi:id="p_thrust" name="thrust">
                <type href="http://www.omg.org/spec/UML/20131001/PrimitiveTypes.xmi#Real"/>
                <defaultValue xmi:type="uml:LiteralReal" value="100.0"/>
              </ownedAttribute>
            </packagedElement>
          </packagedElement>
          <packagedElement xmi:type="uml:Package" xmi:id="pkg_sys" name="Propulsion">
            <packagedElement xmi:type="uml:Class" xmi:id="cb_dyn" name="Dynamics">
              <ownedAttribute xmi:type="uml:Property" xmi:id="p_v" name="v">
                <type href="http://www.omg.org/spec/UML/20131001/PrimitiveTypes.xmi#Real"/>
              </ownedAttribute>
              <ownedAttribute xmi:type="uml:Property" xmi:id="p_a" name="a">
                <type href="http://www.omg.org/spec/UML/20131001/PrimitiveTypes.xmi#Real"/>
              </ownedAttribute>
              <ownedRule xmi:type="uml:Constraint" xmi:id="r_dyn" name="accel">
                <specification xmi:type="uml:OpaqueExpression"><body>der(v) = a + v^2</body></specification>
              </ownedRule>
            </packagedElement>
            <packagedElement xmi:type="uml:Class" xmi:id="blk_prop" name="PropulsionSystem">
              <ownedAttribute xmi:type="uml:Property" xmi:id="part_t" name="mainThruster" type="blk_thruster" aggregation="composite"/>
              <ownedAttribute xmi:type="uml:Property" xmi:id="cp_dyn" name="dyn" type="cb_dyn" aggregation="composite"/>
              <ownedConnector xmi:type="uml:Connector" xmi:id="bind_nested" name="nestedBind">
                <end xmi:id="ne1" role="p_thrust"/>
                <end xmi:id="ne2" role="p_a" partWithPort="cp_dyn"/>
              </ownedConnector>
            </packagedElement>
            <packagedElement xmi:type="uml:Class" xmi:id="req_1" name="ThrustReq"/>
            <packagedElement xmi:type="uml:Abstraction" xmi:id="sat_1" client="blk_prop" supplier="req_1"/>
          </packagedElement>
        </uml:Model>
        <sysml:Block xmi:id="sb_t" base_Class="blk_thruster"/>
        <sysml:ConstraintBlock xmi:id="sc_d" base_Class="cb_dyn"/>
        <sysml:Block xmi:id="sb_p" base_Class="blk_prop"/>
        <sysml:BindingConnector xmi:id="sbc_1" base_Connector="bind_nested"/>
        <sysml:NestedConnectorEnd xmi:id="snce_1" base_ConnectorEnd="ne1" propertyPath="part_t"/>
        <sysml:Requirement xmi:id="sr_1" base_Class="req_1" Id="PROP-01" Text="Minimum thrust 100 N."/>
        <sysml:Satisfy xmi:id="ss_1" base_Abstraction="sat_1"/>
      </xmi:XMI>`;

    const v2 = v1.replace('value="100.0"', 'value="150.0"').replace("Minimum thrust 100 N.", "Minimum thrust 150 N.");

    // 1. Semantic diff
    const diff = diffMagicDrawDocuments(v1, v2);
    assert.strictEqual(diff.summary.classifiersModified, 2);
    assert.strictEqual(diff.summary.requirementsChanged, 1);
    const md = formatMagicDrawDiffMarkdown(diff);
    assert.ok(md.includes("PROP-01") || md.includes("ThrustReq"));

    // 2. Dependency Matrix
    const matrix = buildMagicDrawMatrix(v1, "satisfy");
    assert.strictEqual(matrix.rows.length, 1);
    assert.strictEqual(matrix.columns.length, 1);
    assert.strictEqual(matrix.cells.length, 1);

    // 3. Multi-file SysML v2 migration + round-trip parse with @modelscript/sysml2
    const workspace = migrateMagicDrawToSysml2Workspace(v1);
    assert.strictEqual(workspace.files.length, 2);
    assert.ok(
      workspace.files.some((f) => f.fileName === "Propulsion.sysml" && f.content.includes("private import Types::*;")),
    );
    const sysmlParser = await getSysmlParser();
    for (const f of workspace.files) {
      const tree = sysmlParser.parse(f.content);
      assert.strictEqual(tree.rootNode.hasError, false, `Parse error in migrated ${f.fileName}:\n${f.content}`);
    }

    // 4. Deep DAE lowering with der(v), v^2, and NestedConnectorEnd
    const arena = lowerMagicDrawParametricsToDae(v1);
    assert.ok(arena.varCount >= 4);
    assert.ok(arena.eqCount >= 3);
  });

  it("extracts embedded PNG, SVG, and PDF binary attachments from .mdzip and Binaries.properties", () => {
    const minXml = `<?xml version="1.0" encoding="UTF-8"?><xmi:XMI xmlns:xmi="http://www.omg.org/spec/XMI/20131001" xmlns:uml="http://www.omg.org/spec/UML/20131001"><uml:Model xmi:id="m1" name="BinTest"/></xmi:XMI>`;
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const pdfBytes = new TextEncoder().encode("%PDF-1.7\n%test");
    const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>');
    const viewXml = new TextEncoder().encode("<?xml version='1.0'?><mdOwnedViews/>");
    const binProps = new TextEncoder().encode(
      "com.nomagic.magicdraw.uml_model.model=BINARY-icon-1,BINARY-doc-1,BINARY-svg-1,BINARY-view-1\n",
    );

    const mdzip = createRawZipArchive([
      { name: "com.nomagic.magicdraw.uml_model.model", data: new TextEncoder().encode(minXml) },
      { name: "Binaries.properties", data: binProps },
      { name: "BINARY-icon-1", data: pngBytes },
      { name: "BINARY-doc-1", data: pdfBytes },
      { name: "BINARY-svg-1", data: svgBytes },
      { name: "BINARY-view-1", data: viewXml },
    ]);

    const doc = parseMagicDraw(mdzip);
    // Diagram view XML is excluded from doc.binaries by default; 3 non-view attachments remain
    assert.strictEqual(doc.binaries?.length, 3);
    const png = doc.binaries?.find((b) => b.entryName === "BINARY-icon-1");
    assert.strictEqual(png?.kind, "image");
    assert.strictEqual(png?.mimeType, "image/png");
    assert.strictEqual(png?.ownerResource, "com.nomagic.magicdraw.uml_model.model");
    assert.ok(png?.toDataUri()?.startsWith("data:image/png;base64,"));

    const pdf = doc.binaries?.find((b) => b.entryName === "BINARY-doc-1");
    assert.strictEqual(pdf?.kind, "pdf");
    assert.strictEqual(pdf?.mimeType, "application/pdf");

    const svg = doc.binaries?.find((b) => b.entryName === "BINARY-svg-1");
    assert.strictEqual(svg?.kind, "svg");
    assert.strictEqual(svg?.mimeType, "image/svg+xml");
  });
});
