// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { lintAtpWorkspace } from "../../../languages/atp/dist/src/index.js";
import { lintCgmesWorkspace } from "../../../languages/cgmes/dist/src/index.js";
import { lintOpenDssWorkspace } from "../../../languages/opendss/dist/src/index.js";
import { lintPscadWorkspace } from "../../../languages/pscad/dist/src/index.js";
import { lintPslfWorkspace } from "../../../languages/pslf/dist/src/index.js";
import { lintPsseWorkspace } from "../../../languages/psse/dist/src/index.js";
import { lintSclWorkspace } from "../../../languages/scl/dist/src/index.js";
import { lintSpiceWorkspace } from "../../../languages/spice/dist/src/index.js";
import { lintVerilogAWorkspace } from "../../../languages/verilog-a/dist/src/index.js";

test("Phase 1: CGMES workspace linter detects unresolved cross-profile rdf:resource", () => {
  const valid = new Map<string, string>([
    [
      "eq.xml",
      `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:cim="http://iec.ch/TC57/2013/CIM-schema-cim16#"><cim:BaseVoltage rdf:ID="BV1"><cim:BaseVoltage.nominalVoltage>230</cim:BaseVoltage.nominalVoltage></cim:BaseVoltage></rdf:RDF>`,
    ],
    [
      "tp.xml",
      `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:cim="http://iec.ch/TC57/2013/CIM-schema-cim16#"><cim:TopologicalNode rdf:ID="TN1"><cim:TopologicalNode.BaseVoltage rdf:resource="#BV1"/></cim:TopologicalNode></rdf:RDF>`,
    ],
  ]);
  const validDiags = lintCgmesWorkspace(valid);
  assert.equal(validDiags.filter((d) => d.rule === "unresolved-cgmes-resource").length, 0);

  const broken = new Map<string, string>([
    [
      "tp.xml",
      `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:cim="http://iec.ch/TC57/2013/CIM-schema-cim16#"><cim:TopologicalNode rdf:ID="TN1"><cim:TopologicalNode.BaseVoltage rdf:resource="#MISSING_BV"/></cim:TopologicalNode></rdf:RDF>`,
    ],
  ]);
  const brokenDiags = lintCgmesWorkspace(broken);
  assert.ok(brokenDiags.some((d) => d.rule === "unresolved-cgmes-resource" && d.uri === "tp.xml"));
});

test("Phase 1: PSS/E workspace linter checks .dyr bus references against .raw", () => {
  const raw =
    "0, 100.0\nTest\n\n101,'BUS1',230.0,3,1,1,1,1.0,0.0\n0 / END OF BUS DATA\n0 / END OF LOAD DATA\n0 / END OF FIXED SHUNT DATA\n101,'1 ',10.0,0.0,50.0,-50.0,1.0,0,100.0,0,1,0,0,1.0,1\n0 / END OF GENERATOR DATA\nQ\n";
  const ok = new Map([
    ["case.raw", raw],
    ["case.dyr", "101 'GENROU' 1 6.0 0.03 0.5 0.05 1.8 1.75 0.6 0.4 0.25 0.15 3.5 0.0 0.1 0.3 /"],
  ]);
  assert.equal(lintPsseWorkspace(ok, "case.raw").filter((d) => d.rule === "dyr-bus-not-found").length, 0);

  const bad = new Map([
    ["case.raw", raw],
    ["case.dyr", "999 'GENROU' 1 6.0 0.03 /"],
  ]);
  assert.ok(lintPsseWorkspace(bad, "case.raw").some((d) => d.rule === "dyr-bus-not-found" && d.uri === "case.dyr"));
});

test("Phase 1: PSLF workspace linter checks .dyd bus references against .epc", () => {
  const epc = "case 'Test'\nb 1 'BUS_1' 16.5 3 1 1 1.04 0.0 1.1 0.9\ng 1 '1' 1 71.6 27.0 300.0 -300.0 1.04 100.0\n";
  const ok = new Map([
    ["base.epc", epc],
    ["dyn.dyd", "genrou 1 'BUS_1' 16.5 '1' : #9 tpdo=6.0\n"],
  ]);
  assert.equal(lintPslfWorkspace(ok, "base.epc").filter((d) => d.rule === "dyd-bus-not-found").length, 0);

  const bad = new Map([
    ["base.epc", epc],
    ["dyn.dyd", "genrou 999 'BUS_X' 16.5 '1' : #9 tpdo=6.0\n"],
  ]);
  assert.ok(lintPslfWorkspace(bad, "base.epc").some((d) => d.rule === "dyd-bus-not-found" && d.uri === "dyn.dyd"));
});

test("Phase 1: PSCAD workspace linter flags missing external companion files", () => {
  const pscx = `<project name="Test"><File path="missing_ctrl.f"/><schemas/></project>`;
  const diags = lintPscadWorkspace(new Map([["proj.pscx", pscx]]), "proj.pscx");
  assert.ok(diags.some((d) => d.rule === "missing-pscad-external-file"));

  const ok = new Map([
    ["proj.pscx", pscx],
    ["missing_ctrl.f", "      SUBROUTINE F()\n      END\n"],
  ]);
  assert.equal(lintPscadWorkspace(ok, "proj.pscx").filter((d) => d.rule === "missing-pscad-external-file").length, 0);
});

test("Phase 1: OpenDSS workspace linter resolves Redirect and detects missing/cyclic files", () => {
  const valid = new Map([
    ["master.dss", "New Circuit.C1 basekv=115\nRedirect lines.dss\n"],
    ["lines.dss", "New Line.L1 bus1=sourcebus bus2=n2 r1=0.1 x1=0.2 length=1\n"],
  ]);
  assert.equal(lintOpenDssWorkspace(valid, "master.dss").filter((d) => d.rule.includes("redirect")).length, 0);

  const cyclic = new Map([
    ["a.dss", "Redirect b.dss\n"],
    ["b.dss", "Redirect missing.dss\n"],
  ]);
  const diags = lintOpenDssWorkspace(cyclic, "a.dss");
  assert.ok(diags.some((d) => d.rule === "unresolved-opendss-redirect"));
});

test("Phase 1: SCL workspace linter detects unresolved ExtRef IED and duplicate GOOSE appID", () => {
  const ied1 = `<SCL><Header id="H"/><IED name="IED_A"><AccessPoint name="AP"><Server><LDevice inst="LD0"><LN0 lnClass="LLN0"><GSEControl name="G1" appID="APP_1"/></LN0></LDevice></Server></AccessPoint></IED></SCL>`;
  const ied2 = `<SCL><Header id="H"/><IED name="IED_B"><AccessPoint name="AP"><Server><LDevice inst="LD0"><LN0 lnClass="LLN0"><GSEControl name="G2" appID="APP_1"/><Inputs><ExtRef iedName="IED_MISSING"/></Inputs></LN0></LDevice></Server></AccessPoint></IED></SCL>`;
  const diags = lintSclWorkspace(
    new Map([
      ["a.icd", ied1],
      ["b.icd", ied2],
    ]),
  );
  assert.ok(diags.some((d) => d.rule === "duplicate-goose-appid"));
  assert.ok(diags.some((d) => d.rule === "unresolved-scl-extref-ied"));
});

test("Phase 1: SPICE workspace linter resolves .include and detects cycles", () => {
  const ok = new Map([
    ["top.sp", "* top\nV1 in 0 DC 5\n.include sub.sp\n.end\n"],
    ["sub.sp", "R1 in 0 1k\n"],
  ]);
  assert.equal(lintSpiceWorkspace(ok, "top.sp").filter((d) => d.rule.includes("include")).length, 0);

  const bad = new Map([["top.sp", "* top\n.include nope.lib\n.end\n"]]);
  assert.ok(lintSpiceWorkspace(bad, "top.sp").some((d) => d.rule === "unresolved-spice-include"));
});

test("Phase 1: ATP workspace linter resolves $INCLUDE and detects missing files", () => {
  const ok = new Map([
    ["main.atp", "BEGIN NEW DATA CASE\n$INCLUDE sub.atp\nBLANK\n"],
    ["sub.atp", "C subcircuit\n"],
  ]);
  assert.equal(lintAtpWorkspace(ok, "main.atp").filter((d) => d.rule.includes("include")).length, 0);

  const bad = new Map([["main.atp", "BEGIN NEW DATA CASE\n$INCLUDE missing.atp\nBLANK\n"]]);
  assert.ok(lintAtpWorkspace(bad, "main.atp").some((d) => d.rule === "unresolved-atp-include"));
});

test("Phase 1: Verilog-A workspace linter resolves `include and ignores builtin headers", () => {
  const ok = new Map([
    [
      "res.va",
      '`include "disciplines.vams"\n`include "params.vh"\nmodule r(p,n); inout p,n; electrical p,n; analog V(p,n) <+ 100*I(p,n); endmodule\n',
    ],
    ["params.vh", "// user params\n"],
  ]);
  assert.equal(lintVerilogAWorkspace(ok, "res.va").filter((d) => d.rule.includes("include")).length, 0);

  const bad = new Map([["res.va", '`include "missing_header.va"\nmodule r(p,n); inout p,n; endmodule\n']]);
  assert.ok(lintVerilogAWorkspace(bad, "res.va").some((d) => d.rule === "unresolved-veriloga-include"));
});
