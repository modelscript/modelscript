// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractEmtNetlist } from "../src/netlist/emt-netlist.js";
import { parsePscx } from "../src/parser/pscx-parser.js";

const constCmp = (id: number, name: string, y: number): string =>
  `<User classid="UserCmp" name="master:const" defn="master:const" id="${id}" x="0" y="${y}" w="40" h="20" orient="0">
     <paramlist><param name="Name" value="${name}" /></paramlist>
   </User>`;

const wire = (id: number, y: number): string =>
  `<Wire classid="WireOrthogonal" id="${id}" x="18" y="${y}" w="74" h="10" orient="0">
     <vertex x="0" y="0" /><vertex x="64" y="0" />
   </Wire>`;

/** Three scalar constants feed a datamerge; its input pins are named bottom-to-top on purpose. */
const xml = `<project name="dm" version="5.0.2"><definitions>
  <Definition classid="UserCmpDefn" name="Main" id="1"><schematic classid="UserCanvas">
    ${constCmp(11, "top", 0)}${constCmp(12, "mid", 100)}${constCmp(13, "bot", 200)}
    <User classid="UserCmp" name="master:datamerge" defn="master:datamerge" id="20" x="100" y="0" w="40" h="60" orient="0">
      <paramlist><param name="Name" value="dm" /><param name="N" value="3" /></paramlist>
      <port name="in3" pos="-18,0" kind="signal" dim="1" />
      <port name="in2" pos="-18,100" kind="signal" dim="1" />
      <port name="in1" pos="-18,200" kind="signal" dim="1" />
      <port name="out" pos="40,0" kind="signal" dim="1" />
    </User>
    ${wire(31, 0)}${wire(32, 100)}${wire(33, 200)}
  </schematic></Definition>
</definitions></project>`;

describe("datamerge netlist lowering", () => {
  const net = extractEmtNetlist(parsePscx(xml));
  const blocks = new Map((net.controlBlocks ?? []).map((b) => [b.id, b]));

  it("emits one pass-through block per phase", () => {
    for (const s of ["A", "B", "C"]) {
      const b = blocks.get(`dm_phase${s}`);
      assert.ok(b, `dm_phase${s} missing`);
      assert.equal(b!.kind, "sum");
      assert.equal(b!.inputs.length, 1);
    }
  });

  it("orders the inputs top to bottom by port position", () => {
    assert.deepEqual(
      ["A", "B", "C"].map((s) => blocks.get(`dm_phase${s}`)!.inputs[0]),
      ["top", "mid", "bot"],
    );
  });
});
