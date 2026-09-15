// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decisionDiamondGlyph,
  forkJoinBarGlyph,
  pinPortGlyph,
  pseudostateFinalGlyph,
  pseudostateHistoryGlyph,
  pseudostateInitialGlyph,
  stickFigureActorGlyph,
} from "../src/glyphs.js";

describe("Shared Vector Glyphs Library", () => {
  it("should generate stick figure actor markup elements", () => {
    const glyph = stickFigureActorGlyph({ stroke: "#4a148c" });
    assert.ok(Array.isArray(glyph));
    assert.strictEqual(glyph.length, 6);

    const head = glyph.find((m) => m.selector === "actorHead");
    assert.ok(head);
    assert.strictEqual(head.tagName, "circle");
    assert.strictEqual(head.attrs?.stroke, "#4a148c");

    const spine = glyph.find((m) => m.selector === "actorSpine");
    assert.ok(spine);
    assert.strictEqual(spine.tagName, "line");

    const label = glyph.find((m) => m.selector === "label");
    assert.ok(label);
    assert.strictEqual(label.tagName, "text");
  });

  it("should generate decision diamond polygon markup", () => {
    const glyph = decisionDiamondGlyph({ fill: "#fff3e0", stroke: "#e65100" });
    assert.ok(Array.isArray(glyph));
    const poly = glyph.find((m) => m.selector === "body");
    assert.ok(poly);
    assert.strictEqual(poly.tagName, "polygon");
    assert.strictEqual(poly.attrs?.fill, "#fff3e0");
    assert.strictEqual(poly.attrs?.stroke, "#e65100");
  });

  it("should generate fork/join synchronization bar", () => {
    const hBar = forkJoinBarGlyph({ orientation: "horizontal", length: 80 });
    assert.strictEqual(hBar[0].attrs?.width, 80);
    assert.strictEqual(hBar[0].attrs?.height, 6);

    const vBar = forkJoinBarGlyph({ orientation: "vertical", length: 100, thickness: 8 });
    assert.strictEqual(vBar[0].attrs?.width, 8);
    assert.strictEqual(vBar[0].attrs?.height, 100);
  });

  it("should generate initial, final, and history pseudostates", () => {
    const init = pseudostateInitialGlyph({ r: 12 });
    assert.strictEqual(init[0].tagName, "circle");
    assert.strictEqual(init[0].attrs?.r, 12);

    const fin = pseudostateFinalGlyph({ outerR: 14, innerR: 8 });
    assert.strictEqual(fin.length, 2);
    assert.strictEqual(fin[0].selector, "outer");
    assert.strictEqual(fin[1].selector, "inner");

    const histDeep = pseudostateHistoryGlyph({ deep: true });
    const histLabel = histDeep.find((m) => m.selector === "label");
    assert.strictEqual(histLabel?.attrs?.text, "H*");
  });

  it("should generate pin port with standard and conjugated styling", () => {
    const normalPin = pinPortGlyph({ conjugated: false, size: 14 });
    assert.strictEqual(normalPin[0].attrs?.fill, "#ef6c00");

    const conjPin = pinPortGlyph({ conjugated: true, size: 14 });
    assert.strictEqual(conjPin[0].attrs?.fill, "#ffffff");
  });
});
