// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/adams — Projection from MSC Adams to Modelica.Mechanics.MultiBody.
 */

import type { AdamsDataset, AdamsJointType } from "../types.js";

/**
 * Generates an idiomatic Modelica 3.x multibody model from an Adams dataset.
 */
export function adamsToModelica(dataset: AdamsDataset): string {
  const modelName = dataset.title.replace(/[^a-zA-Z0-9_]/g, "_");
  const lines: string[] = [];

  lines.push(`model ${modelName}`);
  lines.push(`  "Synthesized from MSC Adams Dataset"`);
  lines.push(`  import Modelica.Mechanics.MultiBody;`);
  lines.push(`  import Modelica.Mechanics.MultiBody.Parts;`);
  lines.push(`  import Modelica.Mechanics.MultiBody.Joints;`);
  lines.push(`  import Modelica.Mechanics.MultiBody.Forces;`);
  lines.push("");

  // 1. World ground object
  lines.push(
    `  MultiBody.World world(gravityType = MultiBody.Types.GravityTypes.ConstantGravity, g = 9.80665, n = {0, 0, -1}) annotation(Placement(transformation(extent = {{-80, -80}, {-60, -60}})));`,
  );

  // 2. Rigid Bodies
  for (const part of dataset.parts.values()) {
    if (part.isGround) continue;
    const pName = `part_${part.id}`;
    const m = part.mass;
    const i11 = part.inertia.ixx;
    const i22 = part.inertia.iyy;
    const i33 = part.inertia.izz;

    lines.push(`  Parts.Body ${pName}(m = ${m}, I_11 = ${i11}, I_22 = ${i22}, I_33 = ${i33})`);
    lines.push(`    annotation(Placement(transformation(extent = {{-10, -10}, {10, 10}})));`);
  }
  lines.push("");

  // 3. Kinematic Joints
  for (const joint of dataset.joints.values()) {
    const jName = `joint_${joint.id}`;
    const moType = getModelicaJointType(joint.type);
    lines.push(`  Joints.${moType} ${jName}`);
    lines.push(`    annotation(Placement(transformation(extent = {{-10, -10}, {10, 10}})));`);
  }
  lines.push("");

  // 4. Forces (Spring-Damper)
  for (const force of dataset.forces.values()) {
    const fName = `force_${force.id}`;
    const k = force.stiffness ?? 1000.0;
    const c = force.damping ?? 50.0;
    const s0 = force.freeLength ?? 0.0;
    lines.push(`  Forces.SpringDamper ${fName}(c = ${k}, d = ${c}, s_unstretched = ${s0})`);
    lines.push(`    annotation(Placement(transformation(extent = {{-10, -10}, {10, 10}})));`);
  }
  lines.push("");

  // 5. Connect equations
  lines.push("equation");

  for (const joint of dataset.joints.values()) {
    const jName = `joint_${joint.id}`;
    const mA = dataset.markers.get(joint.iMarkerId);
    const mB = dataset.markers.get(joint.jMarkerId);
    if (!mA || !mB) continue;

    const getFrame = (markerId: string | number) => {
      const m = dataset.markers.get(markerId);
      if (!m) return "world.frame_b";
      const part = dataset.parts.get(m.partId);
      if (!part || part.isGround) return "world.frame_b";
      return `part_${part.id}.frame_a`;
    };

    lines.push(`  connect(${getFrame(joint.iMarkerId)}, ${jName}.frame_a);`);
    lines.push(`  connect(${jName}.frame_b, ${getFrame(joint.jMarkerId)});`);
  }

  for (const force of dataset.forces.values()) {
    const fName = `force_${force.id}`;
    const getFrame = (markerId: string | number) => {
      const m = dataset.markers.get(markerId);
      if (!m) return "world.frame_b";
      const part = dataset.parts.get(m.partId);
      if (!part || part.isGround) return "world.frame_b";
      return `part_${part.id}.frame_b`;
    };

    lines.push(`  connect(${getFrame(force.iMarkerId)}, ${fName}.frame_a);`);
    lines.push(`  connect(${fName}.frame_b, ${getFrame(force.jMarkerId)});`);
  }

  lines.push(`end ${modelName};`);
  return lines.join("\n");
}

function getModelicaJointType(type: AdamsJointType): string {
  switch (type) {
    case "REVOLUTE":
      return "Revolute(n = {0, 0, 1})";
    case "TRANSLATIONAL":
      return "Prismatic(e = {0, 0, 1})";
    case "SPHERICAL":
      return "Spherical";
    case "UNIVERSAL":
      return "Universal";
    case "PLANAR":
      return "Planar";
    case "FIXED":
      return "Fixed";
    case "CYLINDRICAL":
      return "Cylindrical";
    default:
      return "Revolute";
  }
}
