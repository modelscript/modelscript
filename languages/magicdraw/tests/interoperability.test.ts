// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseReqIf } from "@modelscript/reqif";
import { getSysmlParser } from "@modelscript/sysml2";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import {
  buildMagicDrawDiagram,
  createRawZipArchive,
  magicDrawToReqif,
  magicDrawToSysml2,
  parseMagicDraw,
} from "../src/index.js";

const CAMEO_REALISTIC_XMI = `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.5"
  xmlns:xmi="http://www.omg.org/spec/XMI/20131001"
  xmlns:uml="http://www.omg.org/spec/UML/20131001"
  xmlns:sysml="http://www.omg.org/spec/SysML/20181001/SysML">
  <uml:Model xmi:id="m_aero" name="FlightControl">
    <packagedElement xmi:type="uml:Package" xmi:id="p_sys" name="System">
      <packagedElement xmi:type="uml:Class" xmi:id="if_cmd" name="CommandBus">
        <ownedAttribute xmi:type="uml:Property" xmi:id="p_pitch" name="pitchCmd">
          <type href="http://www.omg.org/spec/UML/20131001/PrimitiveTypes.xmi#Real"/>
        </ownedAttribute>
      </packagedElement>
      <packagedElement xmi:type="uml:Class" xmi:id="blk_fcc" name="FlightComputer">
        <ownedAttribute xmi:type="uml:Port" xmi:id="pt_out" name="cmdOut" type="if_cmd"/>
        <ownedAttribute xmi:type="uml:Property" xmi:id="p_rate" name="loopRateHz">
          <type href="http://www.omg.org/spec/UML/20131001/PrimitiveTypes.xmi#Real"/>
          <defaultValue xmi:type="uml:LiteralReal" value="200.0"/>
        </ownedAttribute>
      </packagedElement>
      <packagedElement xmi:type="uml:Class" xmi:id="req_lat" name="LatencyReq"/>
      <packagedElement xmi:type="uml:Class" xmi:id="req_rate" name="LoopRateReq"/>
      <packagedElement xmi:type="uml:Abstraction" xmi:id="abs_sat" client="blk_fcc" supplier="req_lat"/>
      <packagedElement xmi:type="uml:Abstraction" xmi:id="abs_der" client="req_rate" supplier="req_lat"/>
      <xmi:Extension extender="MagicDraw UML 2024x">
        <ownedDiagram xmi:id="d_bdd" name="FCC BDD" type="SysML Block Definition Diagram">
          <mdOwnedViews>
            <mdElement elementClass="ClassView">
              <elementID xmi:idref="blk_fcc"/>
              <geometry>80, 90, 240, 130</geometry>
            </mdElement>
          </mdOwnedViews>
        </ownedDiagram>
      </xmi:Extension>
    </packagedElement>
  </uml:Model>
  <sysml:InterfaceBlock xmi:id="s_if" base_Class="if_cmd"/>
  <sysml:Block xmi:id="s_fcc" base_Class="blk_fcc"/>
  <sysml:ProxyPort xmi:id="s_pt" base_Port="pt_out"/>
  <sysml:Requirement xmi:id="s_r1" base_Class="req_lat" id="FCC-REQ-01" text="End-to-end control latency shall be under 5 ms."/>
  <sysml:Requirement xmi:id="s_r2" base_Class="req_rate" id="FCC-REQ-02" text="Control loop shall execute at 200 Hz."/>
  <sysml:Satisfy xmi:id="s_sat" base_Abstraction="abs_sat"/>
  <sysml:DeriveReqt xmi:id="s_der" base_Abstraction="abs_der"/>
</xmi:XMI>`;

describe("@modelscript/magicdraw — Cross-Package Interoperability & Cameo Quirks", () => {
  it("unpacks gzipped internal .mdzip payloads, base64 data-URI strings, and <elementID xmi:idref/> views", () => {
    const gzippedModel = gzipSync(Buffer.from(CAMEO_REALISTIC_XMI, "utf-8"));
    const mdzipBytes = createRawZipArchive([
      { name: "PROJECT-aero.xml", data: new TextEncoder().encode('<PROJECT name="FlightControl" version="2024x"/>') },
      { name: "com.nomagic.magicdraw.uml_model.model", data: new Uint8Array(gzippedModel) },
    ]);

    // 1. Direct Uint8Array
    const doc = parseMagicDraw(mdzipBytes);
    assert.strictEqual(doc.metadata.status, "ok");
    assert.strictEqual(doc.metadata.magicDrawVersion, "2024x");
    assert.ok(doc.classifiers.has("blk_fcc"));

    // 2. Base64 data-URI string (LSP/VFS channel)
    const dataUri = `data:application/zip;base64,${Buffer.from(mdzipBytes).toString("base64")}`;
    const docFromUri = parseMagicDraw(dataUri);
    assert.strictEqual(docFromUri.metadata.status, "ok");
    assert.strictEqual(docFromUri.classifiers.size, doc.classifiers.size);

    // 3. Cameo <mdOwnedViews><mdElement><elementID xmi:idref="..."/> bounds
    const bdd = buildMagicDrawDiagram(doc, { diagramKind: "BDD" });
    const fccNode = bdd.nodes.find((n) => n.id === "blk_fcc");
    assert.ok(fccNode);
    assert.strictEqual(fccNode.x, 80);
    assert.strictEqual(fccNode.y, 90);
  });

  it("round-trip validates projected SysML v2 with @modelscript/sysml2 and ReqIF with @modelscript/reqif", async () => {
    const doc = parseMagicDraw(CAMEO_REALISTIC_XMI);

    // 1. Parse projected SysML v2 with native WASM @modelscript/sysml2 parser
    const sysmlText = magicDrawToSysml2(doc);
    const sysmlParser = await getSysmlParser();
    const tree = sysmlParser.parse(sysmlText);
    assert.ok(tree?.rootNode, "SysML v2 parser must return a root node");
    assert.strictEqual(tree.rootNode.hasError, false, `Projected SysML v2 had parse errors:\n${sysmlText}`);

    // 2. Parse projected ReqIF 1.2 with @modelscript/reqif
    const reqifXml = magicDrawToReqif(doc);
    const reqifDoc = parseReqIf(reqifXml);
    assert.strictEqual(reqifDoc.specObjects.size, 2);
    assert.strictEqual(reqifDoc.specRelations.length, 1);
  });
});
