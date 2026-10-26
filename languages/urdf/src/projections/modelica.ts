// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/urdf — Projection from ROS URDF to Modelica.Mechanics.MultiBody.
 */

import type { UrdfRobot } from "../types.js";

function sanitizeIdentifier(str: string): string {
  let res = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    if (
      (ch >= 65 && ch <= 90) || // A-Z
      (ch >= 97 && ch <= 122) || // a-z
      (ch >= 48 && ch <= 57) || // 0-9
      ch === 95 // _
    ) {
      res += str[i];
    } else {
      res += "_";
    }
  }
  return res || "ident";
}

/**
 * Generates an idiomatic Modelica 3.x multibody robot model from a URDF robot.
 */
export function urdfToModelica(robot: UrdfRobot): string {
  const modelName = sanitizeIdentifier(robot.name);
  const lines: string[] = [];

  lines.push(`model ${modelName}`);
  lines.push(`  "Synthesized from ROS URDF Robot Definition"`);
  lines.push(`  import Modelica.Mechanics.MultiBody;`);
  lines.push(`  import Modelica.Mechanics.MultiBody.Parts;`);
  lines.push(`  import Modelica.Mechanics.MultiBody.Joints;`);
  lines.push("");

  // 1. World reference
  lines.push(
    `  MultiBody.World world(gravityType = MultiBody.Types.GravityTypes.ConstantGravity, g = 9.80665, n = {0, 0, -1}) annotation(Placement(transformation(extent = {{-80, -80}, {-60, -60}})));`,
  );

  // 2. Rigid Bodies (Links)
  for (const link of robot.links.values()) {
    const lName = sanitizeIdentifier(link.name);
    const m = link.inertial?.mass ?? 1.0;
    const i11 = link.inertial?.ixx ?? m * 0.1;
    const i22 = link.inertial?.iyy ?? m * 0.1;
    const i33 = link.inertial?.izz ?? m * 0.1;

    lines.push(`  Parts.Body ${lName}(m = ${m}, I_11 = ${i11}, I_22 = ${i22}, I_33 = ${i33})`);
    lines.push(`    annotation(Placement(transformation(extent = {{-10, -10}, {10, 10}})));`);
  }
  lines.push("");

  // 3. Kinematic Joints
  for (const joint of robot.joints.values()) {
    const jName = sanitizeIdentifier(joint.name);
    const ax = joint.axis.x;
    const ay = joint.axis.y;
    const az = joint.axis.z;

    if (joint.type === "revolute" || joint.type === "continuous") {
      lines.push(`  Joints.Revolute ${jName}(n = {${ax}, ${ay}, ${az}})`);
    } else if (joint.type === "prismatic") {
      lines.push(`  Joints.Prismatic ${jName}(e = {${ax}, ${ay}, ${az}})`);
    } else {
      lines.push(`  Joints.Fixed ${jName}`);
    }
    lines.push(`    annotation(Placement(transformation(extent = {{-10, -10}, {10, 10}})));`);
  }
  lines.push("");

  // 4. Connect equations
  lines.push("equation");

  // Connect base to world
  const childLinks = new Set(Array.from(robot.joints.values()).map((j) => j.childLink));
  for (const linkName of robot.links.keys()) {
    if (!childLinks.has(linkName)) {
      const lName = sanitizeIdentifier(linkName);
      lines.push(`  connect(world.frame_b, ${lName}.frame_a);`);
    }
  }

  // Connect joints
  for (const joint of robot.joints.values()) {
    const jName = sanitizeIdentifier(joint.name);
    const pName = sanitizeIdentifier(joint.parentLink);
    const cName = sanitizeIdentifier(joint.childLink);

    lines.push(`  connect(${pName}.frame_b, ${jName}.frame_a);`);
    lines.push(`  connect(${jName}.frame_b, ${cName}.frame_a);`);
  }

  lines.push(`end ${modelName};`);
  return lines.join("\n");
}
