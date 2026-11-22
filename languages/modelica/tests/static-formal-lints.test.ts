// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  runModelicaFastStaticLints,
  runModelicaFormalLints,
  verifyModelicaAlgorithmCfa,
  verifyModelicaChcWhileLoops,
  verifyModelicaDdeDelayStability,
  verifyModelicaEgraphEquations,
  verifyModelicaHc4ParameterBounds,
  verifyModelicaHjiDisturbanceBarrier,
  verifyModelicaHybridWhenZeno,
  verifyModelicaSbgArrayEquations,
} from "../src/analysis/static-formal-checks.js";

test("M7801: CFA detects unassigned output, unreachable branch, and div-by-zero in algorithm/function", () => {
  const src = `
    function BadFunc
      input Real u;
      output Real y;
      output Real z;
    algorithm
      y := u / 0.0;
      if false then
        z := 1.0;
      end if;
    end BadFunc;
  `;
  const diags = verifyModelicaAlgorithmCfa(src);
  assert.ok(diags.some((d) => d.code === 7801 && d.message.includes("division by zero")));
  assert.ok(diags.some((d) => d.code === 7801 && d.message.includes("unreachable")));

  const missingOutSrc = `
    function UnassignedOut
      input Real u;
      output Real y;
    algorithm
      u := u + 1;
    end UnassignedOut;
  `;
  const missingDiags = verifyModelicaAlgorithmCfa(missingOutSrc);
  assert.ok(missingDiags.some((d) => d.code === 7801 && d.message.includes("output variable 'y'")));
});

test("M7802: SBG detects overlapping slices and missing boundary coverage on array equations", () => {
  const src = `
    model Pipe1D
      parameter Integer N = 10;
      Real T[10];
    equation
      for i in 1:6 loop
        T[i] = 300.0;
      end for;
      for i in 5:9 loop
        T[i] = 310.0;
      end for;
    end Pipe1D;
  `;
  const diags = verifyModelicaSbgArrayEquations(src);
  assert.ok(
    diags.some((d) => d.code === 7802 && d.message.includes("overlapping index slices")),
    `Expected overlapping slice M7802, got: ${JSON.stringify(diags)}`,
  );
  assert.ok(
    diags.some((d) => d.code === 7802 && d.message.includes("missing equation coverage")),
    `Expected missing boundary M7802, got: ${JSON.stringify(diags)}`,
  );
});

test("M7803: E-graph detects duplicate (singular Jacobian) and contradictory linear equations", () => {
  const dupSrc = `
    model DupSys
      Real x;
      Real y;
    equation
      x + y = 5;
      2*y + 2*x = 10;
    end DupSys;
  `;
  const dupDiags = verifyModelicaEgraphEquations(dupSrc);
  assert.ok(
    dupDiags.some((d) => d.code === 7803 && d.message.includes("duplicate")),
    `Expected duplicate M7803, got: ${JSON.stringify(dupDiags)}`,
  );

  const contraSrc = `
    model ContraSys
      Real x;
      Real y;
    equation
      x + y = 5;
      y + x = 8;
    end ContraSys;
  `;
  const contraDiags = verifyModelicaEgraphEquations(contraSrc);
  assert.ok(
    contraDiags.some((d) => d.code === 7803 && d.message.includes("contradictory")),
    `Expected contradictory M7803, got: ${JSON.stringify(contraDiags)}`,
  );
});

test("M7804: HC4 detects empty [min, max] domain and out-of-bounds parameter/start values", () => {
  const src = `
    model BadParams
      parameter Real R(min = 10.0, max = 5.0) = 7.0;
      Real T(min = 200.0, max = 400.0, start = 500.0);
    equation
      der(T) = -0.1 * (T - 300.0);
    end BadParams;
  `;
  const diags = verifyModelicaHc4ParameterBounds(src);
  assert.ok(diags.some((d) => d.code === 7804 && d.message.includes("empty domain interval")));
  assert.ok(diags.some((d) => d.code === 7804 && d.message.includes("violates upper bound")));
});

test("M7805-M7808: Formal lints detect DDE instability, hybrid Zeno/conflicting reinit, unbounded while, and HJI breach", () => {
  const ddeSrc = `
    model UnstableDelay
      Real x;
    equation
      der(x) = -2.0 * delay(x, 1.0);
    end UnstableDelay;
  `;
  const ddeDiags = verifyModelicaDdeDelayStability(ddeSrc);
  assert.ok(ddeDiags.some((d) => d.code === 7805));

  const hybridSrc = `
    model ZenoBouncer
      Real h(start = 1.0);
    equation
      der(h) = -1.0;
      when h <= 0.0 then
        reinit(h, -0.5);
        reinit(h, 0.0);
      end when;
    end ZenoBouncer;
  `;
  const hybridDiags = verifyModelicaHybridWhenZeno(hybridSrc);
  assert.ok(hybridDiags.some((d) => d.code === 7806 && d.message.includes("Zeno")));
  assert.ok(hybridDiags.some((d) => d.code === 7806 && d.message.includes("conflicting reinit")));

  const chcSrc = `
    function BadLoop
      input Integer n;
      output Integer y;
    algorithm
      y := 0;
      while true loop
        y := y + 1;
      end while;
    end BadLoop;
  `;
  const chcDiags = verifyModelicaChcWhileLoops(chcSrc);
  assert.ok(chcDiags.some((d) => d.code === 7807));

  const hjiSrc = `
    model DisturbedPlant
      input Real d;
      Real x(min = -1.0, max = 1.0);
    equation
      der(x) = -1.0 * x + 3.0 * d;
    end DisturbedPlant;
  `;
  const hjiDiags = verifyModelicaHjiDisturbanceBarrier(hjiSrc, 1.0);
  assert.ok(hjiDiags.some((d) => d.code === 7808));
});

test("Clean Modelica model passes Tier 1 fast static lints (< 15 ms) and Tier 2 formal lints with 0 diagnostics", () => {
  const cleanSrc = `
    model HealthyRC
      parameter Real R(min = 1.0, max = 1000.0) = 100.0;
      Real v(min = -10.0, max = 10.0, start = 1.0);
      Real T[4];
    equation
      der(v) = -1.0 * v;
      for i in 1:4 loop
        T[i] = 300.0;
      end for;
    end HealthyRC;
  `;
  const t0 = performance.now();
  const fastDiags = runModelicaFastStaticLints(cleanSrc);
  const elapsedMs = performance.now() - t0;
  assert.equal(fastDiags.length, 0, `Expected 0 fast diagnostics, got: ${JSON.stringify(fastDiags)}`);
  assert.ok(elapsedMs < 15, `Expected Tier 1 fast static lints < 15 ms, took ${elapsedMs.toFixed(2)} ms`);

  const formalDiags = runModelicaFormalLints(cleanSrc);
  assert.equal(formalDiags.length, 0, `Expected 0 formal diagnostics, got: ${JSON.stringify(formalDiags)}`);
});
