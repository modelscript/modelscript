// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintSysmlModelicaBridge } from "../src/sysml-modelica-bridge-linter.js";

test("SM1001-SM1004: Bridge linter catches causality mismatch, SI unit mismatch, and parameter contract breach", () => {
  const sysml = `
    part def MotorDrive {
      in attribute torqueCmd : Real [N.m];
      out attribute speedMeas : Real [rad/s];
      require constraint { R >= 0.5 and R <= 2.0 }
    }
  `;
  const modelica = `
    model MotorDrive
      output Real torqueCmd(unit = "W");
      output Real speedMeas(unit = "rad/s");
      parameter Real R(unit = "Ohm") = 5.0;
    equation
      speedMeas = torqueCmd / R;
    end MotorDrive;
  `;

  const report = lintSysmlModelicaBridge(sysml, modelica);
  assert.equal(report.valid, false);
  assert.equal(report.checkedPorts, 2);
  assert.equal(report.checkedUnits, 2);
  assert.equal(report.checkedParameters, 1);

  assert.ok(
    report.diagnostics.some((d) => d.code === "SM1001" && d.symbol === "torqueCmd"),
    `Expected SM1001 causality mismatch, got: ${JSON.stringify(report.diagnostics)}`,
  );
  assert.ok(
    report.diagnostics.some((d) => d.code === "SM1002" && d.symbol === "torqueCmd"),
    `Expected SM1002 SI unit mismatch, got: ${JSON.stringify(report.diagnostics)}`,
  );
  assert.ok(
    report.diagnostics.some((d) => d.code === "SM1003"),
    `Expected SM1003 parameter contract violation, got: ${JSON.stringify(report.diagnostics)}`,
  );
  assert.ok(
    report.diagnostics.some((d) => d.code === "SM1004"),
    `Expected SM1004 proof manifest, got: ${JSON.stringify(report.diagnostics)}`,
  );
  assert.equal(report.proofDigest.length, 16);
});

test("Matched SysML v2 <-> Modelica pair passes bridge linter with valid=true and deterministic proofDigest", () => {
  const sysml = `
    part def ServoActuator {
      in attribute torqueCmd : Real [N.m];
      out attribute omega : Real [rad/s];
      require constraint { R >= 0.5 and R <= 2.0 }
    }
  `;
  const modelica = `
    model ServoActuator
      input Real torqueCmd(unit = "N.m");
      output Real omega(unit = "rad/s");
      parameter Real R(unit = "Ohm") = 1.25;
    equation
      omega = torqueCmd / R;
    end ServoActuator;
  `;

  const r1 = lintSysmlModelicaBridge(sysml, modelica);
  const r2 = lintSysmlModelicaBridge(sysml, modelica);
  assert.equal(r1.valid, true);
  assert.equal(r1.checkedPorts, 2);
  assert.equal(r1.checkedUnits, 2);
  assert.equal(r1.checkedParameters, 1);
  assert.equal(r1.diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.equal(r1.diagnostics.length, 1);
  assert.equal(r1.diagnostics[0]?.code, "SM1004");
  assert.equal(r1.proofDigest, r2.proofDigest);
});
