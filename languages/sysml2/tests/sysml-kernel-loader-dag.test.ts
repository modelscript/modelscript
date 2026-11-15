// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateSysmlAssumptions,
  evaluateSysmlDefinition,
  parseSysmlDefinitions,
  resolveDefinitionInputs,
  resolveSysmlExecutionOrder,
} from "../src/index.js";

test("parseSysmlDefinitions & resolveSysmlExecutionOrder topologically sort cross-definition workflows and ignore quoted filenames", () => {
  const src = `
    package WorkflowDag {
      verification def DownstreamReport {
        attribute dependsOn = "GateStage";
        attribute dataFile = "StageMissing.raw";
        attribute marginMin = 1.0;
        require constraint { GateStage.score >= marginMin }
      }

      verification def GuardedStage {
        attribute inputScr = GateStage.scr;
        assume constraint { GateStage.needsDetail == true }
        require constraint { inputScr > 0 }
      }

      analysis def GateStage {
        attribute faultMva = UpstreamAudit.faultMva;
        attribute ratingMw = 250.0;
        attribute scr = faultMva / ratingMw;
        attribute needsDetail = scr < 2.0;
        attribute score = UpstreamAudit.completeness;
        require constraint { scr > 0 }
      }

      action def UpstreamAudit {
        attribute rawPath = "FakeDef.raw";
        attribute faultMva = 620.0;
        attribute completeness = 1.0;
      }
    }
  `;

  const pkg = parseSysmlDefinitions(src);
  const ordered = resolveSysmlExecutionOrder(pkg.definitions);
  assert.deepEqual(
    ordered.map((d) => d.name),
    ["UpstreamAudit", "GateStage", "DownstreamReport", "GuardedStage"],
  );
  const upstream = pkg.definitions.find((d) => d.name === "UpstreamAudit");
  assert.deepEqual(upstream?.dependsOn, []);
});

test("resolveSysmlExecutionOrder rejects cycles and unknown dependsOn targets", () => {
  const cyclic = parseSysmlDefinitions(`
    package Cyclic {
      analysis def A { attribute x = B.y; }
      analysis def B { attribute y = A.x; }
    }
  `);
  assert.throws(() => resolveSysmlExecutionOrder(cyclic.definitions), /Circular dependency/);

  const unknown = parseSysmlDefinitions(`
    package Unknown {
      analysis def A { attribute dependsOn = "GhostStage"; }
    }
  `);
  assert.throws(() => resolveSysmlExecutionOrder(unknown.definitions), /unknown dependency 'GhostStage'/);
});

test("resolveDefinitionInputs & evaluateSysmlAssumptions propagate upstream outputs and gate downstream execution", () => {
  const pkg = parseSysmlDefinitions(`
    package ScreeningFlow {
      analysis def GateStage {
        attribute faultMva = Audit.faultMva;
        attribute ibrMw = 250.0;
        attribute minScr = 2.0;
        attribute scr = faultMva / ibrMw;
        attribute emtMandatory = scr < minScr;
        require constraint { scr > 0 }
      }

      verification def EmtBranch {
        attribute scr = GateStage.scr;
        assume constraint { GateStage.emtMandatory == true }
        require constraint { scr < 2.0 }
      }
    }
  `);
  const gate = pkg.definitions.find((d) => d.name === "GateStage")!;
  const emt = pkg.definitions.find((d) => d.name === "EmtBranch")!;
  const upstreamEnv: Record<string, number | boolean | string> = { "Audit.faultMva": 620 };

  // Strong grid default (SCR = 620 / 250 = 2.48 >= 2.0) -> EMT branch skipped
  const strongGateInputs = resolveDefinitionInputs(gate, upstreamEnv);
  assert.equal(strongGateInputs["faultMva"], 620);
  assert.ok(Math.abs(Number(strongGateInputs["scr"]) - 2.48) < 1e-6);
  assert.equal(strongGateInputs["emtMandatory"], false);

  const envStrong: Record<string, number | boolean | string> = { ...upstreamEnv };
  for (const [k, v] of Object.entries(strongGateInputs)) envStrong[`GateStage.${k}`] = v;

  const assumeStrong = evaluateSysmlAssumptions(emt, envStrong);
  assert.equal(assumeStrong.active, false);
  const evalStrong = evaluateSysmlDefinition(emt, { ...envStrong, ...resolveDefinitionInputs(emt, envStrong) });
  assert.equal(evalStrong.passed, true);
  assert.equal(evalStrong.checks[0]?.vacuous, true);

  // Weak grid override (SCR = 620 / 350 = 1.771 < 2.0) -> EMT branch active
  const weakGateInputs = resolveDefinitionInputs(gate, upstreamEnv, { "GateStage.ibrMw": 350 });
  assert.ok(Math.abs(Number(weakGateInputs["scr"]) - 620 / 350) < 1e-6);
  assert.equal(weakGateInputs["emtMandatory"], true);

  const envWeak: Record<string, number | boolean | string> = { ...upstreamEnv };
  for (const [k, v] of Object.entries(weakGateInputs)) envWeak[`GateStage.${k}`] = v;

  const assumeWeak = evaluateSysmlAssumptions(emt, envWeak);
  assert.equal(assumeWeak.active, true);
  const evalWeak = evaluateSysmlDefinition(emt, { ...envWeak, ...resolveDefinitionInputs(emt, envWeak) });
  assert.equal(evalWeak.passed, true);
  assert.equal(evalWeak.checks[0]?.vacuous, false);
});
