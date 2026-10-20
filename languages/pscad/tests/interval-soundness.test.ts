// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CsmfControlGraph, type CsmfBlockConfig } from "../../../packages/simulate/src/solvers/emt/index.js";
import { analyzeControlIntervals } from "../src/analysis/control-intervals.js";
import type { EmtControlBlock } from "../src/types.js";

/** Deterministic PRNG so failures reproduce. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const KINDS: EmtControlBlock["kind"][] = [
  "const",
  "gain",
  "sum",
  "mult",
  "square",
  "limit",
  "pi",
  "integral",
  "trans_filt",
  "ratelimit",
  "select",
  "maxmin",
  "fp_int",
  "trig",
  "angle_resolver",
  "logic",
  "compar",
  "compare",
  "range",
  "upramp",
  "xy_table",
  "sensor_v",
  "rms3ph",
  "time_sig",
];

function randomBlocks(rand: () => number, n: number): EmtControlBlock[] {
  const u = (lo: number, hi: number): number => lo + (hi - lo) * rand();
  const blocks: EmtControlBlock[] = [];
  for (let i = 0; i < n; i++) {
    const kind = i < 2 ? "const" : KINDS[Math.floor(rand() * KINDS.length)]!;
    const pick = (): string => blocks[Math.floor(rand() * blocks.length)]!.id;
    const arity =
      kind === "const" || kind === "sensor_v" || kind === "time_sig"
        ? 0
        : kind === "rms3ph"
          ? 3
          : 1 + Math.floor(rand() * 3);
    const inputs = i === 0 ? [] : Array.from({ length: arity }, pick);
    const params: Record<string, number> = {};
    switch (kind) {
      case "const":
        params["value"] = u(-10, 10);
        break;
      case "gain":
        params["K"] = u(-4, 4);
        break;
      case "sum":
        params["s1"] = rand() < 0.5 ? 1 : -1;
        params["s2"] = rand() < 0.5 ? 1 : -1;
        params["s3"] = rand() < 0.5 ? 1 : -1;
        break;
      case "limit":
      case "pi":
      case "integral":
        if (rand() < 0.8) {
          params["min"] = u(-5, 0);
          params["max"] = u(0, 5);
        }
        params["K"] = u(0.1, 3);
        params["Kp"] = u(0.1, 3);
        params["Ti"] = u(0.05, 1);
        break;
      case "ratelimit":
        params["IR"] = u(1, 50);
        params["DR"] = u(1, 50);
        break;
      case "compar":
        params["high"] = u(0, 5);
        params["low"] = u(-5, 0);
        break;
      case "compare":
        params["X"] = u(-3, 3);
        params["OL"] = u(-2, 0);
        params["OH"] = u(0, 2);
        break;
      case "range":
        params["XL"] = u(-3, 0);
        params["XU"] = u(0, 3);
        params["OL"] = u(-2, 2);
        params["OM"] = u(-2, 2);
        params["OH"] = u(-2, 2);
        break;
      case "upramp":
        params["X1"] = u(-1, 0);
        params["X2"] = u(0.5, 2);
        params["Y2"] = u(0.5, 5);
        break;
      case "xy_table":
        params["N"] = 3;
        for (let k = 1; k <= 3; k++) {
          params[`X${k}`] = k;
          params[`Y${k}`] = u(-5, 5);
        }
        params["Ky"] = u(-2, 2);
        params["Yoff"] = u(-1, 1);
        break;
      case "maxmin":
        params["Type"] = rand() < 0.5 ? 1 : 2;
        break;
      default:
        break;
    }
    blocks.push({ id: `b${i}`, kind, inputs, params });
  }
  return blocks;
}

function check(blocks: EmtControlBlock[], steps: number, seed: number): void {
  const intervals = analyzeControlIntervals(blocks);
  const configs: CsmfBlockConfig[] = blocks.map((b) => ({
    id: b.id,
    kind: b.kind as CsmfBlockConfig["kind"],
    inputs: b.inputs,
    params: b.params,
  }));
  const g = new CsmfControlGraph(configs, 1e-3);
  const noise = rng(seed ^ 0x9e3779b9);
  for (let s = 0; s < steps; s++) {
    g.step(
      () => (noise() - 0.5) * 2000,
      () => (noise() - 0.5) * 2000,
    );
    for (const b of blocks) {
      const iv = intervals.get(b.id);
      const y = g.getOutput(b.id);
      if (iv === undefined || !Number.isFinite(y)) continue;
      const tol = 1e-9 * Math.max(1, Math.abs(y));
      assert.ok(
        y >= iv.lo - tol && y <= iv.hi + tol,
        `seed ${seed} step ${s}: ${b.id} (${b.kind}) output ${y} escaped [${iv.lo}, ${iv.hi}]`,
      );
    }
  }
}

describe("interval analysis is sound against the CSMF runtime", () => {
  it("encloses every block output over 300 random acyclic graphs", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = rng(seed);
      check(randomBlocks(rand, 4 + Math.floor(rand() * 10)), 60, seed);
    }
  });

  it("encloses a clamped integrator feedback loop", () => {
    const blocks: EmtControlBlock[] = [
      { id: "ref", kind: "const", inputs: [], params: { value: 3 } },
      { id: "err", kind: "sum", inputs: ["ref", "int"], params: { s2: -1 } },
      { id: "int", kind: "integral", inputs: ["err"], params: { K: 5, min: -2, max: 4 } },
    ];
    check(blocks, 400, 7);
  });
});
