// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintMagicDrawDocument, parseMagicDraw } from "../src/index.js";

describe("@modelscript/magicdraw — Semantic Lint Rules (M9921–M9934)", () => {
  it("detects duplicate xmi:id (M9924) and incompatible parametric binding (M9934)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <xmi:XMI xmi:version="2.5"
        xmlns:xmi="http://www.omg.org/spec/XMI/20131001"
        xmlns:uml="http://www.omg.org/spec/UML/20131001"
        xmlns:sysml="http://www.omg.org/spec/SysML/20181001/SysML">
        <uml:Model xmi:id="m_dup" name="LintTestModel">
          <packagedElement xmi:type="uml:Class" xmi:id="dup_id" name="FirstBlock"/>
          <packagedElement xmi:type="uml:Class" xmi:id="dup_id" name="SecondBlock"/>
          <packagedElement xmi:type="uml:Class" xmi:id="blk_sys" name="SystemBlock">
            <ownedAttribute xmi:type="uml:Property" xmi:id="p_real" name="voltage">
              <type href="http://www.omg.org/spec/UML/20131001/PrimitiveTypes.xmi#Real"/>
            </ownedAttribute>
            <ownedAttribute xmi:type="uml:Property" xmi:id="p_bool" name="enabled">
              <type href="http://www.omg.org/spec/UML/20131001/PrimitiveTypes.xmi#Boolean"/>
            </ownedAttribute>
            <ownedConnector xmi:type="uml:Connector" xmi:id="bad_bind" name="badBinding">
              <end xmi:id="be1" role="p_real"/>
              <end xmi:id="be2" role="p_bool"/>
            </ownedConnector>
          </packagedElement>
        </uml:Model>
        <sysml:Block xmi:id="st_sys" base_Class="blk_sys"/>
        <sysml:BindingConnector xmi:id="st_bind" base_Connector="bad_bind"/>
      </xmi:XMI>`;

    const doc = parseMagicDraw(xml);
    const diags = lintMagicDrawDocument(doc);
    assert.ok(
      diags.some((d) => d.code === "M9924"),
      "Expected M9924 duplicate xmi:id",
    );
    assert.ok(
      diags.some((d) => d.code === "M9934"),
      "Expected M9934 invalid parametric binding",
    );
  });

  it("reports zero errors on a well-formed satisfied and verified SysML 1.x model", () => {
    const cleanXml = `<?xml version="1.0" encoding="UTF-8"?>
      <xmi:XMI xmi:version="2.5"
        xmlns:xmi="http://www.omg.org/spec/XMI/20131001"
        xmlns:uml="http://www.omg.org/spec/UML/20131001"
        xmlns:sysml="http://www.omg.org/spec/SysML/20181001/SysML">
        <uml:Model xmi:id="m_clean" name="CleanModel">
          <packagedElement xmi:type="uml:Class" xmi:id="b_ctrl" name="Controller">
            <ownedAttribute xmi:type="uml:Property" xmi:id="p_gain" name="gain">
              <type href="http://www.omg.org/spec/UML/20131001/PrimitiveTypes.xmi#Real"/>
            </ownedAttribute>
          </packagedElement>
          <packagedElement xmi:type="uml:Class" xmi:id="tc_1" name="GainTestCase"/>
          <packagedElement xmi:type="uml:Class" xmi:id="req_1" name="GainReq"/>
          <packagedElement xmi:type="uml:Abstraction" xmi:id="a_sat" client="b_ctrl" supplier="req_1"/>
          <packagedElement xmi:type="uml:Abstraction" xmi:id="a_ver" client="tc_1" supplier="req_1"/>
        </uml:Model>
        <sysml:Block xmi:id="s_b" base_Class="b_ctrl"/>
        <sysml:Requirement xmi:id="s_r" base_Class="req_1" id="REQ-10" text="Controller gain shall be positive."/>
        <sysml:Satisfy xmi:id="s_sat" base_Abstraction="a_sat"/>
        <sysml:Verify xmi:id="s_ver" base_Abstraction="a_ver"/>
      </xmi:XMI>`;

    const diags = lintMagicDrawDocument(parseMagicDraw(cleanXml));
    assert.strictEqual(diags.length, 0);
  });
});
