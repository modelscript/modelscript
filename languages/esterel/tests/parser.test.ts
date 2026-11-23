// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEsterel } from "../src/parser/index.js";

describe("Esterel Parser", () => {
  it("parses Berry's classic ABRO module with comments and parallel composition", () => {
    const src = `
      % Classic Berry ABRO module
      %{ Multi-line Esterel comment }%
      module ABRO:
      input A, B, R;
      output O;
      loop
        [ await A || await B ];
        emit O
      each R
      end module
    `;
    const prog = parseEsterel(src);
    assert.strictEqual(prog.errors.length, 0);
    assert.strictEqual(prog.modules.length, 1);
    const mod = prog.modules[0]!;
    assert.strictEqual(mod.name, "ABRO");
    assert.strictEqual(mod.signals.length, 4);
    assert.strictEqual(mod.body.kind, "loop");
    assert.ok(mod.body.eachExpr);
    assert.strictEqual(mod.body.body.kind, "seq");
    assert.strictEqual(mod.body.body.statements[0]?.kind, "par");
    assert.strictEqual(mod.body.body.statements[1]?.kind, "emit");
  });

  it("parses all interface declarations: input, output, inputoutput, sensor, relation", () => {
    const src = `
      module Interfaces:
      input A, B;
      output O : integer;
      inputoutput IO;
      sensor TEMP : real;
      relation A # B, A => IO;
      nothing
      end module
    `;
    const prog = parseEsterel(src);
    assert.strictEqual(prog.errors.length, 0);
    const mod = prog.modules[0]!;
    assert.strictEqual(mod.signals.length, 5);
    assert.strictEqual(mod.signals[2]?.valueType, "integer");
    assert.strictEqual(mod.signals[3]?.direction, "inputoutput");
    assert.strictEqual(mod.signals[4]?.direction, "sensor");
    assert.strictEqual(mod.relations.length, 2);
    assert.strictEqual(mod.relations[0]?.kind, "exclusion");
    assert.deepStrictEqual(mod.relations[0]?.signals, ["A", "B"]);
    assert.strictEqual(mod.relations[1]?.kind, "implication");
    assert.deepStrictEqual(mod.relations[1]?.signals, ["A", "IO"]);
  });

  it("parses local signals, present, await immediate, every, abort, weak abort, suspend, trap/exit, sustain, run", () => {
    const src = `
      module Sub:
      input X;
      output Y;
      await immediate X;
      emit Y
      end module

      module FullSyntax:
      input A, B, R, S, K;
      output O, W;
      signal L in
        trap T1, T2 in
          weak abort
            suspend
              every immediate A do
                present B and not R then
                  emit L;
                  sustain O
                else
                  pause;
                  run Sub [ signal A / X, O / Y ];
                  exit T1
                end
              end
            when S end
          when K do
            emit W
          end
        handle T1 do
          nothing
        end
      end
      end module
    `;
    const prog = parseEsterel(src);
    assert.strictEqual(prog.errors.length, 0, JSON.stringify(prog.errors));
    assert.strictEqual(prog.modules.length, 2);
    const full = prog.modules[1]!;
    assert.strictEqual(full.name, "FullSyntax");
    assert.strictEqual(full.body.kind, "signal");
    assert.strictEqual(full.body.body.kind, "trap");
    assert.deepStrictEqual(full.body.body.traps, ["T1", "T2"]);
    assert.strictEqual(full.body.body.handlers.length, 1);
  });

  it("recovers gracefully and records syntax errors on malformed input", () => {
    const src = `
      module Broken:
      input A;
      present A then
        emit A
      % missing end for present and module
    `;
    const prog = parseEsterel(src);
    assert.ok(prog.errors.length > 0);
  });
});
