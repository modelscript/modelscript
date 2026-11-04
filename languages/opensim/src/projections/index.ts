// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opensim — Cross-Domain Projections (Modelica 3.x & ROS/Gazebo URDF).
 */

import type { OpenSimDocument, OpenSimJointType } from "../types.js";

function sanitizeId(raw: string): string {
  const s = raw.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[a-zA-Z_]/.test(s) ? s : `_${s}`;
}

function canonicalFrame(raw: string): string {
  const t = raw.trim();
  if (t === "ground" || t === "/ground") return "ground";
  return t.replace(/^\/?bodyset\//i, "").replace(/^\//, "");
}

/**
 * Projects an OpenSim musculoskeletal document into a complete Modelica 3.x model.
 */
export function openSimToModelica(doc: OpenSimDocument): string {
  const modelId = sanitizeId(doc.modelName || "OpenSimMusculoskeletalModel");
  const lines: string[] = [];

  lines.push(`model ${modelId} "OpenSim ${doc.version} Musculoskeletal Model (${doc.modelName})"`);
  lines.push(
    `  parameter Real gravity[3] = {${doc.gravity[0]}, ${doc.gravity[1]}, ${doc.gravity[2]}} "Gravity vector [m/s^2]";`,
  );

  if (doc.bodies.length > 0) {
    lines.push("");
    lines.push("  // Rigid Body Inertial Parameters");
    for (const b of doc.bodies) {
      const bId = sanitizeId(b.name);
      const [ixx, iyy, izz] = b.inertia;
      lines.push(`  parameter Real mass_${bId}(unit="kg") = ${b.mass};`);
      lines.push(`  parameter Real Ixx_${bId}(unit="kg.m2") = ${ixx};`);
      lines.push(`  parameter Real Iyy_${bId}(unit="kg.m2") = ${iyy};`);
      lines.push(`  parameter Real Izz_${bId}(unit="kg.m2") = ${izz};`);
    }
  }

  if (doc.muscles.length > 0) {
    lines.push("");
    lines.push("  // Hill-Type Muscle Parameters & States");
    for (const m of doc.muscles) {
      const mId = sanitizeId(m.name);
      lines.push(`  parameter Real F_max_${mId}(unit="N") = ${m.maxIsometricForce};`);
      lines.push(`  parameter Real l_opt_${mId}(unit="m") = ${m.optimalFiberLength};`);
      lines.push(`  parameter Real l_slack_${mId}(unit="m") = ${m.tendonSlackLength};`);
      lines.push(`  parameter Real alpha_opt_${mId}(unit="rad") = ${m.pennationAngleAtOptimal};`);
      lines.push(`  parameter Real tau_act_${mId}(unit="s") = ${m.activationTimeConstant};`);
      lines.push(`  parameter Real tau_deact_${mId}(unit="s") = ${m.deactivationTimeConstant};`);
      lines.push(`  Real u_exc_${mId} "Neural excitation for ${m.name}";`);
      lines.push(`  Real a_${mId}(start=0.05, fixed=true) "Activation of ${m.name}";`);
      lines.push(`  Real l_M_${mId}(start=${m.optimalFiberLength}, fixed=true, unit="m") "Fiber length of ${m.name}";`);
      lines.push(`  Real F_M_${mId}(unit="N") "Tendon force of ${m.name}";`);
    }
  }

  const allCoords: Array<{
    coordName: string;
    cId: string;
    defaultValue: number;
    locked: boolean;
    motionType: string;
    childBody: string;
    parentBody: string;
  }> = [];

  for (const j of doc.joints) {
    for (const c of j.coordinates) {
      allCoords.push({
        coordName: c.name,
        cId: sanitizeId(c.name),
        defaultValue: c.defaultValue,
        locked: c.locked,
        motionType: c.motionType,
        childBody: canonicalFrame(j.childFrame),
        parentBody: canonicalFrame(j.parentFrame),
      });
    }
  }

  if (allCoords.length > 0) {
    lines.push("");
    lines.push("  // Generalized Coordinates & Speeds");
    for (const c of allCoords) {
      const unit = c.motionType === "translational" ? "m" : "rad";
      const velUnit = c.motionType === "translational" ? "m/s" : "rad/s";
      lines.push(`  Real q_${c.cId}(start=${c.defaultValue}, fixed=true, unit="${unit}");`);
      lines.push(`  Real u_${c.cId}(start=0.0, fixed=true, unit="${velUnit}");`);
    }
  }

  lines.push("");
  lines.push("equation");

  for (const m of doc.muscles) {
    const mId = sanitizeId(m.name);
    lines.push(`  u_exc_${mId} = 0.5;`);
    lines.push(
      `  der(a_${mId}) = if u_exc_${mId} > a_${mId} then (u_exc_${mId} - a_${mId}) / (tau_act_${mId} * (0.5 + 1.5 * a_${mId})) else (u_exc_${mId} - a_${mId}) / (tau_deact_${mId} / (0.5 + 1.5 * a_${mId}));`,
    );
    lines.push(`  der(l_M_${mId}) = (l_opt_${mId} - l_M_${mId}) / tau_deact_${mId};`);
    lines.push(
      `  F_M_${mId} = F_max_${mId} * a_${mId} * exp(-((l_M_${mId} / l_opt_${mId} - 1.0) ^ 2) / 0.45) * cos(alpha_opt_${mId});`,
    );
  }

  const bodyNames = new Set(doc.bodies.map((b) => b.name));
  for (const c of allCoords) {
    lines.push(`  der(q_${c.cId}) = u_${c.cId};`);
    if (c.locked) {
      lines.push(`  der(u_${c.cId}) = 0.0;`);
      continue;
    }

    const spanningMuscleTerms: string[] = [];
    for (const m of doc.muscles) {
      const frames = m.pathPoints.map((pp) => canonicalFrame(pp.bodyFrame));
      if (frames.includes(c.childBody) || frames.includes(c.parentBody)) {
        spanningMuscleTerms.push(`0.04 * F_M_${sanitizeId(m.name)}`);
      }
    }

    const tauMuscleExpr = spanningMuscleTerms.length > 0 ? spanningMuscleTerms.join(" + ") : "0.0";
    const hasChildBody = bodyNames.has(c.childBody);
    const childId = sanitizeId(c.childBody);
    const massRef = hasChildBody ? `mass_${childId}` : "1.0";
    const inertiaRef = c.motionType === "translational" ? massRef : hasChildBody ? `Izz_${childId}` : "1.0";
    const gravTerm =
      c.motionType === "translational" ? `${massRef} * gravity[2]` : `-${massRef} * 9.80665 * 0.1 * sin(q_${c.cId})`;

    lines.push(`  der(u_${c.cId}) = (${tauMuscleExpr} - 0.5 * u_${c.cId} + (${gravTerm})) / ${inertiaRef};`);
  }

  lines.push(`end ${modelId};`);
  return lines.join("\n");
}

function mapJointTypeToUrdf(
  jointType: OpenSimJointType,
  hasCoordinates: boolean,
): "revolute" | "prismatic" | "fixed" | "floating" {
  switch (jointType) {
    case "PinJoint":
      return "revolute";
    case "SliderJoint":
      return "prismatic";
    case "WeldJoint":
      return "fixed";
    case "FreeJoint":
      return "floating";
    case "BallJoint":
    case "CustomJoint":
      return hasCoordinates ? "revolute" : "fixed";
  }
}

/**
 * Projects an OpenSim musculoskeletal document into a valid URDF `<robot>` XML string.
 */
export function openSimToUrdf(doc: OpenSimDocument): string {
  const robotName = sanitizeId(doc.modelName || "opensim_robot");
  const lines: string[] = [];

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<robot name="${robotName}">`);

  const definedLinks = new Set<string>(doc.bodies.map((b) => b.name));
  const usesGround = doc.joints.some(
    (j) => canonicalFrame(j.parentFrame) === "ground" || canonicalFrame(j.childFrame) === "ground",
  );
  if (usesGround && !definedLinks.has("ground")) {
    lines.push(`  <link name="ground"/>`);
  }

  for (const b of doc.bodies) {
    const [cx, cy, cz] = b.massCenter;
    const [ixx, iyy, izz, ixy, ixz, iyz] = b.inertia;
    lines.push(`  <link name="${b.name}">`);
    lines.push(`    <inertial>`);
    lines.push(`      <origin xyz="${cx} ${cy} ${cz}" rpy="0 0 0"/>`);
    lines.push(`      <mass value="${b.mass}"/>`);
    lines.push(`      <inertia ixx="${ixx}" ixy="${ixy}" ixz="${ixz}" iyy="${iyy}" iyz="${iyz}" izz="${izz}"/>`);
    lines.push(`    </inertial>`);
    lines.push(`  </link>`);
  }

  for (const j of doc.joints) {
    const urdfType = mapJointTypeToUrdf(j.jointType, j.coordinates.length > 0);
    const parentLink = canonicalFrame(j.parentFrame) || "ground";
    const childLink = canonicalFrame(j.childFrame);
    const [lx, ly, lz] = j.locationInParent;
    const [rx, ry, rz] = j.orientationInParent;

    lines.push(`  <joint name="${j.name}" type="${urdfType}">`);
    lines.push(`    <parent link="${parentLink}"/>`);
    lines.push(`    <child link="${childLink}"/>`);
    lines.push(`    <origin xyz="${lx} ${ly} ${lz}" rpy="${rx} ${ry} ${rz}"/>`);

    if (urdfType === "revolute" || urdfType === "prismatic") {
      lines.push(`    <axis xyz="0 0 1"/>`);
      const primaryCoord = j.coordinates[0];
      const lower = primaryCoord ? primaryCoord.rangeMin : -3.14159;
      const upper = primaryCoord ? primaryCoord.rangeMax : 3.14159;
      lines.push(`    <limit lower="${lower}" upper="${upper}" effort="1000" velocity="10"/>`);
    }

    lines.push(`  </joint>`);
  }

  lines.push(`</robot>`);
  return lines.join("\n");
}
