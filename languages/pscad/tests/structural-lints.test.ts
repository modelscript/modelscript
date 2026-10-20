// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintPscx } from "../src/lints/index.js";
import { parsePscx } from "../src/parser/pscx-parser.js";

const project = (body: string): string =>
  `<project name="t" version="5.0.0"><param name="time_step" value="20.0"/><definitions>
   <Definition classid="UserCmpDefn" name="Main" id="1"><schematic classid="UserCanvas">${body}</schematic></Definition>
 </definitions></project>`;

const block = (id: number, defn: string, name: string, inputs: string): string =>
  `<User classid="UserCmp" name="master:${defn}" defn="master:${defn}" id="${id}" x="${id * 100}" y="0" w="40" h="20" orient="0">
     <paramlist><param name="Name" value="${name}"/><param name="inputs" value="${inputs}"/></paramlist>
   </User>`;

const lint = (xml: string, code: string) => lintPscx(parsePscx(xml)).filter((d) => d.code === code);

describe("M6012 csmf-algebraic-loop", () => {
  it("flags a gain -> sum -> gain feedback cycle with no state and lists the blocks", () => {
    const xml = project(block(1, "unity", "G1", "S1") + block(2, "sumjct", "S1", "G2") + block(3, "unity", "G2", "G1"));
    const diags = lint(xml, "M6012");
    assert.equal(diags.length, 1);
    for (const n of ["G1", "S1", "G2"]) assert.ok(diags[0]!.message.includes(`'${n}'`), diags[0]!.message);
  });

  it("flags a self loop", () => {
    const diags = lint(project(block(1, "unity", "G1", "G1")), "M6012");
    assert.equal(diags.length, 1);
  });

  it("is cleared by a stateful integral block inside the loop", () => {
    const xml = project(
      block(1, "unity", "G1", "S1") + block(2, "sumjct", "S1", "I1") + block(3, "integral", "I1", "G1"),
    );
    assert.equal(lint(xml, "M6012").length, 0);
  });

  it("does not flag an acyclic chain", () => {
    const xml = project(block(1, "unity", "G1", "") + block(2, "sumjct", "S1", "G1") + block(3, "unity", "G2", "S1"));
    assert.equal(lint(xml, "M6012").length, 0);
  });
});

describe("M6013 parallel-ideal-sources", () => {
  const source = (id: number, name: string, extra = ""): string =>
    `<User classid="UserCmp" defn="source_3p" id="${id}" x="100" y="200" orient="0">
       <param name="Name" value="${name}"/><param name="V" value="16.5"/>${extra}
       <port name="out" pos="[20, 0]"/>
     </User>`;
  // Port connectivity is geometric: a wire must touch the source port and the bus origin.
  const bus = `<Bus name="Bus1" id="B1" x="120" y="200" length="60" vbase="16.5"/>
    <Wire><vertex x="120" y="200"/><vertex x="160" y="200"/></Wire>`;

  const zeroR = `<param name="R" value="0"/>`;

  it("flags two explicit zero-impedance sources on the same bus as an error", () => {
    const xml = project(bus + source(1, "SrcA", zeroR) + source(2, "SrcB", zeroR));
    const diags = lint(xml, "M6013");
    assert.equal(diags.length, 1);
    assert.equal(diags[0]!.severity, "error");
    assert.ok(diags[0]!.message.includes("'SrcA'") && diags[0]!.message.includes("'SrcB'"));
    assert.equal(lint(xml, "M6014").length, 0);
  });

  it("warns (M6014) rather than errors when the impedance is merely unspecified", () => {
    const xml = project(bus + source(1, "SrcA") + source(2, "SrcB"));
    assert.equal(lint(xml, "M6013").length, 0);
    const diags = lint(xml, "M6014");
    assert.equal(diags.length, 1);
    assert.equal(diags[0]!.severity, "warning");
  });

  it("is cleared when one source has a non-zero series resistance", () => {
    const withR = `<param name="R" value="1.5"/>`;
    const xml = project(bus + source(1, "SrcA", zeroR) + source(2, "SrcB", withR));
    assert.equal(lint(xml, "M6013").length, 0);
    assert.equal(lint(xml, "M6014").length, 0);
  });

  it("is cleared when the sources are on different buses", () => {
    const other = `<Bus name="Bus2" id="B2" x="520" y="200" length="60" vbase="16.5"/>
      <Wire><vertex x="520" y="200"/><vertex x="560" y="200"/></Wire>`;
    const second = source(2, "SrcB").replace('x="100"', 'x="500"');
    assert.equal(lint(project(bus + other + source(1, "SrcA") + second), "M6013").length, 0);
  });
});
