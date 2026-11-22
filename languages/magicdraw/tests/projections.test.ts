// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  lowerMagicDrawParametricsToDae,
  magicDrawToModelica,
  magicDrawToReqif,
  magicDrawToSysml2,
  parseMagicDraw,
} from "../src/index.js";

describe("@modelscript/magicdraw — Polyglot Projections & DAE Lowering", () => {
  it("lowers parametric algebraic equations with *, /, +, -, and negation into DAEBuilder", () => {
    const paramXml = `<?xml version="1.0" encoding="UTF-8"?>
      <xmi:XMI xmi:version="2.5"
        xmlns:xmi="http://www.omg.org/spec/XMI/20131001"
        xmlns:uml="http://www.omg.org/spec/UML/20131001"
        xmlns:sysml="http://www.omg.org/spec/SysML/20181001/SysML">
        <uml:Model xmi:id="m_par" name="OhmsLaw">
          <packagedElement xmi:type="uml:Class" xmi:id="cb_ohm" name="PowerCalc">
            <ownedAttribute xmi:type="uml:Property" xmi:id="p_v" name="V">
              <type href="http://www.omg.org/spec/UML/20131001/PrimitiveTypes.xmi#Real"/>
              <defaultValue xmi:type="uml:LiteralReal" value="12.0"/>
            </ownedAttribute>
            <ownedAttribute xmi:type="uml:Property" xmi:id="p_r" name="R">
              <type href="http://www.omg.org/spec/UML/20131001/PrimitiveTypes.xmi#Real"/>
              <defaultValue xmi:type="uml:LiteralReal" value="4.0"/>
            </ownedAttribute>
            <ownedAttribute xmi:type="uml:Property" xmi:id="p_p" name="P">
              <type href="http://www.omg.org/spec/UML/20131001/PrimitiveTypes.xmi#Real"/>
            </ownedAttribute>
            <ownedRule xmi:type="uml:Constraint" xmi:id="c_ohm" name="powerEq">
              <specification xmi:type="uml:OpaqueExpression" xmi:id="oe_ohm">
                <language>English</language>
                <body>P = (V * V) / R - 0.5</body>
              </specification>
            </ownedRule>
          </packagedElement>
        </uml:Model>
        <sysml:ConstraintBlock xmi:id="st_ohm" base_Class="cb_ohm"/>
      </xmi:XMI>`;

    const doc = parseMagicDraw(paramXml);
    const arena = lowerMagicDrawParametricsToDae(doc, "OhmsLawDae");
    assert.strictEqual(arena.varCount, 3);
    assert.strictEqual(arena.eqCount, 3);

    const mo = magicDrawToModelica(doc);
    assert.ok(mo.includes("P = (V * V) / R - 0.5;"));

    const sysml = magicDrawToSysml2(doc);
    assert.ok(sysml.includes("constraint def PowerCalc"));

    const reqif = magicDrawToReqif(doc);
    assert.ok(reqif.includes("<REQ-IF "));
  });
});
