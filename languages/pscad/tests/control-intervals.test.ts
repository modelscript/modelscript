// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeControlIntervals, isBounded } from "../src/analysis/control-intervals.js";
import { lintPscx } from "../src/lints/index.js";
import { parsePscx } from "../src/parser/pscx-parser.js";
import type { EmtControlBlock } from "../src/types.js";

const blk = (
  id: string,
  kind: EmtControlBlock["kind"],
  inputs: string[] = [],
  params: Record<string, number> = {},
): EmtControlBlock => ({ id, kind, inputs, params });

describe("control interval analysis", () => {
  it("propagates constants exactly through gain, sum signs and mult", () => {
    const r = analyzeControlIntervals([
      blk("a", "const", [], { value: 2 }),
      blk("b", "const", [], { value: 5 }),
      blk("g", "gain", ["a"], { K: -3 }),
      blk("s", "sum", ["a", "b"], { s2: -1 }),
      blk("m", "mult", ["a", "b"]),
    ]);
    assert.deepEqual(r.get("g"), { lo: -6, hi: -6 });
    assert.deepEqual(r.get("s"), { lo: -3, hi: -3 });
    assert.deepEqual(r.get("m"), { lo: 10, hi: 10 });
  });

  it("clamps through a limiter and bounds a clamped integrator", () => {
    const r = analyzeControlIntervals([
      blk("c", "const", [], { value: 5 }),
      blk("l", "limit", ["c"], { min: -1, max: 2 }),
      blk("i", "integral", ["c"], { min: 0, max: 10 }),
    ]);
    assert.deepEqual(r.get("l"), { lo: 2, hi: 2 });
    assert.deepEqual(r.get("i"), { lo: 0, hi: 10 });
  });

  it("makes no finite claim for unbounded or unknown blocks (sound over-approximation)", () => {
    const r = analyzeControlIntervals([
      blk("v", "sensor_v"),
      blk("g", "gain", ["v"], { K: 2 }),
      blk("i", "integral", ["g"]),
      blk("zero", "gain", ["v"], { K: 0 }),
    ]);
    assert.ok(!isBounded(r.get("v")!));
    assert.ok(!isBounded(r.get("g")!));
    assert.ok(!isBounded(r.get("i")!));
    assert.deepEqual(r.get("zero"), { lo: 0, hi: 0 });
  });

  it("terminates on feedback loops by widening", () => {
    const r = analyzeControlIntervals([
      blk("one", "const", [], { value: 1 }),
      blk("acc", "sum", ["one", "d"]),
      blk("d", "lag", ["acc"]),
    ]);
    assert.ok(!isBounded(r.get("acc")!));
  });
});

describe("M6015 limiter-permanently-saturated", () => {
  const project = (body: string): string =>
    `<project name="t" version="5.0.0"><definitions>
     <Definition classid="UserCmpDefn" name="Main" id="1"><schematic classid="UserCanvas">${body}</schematic></Definition>
   </definitions></project>`;
  const cmp = (id: number, defn: string, name: string, params: string): string =>
    `<User classid="UserCmp" name="master:${defn}" defn="master:${defn}" id="${id}" x="${id * 100}" y="0" w="40" h="20" orient="0">
       <paramlist><param name="Name" value="${name}"/>${params}</paramlist>
     </User>`;
  const lint = (xml: string) => lintPscx(parsePscx(xml)).filter((d) => d.code === "M6015");

  it("flags a limiter fed by a constant outside its limits", () => {
    const xml = project(
      cmp(1, "const", "C", '<param name="value" value="5"/>') +
        cmp(
          2,
          "hardlimit",
          "L",
          '<param name="inputs" value="C"/><param name="min" value="-1"/><param name="max" value="2"/>',
        ),
    );
    const d = lint(xml);
    assert.equal(d.length, 1);
    assert.ok(d[0]!.message.includes("'L'") && d[0]!.message.includes("[5, 5]"), d[0]!.message);
  });

  it("does not flag when the input range overlaps the limits or is unbounded", () => {
    const inside = project(
      cmp(1, "const", "C", '<param name="value" value="1"/>') +
        cmp(
          2,
          "hardlimit",
          "L",
          '<param name="inputs" value="C"/><param name="min" value="-1"/><param name="max" value="2"/>',
        ),
    );
    assert.equal(lint(inside).length, 0);
    const unbounded = project(
      cmp(1, "integral", "I", '<param name="inputs" value=""/>') +
        cmp(
          2,
          "hardlimit",
          "L",
          '<param name="inputs" value="I"/><param name="min" value="-1"/><param name="max" value="2"/>',
        ),
    );
    assert.equal(lint(unbounded).length, 0);
  });
});
