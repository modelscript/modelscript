// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Compile } from "../src/commands/compile.js";
import { Simulate } from "../src/commands/simulate.js";

describe("SysML v2 Multi-File CLI End-to-End (`msx compile` & `msx simulate`)", () => {
  const scratchDir = path.resolve(import.meta.dirname, "scratch_sysml2_multifile_cli");

  before(() => {
    if (fs.existsSync(scratchDir)) {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
    fs.mkdirSync(scratchDir, { recursive: true });
  });

  after(() => {
    if (fs.existsSync(scratchDir)) {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it("compiles and flattens a multi-file SysML v2 model across packages (`msx compile`)", async () => {
    const file1 = path.join(scratchDir, "Definitions.sysml");
    const file2 = path.join(scratchDir, "Components.sysml");
    const file3 = path.join(scratchDir, "Plant.sysml");

    fs.writeFileSync(
      file1,
      `package Definitions {
        port def FluidPort {
          attribute p : Real;
          flow m_flow : Real;
        }
      }`,
      "utf-8",
    );

    fs.writeFileSync(
      file2,
      `package Components {
        part def Tank {
          attribute area : Real = 2.0;
          attribute level : Real = 1.0;
          attribute q_in : Real = 1.0;
          attribute q_out : Real = 0.5;
          constraint dynamicMass {
            der(level) == (q_in - q_out) / area;
          }
        }
      }`,
      "utf-8",
    );

    fs.writeFileSync(
      file3,
      `package Plant {
        part def StorageFacility {
          part mainTank : Tank {
            attribute area = 1.0;
            attribute q_in = 1.0;
            attribute q_out = 0.5;
          }
        }
      }`,
      "utf-8",
    );

    const daeOut = path.join(scratchDir, "StorageFacility.dae");

    await Compile.handler({
      name: "StorageFacility",
      paths: [file1, file2, file3],
      output: daeOut,
      to: "dae",
      _: ["compile"],
      $0: "msx",
    } as any);

    assert.ok(fs.existsSync(daeOut), "Flattened DAE output file should exist");
    const daeText = fs.readFileSync(daeOut, "utf-8");
    assert.ok(daeText.includes("mainTank.level"), "Should contain flattened state mainTank.level");
    assert.ok(daeText.includes("mainTank.area"), "Should contain parameter mainTank.area");
    assert.ok(daeText.includes("der(mainTank.level)"), "Should contain derivative equation for mainTank.level");
  });

  it("simulates a multi-file SysML v2 continuous dynamic model (`msx simulate`)", async () => {
    const file1 = path.join(scratchDir, "Definitions.sysml");
    const file2 = path.join(scratchDir, "Components.sysml");
    const file3 = path.join(scratchDir, "Plant.sysml");

    const simJsonOut = path.join(scratchDir, "sim_result.json");

    await Simulate.handler({
      name: "StorageFacility",
      paths: [file1, file2, file3],
      output: simJsonOut,
      format: "json",
      solver: "dopri5",
      engine: "arena",
      startTime: 0,
      stopTime: 2.0,
      stepSize: 0.1,
      _: ["simulate"],
      $0: "msx",
    } as any);

    assert.ok(fs.existsSync(simJsonOut), "Simulation JSON result should exist");
    const res = JSON.parse(fs.readFileSync(simJsonOut, "utf-8"));
    assert.ok(Array.isArray(res) && res.length > 0, "Result should be an array of time steps");
    assert.ok("time" in res[0], "Each step should contain time");

    const lastStep = res[res.length - 1];
    assert.ok("mainTank.level" in lastStep, "Should contain trajectory for mainTank.level");
    // With initial level = 1.0 and der(level) = (1.0 - 0.5) / 1.0 = 0.5,
    // at t = 2.0, level should integrate to approximately 2.0
    const finalLevel = lastStep["mainTank.level"];
    assert.ok(Math.abs(finalLevel - 2.0) < 0.05, `Expected final level ~ 2.0, got ${finalLevel}`);
  });
});
