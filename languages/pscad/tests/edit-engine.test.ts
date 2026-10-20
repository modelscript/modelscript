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
    assert.ok(attached(after) >= attached(before) - 1, "attachment preserved");
  });
});
