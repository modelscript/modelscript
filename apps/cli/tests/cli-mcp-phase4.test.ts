// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { Bifurcation } from "../src/commands/bifurcation.js";
import { Simulate } from "../src/commands/simulate.js";

describe("Phase 4 Track 1: CLI Surface Wiring for Phase 1–3 Solvers & Bifurcation", () => {
  it("exposes all Phase 1–3 solver choices and --linear-solver in msx simulate CLI builder", () => {
    const recordedOptions = new Map<string, Record<string, unknown>>();
    const mockYargs = {
      positional() {
        return this;
      },
      option(name: string, spec: Record<string, unknown>) {
        recordedOptions.set(name, spec);
        return this;
      },
    };

    (Simulate.builder as (y: unknown) => unknown)(mockYargs);

    const solverOpt = recordedOptions.get("solver");
    assert.ok(solverOpt, "solver option must be registered");
    const choices = solverOpt.choices as string[];
    for (const s of [
      "tsit5",
      "vern7",
      "vern9",
      "trbdf2",
      "rodas4p",
      "kencarp4",
      "radau5",
      "radau9",
      "verlet",
      "yoshida4",
      "yoshida6",
      "yoshida8",
      "qss1",
      "qss2",
      "qss3",
      "liqss2",
    ]) {
      assert.ok(choices.includes(s), `Expected --solver choices to include '${s}'`);
    }

    const linSolverOpt = recordedOptions.get("linear-solver");
    assert.ok(linSolverOpt, "linear-solver option must be registered");
    const linChoices = linSolverOpt.choices as string[];
    for (const ls of ["dense-lu", "klu", "gmres", "bicgstab", "distributed-ras"]) {
      assert.ok(linChoices.includes(ls), `Expected --linear-solver choices to include '${ls}'`);
    }
  });

  it("executes msx bifurcation CLI handler on saddle-node and hopf normal forms", async () => {
    const tmpFile = path.join(os.tmpdir(), `msx-bif-test-${Date.now()}.json`);
    try {
      await Bifurcation.handler({
        _: ["bifurcation"],
        $0: "msx",
        name: "saddle-node",
        p0: -1.0,
        "p-min": -2.0,
        "p-max": 2.0,
        ds: 0.05,
        "max-steps": 100,
        format: "json",
        output: tmpFile,
      } as any);

      const parsed = JSON.parse(fs.readFileSync(tmpFile, "utf-8"));
      assert.equal(parsed.model, "saddle-node");
      assert.ok(parsed.pointsComputed > 10);
      assert.ok(Array.isArray(parsed.bifurcations) && parsed.bifurcations.length >= 1);
      const fold = parsed.bifurcations.find((b: any) => String(b.type).toLowerCase() === "fold");
      assert.ok(fold, "Expected Fold bifurcation on saddle-node branch");
      assert.ok(Math.abs(fold.p) < 1e-3, `Expected Fold at p=0, got p=${fold.p}`);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });
});
