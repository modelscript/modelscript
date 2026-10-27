// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { CfdCommand } from "../src/commands/cfd.js";

const SAMPLE_SU2_DECK = `%
% SU2 Aerodynamic Configuration: NACA 0012
%
PHYSICAL_PROBLEM= NAVIER_STOKES
MATH_PROBLEM= EULER
KIND_TURB_MODEL= NONE
MACH_NUMBER= 0.8
AOA= 1.25
REYNOLDS_NUMBER= 6.5E6
REF_AREA= 1.0
REF_LENGTH= 1.0
MESH_FILENAME= naca0012.su2
%
MARKER_EULER= ( airfoil )
MARKER_FAR= ( farfield )
MARKER_INLET= ( inlet, 101325.0, 288.15, 1.0, 0.0, 0.0 )
MARKER_OUTLET= ( outlet, 101325.0 )
`;

test("CFD CLI Commands (msx cfd inspect, lint, to-dae, to-modelica, solve)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_cfd_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const cfgFile = path.join(tmpDir, "airfoil.cfg");
  fs.writeFileSync(cfgFile, SAMPLE_SU2_DECK, "utf-8");

  await t.test("msx cfd inspect / summary", async () => {
    const outputs: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: any) => {
      outputs.push(String(chunk));
      return true;
    };

    try {
      await (CfdCommand.handler as any)({
        action: "inspect",
        files: [cfgFile],
      });
      const combined = outputs.join("");
      assert.ok(combined.includes("CFD AERODYNAMIC SUMMARY"));
      assert.ok(combined.includes("Mach Number     : 0.8"));
      assert.ok(combined.includes("airfoil"));
    } finally {
      process.stdout.write = origWrite;
    }
  });

  await t.test("msx cfd lint", async () => {
    const outputs: string[] = [];
    const origWrite = process.stdout.write;
    const origExitCode = process.exitCode;
    process.stdout.write = (chunk: any) => {
      outputs.push(String(chunk));
      return true;
    };

    try {
      await (CfdCommand.handler as any)({
        action: "lint",
        files: [cfgFile],
      });
      const combined = outputs.join("");
      assert.ok(combined.includes("No pre-flight diagnostics found"));
    } finally {
      process.stdout.write = origWrite;
      process.exitCode = origExitCode;
    }
  });

  await t.test("msx cfd to-dae", async () => {
    const daeOut = path.join(tmpDir, "cfd_dae.json");
    await (CfdCommand.handler as any)({
      action: "to-dae",
      files: [cfgFile],
      out: daeOut,
    });

    assert.ok(fs.existsSync(daeOut), "DAE metadata file should be created");
    const json = JSON.parse(fs.readFileSync(daeOut, "utf-8"));
    assert.ok(json.variables >= 10);
    assert.ok(json.equations >= 5);
  });

  await t.test("msx cfd to-modelica", async () => {
    const moOut = path.join(tmpDir, "airfoil.mo");
    await (CfdCommand.handler as any)({
      action: "to-modelica",
      files: [cfgFile],
      out: moOut,
    });

    assert.ok(fs.existsSync(moOut), "Modelica file should be generated");
    const code = fs.readFileSync(moOut, "utf-8");
    assert.ok(code.includes("model"));
    assert.ok(code.includes("Lift"));
  });

  await t.test("msx cfd solve", async () => {
    const outputs: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: any) => {
      outputs.push(String(chunk));
      return true;
    };

    try {
      await (CfdCommand.handler as any)({
        action: "solve",
        files: [cfgFile],
      });
      const combined = outputs.join("");
      assert.ok(combined.includes("CFD AERODYNAMIC FORCES SOLVER"));
      assert.ok(combined.includes("Lift Coefficient"));
      assert.ok(combined.includes("Drag Coefficient"));
    } finally {
      process.stdout.write = origWrite;
    }
  });
});
