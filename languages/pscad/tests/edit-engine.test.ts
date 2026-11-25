// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { planPscadEdits, splicesToTextEdits } from "../src/edit/edit-engine.js";
import { buildProjectModel } from "../src/model/pscad-model.js";

const EOL = "\r\r\n";
const sample = [
  '<project name="T" version="5.0.2" schema="" Target="EMTDC">',
  "  <definitions>",
  '    <Definition classid="UserCmpDefn" name="Main" id="1">',
  '      <schematic classid="UserCanvas">',
  '        <Wire classid="WireOrthogonal" id="10" name="" x="100" y="50" w="64" h="10" orient="0" disable="false">',
  '          <vertex x="0" y="0" />',
  '          <vertex x="54" y="0" />',
  "        </Wire>",
  '        <User classid="UserCmp" id="20" name="master:resistor" x="100" y="50" w="60" h="40" z="1" orient="0" defn="master:resistor" link="-1" q="4" disable="false">',
  '          <paramlist link="-1" name="" crc="1">',
  '            <param name="R" value="1.0 [ohm]" />',
  "          </paramlist>",
  "        </User>",
  "      </schematic>",
  "    </Definition>",
  "  </definitions>",
  "</project>",
].join(EOL);

describe("pscad edit engine", () => {
  it("moves a component and changes a parameter with minimal splices", () => {
    const r = planPscadEdits(
      sample,
      [
        { type: "moveComponent", id: "20", x: 200, y: 90, orient: 1 },
        { type: "setParameter", id: "20", name: "R", value: "5.0 [ohm]" },
      ],
      undefined,
    );
    assert.deepEqual(r.errors, []);
    const m = buildProjectModel(r.text);
    assert.equal(m.errors.length, 0);
    const inst = m.definitions.get("Main")!.instances[0]!;
    assert.deepEqual([inst.x, inst.y, inst.orient], [200, 90, 1]);
    assert.equal(inst.params.get("R"), "5.0 [ohm]");
    assert.ok(r.text.includes(EOL), "line endings preserved");
    assert.equal(r.text.replace(/200|90|orient="1"|5\.0/g, "").length < sample.length + 40, true);
  });

  it("adds and removes components and wires", () => {
    const added = planPscadEdits(
      sample,
      [
        { type: "addComponent", defn: "master:capacitor", x: 300, y: 50, params: { C: "1.0 [uF]" } },
        {
          type: "addWire",
          points: [
            { x: 160, y: 50 },
            { x: 160, y: 90 },
            { x: 300, y: 90 },
          ],
        },
      ],
      undefined,
    );
    assert.deepEqual(added.errors, []);
    assert.equal(added.createdIds.length, 2);
    const m = buildProjectModel(added.text);
    assert.equal(m.errors.length, 0);
    const def = m.definitions.get("Main")!;
    assert.equal(def.instances.length, 2);
    assert.equal(def.wires.length, 2);
    const w = def.wires.find((x) => x.id === added.createdIds[1])!;
    assert.deepEqual(w.vertices, [
      { x: 160, y: 50 },
      { x: 160, y: 90 },
      { x: 300, y: 90 },
    ]);

    const removed = planPscadEdits(
      added.text,
      [
        { type: "removeComponent", id: "20" },
        { type: "removeWire", id: "10" },
      ],
      undefined,
    );
    const m2 = buildProjectModel(removed.text);
    assert.equal(m2.errors.length, 0);
    assert.equal(m2.definitions.get("Main")!.instances.length, 1);
    assert.equal(m2.definitions.get("Main")!.wires.length, 1);
  });

  it("rewrites wire points in the wire-relative frame", () => {
    const r = planPscadEdits(
      sample,
      [
        {
          type: "setWirePoints",
          id: "10",
          points: [
            { x: 100, y: 50 },
            { x: 100, y: 80 },
            { x: 180, y: 80 },
          ],
        },
      ],
      undefined,
    );
    assert.deepEqual(r.errors, []);
    const m = buildProjectModel(r.text);
    assert.equal(m.errors.length, 0);
    assert.deepEqual(m.definitions.get("Main")!.wires[0]!.vertices, [
      { x: 100, y: 50 },
      { x: 100, y: 80 },
      { x: 180, y: 80 },
    ]);
  });

  it("converts splices to LSP text edits", () => {
    const r = planPscadEdits(sample, [{ type: "moveComponent", id: "20", x: 1, y: 2 }], undefined);
    const edits = splicesToTextEdits(sample, r.splices);
    assert.ok(edits.length >= 2);
    assert.ok(edits.every((e) => e.range.start.line >= 0));
  });

  const corpus = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.cache/pscad-corpus");
  const demo = existsSync(corpus) ? findFile(corpus, "DC_EMT_demo.pscx") : undefined;
  it("edits a real project without disturbing other bytes", { skip: !demo }, () => {
    const text = readFileSync(demo!, "utf8");
    const m = buildProjectModel(text);
    const inst = m.definitions.get("Main")!.instances.find((i) => i.defn.startsWith("master:") && i.params.size > 0)!;
    const key = [...inst.params.keys()][0]!;
    const r = planPscadEdits(
      text,
      [
        { type: "moveComponent", id: inst.id, x: inst.x + 18, y: inst.y },
        { type: "setParameter", id: inst.id, name: key, value: "42" },
      ],
      undefined,
    );
    assert.deepEqual(r.errors, []);
    const after = buildProjectModel(r.text);
    assert.equal(after.errors.length, 0);
    const moved = after.definitions.get("Main")!.instances.find((i) => i.id === inst.id)!;
    assert.equal(moved.x, inst.x + 18);
    assert.equal(moved.params.get(key), "42");
    // Only the touched values differ: same line count, same length delta bounded.
    assert.equal(r.text.split("\n").length, text.split("\n").length);
    assert.ok(Math.abs(r.text.length - text.length) < 40);
    // Everything outside the splices is untouched.
    const total = r.splices.reduce((n, s) => n + (s.end - s.start), 0);
    assert.ok(total < 100);
  });
});

function findFile(dir: string, name: string): string | undefined {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const f = findFile(p, name);
      if (f) return f;
    } else if (e.name === name) return p;
  }
  return undefined;
}

import { planDiagramActions } from "../src/edit/diagram-actions.js";
import { parsePscx } from "../src/parser/pscx-parser.js";

describe("pscad diagram actions (corpus)", () => {
  const corpus = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.cache/pscad-corpus");
  const demo = existsSync(corpus) ? findFile(corpus, "DC_EMT_demo.pscx") : undefined;
  it("keeps wires attached and orthogonal when a component moves", { skip: !demo }, () => {
    const text = readFileSync(demo!, "utf8");
    const before = parsePscx(text).rootModule;
    const cmp = before.components.find(
      (c) =>
        c.definitionName === "master:pgb" &&
        before.wires.some((w) => w.connectedPortIds.some((p) => c.ports.some((q) => q.id === p))),
    );
    assert.ok(cmp, "fixture component");
    const planned = planDiagramActions(text, [
      {
        type: "move",
        items: [{ name: "cmp_" + cmp.id, x: cmp.position.x + 36 - 20, y: cmp.position.y - 20, width: 40, height: 40 }],
      },
    ]);
    assert.deepEqual(planned.unresolved, []);
    assert.ok(planned.edits.length >= 1);
    // Apply LSP edits back to text.
    const lines = text.split("\n");
    const off = (p: { line: number; character: number }) =>
      lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
    let out = text;
    for (const e of [...planned.edits].sort((a, b) => off(b.range.start) - off(a.range.start))) {
      out = out.slice(0, off(e.range.start)) + e.newText + out.slice(off(e.range.end));
    }
    const after = parsePscx(out).rootModule;
    const moved = after.components.find((c) => c.id === cmp.id)!;
    assert.equal(moved.position.x, cmp.position.x + 36);
    for (const w of after.wires) {
      for (let k = 1; k < w.vertices.length; k++) {
        const a = w.vertices[k - 1]!;
        const b = w.vertices[k]!;
        const wasDiagonal = before.wires
          .find((x) => x.id === w.id)
          ?.vertices.some((v, i, arr) => i > 0 && v.x !== arr[i - 1]!.x && v.y !== arr[i - 1]!.y);
        if (!wasDiagonal) assert.ok(a.x === b.x || a.y === b.y, "segment stays axis-aligned");
      }
    }
    const attached = (m: typeof before) => m.wires.filter((w) => w.startPortId || w.endPortId).length;
    assert.ok(attached(after) >= attached(before), "attachment preserved");
  });

  it("stretches 2-point wire with orthogonal dogleg when component moves diagonally", () => {
    const planned = planDiagramActions(sample, [
      {
        type: "move",
        items: [{ name: "cmp_20", x: 136, y: 86, width: 60, height: 40 }],
      },
    ]);
    assert.deepEqual(planned.unresolved, []);
    assert.ok(planned.edits.length >= 1);
    // Applying edits gives an orthogonal wire
    const lines = sample.split("\n");
    const off = (p: { line: number; character: number }) =>
      lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
    let out = sample;
    for (const e of [...planned.edits].sort((a, b) => off(b.range.start) - off(a.range.start))) {
      out = out.slice(0, off(e.range.start)) + e.newText + out.slice(off(e.range.end));
    }
    const after = parsePscx(out).rootModule;
    assert.equal(after.wires.length, 1);
    const w = after.wires[0]!;
    assert.ok(w.vertices.length >= 2);
    for (let k = 1; k < w.vertices.length; k++) {
      const a = w.vertices[k - 1]!;
      const b = w.vertices[k]!;
      assert.ok(a.x === b.x || a.y === b.y, `segment ${k} must be axis-aligned: (${a.x},${a.y}) -> (${b.x},${b.y})`);
    }
  });
});

function applyTextEdits(
  text: string,
  edits: {
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    newText: string;
  }[],
): string {
  const lines = text.split("\n");
  const off = (p: { line: number; character: number }) =>
    lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
  let out = text;
  for (const e of [...edits].sort((a, b) => off(b.range.start) - off(a.range.start))) {
    out = out.slice(0, off(e.range.start)) + e.newText + out.slice(off(e.range.end));
  }
  return out;
}

describe("pscad diagram actions (delete, reconnect, id-less wires, buses)", () => {
  const rlSwitchingPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../examples/01-rl-switching-circuit/rl_switching.pscx",
  );
  const rlText = readFileSync(rlSwitchingPath, "utf8");

  it("removes attached id-less wires when deleting a component and reconnects cleanly", () => {
    const before = parsePscx(rlText).rootModule;
    assert.equal(before.wires.length, 5);

    // 1. Delete MainBreaker (BRK1) — should remove BRK1 and its two attached id-less wires
    const delPlan = planDiagramActions(rlText, [{ type: "deleteComponents", names: ["MainBreaker"] }]);
    assert.deepEqual(delPlan.unresolved, []);
    const afterDeleteText = applyTextEdits(rlText, delPlan.edits);
    const afterDelete = parsePscx(afterDeleteText).rootModule;
    assert.equal(
      afterDelete.components.find((c) => c.id === "BRK1"),
      undefined,
    );
    assert.equal(afterDelete.wires.length, 3, "only the 3 unrelated wires remain");
    assert.equal(
      afterDelete.wires.filter((w) => !w.startPortId || !w.endPortId).length,
      0,
      "no orphaned/floating wires remain",
    );

    // 2. Reconnect Bus_Source right port (B1.B1_out) directly to Load_R left port (R1.R1_in)
    const connPlan = planDiagramActions(afterDeleteText, [
      { type: "connect", source: "B1.B1_out", target: "R1.R1_in" },
    ]);
    assert.deepEqual(connPlan.unresolved, []);
    const afterConnText = applyTextEdits(afterDeleteText, connPlan.edits);
    const afterConn = parsePscx(afterConnText).rootModule;
    assert.equal(afterConn.wires.length, 4, "exactly one new wire was added");
    const newWire = afterConn.wires[afterConn.wires.length - 1]!;
    assert.deepEqual(newWire.vertices[0], { x: 180, y: 160 }, "starts at Bus_Source right port (B1_out)");
    assert.deepEqual(newWire.vertices[newWire.vertices.length - 1], { x: 320, y: 160 }, "ends at Load_R left port");
  });

  it("ignores connectedOnly neighbors and preserves Bus centerline Y on move", () => {
    // Moving SRC1 down by 24px with Bus_Source included as connectedOnly: true (matching X6 node:moved)
    const movePlan = planDiagramActions(rlText, [
      {
        type: "move",
        items: [
          { name: "SRC1", x: 56, y: 164, width: 48, height: 40, rotation: 0 } as never,
          { name: "Bus_Source", x: 140, y: 153, width: 40, height: 14, rotation: 0, connectedOnly: true } as never,
        ],
      },
    ]);
    assert.deepEqual(movePlan.unresolved, []);
    const out = applyTextEdits(rlText, movePlan.edits);
    const afterModel = buildProjectModel(out);
    assert.equal(afterModel.errors.length, 0, "edited XML must remain well-formed");
    const after = parsePscx(out).rootModule;
    const bus = after.buses.find((b) => b.id === "B1")!;
    assert.equal(bus.position.y, 160, "unmoved Bus_Source must not drift upward");
    const w1 = after.wires[0]!;
    assert.equal(w1.startPortId, "SRC1_out", "wire 1 stays attached to moved SRC1");
    assert.equal(w1.endPortId, "B1", "wire 1 stays attached to Bus_Source");
  });

  it("moves Bus_Source using centerline Y and stretches its attached wires", () => {
    // Visual top-left y = 173 with height = 14 => centerline y = 180 (moved down by +20px)
    const moveBusPlan = planDiagramActions(rlText, [
      {
        type: "move",
        items: [{ name: "B1", x: 140, y: 173, width: 40, height: 14 }],
      },
    ]);
    assert.deepEqual(moveBusPlan.unresolved, []);
    const out = applyTextEdits(rlText, moveBusPlan.edits);
    const after = parsePscx(out).rootModule;
    const bus = after.buses.find((b) => b.id === "B1")!;
    assert.equal(bus.position.x, 140);
    assert.equal(bus.position.y, 180);
    assert.equal(after.wires[0]!.endPortId, "B1", "wire 1 stays attached to moved Bus_Source");
    assert.equal(after.wires[1]!.startPortId, "B1", "wire 2 stays attached to moved Bus_Source");
  });

  it("disconnects only the targeted wire in a multi-wire net", () => {
    const discPlan = planDiagramActions(rlText, [{ type: "disconnect", source: "B1.B1_out", target: "BRK1.BRK1_in" }]);
    assert.deepEqual(discPlan.unresolved, []);
    const out = applyTextEdits(rlText, discPlan.edits);
    const after = parsePscx(out).rootModule;
    assert.equal(after.wires.length, 4);
    assert.ok(
      after.wires.some((w) => w.startPortId === "SRC1_out" && w.endPortId === "B1"),
      "SRC1 -> B1 wire must remain intact",
    );
    assert.ok(
      !after.wires.some((w) => w.startPortId === "B1" && w.endPortId === "BRK1_in"),
      "B1 -> BRK1 wire must be removed",
    );
  });
});
