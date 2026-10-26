// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { UrdfCommand } from "../src/commands/urdf.js";

const ROBOT_URDF = `<?xml version="1.0"?>
<robot name="cli_arm">
  <link name="base">
    <inertial>
      <mass value="5.0"/>
      <inertia ixx="0.5" ixy="0" ixz="0" iyy="0.5" iyz="0" izz="0.5"/>
    </inertial>
  </link>
  <link name="link1">
    <inertial>
      <mass value="2.0"/>
      <inertia ixx="0.2" ixy="0" ixz="0" iyy="0.2" iyz="0" izz="0.05"/>
    </inertial>
  </link>
  <joint name="joint1" type="revolute">
    <parent link="base"/>
    <child link="link1"/>
    <origin xyz="0 0 1"/>
    <axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14" effort="100" velocity="3"/>
  </joint>
</robot>`;

test("ROS URDF CLI Commands (msx urdf lint, rnea, to-modelica, to-simpack, to-adams, to-dae)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_urdf_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const urdfFile = path.join(tmpDir, "arm.urdf");
  fs.writeFileSync(urdfFile, ROBOT_URDF, "utf-8");

  await t.test("msx urdf lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (UrdfCommand.handler as any)({
        action: "lint",
        files: [urdfFile],
      });
      assert.ok(logs.some((l) => l.includes("Clean. 0 diagnostics.")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx urdf rnea", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (UrdfCommand.handler as any)({
        action: "rnea",
        files: [urdfFile],
      });
      assert.ok(logs.some((l) => l.includes("URDF RNEA")));
      assert.ok(logs.some((l) => l.includes("joint1")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx urdf to-modelica", async () => {
    const outMo = path.join(tmpDir, "arm.mo");
    await (UrdfCommand.handler as any)({
      action: "to-modelica",
      files: [urdfFile],
      out: outMo,
    });
    assert.ok(fs.existsSync(outMo));
    const content = fs.readFileSync(outMo, "utf-8");
    assert.ok(content.includes("model cli_arm"));
    assert.ok(content.includes("MultiBody.World world"));
  });

  await t.test("msx urdf to-simpack", async () => {
    const outSimpack = path.join(tmpDir, "arm_simpack.json");
    await (UrdfCommand.handler as any)({
      action: "to-simpack",
      files: [urdfFile],
      out: outSimpack,
    });
    assert.ok(fs.existsSync(outSimpack));
    const content = JSON.parse(fs.readFileSync(outSimpack, "utf-8"));
    assert.ok(content.bodies);
    assert.ok(content.joints);
  });

  await t.test("msx urdf to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (UrdfCommand.handler as any)({
        action: "to-dae",
        files: [urdfFile],
      });
      assert.ok(logs.some((l) => l.includes("lowered to linear WebAssembly memory arena")));
      assert.ok(logs.some((l) => l.includes("Variables:")));
    } finally {
      console.log = origLog;
    }
  });
});
