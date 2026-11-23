// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLustre } from "../src/index.js";

describe("@modelscript/lustre — Parser Suite", () => {
  it("parses const, type, node, function, var, let...tel, and -- / /* */ comments", () => {
    const src = `
-- Global constants and type aliases
const
  DT: real = 0.01;
  LIMIT: int = 10;

type
  Signal = real;

/* Stateless helper function */
function Clamp(x, lo, hi: real) returns (y: real);
let
  y = if x < lo then lo else if x > hi then hi else x;
tel

(* Stateful synchronous node *)
node Counter(reset: bool) returns (n: int);
var
  next_n: int;
let
  next_n = 0 -> pre(n) + 1;
  n = if reset then 0 else next_n;
  assert n >= 0;
tel
`;
    const prog = parseLustre(src);
    assert.strictEqual(prog.syntaxErrors.length, 0);
    assert.strictEqual(prog.consts.length, 2);
    assert.strictEqual(prog.consts[0]!.name, "DT");
    assert.strictEqual(prog.types.length, 1);
    assert.strictEqual(prog.types[0]!.name, "Signal");
    assert.strictEqual(prog.nodes.length, 2);
    assert.strictEqual(prog.nodes[0]!.kind, "function");
    assert.strictEqual(prog.nodes[0]!.name, "Clamp");
    assert.strictEqual(prog.nodes[1]!.kind, "node");
    assert.strictEqual(prog.nodes[1]!.name, "Counter");
    assert.strictEqual(prog.nodes[1]!.locals.length, 1);
    assert.strictEqual(prog.nodes[1]!.equations.length, 2);
    assert.strictEqual(prog.nodes[1]!.assertions.length, 1);
  });

  it("parses temporal and clock operators ->, pre, when, current, merge, and boolean/arithmetic ops", () => {
    const src = `
node ClockedMux(x, y: int; c: bool) returns (z: int; flag: bool);
var
  xs: int when c;
  ys: int when not c;
  held: int;
let
  xs = x when c;
  ys = y when not c;
  held = current(xs);
  z = merge c (xs) (ys);
  flag = (x mod 2 = 0) and (not (y div 2 <> 0) or (c xor false));
tel
`;
    const prog = parseLustre(src);
    assert.strictEqual(prog.syntaxErrors.length, 0);
    const node = prog.nodes[0]!;
    assert.strictEqual(node.locals[0]!.clock.kind, "on");
    if (node.locals[0]!.clock.kind === "on") {
      assert.strictEqual(node.locals[0]!.clock.clockVar, "c");
      assert.strictEqual(node.locals[0]!.clock.negated, false);
    }
    assert.strictEqual(node.locals[1]!.clock.kind, "on");
    if (node.locals[1]!.clock.kind === "on") {
      assert.strictEqual(node.locals[1]!.clock.negated, true);
    }
    assert.strictEqual(node.equations[2]!.rhs.kind, "unary");
    assert.strictEqual(node.equations[3]!.rhs.kind, "merge");
  });

  it("enforces right-associativity of -> and correct operator precedence", () => {
    const src = `
node Prec(a, b, c: int) returns (y: int);
let
  y = a -> b -> c + 1 * 2;
tel
`;
    const prog = parseLustre(src);
    assert.strictEqual(prog.syntaxErrors.length, 0);
    const rhs = prog.nodes[0]!.equations[0]!.rhs;
    assert.strictEqual(rhs.kind, "binary");
    if (rhs.kind === "binary") {
      assert.strictEqual(rhs.op, "->");
      assert.strictEqual(rhs.left.kind, "var");
      assert.strictEqual(rhs.right.kind, "binary");
      if (rhs.right.kind === "binary") {
        assert.strictEqual(rhs.right.op, "->");
      }
    }
  });

  it("recovers gracefully and records syntaxErrors on malformed input", () => {
    const bad = `node Broken(x: int) returns (y: int); let y = ; tel`;
    const prog = parseLustre(bad);
    assert.ok(prog.syntaxErrors.length > 0, "Expected syntax error on missing RHS expression");
  });
});
