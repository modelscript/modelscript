// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAcsl, parseAcslWasmCst } from "../src/parser/index.js";

const SAMPLE_PROGRAM = `
PROGRAM SPRING_MASS
  ! Classic damped harmonic oscillator in ACSL
  INITIAL
    CONSTANT k = 4.0, c = 0.2, m = 1.0
    CONSTANT x0 = 1.0, v0 = 0.0
    INTEGER npts = 100
    LOGICAL active = .TRUE.
    ARRAY gains(3) = 1.0, 2.0, 3.0
    TABLE ftab, 1, 3 / 0.0, 1.0, 2.0, 0.0, 1.0, 4.0 /
    CINTERVAL cint = 0.05
    MAXTERVAL maxt = 0.01
    ALGORITHM ialg = 5
  END

  DYNAMIC
    DERIVATIVE
      DERIVT = a
      a = (-k * x - c * v) / m
      v = INTEG(a, v0)
      x = INTEG(v, x0)
      PROCEDURAL(energy = x, v)
        energy = 0.5 * m * v**2 + 0.5 * k * x**2
      END
      SCHEDULE sample_ev .AT. 1.0
    END

    DISCRETE sample_ev
      INTERVAL dt = 0.5
      sampled_x = x
    END

    TERMT(t .GE. 5.0, 'Simulation complete')
  END

  TERMINAL
    final_e = 0.5 * k * x**2
  END
END
`;

describe("ACSL Parser & Linear WASM CST Accessor", () => {
  it("parses full ACSL program sections, declarations, integrators, tables, and events", () => {
    const prog = parseAcsl(SAMPLE_PROGRAM);
    assert.strictEqual(prog.name, "SPRING_MASS");
    assert.strictEqual(prog.parseErrors.length, 0);
    assert.ok(prog.sections.some((s) => s.kind === "INITIAL" && s.closed));
    assert.ok(prog.sections.some((s) => s.kind === "DYNAMIC" && s.closed));
    assert.ok(prog.sections.some((s) => s.kind === "DERIVATIVE" && s.closed));
    assert.ok(prog.sections.some((s) => s.kind === "DISCRETE" && s.closed));
    assert.ok(prog.sections.some((s) => s.kind === "TERMINAL" && s.closed));

    assert.strictEqual(prog.integrators.length, 2);
    assert.strictEqual(prog.integrators[0]!.stateVar, "v");
    assert.strictEqual(prog.integrators[1]!.stateVar, "x");

    assert.strictEqual(prog.tables.length, 1);
    assert.deepStrictEqual(prog.tables[0]!.breakpoints, [0, 1, 2]);
    assert.deepStrictEqual(prog.tables[0]!.values, [0, 1, 4]);

    assert.strictEqual(prog.discreteBlocks.length, 1);
    assert.strictEqual(prog.discreteBlocks[0]!.name, "sample_ev");
    assert.strictEqual(prog.schedules.length, 1);
    assert.strictEqual(prog.schedules[0]!.triggerKind, "AT");
    assert.strictEqual(prog.procedurals.length, 1);
    assert.strictEqual(prog.termts.length, 1);
    assert.strictEqual(prog.termts[0]!.message, "Simulation complete");
    assert.strictEqual(prog.algorithm?.code, 5);
    assert.strictEqual(prog.derivt?.name, "a");
  });

  it("handles line continuations (&), statement separators ($), and MACRO blocks", () => {
    const src = `
PROGRAM CONTINUATION_TEST
  MACRO gain_block(y, u, k)
    y = k * u
  MACRO END
  INITIAL
    CONSTANT a = 1.0 $ CONSTANT b = 2.0
  END
  DYNAMIC
    DERIVATIVE
      xdot = -a * x &
             - b
      x = INTEG(xdot, 0.0)
    END
  END
END
`;
    const prog = parseAcsl(src);
    assert.strictEqual(prog.parseErrors.length, 0);
    assert.strictEqual(prog.macros.length, 1);
    assert.strictEqual(prog.macros[0]!.name, "gain_block");
    assert.deepStrictEqual(prog.macros[0]!.params, ["y", "u", "k"]);
    assert.strictEqual(prog.declarations.length, 2);
    assert.strictEqual(prog.integrators.length, 1);
  });

  it("parses ACSL source through native WASM GLR parser into zero-wrapper linear CST view", async () => {
    const simple = `PROGRAM DECAY
INITIAL
  CONSTANT k = 0.5
END
DYNAMIC
  DERIVATIVE
    xdot = -k * x
    x = INTEG(xdot, 1.0)
  END
  TERMT(t .GE. 2.0)
END
END
`;
    const cst = await parseAcslWasmCst(simple);
    assert.ok(cst.nodeCount > 5, `Expected >5 CST nodes, got ${cst.nodeCount}`);
    assert.strictEqual(cst.startOffsets.length, cst.nodeCount);
    assert.strictEqual(cst.endOffsets.length, cst.nodeCount);
    assert.strictEqual(cst.depths.length, cst.nodeCount);
    assert.strictEqual(cst.nodeKinds[0], "Program");
  });
});
