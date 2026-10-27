// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { JsbsimCommand } from "../src/commands/jsbsim.js";

const CLI_C172_XML = `<?xml version="1.0"?>
<fdm_config name="c172p_cli" version="2.0">
  <fileheader>
    <description>Cessna 172 Skyhawk CLI Test Model</description>
  </fileheader>
  <metrics>
    <wingarea unit="FT2"> 174.0 </wingarea>
    <wingspan unit="FT"> 36.0 </wingspan>
    <chord unit="FT"> 4.9 </chord>
    <htailarea unit="FT2"> 21.9 </htailarea>
    <htailarm unit="FT"> 15.7 </htailarm>
    <vtailarea unit="FT2"> 16.5 </vtailarea>
    <vtailarm unit="FT"> 15.7 </vtailarm>
  </metrics>
  <mass_balance>
    <emptywt unit="LBS"> 1500.0 </emptywt>
    <ixx unit="SLUG*FT2"> 948.0 </ixx>
    <iyy unit="SLUG*FT2"> 1346.0 </iyy>
    <izz unit="SLUG*FT2"> 1967.0 </izz>
  </mass_balance>
  <ground_reactions>
    <contact type="BOGEY" name="NOSE">
      <location unit="IN"> <x> -6.8 </x> <y> 0.0 </y> <z> -30.0 </z> </location>
      <static_friction> 0.8 </static_friction>
      <dynamic_friction> 0.5 </dynamic_friction>
      <spring_coeff unit="LBS/FT"> 1800.0 </spring_coeff>
      <damping_coeff unit="LBS/FT/SEC"> 600.0 </damping_coeff>
    </contact>
  </ground_reactions>
  <propulsion>
    <engine file="Lycoming-O-320">
      <location unit="IN"> <x> 20.0 </x> <y> 0.0 </y> <z> 0.0 </z> </location>
    </engine>
  </propulsion>
  <aerodynamics>
    <axis name="LIFT">
      <function name="CL"><value> 4.8 </value></function>
    </axis>
    <axis name="DRAG">
      <function name="CD"><value> 0.027 </value></function>
    </axis>
    <axis name="PITCH">
      <function name="Cm"><value> -0.75 </value></function>
    </axis>
  </aerodynamics>
</fdm_config>`;

test("JSBSim CLI Commands (msx jsbsim inspect, lint, simulate, to-dae, to-modelica)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_jsbsim_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const modelFile = path.join(tmpDir, "c172p_cli.xml");
  fs.writeFileSync(modelFile, CLI_C172_XML, "utf-8");

  await t.test("msx jsbsim inspect / summary", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (JsbsimCommand.handler as any)({
        action: "inspect",
        files: [modelFile],
      });
      assert.ok(logs.some((l) => l.includes("JSBSim Aircraft Summary")));
      assert.ok(logs.some((l) => l.includes("c172p_cli")));
      assert.ok(logs.some((l) => l.includes("Wing Area:    174 ft²")));
      assert.ok(logs.some((l) => l.includes("Empty Weight: 1500 lbs")));
      assert.ok(logs.some((l) => l.includes("Ground Gears:     1")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx jsbsim lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (JsbsimCommand.handler as any)({
        action: "lint",
        files: [modelFile],
      });
      assert.ok(logs.some((l) => l.includes("passed all pre-flight checks")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx jsbsim simulate", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (JsbsimCommand.handler as any)({
        action: "simulate",
        files: [modelFile],
        duration: 5.0,
      });
      assert.ok(logs.some((l) => l.includes("6-DOF Flight Dynamics Simulation")));
      assert.ok(logs.some((l) => l.includes("Time Steps Solved:")));
      assert.ok(logs.some((l) => l.includes("Final Altitude:")));
      assert.ok(logs.some((l) => l.includes("Final Speed:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx jsbsim to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (JsbsimCommand.handler as any)({
        action: "to-dae",
        files: [modelFile],
      });
      assert.ok(logs.some((l) => l.includes("Lowered DAE Summary")));
      assert.ok(logs.some((l) => l.includes("Variables:")));
      assert.ok(logs.some((l) => l.includes("Equations:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx jsbsim to-modelica", async () => {
    const outFile = path.join(tmpDir, "c172p_cli.mo");

    await (JsbsimCommand.handler as any)({
      action: "to-modelica",
      files: [modelFile],
      out: outFile,
    });

    assert.ok(fs.existsSync(outFile));
    const mo = fs.readFileSync(outFile, "utf-8");
    assert.ok(mo.includes("model c172p_cli"));
    assert.ok(mo.includes("Real u(start ="));
    assert.ok(mo.includes("der(u)"));
    assert.ok(mo.includes("end c172p_cli;"));
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
