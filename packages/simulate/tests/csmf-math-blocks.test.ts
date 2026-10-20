// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CsmfControlGraph } from "../src/solvers/emt/elements/csmf-controls.js";

const noSense = () => 0;

describe("CSMF math blocks", () => {
  it("square, inv and fp_int are memoryless", () => {
    const g = new CsmfControlGraph(
      [
        { id: "c", kind: "const", value: -2.6 },
        { id: "sq", kind: "square", inputs: ["c"] },
        { id: "iv", kind: "inv", inputs: ["c"] },
        { id: "fi", kind: "fp_int", inputs: ["c"] },
      ],
      1e-3,
    );
    g.step(noSense, noSense);
    assert.ok(Math.abs(g.getOutput("sq") - 6.76) < 1e-12);
    assert.ok(Math.abs(g.getOutput("iv") - 1 / -2.6) < 1e-12);
    assert.equal(g.getOutput("fi"), -2);
  });

  it("inv traps division by zero to the output limit", () => {
    const g = new CsmfControlGraph(
      [
        { id: "c", kind: "const", value: 0 },
        { id: "iv", kind: "inv", inputs: ["c"], maxOut: 500 },
      ],
      1e-3,
    );
    g.step(noSense, noSense);
    assert.equal(g.getOutput("iv"), 500);
  });

  it("integral of a constant ramps linearly (trapezoidal)", () => {
    const dt = 1e-3;
    const g = new CsmfControlGraph(
      [
        { id: "c", kind: "const", value: 2 },
        { id: "i", kind: "integral", inputs: ["c"] },
      ],
      dt,
    );
    for (let k = 0; k < 1000; k++) g.step(noSense, noSense);
    // First step sees uPrev = 0, so the trapezoid loses half a step: 2 * (1 - dt/2).
    assert.ok(Math.abs(g.getOutput("i") - 2 * (1 - dt / 2)) < 1e-9);
  });
});

describe("abcdq0 (split per axis)", () => {
  it("maps a balanced set aligned with theta to d=amplitude, q=0, 0=0", () => {
    const th = 0.7;
    const t2 = (2 * Math.PI) / 3;
    const amp = 3;
    const g = new CsmfControlGraph(
      [
        { id: "a", kind: "const", value: amp * Math.cos(th) },
        { id: "b", kind: "const", value: amp * Math.cos(th - t2) },
        { id: "c", kind: "const", value: amp * Math.cos(th + t2) },
        { id: "th", kind: "const", value: th },
        { id: "d", kind: "abcdq0_d", inputs: ["a", "b", "c", "th"] },
        { id: "q", kind: "abcdq0_q", inputs: ["a", "b", "c", "th"] },
        { id: "z", kind: "abcdq0_0", inputs: ["a", "b", "c", "th"] },
      ],
      1e-3,
    );
    g.step(noSense, noSense);
    assert.ok(Math.abs(g.getOutput("d") - amp) < 1e-12);
    assert.ok(Math.abs(g.getOutput("q")) < 1e-12);
    assert.ok(Math.abs(g.getOutput("z")) < 1e-12);
  });
});

describe("inverse abcdq0", () => {
  it("round-trips through the forward transform", () => {
    const th = 1.1;
    const g = new CsmfControlGraph(
      [
        { id: "d", kind: "const", value: 2 },
        { id: "q", kind: "const", value: -0.5 },
        { id: "z", kind: "const", value: 0.25 },
        { id: "th", kind: "const", value: th },
        { id: "a", kind: "inv_abcdq0_a", inputs: ["d", "q", "z", "th"] },
        { id: "b", kind: "inv_abcdq0_b", inputs: ["d", "q", "z", "th"] },
        { id: "c", kind: "inv_abcdq0_c", inputs: ["d", "q", "z", "th"] },
        { id: "fd", kind: "abcdq0_d", inputs: ["a", "b", "c", "th"] },
        { id: "fq", kind: "abcdq0_q", inputs: ["a", "b", "c", "th"] },
        { id: "f0", kind: "abcdq0_0", inputs: ["a", "b", "c", "th"] },
      ],
      1e-3,
    );
    g.step(noSense, noSense);
    assert.ok(Math.abs(g.getOutput("fd") - 2) < 1e-12);
    assert.ok(Math.abs(g.getOutput("fq") + 0.5) < 1e-12);
    assert.ok(Math.abs(g.getOutput("f0") - 0.25) < 1e-12);
  });

  it("d-only input at theta=0 gives a = d, b = c = -d/2", () => {
    const g = new CsmfControlGraph(
      [
        { id: "d", kind: "const", value: 2 },
        { id: "q", kind: "const", value: 0 },
        { id: "z", kind: "const", value: 0 },
        { id: "th", kind: "const", value: 0 },
        { id: "a", kind: "inv_abcdq0_a", inputs: ["d", "q", "z", "th"] },
        { id: "b", kind: "inv_abcdq0_b", inputs: ["d", "q", "z", "th"] },
        { id: "c", kind: "inv_abcdq0_c", inputs: ["d", "q", "z", "th"] },
      ],
      1e-3,
    );
    g.step(noSense, noSense);
    assert.ok(Math.abs(g.getOutput("a") - 2) < 1e-12);
    assert.ok(Math.abs(g.getOutput("b") + 1) < 1e-12);
    assert.ok(Math.abs(g.getOutput("c") + 1) < 1e-12);
  });
});

describe("select, upramp, time_sig, trig", () => {
  const run = (ctrl: number, opval?: number): number => {
    const g = new CsmfControlGraph(
      [
        { id: "a", kind: "const", value: 10 },
        { id: "b", kind: "const", value: 20 },
        { id: "ctrl", kind: "const", value: ctrl },
        {
          id: "s",
          kind: "select",
          inputs: ["a", "b", "ctrl"],
          ...(opval !== undefined ? { params: { A: opval } } : {}),
        },
      ],
      1e-3,
    );
    g.step(noSense, noSense);
    return g.getOutput("s");
  };

  it("select passes A only when trunc(Ctrl) equals the selection value", () => {
    assert.equal(run(1, 1), 10);
    assert.equal(run(1.9, 1), 10); // truncated to 1
    assert.equal(run(0, 1), 20);
    assert.equal(run(2, 1), 20);
    assert.equal(run(3, 3), 10);
    assert.equal(run(1), 10); // selection value defaults to 1
  });

  const ramp = (x: number): number => {
    const g = new CsmfControlGraph(
      [
        { id: "x", kind: "const", value: x },
        { id: "r", kind: "upramp", inputs: ["x"], params: { X1: 1, X2: 3, Y2: 4 } },
      ],
      1e-3,
    );
    g.step(noSense, noSense);
    return g.getOutput("r");
  };

  it("upramp is 0 below X1, linear between, and caps exactly at Y2", () => {
    assert.equal(ramp(-5), 0);
    assert.equal(ramp(1), 0);
    assert.equal(ramp(2), 2);
    assert.ok(Math.abs(ramp(2.5) - 3) < 1e-12);
    assert.equal(ramp(3), 4);
    assert.equal(ramp(100), 4);
  });

  it("time_sig advances by dt every step, starting at 0", () => {
    const dt = 0.25e-3;
    const g = new CsmfControlGraph([{ id: "t", kind: "time_sig" }], dt);
    const seen: number[] = [];
    for (let k = 0; k < 5; k++) {
      g.step(noSense, noSense);
      seen.push(g.getOutput("t"));
    }
    seen.forEach((v, k) => assert.ok(Math.abs(v - k * dt) < 1e-15, `step ${k}: ${v}`));
  });

  it("trig Type 1 = sin, Type 2 = cos, other types output 0", () => {
    const eval1 = (type: number, x: number): number => {
      const g = new CsmfControlGraph(
        [
          { id: "x", kind: "const", value: x },
          { id: "t", kind: "trig", inputs: ["x"], params: { Type: type } },
        ],
        1e-3,
      );
      g.step(noSense, noSense);
      return g.getOutput("t");
    };
    assert.ok(Math.abs(eval1(1, 0.9) - Math.sin(0.9)) < 1e-12);
    assert.ok(Math.abs(eval1(2, 0.9) - Math.cos(0.9)) < 1e-12);
    assert.equal(eval1(3, 0.9), 0);
  });
});

describe("logic gate", () => {
  const gate = (params: Record<string, number>, ins: number[]): number => {
    const g = new CsmfControlGraph(
      [
        ...ins.map((v, i) => ({ id: `i${i}`, kind: "const" as const, value: v })),
        { id: "g", kind: "logic" as const, inputs: ins.map((_, i) => `i${i}`), params },
      ],
      1e-3,
    );
    g.step(noSense, noSense);
    return g.getOutput("g");
  };

  it("AND is the default (Type 0) and honours Num_in", () => {
    assert.equal(gate({ Type: 0, Num_in: 2 }, [1, 1]), 1);
    assert.equal(gate({ Type: 0, Num_in: 2 }, [1, 0]), 0);
    assert.equal(gate({ Type: 0, Num_in: 2 }, [0, 0]), 0);
    assert.equal(gate({ Num_in: 2 }, [1, 1]), 1);
    // A third input beyond Num_in is ignored.
    assert.equal(gate({ Type: 0, Num_in: 2 }, [1, 1, 0]), 1);
  });

  it("covers OR, NAND, NOR, XOR and XNOR", () => {
    const table: [number, number[], number][] = [
      [1, [0, 0], 0],
      [1, [1, 0], 1],
      [2, [1, 1], 0],
      [2, [1, 0], 1],
      [3, [0, 0], 1],
      [3, [1, 0], 0],
      [4, [1, 0], 1],
      [4, [1, 1], 0],
      [5, [1, 1], 1],
      [5, [1, 0], 0],
    ];
    for (const [type, ins, want] of table)
      assert.equal(gate({ Type: type, Num_in: 2 }, ins), want, `Type ${type} ${ins}`);
  });

  it("input and output inversion flags", () => {
    assert.equal(gate({ Type: 0, Num_in: 2, Inv2: 1 }, [1, 0]), 1);
    assert.equal(gate({ Type: 0, Num_in: 2, Inv: 1 }, [1, 1]), 0);
  });
});

describe("range and ratelimit", () => {
  const rangeOut = (x: number, extra: Record<string, number> = {}): number => {
    const g = new CsmfControlGraph(
      [
        { id: "c", kind: "const", value: x },
        { id: "r", kind: "range", inputs: ["c"], params: { XL: 1, XU: 2, OL: 0, OM: 1, OH: 5, ...extra } },
      ],
      1e-3,
    );
    g.step(noSense, noSense);
    return g.getOutput("r");
  };

  it("range picks OL/OM/OH and treats the boundaries as OM", () => {
    assert.equal(rangeOut(0.5), 0);
    assert.equal(rangeOut(1), 1);
    assert.equal(rangeOut(1.5), 1);
    assert.equal(rangeOut(2), 1);
    assert.equal(rangeOut(2.5), 5);
  });

  it("range conv=1 rounds the output", () => {
    assert.equal(rangeOut(3, { OH: 2.6, conv: 1 }), 3);
  });

  it("ratelimit passes the first sample and then limits the rise to IR*dt", () => {
    const dt = 1e-3;
    const g = new CsmfControlGraph(
      [
        { id: "t", kind: "time_sig" },
        { id: "u", kind: "upramp", inputs: ["t"], params: { X1: 0, X2: 1, Y2: 100 } },
        { id: "rl", kind: "ratelimit", inputs: ["u"], params: { IR: 10, DR: 1e6 } },
      ],
      dt,
    );
    for (let k = 0; k < 51; k++) g.step(noSense, noSense);
    assert.ok(Math.abs(g.getOutput("rl") - 0.5) < 1e-9, String(g.getOutput("rl")));
  });

  it("ratelimit limits the fall to DR*dt", () => {
    const g = new CsmfControlGraph(
      [
        { id: "c", kind: "const", value: 0 },
        { id: "rl", kind: "ratelimit", inputs: ["c"], params: { IR: 1e6, DR: 10 } },
      ],
      1e-3,
    );
    const b = g.blocks[g.blockMap.get("rl")!]!;
    b.rmsCount = 1;
    b.yPrev = 1;
    g.step(noSense, noSense);
    assert.ok(Math.abs(g.getOutput("rl") - 0.99) < 1e-12);
  });
});

describe("compare", () => {
  const cmpOut = (x: number, extra: Record<string, number> = {}): number => {
    const g = new CsmfControlGraph(
      [
        { id: "c", kind: "const", value: x },
        { id: "k", kind: "compare", inputs: ["c"], params: { X: 1, OL: 0, OH: 1, ...extra } },
      ],
      1e-3,
    );
    g.step(noSense, noSense);
    return g.getOutput("k");
  };

  it("outputs OH strictly above X and OL otherwise", () => {
    assert.equal(cmpOut(1.5), 1);
    assert.equal(cmpOut(1), 0);
    assert.equal(cmpOut(0.5), 0);
  });

  it("conv=1 rounds the output", () => {
    assert.equal(cmpOut(2, { OH: 0.7, conv: 1 }), 1);
  });
});

describe("maxmin and rms3ph", () => {
  it("maxmin passes one input and picks max (Type 1) or min (Type 2) of several", () => {
    const run = (type: number, ins: number[]): number => {
      const g = new CsmfControlGraph(
        [
          ...ins.map((v, i) => ({ id: "c" + i, kind: "const" as const, value: v })),
          { id: "m", kind: "maxmin", inputs: ins.map((_, i) => "c" + i), params: { Type: type } },
        ],
        1e-3,
      );
      g.step(noSense, noSense);
      return g.getOutput("m");
    };
    assert.equal(run(1, [-2.5]), -2.5);
    assert.equal(run(1, [1, 4, 2]), 4);
    assert.equal(run(2, [1, 4, 2]), 1);
  });

  it("rms3ph is sqrt(mean square) smoothed by a lag of Ts, starting at Vinit", () => {
    const dt = 1e-3;
    const g = new CsmfControlGraph(
      [
        { id: "a", kind: "const", value: 3 },
        { id: "b", kind: "const", value: -4 },
        { id: "c", kind: "const", value: 0 },
        { id: "r", kind: "rms3ph", inputs: ["a", "b", "c"], params: { Ts: 0.01, Vinit: 0 } },
      ],
      dt,
    );
    const target = Math.sqrt(25 / 3);
    g.step(noSense, noSense);
    const alpha = dt / (0.01 + dt);
    assert.ok(Math.abs(g.getOutput("r") - alpha * target) < 1e-12);
    for (let k = 0; k < 500; k++) g.step(noSense, noSense);
    assert.ok(Math.abs(g.getOutput("r") - target) < 1e-6);
  });
});

describe("x_power_y and angle_resolver", () => {
  const one = (kind: "x_power_y" | "angle_resolver", x: number, params: Record<string, number>): number => {
    const g = new CsmfControlGraph(
      [
        { id: "c", kind: "const", value: x },
        { id: "b", kind, inputs: ["c"], params },
      ],
      1e-3,
    );
    g.step(noSense, noSense);
    return g.getOutput("b");
  };

  it("x_power_y raises to y and clamps a negative base when xneg = 0", () => {
    assert.equal(one("x_power_y", 2, { y: 3, xneg: 0 }), 8);
    assert.equal(one("x_power_y", -2, { y: 3, xneg: 0 }), 0);
    assert.equal(one("x_power_y", -2, { y: 3, xneg: 1 }), -8);
  });

  it("angle_resolver wraps into [-pi, pi]", () => {
    assert.ok(
      Math.abs(one("angle_resolver", 3 * Math.PI, {}) - Math.PI) < 1e-12 ||
        Math.abs(one("angle_resolver", 3 * Math.PI, {}) + Math.PI) < 1e-12,
    );
    assert.ok(Math.abs(one("angle_resolver", 0.5 + 2 * Math.PI, {}) - 0.5) < 1e-12);
    assert.ok(Math.abs(one("angle_resolver", -0.5 - 4 * Math.PI, {}) + 0.5) < 1e-12);
  });
});

describe("tbreakn", () => {
  const run = (params: Record<string, number>, steps: number): number => {
    const g = new CsmfControlGraph([{ id: "b", kind: "tbreakn", params }], 1e-2);
    for (let k = 0; k < steps; k++) g.step(noSense, noSense);
    return g.getOutput("b");
  };

  it("INIT=1 starts closed (0), opens at TO1 and recloses at TO2", () => {
    const p = { INIT: 1, NUMS: 2, TO1: 0.1, TO2: 0.2 };
    assert.equal(run(p, 5), 0);
    assert.equal(run(p, 15), 1);
    assert.equal(run(p, 25), 0);
  });

  it("INIT=0 starts open (1) and closes at TO1 when NUMS=1", () => {
    const p = { INIT: 0, NUMS: 1, TO1: 0.1, TO2: 0.2 };
    assert.equal(run(p, 5), 1);
    assert.equal(run(p, 15), 0);
    assert.equal(run(p, 40), 0);
  });
});
