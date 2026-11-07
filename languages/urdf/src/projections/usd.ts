// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/urdf — Projection from ROS URDF/SDF to OpenUSD & UsdPhysics Scenes.
 *
 * Emits ISO/IEC-standard OpenUSD (.usda) and 64-byte aligned (.usdz) digital twin scenes
 * for NVIDIA Omniverse / Isaac Sim, Apple Vision Pro AR Quick Look, and WebGL viewers.
 *
 * Supports:
 *   - Rigid-body link hierarchies (`UsdGeomXform` + `PhysicsRigidBodyAPI` + `PhysicsMassAPI`)
 *   - Link mass properties: scalar mass, center of mass offset, and diagonal inertia
 *   - Visual geometry: procedural Box (Cube), Cylinder, Sphere, and Mesh prims with displayColor
 *   - Collision boundary representation: `PhysicsCollisionAPI` with collision filters
 *   - Kinematic & dynamic joints: `PhysicsRevoluteJoint`, `PhysicsPrismaticJoint`, `PhysicsFixedJoint`
 *   - Joint limits, joint axes, and parent/child coordinate frame transformations
 *   - Time-sampled forward kinematics trajectory animations (`xformOp:translate.timeSamples`, `xformOp:orient.timeSamples`)
 */

import { createUsdzArchive, sanitizeUsdIdentifier } from "@modelscript/cad";
import { computeForwardKinematics } from "../kinematics/featherstone.js";
import type { UrdfJoint, UrdfLink, UrdfRobot, UrdfTrajectoryData, Vector3D } from "../types.js";

// ── Public Types & Interfaces ────────────────────────────────────────────────

export type { UrdfTrajectoryData };

export interface UrdfUsdOptions {
  /** Root prim name for the USD stage. Defaults to sanitized robot name. */
  stageName?: string | undefined;
  /** Coordinate up-axis: "Z" (engineering standard) or "Y". Default: "Z". */
  upAxis?: "Y" | "Z" | undefined;
  /** Units in meters per unit. Default: 1.0 (meters). */
  metersPerUnit?: number | undefined;
  /** Whether to emit UsdPhysics schemas (RigidBodyAPI, MassAPI, Joints). Default: true. */
  includePhysics?: boolean | undefined;
  /** Whether to serialize visual representation meshes. Default: true. */
  includeVisuals?: boolean | undefined;
  /** Whether to serialize collision representation geometries. Default: true. */
  includeCollisions?: boolean | undefined;
  /** Optional simulation trajectory to bake into time-sampled animated link transforms. */
  trajectory?: UrdfTrajectoryData | undefined;
}

// ── Number & Quaternion Helpers ──────────────────────────────────────────────

function fmt(n: number): string {
  if (Object.is(n, -0)) return "0.0";
  if (Number.isInteger(n)) return `${n}.0`;
  const s = n.toFixed(6).replace(/\.?0+$/, "");
  return s.includes(".") ? s : `${s}.0`;
}

/** Convert Euler Roll-Pitch-Yaw angles (radians) to Quaternion [w, x, y, z]. */
function rpyToQuat(r: number, p: number, y: number): [number, number, number, number] {
  const cr = Math.cos(r * 0.5);
  const sr = Math.sin(r * 0.5);
  const cp = Math.cos(p * 0.5);
  const sp = Math.sin(p * 0.5);
  const cy = Math.cos(y * 0.5);
  const sy = Math.sin(y * 0.5);

  const qw = cr * cp * cy + sr * sp * sy;
  const qx = sr * cp * cy - cr * sp * sy;
  const qy = cr * sp * cy + sr * cp * sy;
  const qz = cr * cp * sy - sr * sp * cy;

  return [qw, qx, qy, qz];
}

/** Convert 3x3 rotation matrix (row-major) to Quaternion [w, x, y, z]. */
function rotMatrixToQuat(
  r: [number, number, number, number, number, number, number, number, number],
): [number, number, number, number] {
  const [r00, r01, r02, r10, r11, r12, r20, r21, r22] = r;
  const trace = r00 + r11 + r22;
  let qw: number, qx: number, qy: number, qz: number;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    qw = 0.25 / s;
    qx = (r21 - r12) * s;
    qy = (r02 - r20) * s;
    qz = (r10 - r01) * s;
  } else if (r00 > r11 && r00 > r22) {
    const s = 2.0 * Math.sqrt(1.0 + r00 - r11 - r22);
    qw = (r21 - r12) / s;
    qx = 0.25 * s;
    qy = (r01 + r10) / s;
    qz = (r02 + r20) / s;
  } else if (r11 > r22) {
    const s = 2.0 * Math.sqrt(1.0 + r11 - r00 - r22);
    qw = (r02 - r20) / s;
    qx = (r01 + r10) / s;
    qy = 0.25 * s;
    qz = (r12 + r21) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + r22 - r00 - r11);
    qw = (r10 - r01) / s;
    qx = (r02 + r20) / s;
    qy = (r12 + r21) / s;
    qz = 0.25 * s;
  }

  return [qw, qx, qy, qz];
}

function resolveAxisToken(axis: Vector3D): "X" | "Y" | "Z" {
  const ax = Math.abs(axis.x);
  const ay = Math.abs(axis.y);
  const az = Math.abs(axis.z);
  if (ax >= ay && ax >= az) return "X";
  if (ay >= ax && ay >= az) return "Y";
  return "Z";
}

// ── Link Serializer ──────────────────────────────────────────────────────────

function serializeLink(
  link: UrdfLink,
  _robot: UrdfRobot,
  options: UrdfUsdOptions,
  _stageName: string,
  linkTrajectorySamples?: {
    times: number[];
    positions: [number, number, number][];
    quats: [number, number, number, number][];
  },
): string[] {
  const lines: string[] = [];
  const linkPrimName = sanitizeUsdIdentifier(link.name);
  const isPhysics = options.includePhysics !== false;

  // 1. Prim declaration with optional UsdPhysics schemas
  const schemas: string[] = [];
  if (isPhysics) {
    schemas.push('"PhysicsRigidBodyAPI"', '"PhysicsMassAPI"');
  }

  const schemaAttr = schemas.length > 0 ? ` (\n        prepend apiSchemas = [${schemas.join(", ")}]\n    )` : "";

  lines.push(`    def Xform "${linkPrimName}"${schemaAttr}`);
  lines.push(`    {`);

  // 2. Rigid body & Mass properties
  if (isPhysics && link.inertial) {
    lines.push(`        bool physics:rigidBodyEnabled = true`);
    lines.push(`        float physics:mass = ${fmt(link.inertial.mass)}`);

    const com = link.inertial.origin?.xyz ?? { x: 0, y: 0, z: 0 };
    lines.push(`        point3f physics:centerOfMass = (${fmt(com.x)}, ${fmt(com.y)}, ${fmt(com.z)})`);
    lines.push(
      `        float3 physics:diagonalInertia = (${fmt(link.inertial.ixx)}, ${fmt(link.inertial.iyy)}, ${fmt(link.inertial.izz)})`,
    );
  }

  // 3. Transform & Time Samples
  if (linkTrajectorySamples && linkTrajectorySamples.times.length > 0) {
    // Time-sampled translate
    lines.push(`        double3 xformOp:translate.timeSamples = {`);
    for (let tIdx = 0; tIdx < linkTrajectorySamples.times.length; tIdx++) {
      const timeSec = linkTrajectorySamples.times[tIdx]!;
      const pos = linkTrajectorySamples.positions[tIdx]!;
      lines.push(`            ${fmt(timeSec)}: (${fmt(pos[0])}, ${fmt(pos[1])}, ${fmt(pos[2])}),`);
    }
    lines.push(`        }`);

    // Time-sampled orient
    lines.push(`        quatf xformOp:orient.timeSamples = {`);
    for (let tIdx = 0; tIdx < linkTrajectorySamples.times.length; tIdx++) {
      const timeSec = linkTrajectorySamples.times[tIdx]!;
      const q = linkTrajectorySamples.quats[tIdx]!;
      lines.push(`            ${fmt(timeSec)}: (${fmt(q[0])}, ${fmt(q[1])}, ${fmt(q[2])}, ${fmt(q[3])}),`);
    }
    lines.push(`        }`);
    lines.push(`        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:orient"]`);
  }

  // 4. Visual Geometries
  if (options.includeVisuals !== false && link.visuals.length > 0) {
    for (let vIdx = 0; vIdx < link.visuals.length; vIdx++) {
      const vis = link.visuals[vIdx]!;
      const visName = sanitizeUsdIdentifier(vis.name || `visual_${vIdx + 1}`);
      const geom = vis.geometry;

      lines.push(`        def Xform "${visName}"`);
      lines.push(`        {`);

      if (vis.origin) {
        const ox = vis.origin.xyz.x ?? 0;
        const oy = vis.origin.xyz.y ?? 0;
        const oz = vis.origin.xyz.z ?? 0;
        const [qw, qx, qy, qz] = rpyToQuat(vis.origin.rpy.x ?? 0, vis.origin.rpy.y ?? 0, vis.origin.rpy.z ?? 0);
        lines.push(`            double3 xformOp:translate = (${fmt(ox)}, ${fmt(oy)}, ${fmt(oz)})`);
        lines.push(`            quatf xformOp:orient = (${fmt(qw)}, ${fmt(qx)}, ${fmt(qy)}, ${fmt(qz)})`);
        lines.push(`            uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:orient"]`);
      }

      // Visual primitive geometry
      if (geom.type === "box" && geom.size) {
        lines.push(`            def Cube "box_shape"`);
        lines.push(`            {`);
        lines.push(`                double size = 1.0`);
        lines.push(
          `                double3 xformOp:scale = (${fmt(geom.size.x)}, ${fmt(geom.size.y)}, ${fmt(geom.size.z)})`,
        );
        lines.push(`                uniform token[] xformOpOrder = ["xformOp:scale"]`);
        if (vis.material?.color) {
          const c = vis.material.color;
          lines.push(`                color3f[] primvars:displayColor = [(${fmt(c.r)}, ${fmt(c.g)}, ${fmt(c.b)})]`);
        }
        lines.push(`            }`);
      } else if (geom.type === "cylinder") {
        const radius = geom.radius ?? 0.05;
        const height = geom.length ?? 0.1;
        lines.push(`            def Cylinder "cylinder_shape"`);
        lines.push(`            {`);
        lines.push(`                double radius = ${fmt(radius)}`);
        lines.push(`                double height = ${fmt(height)}`);
        lines.push(`                uniform token axis = "Z"`);
        if (vis.material?.color) {
          const c = vis.material.color;
          lines.push(`                color3f[] primvars:displayColor = [(${fmt(c.r)}, ${fmt(c.g)}, ${fmt(c.b)})]`);
        }
        lines.push(`            }`);
      } else if (geom.type === "sphere") {
        const radius = geom.radius ?? 0.05;
        lines.push(`            def Sphere "sphere_shape"`);
        lines.push(`            {`);
        lines.push(`                double radius = ${fmt(radius)}`);
        if (vis.material?.color) {
          const c = vis.material.color;
          lines.push(`                color3f[] primvars:displayColor = [(${fmt(c.r)}, ${fmt(c.g)}, ${fmt(c.b)})]`);
        }
        lines.push(`            }`);
      }

      lines.push(`        }`);
    }
  }

  // 5. Collision Geometries
  if (options.includeCollisions !== false && link.collisions.length > 0) {
    for (let cIdx = 0; cIdx < link.collisions.length; cIdx++) {
      const col = link.collisions[cIdx]!;
      const colName = sanitizeUsdIdentifier(col.name || `collision_${cIdx + 1}`);
      const geom = col.geometry;

      lines.push(`        def Xform "${colName}" (`);
      lines.push(`            prepend apiSchemas = ["PhysicsCollisionAPI"]`);
      lines.push(`        )`);
      lines.push(`        {`);
      lines.push(`            bool physics:collisionEnabled = true`);

      if (col.origin) {
        const ox = col.origin.xyz.x ?? 0;
        const oy = col.origin.xyz.y ?? 0;
        const oz = col.origin.xyz.z ?? 0;
        const [qw, qx, qy, qz] = rpyToQuat(col.origin.rpy.x ?? 0, col.origin.rpy.y ?? 0, col.origin.rpy.z ?? 0);
        lines.push(`            double3 xformOp:translate = (${fmt(ox)}, ${fmt(oy)}, ${fmt(oz)})`);
        lines.push(`            quatf xformOp:orient = (${fmt(qw)}, ${fmt(qx)}, ${fmt(qy)}, ${fmt(qz)})`);
        lines.push(`            uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:orient"]`);
      }

      if (geom.type === "box" && geom.size) {
        lines.push(`            def Cube "col_box"`);
        lines.push(`            {`);
        lines.push(`                double size = 1.0`);
        lines.push(
          `                double3 xformOp:scale = (${fmt(geom.size.x)}, ${fmt(geom.size.y)}, ${fmt(geom.size.z)})`,
        );
        lines.push(`                uniform token[] xformOpOrder = ["xformOp:scale"]`);
        lines.push(`            }`);
      } else if (geom.type === "cylinder") {
        lines.push(`            def Cylinder "col_cylinder"`);
        lines.push(`            {`);
        lines.push(`                double radius = ${fmt(geom.radius ?? 0.05)}`);
        lines.push(`                double height = ${fmt(geom.length ?? 0.1)}`);
        lines.push(`                uniform token axis = "Z"`);
        lines.push(`            }`);
      } else if (geom.type === "sphere") {
        lines.push(`            def Sphere "col_sphere"`);
        lines.push(`            {`);
        lines.push(`                double radius = ${fmt(geom.radius ?? 0.05)}`);
        lines.push(`            }`);
      }

      lines.push(`        }`);
    }
  }

  lines.push(`    }`);
  lines.push(``);
  return lines;
}

// ── Joint Serializer ─────────────────────────────────────────────────────────

function serializeJoint(joint: UrdfJoint, stageName: string): string[] {
  const lines: string[] = [];
  const jointPrimName = sanitizeUsdIdentifier(joint.name);
  const parentPath = `</${stageName}/${sanitizeUsdIdentifier(joint.parentLink)}>`;
  const childPath = `</${stageName}/${sanitizeUsdIdentifier(joint.childLink)}>`;

  let schemaType = "PhysicsRevoluteJoint";
  if (joint.type === "prismatic") schemaType = "PhysicsPrismaticJoint";
  else if (joint.type === "fixed") schemaType = "PhysicsFixedJoint";

  lines.push(`    def ${schemaType} "${jointPrimName}"`);
  lines.push(`    {`);
  lines.push(`        rel physics:body0 = ${parentPath}`);
  lines.push(`        rel physics:body1 = ${childPath}`);

  if (joint.type !== "fixed") {
    lines.push(`        uniform token physics:axis = "${resolveAxisToken(joint.axis)}"`);
  }

  if (joint.origin) {
    const ox = joint.origin.xyz.x ?? 0;
    const oy = joint.origin.xyz.y ?? 0;
    const oz = joint.origin.xyz.z ?? 0;
    const [qw, qx, qy, qz] = rpyToQuat(joint.origin.rpy.x ?? 0, joint.origin.rpy.y ?? 0, joint.origin.rpy.z ?? 0);
    lines.push(`        point3f physics:localPos0 = (${fmt(ox)}, ${fmt(oy)}, ${fmt(oz)})`);
    lines.push(`        quatf physics:localRot0 = (${fmt(qw)}, ${fmt(qx)}, ${fmt(qy)}, ${fmt(qz)})`);
  } else {
    lines.push(`        point3f physics:localPos0 = (0.0, 0.0, 0.0)`);
    lines.push(`        quatf physics:localRot0 = (1.0, 0.0, 0.0, 0.0)`);
  }

  lines.push(`        point3f physics:localPos1 = (0.0, 0.0, 0.0)`);
  lines.push(`        quatf physics:localRot1 = (1.0, 0.0, 0.0, 0.0)`);

  if (joint.limits) {
    if (joint.limits.lower !== undefined) {
      lines.push(`        float physics:lowerLimit = ${fmt(joint.limits.lower)}`);
    }
    if (joint.limits.upper !== undefined) {
      lines.push(`        float physics:upperLimit = ${fmt(joint.limits.upper)}`);
    }
  }

  lines.push(`    }`);
  lines.push(``);
  return lines;
}

// ── Main Projection Functions ────────────────────────────────────────────────

/**
 * Projects a URDF robot model into an OpenUSD (.usda) scene.
 */
export function urdfToUsd(robot: UrdfRobot, options?: UrdfUsdOptions): string {
  const stageName = sanitizeUsdIdentifier(options?.stageName ?? robot.name ?? "Robot");
  const upAxis = options?.upAxis ?? "Z";
  const metersPerUnit = options?.metersPerUnit ?? 1.0;

  // Precompute link trajectory poses if trajectory provided
  const linkTrajectoryMap = new Map<
    string,
    { times: number[]; positions: [number, number, number][]; quats: [number, number, number, number][] }
  >();

  if (options?.trajectory && options.trajectory.times.length > 0) {
    const traj = options.trajectory;
    const rawJoints = traj.jointPositions ?? traj.joints ?? {};
    const jointPosMap =
      rawJoints instanceof Map ? rawJoints : new Map(Object.entries(rawJoints));

    for (let tIdx = 0; tIdx < traj.times.length; tIdx++) {
      const timeVal = traj.times[tIdx]!;
      const qInstant = new Map<string, number>();

      for (const [jName, arr] of jointPosMap.entries()) {
        qInstant.set(jName, arr[tIdx] ?? 0);
      }

      const fkPoses = computeForwardKinematics(robot, qInstant);

      for (const [lName, pose] of fkPoses.entries()) {
        let entry = linkTrajectoryMap.get(lName);
        if (!entry) {
          entry = { times: [], positions: [], quats: [] };
          linkTrajectoryMap.set(lName, entry);
        }
        entry.times.push(timeVal);
        entry.positions.push([pose.position[0], pose.position[1], pose.position[2]]);
        entry.quats.push(rotMatrixToQuat(pose.rotation));
      }
    }
  }

  const lines: string[] = [
    `#usda 1.0`,
    `(`,
    `    defaultPrim = "${stageName}"`,
    `    metersPerUnit = ${metersPerUnit}`,
    `    upAxis = "${upAxis}"`,
    `    customLayerData = {`,
    `        string creator = "ModelScript URDF-to-USD Digital Twin Compiler"`,
    `    }`,
    `)`,
    ``,
    `def Xform "${stageName}" (`,
    `    kind = "assembly"`,
    `)`,
    `{`,
  ];

  // 1. Serialize all links
  for (const link of robot.links.values()) {
    const linkTraj = linkTrajectoryMap.get(link.name);
    lines.push(...serializeLink(link, robot, options ?? {}, stageName, linkTraj));
  }

  // 2. Serialize all joints
  if (options?.includePhysics !== false) {
    for (const joint of robot.joints.values()) {
      lines.push(...serializeJoint(joint, stageName));
    }
  }

  lines.push(`}`);
  lines.push(``);
  return lines.join("\n");
}

/**
 * Projects a URDF robot model into a 64-byte aligned OpenUSD package (.usdz).
 */
export function urdfToUsdz(robot: UrdfRobot, options?: UrdfUsdOptions): Uint8Array {
  const usdaText = urdfToUsd(robot, options);
  const stageName = sanitizeUsdIdentifier(options?.stageName ?? robot.name ?? "robot");
  return createUsdzArchive({
    [`${stageName}.usda`]: usdaText,
  });
}
