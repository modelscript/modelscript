// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/urdf — Projection from ROS URDF to Modelica.Mechanics.MultiBody
 * and standalone browser-simulatable hybrid Modelica + WAM models.
 */

import type { UrdfRobot, UrdfTrajectoryData } from "../types.js";

/**
 * Sanitizes an arbitrary URDF identifier into a valid Modelica identifier,
 * prefixing leading digits and optionally deduplicating against `used`.
 */
export function sanitizeUrdfModelicaIdent(str?: string | null, used?: Set<string>): string {
  const safeStr = typeof str === "string" && str ? str : "Robot";
  let res = "";
  for (let i = 0; i < safeStr.length; i++) {
    const ch = safeStr.charCodeAt(i);
    if (
      (ch >= 65 && ch <= 90) || // A-Z
      (ch >= 97 && ch <= 122) || // a-z
      (ch >= 48 && ch <= 57) || // 0-9
      ch === 95 // _
    ) {
      res += safeStr[i];
    } else {
      res += "_";
    }
  }
  if (!res) res = "ident";
  if (res.charCodeAt(0) >= 48 && res.charCodeAt(0) <= 57) {
    res = `_${res}`;
  }
  if (!used) return res;
  let candidate = res;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${res}_${suffix++}`;
  }
  used.add(candidate);
  return candidate;
}

export interface UrdfModelicaOptions {
  /** Enable `useAxisFlange = true` on revolute/prismatic joints for actuator attachment. */
  useAxisFlange?: boolean | undefined;
}

/**
 * Generates an idiomatic Modelica 3.x multibody robot model from a URDF robot.
 */
export function urdfToModelica(robot: UrdfRobot, options: UrdfModelicaOptions = {}): string {
  const modelName = sanitizeUrdfModelicaIdent(robot.name);
  const used = new Set<string>(["world"]);
  const linkIdent = new Map<string, string>();
  const jointIdent = new Map<string, string>();
  for (const name of robot.links.keys()) linkIdent.set(name, sanitizeUrdfModelicaIdent(name, used));
  for (const name of robot.joints.keys()) jointIdent.set(name, sanitizeUrdfModelicaIdent(name, used));

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
    const lName = linkIdent.get(link.name)!;
    const m = link.inertial?.mass ?? 1.0;
    const i11 = link.inertial?.ixx ?? m * 0.1;
    const i22 = link.inertial?.iyy ?? m * 0.1;
    const i33 = link.inertial?.izz ?? m * 0.1;

    lines.push(`  Parts.Body ${lName}(m = ${m}, I_11 = ${i11}, I_22 = ${i22}, I_33 = ${i33})`);
    lines.push(`    annotation(Placement(transformation(extent = {{-10, -10}, {10, 10}})));`);
  }
  lines.push("");

  // 3. Kinematic Joints & Origin Translations
  const flangeMod = options.useAxisFlange ? ", useAxisFlange = true" : "";
  for (const joint of robot.joints.values()) {
    const jName = jointIdent.get(joint.name)!;
    if (joint.origin && (joint.origin.xyz.x !== 0 || joint.origin.xyz.y !== 0 || joint.origin.xyz.z !== 0)) {
      const ox = joint.origin.xyz.x;
      const oy = joint.origin.xyz.y;
      const oz = joint.origin.xyz.z;
      lines.push(`  Parts.FixedTranslation ${jName}_trans(r = {${ox}, ${oy}, ${oz}})`);
      lines.push(`    annotation(Placement(transformation(extent = {{-10, -10}, {10, 10}})));`);
    }
    const ax = joint.axis.x;
    const ay = joint.axis.y;
    const az = joint.axis.z;

    if (joint.type === "revolute" || joint.type === "continuous") {
      lines.push(`  Joints.Revolute ${jName}(n = {${ax}, ${ay}, ${az}}${flangeMod})`);
    } else if (joint.type === "prismatic") {
      lines.push(`  Joints.Prismatic ${jName}(e = {${ax}, ${ay}, ${az}}${flangeMod})`);
    } else {
      lines.push(`  Joints.Fixed ${jName}`);
    }
    lines.push(`    annotation(Placement(transformation(extent = {{-10, -10}, {10, 10}})));`);
  }
  lines.push("");

  // 4. Connect equations
  lines.push("equation");

  const childLinks = new Set(Array.from(robot.joints.values()).map((j) => j.childLink));
  for (const linkName of robot.links.keys()) {
    if (!childLinks.has(linkName)) {
      const lName = linkIdent.get(linkName)!;
      lines.push(`  connect(world.frame_b, ${lName}.frame_a);`);
    }
  }

  for (const joint of robot.joints.values()) {
    const jName = jointIdent.get(joint.name)!;
    const pName = linkIdent.get(joint.parentLink)!;
    const cName = linkIdent.get(joint.childLink)!;

    lines.push(`  connect(${pName}.frame_b, ${jName}.frame_a);`);
    lines.push(`  connect(${jName}.frame_b, ${cName}.frame_a);`);
  }

  lines.push(`end ${modelName};`);
  return lines.join("\n");
}

export interface HybridWamModelicaOptions {
  /** Name of the WAM residual Modelica block (default: "WamResidualBlock"). */
  wamBlockName?: string | undefined;
  /** Optional emitted Modelica block code to inline in the generated file. */
  wamBlockCode?: string | undefined;
  /** Proportional controller gain per actuated joint (default: 20.0). */
  kp?: number | undefined;
  /** Derivative controller gain per actuated joint (default: 5.5). */
  kd?: number | undefined;
  /**
   * When true, emits a self-contained equation-based Modelica rigid-body model
   * (no Modelica.Mechanics.MultiBody dependency) so browser WASM DAE simulation
   * works out-of-the-box without preloading MSL.
   */
  standaloneEquationModel?: boolean | undefined;
}

function computeRefAmplitude(joint: {
  limits?: { lower?: number | undefined; upper?: number | undefined } | undefined;
}): number {
  const lo = joint.limits?.lower;
  const hi = joint.limits?.upper;
  if (lo !== undefined && hi !== undefined && Number.isFinite(lo) && Number.isFinite(hi)) {
    return Math.min(0.7, Math.max(0.1, Math.min(Math.abs(lo), Math.abs(hi)) * 0.8));
  }
  return 0.7;
}

/**
 * Generates a hybrid Modelica model extending a URDF robot with a PD controller
 * and a WAM residual augmentation block (tau_total = tau_ctrl + tau_wam).
 */
export function urdfToHybridWamModelica(robot: UrdfRobot, options: HybridWamModelicaOptions = {}): string {
  const baseName = sanitizeUrdfModelicaIdent(robot.name);
  const hybridName = `${baseName}_HybridWAM`;
  const wamBlockName = options.wamBlockName ?? "WamResidualBlock";
  const kp = options.kp ?? 20.0;
  const kd = options.kd ?? 5.5;

  const actuatedJoints = Array.from(robot.joints.values()).filter(
    (j) => j.type === "revolute" || j.type === "continuous" || j.type === "prismatic",
  );
  const usedJointIdents = new Set<string>();
  const jointIdents = actuatedJoints.map((j) => sanitizeUrdfModelicaIdent(j.name, usedJointIdents));

  if (options.standaloneEquationModel) {
    const lines: string[] = [];
    // Put the primary hybrid model FIRST so single-file class extractors pick it up immediately
    lines.push(`model ${hybridName}`);
    lines.push(`  "Standalone Hybrid Physics + WAM Robot Controller (Browser WASM DAE)"`);
    lines.push(`  parameter Real kp = ${kp};`);
    lines.push(`  parameter Real kd = ${kd};`);
    lines.push(`  parameter Boolean enableWam = ${options.wamBlockCode ? "true" : "false"};`);

    for (let i = 0; i < actuatedJoints.length; i++) {
      const j = actuatedJoints[i]!;
      const jn = jointIdents[i]!;
      const childLink = robot.links.get(j.childLink);
      const effInertia = Math.max(0.05, childLink?.inertial?.iyy ?? childLink?.inertial?.izz ?? 0.35);
      const maxAmp = computeRefAmplitude(j);

      lines.push(`  parameter Real I_${jn} = ${effInertia.toFixed(4)} "Effective joint inertia";`);
      lines.push(`  parameter Real refAmp_${jn} = ${maxAmp.toFixed(3)};`);
      lines.push(`  parameter Real refFreq_${jn} = 1.4;`);
      lines.push(`  parameter Real refPhase_${jn} = ${(i * 0.6).toFixed(2)};`);
      lines.push(`  Real ${jn}_phi(start = 0.0, fixed = true);`);
      lines.push(`  Real ${jn}_w(start = 0.0, fixed = true);`);
      lines.push(`  Real q_ref_${jn};`);
      lines.push(`  Real tau_ctrl_${jn};`);
      lines.push(`  Real tau_wam_${jn};`);
      lines.push(`  Real tau_total_${jn};`);
      lines.push(`  Real tau_dist_${jn};`);
    }

    if (options.wamBlockCode && actuatedJoints.length > 0) {
      lines.push(`  ${wamBlockName} wam;`);
    }

    lines.push(`equation`);
    for (let i = 0; i < actuatedJoints.length; i++) {
      const jn = jointIdents[i]!;
      lines.push(`  q_ref_${jn} = refAmp_${jn} * sin(refFreq_${jn} * time + refPhase_${jn});`);
      lines.push(`  tau_ctrl_${jn} = kp * (q_ref_${jn} - ${jn}_phi) - kd * ${jn}_w;`);
      if (options.wamBlockCode) {
        lines.push(`  wam.q_${jn} = ${jn}_phi;`);
        lines.push(`  wam.dq_${jn} = ${jn}_w;`);
        lines.push(`  wam.u_${jn} = tau_ctrl_${jn};`);
        lines.push(`  tau_wam_${jn} = if enableWam then wam.tau_res_${jn} else 0.0;`);
      } else {
        lines.push(`  tau_wam_${jn} = 0.0;`);
      }
      lines.push(`  tau_total_${jn} = tau_ctrl_${jn} + tau_wam_${jn};`);
      lines.push(
        `  tau_dist_${jn} = 1.35 * tanh(5.0 * ${jn}_w) + 0.85 * sin(${jn}_phi + ${(0.3 * i).toFixed(2)}) + 0.08 * tau_ctrl_${jn};`,
      );
      lines.push(`  der(${jn}_phi) = ${jn}_w;`);
      lines.push(`  I_${jn} * der(${jn}_w) = tau_total_${jn} - tau_dist_${jn} - 0.15 * ${jn}_w;`);
    }

    lines.push(`end ${hybridName};`);
    if (options.wamBlockCode) {
      lines.push("", options.wamBlockCode.trim());
    }
    return lines.join("\n");
  }

  // Full Modelica.Mechanics.MultiBody mode with actuated joint axis flanges
  const baseModelica = urdfToModelica(robot, { useAxisFlange: true });
  const lines: string[] = [];

  lines.push(`model ${hybridName}`);
  lines.push(`  "Hybrid Physics + WAM Residual Augmented Robot Controller"`);
  lines.push(`  extends ${baseName};`);
  lines.push(`  import Modelica.Mechanics.Rotational;`);
  lines.push(`  import Modelica.Mechanics.Translational;`);
  lines.push(`  parameter Real kp = ${kp} "Nominal proportional gain";`);
  lines.push(`  parameter Real kd = ${kd} "Nominal derivative gain";`);
  lines.push(`  parameter Boolean enableWam = ${options.wamBlockCode ? "true" : "false"};`);

  for (let i = 0; i < actuatedJoints.length; i++) {
    const j = actuatedJoints[i]!;
    const jn = jointIdents[i]!;
    const maxAmp = computeRefAmplitude(j);
    lines.push(`  parameter Real refAmp_${jn} = ${maxAmp.toFixed(3)};`);
    lines.push(`  parameter Real refFreq_${jn} = 1.4;`);
    lines.push(`  parameter Real refPhase_${jn} = ${(i * 0.6).toFixed(2)};`);
    lines.push(`  Real q_ref_${jn}(start = 0.0);`);
    lines.push(`  Real tau_ctrl_${jn};`);
    lines.push(`  Real tau_wam_${jn};`);
    lines.push(`  Real tau_total_${jn};`);
    if (j.type === "prismatic") {
      lines.push(`  Translational.Sources.Force act_${jn};`);
    } else {
      lines.push(`  Rotational.Sources.Torque act_${jn};`);
    }
  }

  if (options.wamBlockCode && actuatedJoints.length > 0) {
    lines.push(`  ${wamBlockName} wam;`);
  }

  lines.push(`equation`);
  for (let i = 0; i < actuatedJoints.length; i++) {
    const j = actuatedJoints[i]!;
    const jn = jointIdents[i]!;
    const posVar = j.type === "prismatic" ? `${jn}.s` : `${jn}.phi`;
    const velVar = j.type === "prismatic" ? `${jn}.v` : `${jn}.w`;
    const forceInput = j.type === "prismatic" ? `act_${jn}.f` : `act_${jn}.tau`;

    lines.push(`  q_ref_${jn} = refAmp_${jn} * sin(refFreq_${jn} * time + refPhase_${jn});`);
    lines.push(`  tau_ctrl_${jn} = kp * (q_ref_${jn} - ${posVar}) - kd * ${velVar};`);
    if (options.wamBlockCode) {
      lines.push(`  wam.q_${jn} = ${posVar};`);
      lines.push(`  wam.dq_${jn} = ${velVar};`);
      lines.push(`  wam.u_${jn} = tau_ctrl_${jn};`);
      lines.push(`  tau_wam_${jn} = if enableWam then wam.tau_res_${jn} else 0.0;`);
    } else {
      lines.push(`  tau_wam_${jn} = 0.0;`);
    }
    lines.push(`  tau_total_${jn} = tau_ctrl_${jn} + tau_wam_${jn};`);
    lines.push(`  ${forceInput} = tau_total_${jn};`);
    lines.push(`  connect(act_${jn}.flange, ${jn}.axis);`);
  }

  lines.push(`end ${hybridName};`, ``);
  lines.push(baseModelica);
  if (options.wamBlockCode) {
    lines.push(``, options.wamBlockCode.trim());
  }
  return lines.join("\n");
}

/**
 * Maps simulated joint time-series (from Modelica DAE or browser integrator) into UrdfTrajectoryData.
 */
export function simulationSeriesToUrdfTrajectory(
  times: number[],
  jointSeries: Record<string, number[]>,
): UrdfTrajectoryData {
  const jointPositions: Record<string, number[]> = {};
  for (const [name, values] of Object.entries(jointSeries)) {
    jointPositions[name] = values;
  }
  return {
    times,
    jointPositions,
  };
}
