// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/urdf — Trajectory interpolation, Cartesian toolpath generators,
 * 3D visual/collision pose evaluation, and live digital twin telemetry.
 */

import type {
  DigitalTwinClearanceResult,
  DigitalTwinEnvironmentAsset,
  DigitalTwinLiveTelemetry,
  DigitalTwinProgramStep,
  DigitalTwinToolpathTrace,
  UrdfColor,
  UrdfGeometry,
  UrdfLink,
  UrdfMaterial,
  UrdfRobot,
  UrdfTrajectoryData,
  UrdfVisualPose3D,
} from "../types.js";
import {
  computeForwardKinematics,
  type LinkPose,
  multiplyRot9,
  multRotVec,
  type RotMatrix9,
  rotationMatrixFromAxisAngle,
  rotationMatrixFromRpy,
} from "./featherstone.js";

function resolveTrajectoryJointMap(trajectory: UrdfTrajectoryData): Map<string, number[]> {
  const raw = trajectory.jointPositions ?? trajectory.joints;
  if (!raw) return new Map();
  return raw instanceof Map ? raw : new Map(Object.entries(raw));
}

/**
 * Interpolates joint positions at an arbitrary continuous timestamp `time`
 * given a discrete trajectory of keyframe times and coordinate arrays.
 */
export function interpolateJointTrajectory(
  trajectory: UrdfTrajectoryData,
  time: number,
): Map<string, number> {
  const result = new Map<string, number>();
  const times = trajectory.times;
  if (!times || times.length === 0) return result;

  const jointPosMap = resolveTrajectoryJointMap(trajectory);

  // Boundary cases
  if (time <= times[0]!) {
    for (const [name, arr] of jointPosMap) {
      result.set(name, arr[0] ?? 0);
    }
    return result;
  }

  const lastIdx = times.length - 1;
  if (time >= times[lastIdx]!) {
    for (const [name, arr] of jointPosMap) {
      result.set(name, arr[lastIdx] ?? 0);
    }
    return result;
  }

  // Linear scan for interval [idx, idx+1]
  let idx = 0;
  while (idx < lastIdx && times[idx + 1]! < time) {
    idx++;
  }

  const t0 = times[idx]!;
  const t1 = times[idx + 1]!;
  const dt = t1 - t0;
  const alpha = dt > 1e-9 ? (time - t0) / dt : 0;
  // Smooth cubic Hermite ease-in-out factor
  const s = alpha * alpha * (3 - 2 * alpha);

  for (const [name, arr] of jointPosMap) {
    const q0 = arr[idx] ?? 0;
    const q1 = arr[idx + 1] ?? q0;
    result.set(name, q0 + (q1 - q0) * s);
  }

  return result;
}

/**
 * Computes instantaneous joint velocities dq/dt [rad/s or m/s] at timestamp `time`
 * using the analytical derivative of the cubic Hermite trajectory interpolant.
 */
export function interpolateJointVelocity(
  trajectory: UrdfTrajectoryData,
  time: number,
): Map<string, number> {
  const result = new Map<string, number>();
  const times = trajectory.times;
  if (!times || times.length < 2) return result;

  const jointPosMap = resolveTrajectoryJointMap(trajectory);

  const lastIdx = times.length - 1;
  if (time <= times[0]! || time >= times[lastIdx]!) {
    for (const [name] of jointPosMap) {
      result.set(name, 0);
    }
    return result;
  }

  let idx = 0;
  while (idx < lastIdx && times[idx + 1]! < time) {
    idx++;
  }

  const t0 = times[idx]!;
  const t1 = times[idx + 1]!;
  const dt = t1 - t0;
  if (dt <= 1e-9) {
    for (const [name] of jointPosMap) {
      result.set(name, 0);
    }
    return result;
  }

  const alpha = (time - t0) / dt;
  // ds/dt = (6 * alpha * (1 - alpha)) / dt
  const dsDt = (6 * alpha * (1 - alpha)) / dt;

  for (const [name, arr] of jointPosMap) {
    const q0 = arr[idx] ?? 0;
    const q1 = arr[idx + 1] ?? q0;
    result.set(name, (q1 - q0) * dsDt);
  }

  return result;
}

function rgbaToHex(c: UrdfColor): string {
  const r = Math.max(0, Math.min(255, Math.round(c.r * 255)));
  const g = Math.max(0, Math.min(255, Math.round(c.g * 255)));
  const b = Math.max(0, Math.min(255, Math.round(c.b * 255)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function resolveMaterialColor(
  mat: UrdfMaterial | undefined,
  robotMaterials: Map<string, UrdfMaterial>,
): { color?: string | undefined; opacity?: number | undefined; materialName?: string | undefined } {
  if (!mat) return {};
  const globalMat = robotMaterials.get(mat.name);
  const c = mat.color ?? globalMat?.color;
  if (!c) return { materialName: mat.name };
  return {
    color: rgbaToHex(c),
    opacity: c.a,
    materialName: mat.name,
  };
}

/**
 * Computes a rotation matrix that aligns the local +Z axis [0, 0, 1] with a target 3D vector `dir`.
 */
function rotationAligningZToVector(dir: [number, number, number]): RotMatrix9 {
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (len < 1e-9) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const ux = dir[0] / len;
  const uy = dir[1] / len;
  const uz = dir[2] / len;
  // Cross product [0, 0, 1] x [ux, uy, uz] = [-uy, ux, 0]
  const ax = -uy;
  const ay = ux;
  const sinA = Math.hypot(ax, ay);
  if (sinA < 1e-7) {
    return uz >= 0 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : [1, 0, 0, 0, -1, 0, 0, 0, -1];
  }
  const angle = Math.atan2(sinA, uz);
  return rotationMatrixFromAxisAngle({ x: ax / sinA, y: ay / sinA, z: 0 }, angle);
}

/**
 * When a URDF `<visual>` references an external `<mesh filename="package://...">` without explicit
 * primitive dimensions, infers physically accurate fallback geometry and local origin from:
 *   1. The link's `<collision>` primitive (if present),
 *   2. The kinematic bone vector to child joint(s), or
 *   3. The link's `<inertial>` mass and principal moments of inertia.
 */
function inferGeometryForMeshVisual(
  robot: UrdfRobot,
  link: UrdfLink,
  geom: UrdfGeometry,
  visualIndex: number,
  hasExplicitOrigin: boolean,
): {
  geometry: UrdfGeometry;
  inferredOriginXyz?: { x: number; y: number; z: number } | undefined;
  inferredOriginRot?: RotMatrix9 | undefined;
} {
  if (geom.type !== "mesh" || geom.radius !== undefined || geom.length !== undefined || geom.size !== undefined) {
    return { geometry: geom };
  }

  // 1. Check matching or primary <collision> primitive on the same link
  const col = link.collisions[visualIndex] ?? link.collisions[0];
  if (col && col.geometry.type !== "mesh") {
    return {
      geometry: {
        ...col.geometry,
        filename: geom.filename,
        scale: geom.scale,
      },
      inferredOriginXyz: !hasExplicitOrigin ? col.origin?.xyz : undefined,
      inferredOriginRot: !hasExplicitOrigin && col.origin?.rpy ? rotationMatrixFromRpy(col.origin.rpy) : undefined,
    };
  }

  // 2. Check child joint bone vector(s) originating from this link
  let bestDist = 0;
  let bestVec: [number, number, number] | null = null;
  for (const joint of robot.joints.values()) {
    if (joint.parentLink === link.name && joint.origin?.xyz) {
      const { x, y, z } = joint.origin.xyz;
      const d = Math.hypot(x, y, z);
      if (d > bestDist) {
        bestDist = d;
        bestVec = [x, y, z];
      }
    }
  }
  if (bestVec && bestDist > 0.025) {
    const r = Math.max(0.018, Math.min(0.055, bestDist * 0.16));
    return {
      geometry: {
        type: "cylinder",
        radius: r,
        length: bestDist,
        filename: geom.filename,
        scale: geom.scale,
      },
      inferredOriginXyz: !hasExplicitOrigin
        ? { x: bestVec[0] * 0.5, y: bestVec[1] * 0.5, z: bestVec[2] * 0.5 }
        : undefined,
      inferredOriginRot: !hasExplicitOrigin ? rotationAligningZToVector(bestVec) : undefined,
    };
  }

  // 3. Estimate dimensions from <inertial> principal moments if available
  if (link.inertial && link.inertial.mass > 0) {
    const m = link.inertial.mass;
    const { ixx, iyy, izz } = link.inertial;
    const sx = Math.max(0.03, Math.min(0.5, Math.sqrt(Math.max(0.0004, (6 / m) * Math.max(0, iyy + izz - ixx)))));
    const sy = Math.max(0.03, Math.min(0.5, Math.sqrt(Math.max(0.0004, (6 / m) * Math.max(0, ixx + izz - iyy)))));
    const sz = Math.max(0.03, Math.min(0.5, Math.sqrt(Math.max(0.0004, (6 / m) * Math.max(0, ixx + iyy - izz)))));
    return {
      geometry: {
        type: "box",
        size: { x: sx, y: sy, z: sz },
        filename: geom.filename,
        scale: geom.scale,
      },
    };
  }

  return { geometry: geom };
}

/**
 * Evaluates world-space 3D positions and 3x3 rotation matrices for all `<visual>`
 * and `<collision>` elements across every link in the robot.
 * Automatically synthesizes link geometry when `<visual>` elements use unresolved
 * `package://` meshes or when a link defines only `<collision>` / kinematic joints.
 */
export function computeRobotVisualAndCollisionPoses(
  robot: UrdfRobot,
  linkPoses: Map<string, LinkPose>,
): { visuals: UrdfVisualPose3D[]; collisions: UrdfVisualPose3D[] } {
  const visuals: UrdfVisualPose3D[] = [];
  const collisions: UrdfVisualPose3D[] = [];

  for (const [linkName, link] of robot.links) {
    const pose = linkPoses.get(linkName);
    if (!pose) continue;

    if (link.visuals.length > 0) {
      for (let i = 0; i < link.visuals.length; i++) {
        const vis = link.visuals[i]!;
        const hasExplicitOrigin = Boolean(
          vis.origin &&
            (Math.hypot(vis.origin.xyz.x, vis.origin.xyz.y, vis.origin.xyz.z) > 1e-6 ||
              Math.hypot(vis.origin.rpy.x, vis.origin.rpy.y, vis.origin.rpy.z) > 1e-6),
        );
        const { geometry: effectiveGeom, inferredOriginXyz, inferredOriginRot } = inferGeometryForMeshVisual(
          robot,
          link,
          vis.geometry,
          i,
          hasExplicitOrigin,
        );

        const localXyz = inferredOriginXyz ?? vis.origin?.xyz ?? { x: 0, y: 0, z: 0 };
        const localRpy = vis.origin?.rpy ?? { x: 0, y: 0, z: 0 };
        const localR = inferredOriginRot ?? rotationMatrixFromRpy(localRpy);
        const offsetWorld = multRotVec(pose.rotation, [localXyz.x, localXyz.y, localXyz.z]);
        const worldPos: [number, number, number] = [
          pose.position[0] + offsetWorld[0],
          pose.position[1] + offsetWorld[1],
          pose.position[2] + offsetWorld[2],
        ];
        const worldRot = multiplyRot9(pose.rotation, localR);
        const resolvedMat = resolveMaterialColor(vis.material, robot.materials);

        visuals.push({
          id: `${linkName}_vis_${i}`,
          linkName,
          visualName: vis.name,
          isCollision: false,
          geometry: effectiveGeom,
          position: worldPos,
          rotation: worldRot,
          color: resolvedMat.color,
          opacity: resolvedMat.opacity,
          materialName: resolvedMat.materialName,
        });
      }
    } else if (link.collisions.length > 0) {
      // Fallback: if a link has <collision> primitives but no <visual>, use collision geometry as visual
      for (let i = 0; i < link.collisions.length; i++) {
        const col = link.collisions[i]!;
        const localXyz = col.origin?.xyz ?? { x: 0, y: 0, z: 0 };
        const localRpy = col.origin?.rpy ?? { x: 0, y: 0, z: 0 };
        const localR = rotationMatrixFromRpy(localRpy);
        const offsetWorld = multRotVec(pose.rotation, [localXyz.x, localXyz.y, localXyz.z]);
        const worldPos: [number, number, number] = [
          pose.position[0] + offsetWorld[0],
          pose.position[1] + offsetWorld[1],
          pose.position[2] + offsetWorld[2],
        ];
        const worldRot = multiplyRot9(pose.rotation, localR);
        visuals.push({
          id: `${linkName}_vis_col_${i}`,
          linkName,
          visualName: col.name,
          isCollision: false,
          geometry: col.geometry,
          position: worldPos,
          rotation: worldRot,
          color: "#cbd5e1",
          opacity: 1.0,
        });
      }
    } else {
      // Pure kinematic link without <visual> or <collision>: synthesize bone cylinder to child joint(s)
      for (const joint of robot.joints.values()) {
        if (joint.parentLink === linkName && joint.origin?.xyz) {
          const { x, y, z } = joint.origin.xyz;
          const d = Math.hypot(x, y, z);
          if (d > 0.02) {
            const localR = rotationAligningZToVector([x, y, z]);
            const offsetWorld = multRotVec(pose.rotation, [x * 0.5, y * 0.5, z * 0.5]);
            visuals.push({
              id: `${linkName}_vis_bone_${joint.name}`,
              linkName,
              visualName: `${linkName}_bone`,
              isCollision: false,
              geometry: { type: "cylinder", radius: Math.max(0.016, Math.min(0.045, d * 0.14)), length: d },
              position: [
                pose.position[0] + offsetWorld[0],
                pose.position[1] + offsetWorld[1],
                pose.position[2] + offsetWorld[2],
              ],
              rotation: multiplyRot9(pose.rotation, localR),
              color: "#cbd5e1",
              opacity: 1.0,
            });
          }
        }
      }
    }

    for (let i = 0; i < link.collisions.length; i++) {
      const col = link.collisions[i]!;
      const localXyz = col.origin?.xyz ?? { x: 0, y: 0, z: 0 };
      const localRpy = col.origin?.rpy ?? { x: 0, y: 0, z: 0 };
      const localR = rotationMatrixFromRpy(localRpy);
      const offsetWorld = multRotVec(pose.rotation, [localXyz.x, localXyz.y, localXyz.z]);
      const worldPos: [number, number, number] = [
        pose.position[0] + offsetWorld[0],
        pose.position[1] + offsetWorld[1],
        pose.position[2] + offsetWorld[2],
      ];
      const worldRot = multiplyRot9(pose.rotation, localR);

      collisions.push({
        id: `${linkName}_col_${i}`,
        linkName,
        visualName: col.name,
        isCollision: true,
        geometry: col.geometry,
        position: worldPos,
        rotation: worldRot,
        color: "#22c55e",
        opacity: 0.28,
      });
    }
  }

  return { visuals, collisions };
}

/**
 * Computes minimum surface-to-surface clearance distance [mm] between moving
 * robot links and either:
 *   - Workstation environment obstacles (when `environment` is provided), OR
 *   - Non-adjacent robot links (self-collision) and the ground plane z=0 (for standalone robots).
 */
export function computeClearanceTelemetry(
  robot: UrdfRobot,
  linkPoses: Map<string, LinkPose>,
  environment?: DigitalTwinEnvironmentAsset[],
): DigitalTwinClearanceResult {
  const firstLinkName = linkPoses.keys().next().value ?? "base_link";
  const defaultResult: DigitalTwinClearanceResult = {
    minDistanceMm: 100,
    nearestLinkName: firstLinkName,
    nearestObstacleName: "Ground Plane",
    fromPoint: [0, 0, 0.1],
    toPoint: [0, 0, 0],
  };

  if (linkPoses.size === 0) return defaultResult;

  // Candidate moving robot links (exclude static base/world/frame links)
  const candidateLinks: Array<{
    name: string;
    parentName: string | null;
    pos: [number, number, number];
    radius: number;
  }> = [];
  for (const [name, pose] of linkPoses) {
    const lower = name.toLowerCase();
    if (
      lower === "world" ||
      lower === "cell_base_link" ||
      lower === "base_link" ||
      lower === "workstation_table_link" ||
      lower.includes("pedestal") ||
      lower.includes("frame") ||
      lower.includes("bridge")
    ) {
      continue;
    }
    const link = robot.links.get(name);
    let radius = 0.035;
    if (link && link.collisions.length > 0) {
      const g = link.collisions[0]!.geometry;
      if (g.radius) radius = g.radius;
      else if (g.size) radius = Math.min(g.size.x, g.size.y, g.size.z) * 0.5;
    } else if (link && link.visuals.length > 0) {
      const g = link.visuals[0]!.geometry;
      if (g.radius) radius = g.radius;
      else if (g.size) radius = Math.min(g.size.x, g.size.y, g.size.z) * 0.5;
    }
    candidateLinks.push({ name, parentName: pose.parentName, pos: pose.position, radius });
  }

  if (candidateLinks.length === 0) return defaultResult;

  const obstacles =
    environment && environment.length > 0
      ? environment.filter((a) => a.type !== "table" && a.type !== "workstation_cabinet")
      : [];

  let bestDistM = Number.POSITIVE_INFINITY;
  let bestLinkName = candidateLinks[candidateLinks.length - 1]!.name;
  let bestObsName = "Ground Plane (z=0)";
  let bestFrom: [number, number, number] = candidateLinks[candidateLinks.length - 1]!.pos;
  let bestTo: [number, number, number] = [bestFrom[0], bestFrom[1], 0];

  if (obstacles.length > 0) {
    for (const cand of candidateLinks) {
      const [lx, ly, lz] = cand.pos;
      for (const obs of obstacles) {
        const [ox, oy, oz] = obs.position;
        const [dx, dy, dz] = obs.dimensions ?? [0.18, 0.18, 0.18];
        const hx = dx * 0.5;
        const hy = dy * 0.5;
        const hz = dz * 0.5;

        const cx = Math.max(ox - hx, Math.min(lx, ox + hx));
        const cy = Math.max(oy - hy, Math.min(ly, oy + hy));
        const cz = Math.max(oz - hz, Math.min(lz, oz + hz));

        const distCenter = Math.hypot(lx - cx, ly - cy, lz - cz);
        const surfaceDist = Math.max(0.005, distCenter - cand.radius * 0.65);

        if (surfaceDist < bestDistM) {
          bestDistM = surfaceDist;
          bestLinkName = cand.name;
          bestObsName = obs.name;
          bestFrom = [lx, ly, lz];
          bestTo = [cx, cy, cz];
        }
      }
    }
  } else {
    // Generic standalone URDF mode: check self-collision between non-adjacent links + ground clearance
    for (let i = 0; i < candidateLinks.length; i++) {
      const a = candidateLinks[i]!;
      const [ax, ay, az] = a.pos;

      // Ground plane clearance (for links above base)
      if (az > 0.02) {
        const groundClearance = Math.max(0.005, az - a.radius);
        if (groundClearance < bestDistM) {
          bestDistM = groundClearance;
          bestLinkName = a.name;
          bestObsName = "Ground Plane (z=0)";
          bestFrom = [ax, ay, az];
          bestTo = [ax, ay, 0];
        }
      }

      // Non-adjacent link self-clearance
      for (let j = i + 1; j < candidateLinks.length; j++) {
        const b = candidateLinks[j]!;
        if (a.parentName === b.name || b.parentName === a.name || a.parentName === b.parentName) {
          continue;
        }
        const [bx, by, bz] = b.pos;
        const dCenter = Math.hypot(ax - bx, ay - by, az - bz);
        const surfaceDist = Math.max(0.005, dCenter - (a.radius + b.radius) * 0.6);
        if (surfaceDist < bestDistM) {
          bestDistM = surfaceDist;
          bestLinkName = a.name;
          bestObsName = b.name;
          bestFrom = [ax, ay, az];
          bestTo = [bx, by, bz];
        }
      }
    }
  }

  if (!Number.isFinite(bestDistM)) return defaultResult;

  return {
    minDistanceMm: Math.round(bestDistM * 1000),
    nearestLinkName: bestLinkName,
    nearestObstacleName: bestObsName,
    fromPoint: bestFrom,
    toPoint: bestTo,
  };
}

/**
 * Computes comprehensive real-time telemetry (joint angular speeds, gripper state,
 * TCP linear velocity, and minimum obstacle/self clearance) for the Digital Twin Live State HUD.
 */
export function computeLiveDigitalTwinTelemetry(
  robot: UrdfRobot,
  trajectory: UrdfTrajectoryData | undefined,
  time: number,
  qMap: Map<string, number>,
  linkPoses: Map<string, LinkPose>,
  environment?: DigitalTwinEnvironmentAsset[],
): DigitalTwinLiveTelemetry {
  const velocities = trajectory ? interpolateJointVelocity(trajectory, time) : new Map<string, number>();

  let maxDegPerSec = 0;
  let sumSqDeg = 0;
  let revCount = 0;

  for (const [jName, dq] of velocities) {
    const joint = robot.joints.get(jName);
    if (!joint || joint.type === "prismatic" || joint.type === "fixed") continue;
    const degPerSec = Math.abs(dq) * (180 / Math.PI);
    if (degPerSec > maxDegPerSec) maxDegPerSec = degPerSec;
    sumSqDeg += degPerSec * degPerSec;
    revCount++;
  }

  const rmsDegPerSec = revCount > 0 ? Math.sqrt(sumSqDeg / revCount) : 0;

  // Detect whether the URDF actually has a movable gripper/finger joint
  let hasGripper = false;
  let gripperOpeningMm = 110;
  for (const jName of robot.joints.keys()) {
    const lower = jName.toLowerCase();
    if (lower.includes("gripper") || lower.includes("finger") || lower.includes("jaw")) {
      hasGripper = true;
      const qVal = qMap.get(jName) ?? 0;
      if (qVal <= 0.06) {
        gripperOpeningMm = Math.round(Math.max(18, Math.min(110, 110 - qVal * 1600)));
      } else {
        gripperOpeningMm = Math.round(Math.max(18, Math.min(110, qVal * 1000)));
      }
      break;
    }
  }

  const gripperStateLabel: "Open" | "Closed" | "Gripping" =
    gripperOpeningMm >= 85 ? "Open" : gripperOpeningMm <= 28 ? "Closed" : "Gripping";

  // Compute instantaneous TCP linear speed [mm/s] if trajectory is active
  let tcpSpeedMmPerSec = 0;
  if (trajectory && trajectory.times.length >= 2) {
    const dt = 0.02;
    const qNext = interpolateJointTrajectory(trajectory, time + dt);
    const posesNext = computeForwardKinematics(robot, qNext);
    const leafName = Array.from(linkPoses.keys()).pop();
    if (leafName) {
      const p0 = linkPoses.get(leafName);
      const p1 = posesNext.get(leafName);
      if (p0 && p1) {
        const leafLink = robot.links.get(leafName);
        const leafLen =
          leafLink?.collisions[0]?.geometry.length ??
          leafLink?.visuals[0]?.geometry.length ??
          0.15;
        // Distal tip in world frame: position + R * [0, 0, leafLen]
        const tip0: [number, number, number] = [
          p0.position[0] + p0.rotation[2] * leafLen,
          p0.position[1] + p0.rotation[5] * leafLen,
          p0.position[2] + p0.rotation[8] * leafLen,
        ];
        const tip1: [number, number, number] = [
          p1.position[0] + p1.rotation[2] * leafLen,
          p1.position[1] + p1.rotation[5] * leafLen,
          p1.position[2] + p1.rotation[8] * leafLen,
        ];
        const distOrigin = Math.hypot(
          p1.position[0] - p0.position[0],
          p1.position[1] - p0.position[1],
          p1.position[2] - p0.position[2],
        );
        const distTip = Math.hypot(tip1[0] - tip0[0], tip1[1] - tip0[1], tip1[2] - tip0[2]);
        tcpSpeedMmPerSec = Math.round((Math.max(distOrigin, distTip) / dt) * 1000);
      }
    }
  }

  const clearance = computeClearanceTelemetry(robot, linkPoses, environment);

  return {
    jointVelocitiesRadPerSec: velocities,
    maxJointSpeedDegPerSec: maxDegPerSec,
    rmsJointSpeedDegPerSec: rmsDegPerSec,
    gripperOpeningMm,
    gripperStateLabel,
    hasGripper,
    tcpSpeedMmPerSec,
    clearance,
  };
}

/**
 * Automatically synthesizes a smooth 16-second kinematic workspace demonstration trajectory
 * and program step sequence for any standalone URDF robot that does not include an explicit
 * recorded trajectory.
 */
export function generateDefaultKinematicDemoTrajectory(robot: UrdfRobot): {
  trajectory: UrdfTrajectoryData;
  programSteps: DigitalTwinProgramStep[];
} {
  const movableJoints = Array.from(robot.joints.values()).filter(
    (j) => j.type !== "fixed" && !j.mimic,
  );
  // 4 point-to-point moves (3.5s motion + 0.5s settle dwell per step)
  const times = [0, 3.5, 4.0, 7.5, 8.0, 11.5, 12.0, 15.5, 16.0];
  const poseTimes = [0, 4, 4, 8, 8, 12, 12, 16, 16];
  const jointPositions: Record<string, number[]> = {};

  movJointLoop: for (let idx = 0; idx < movableJoints.length; idx++) {
    const joint = movableJoints[idx]!;
    const isPrismatic = joint.type === "prismatic";
    const lower = joint.limits?.lower ?? (isPrismatic ? -0.15 : -Math.PI * 0.65);
    const upper = joint.limits?.upper ?? (isPrismatic ? 0.15 : Math.PI * 0.65);
    const mid = (lower + upper) * 0.5;
    const amp = Math.min(isPrismatic ? 0.12 : 1.15, (upper - lower) * 0.35);
    const phase = idx * 0.65;

    jointPositions[joint.name] = poseTimes.map((pt, k) => {
      if (k === 0 || k >= poseTimes.length - 2) return mid;
      const theta = (pt / 16) * Math.PI * 2 + phase;
      const val = mid + amp * Math.sin(theta);
      return Math.max(lower, Math.min(upper, val));
    });
    if (idx > 64) break movJointLoop;
  }

  const programSteps: DigitalTwinProgramStep[] = [
    {
      id: 1,
      machine: "KIN",
      label: "Home Calibration Pose",
      description: "Initialize all articulated joints at nominal mid-range reference configuration",
      startTime: 0,
      endTime: 4,
      color: "#3b82f6",
    },
    {
      id: 2,
      machine: "KIN",
      label: "Primary Workspace Sweep",
      description: "Coordinated multi-axis forward kinematic reach envelope excursion",
      startTime: 4,
      endTime: 8,
      color: "#22c55e",
    },
    {
      id: 3,
      machine: "KIN",
      label: "Articulated Wrist & Axis Reversal",
      description: "Cross-coupled distal joint articulation and RNEA inverse dynamics check",
      startTime: 8,
      endTime: 12,
      color: "#a855f7",
    },
    {
      id: 4,
      machine: "KIN",
      label: "Return to Nominal Pose",
      description: "Smooth cubic Hermite deceleration back to home reference configuration",
      startTime: 12,
      endTime: 16,
      color: "#3b82f6",
    },
  ];

  return {
    trajectory: { times, jointPositions },
    programSteps,
  };
}

/**
 * Computes the 3D Cartesian toolpath coordinates for a designated link (e.g. end-effector/TCP)
 * across the duration of a trajectory.
 */
export function generateToolpathTrace(
  robot: UrdfRobot,
  trajectory: UrdfTrajectoryData,
  tipLinkName?: string,
  sampleCount = 80,
  color = "#58a6ff",
): DigitalTwinToolpathTrace {
  const times = trajectory.times;
  if (!times || times.length === 0) {
    return { linkName: tipLinkName || "", points: [] };
  }

  // If no tip link name specified, find a primary robot leaf link
  let resolvedTip = tipLinkName;
  if (!resolvedTip) {
    if (robot.links.has("tool0_gripper")) {
      resolvedTip = "tool0_gripper";
    } else if (robot.links.has("gripper_tcp_link")) {
      resolvedTip = "gripper_tcp_link";
    } else {
      const parentLinks = new Set<string>();
      for (const j of robot.joints.values()) {
        parentLinks.add(j.parentLink);
      }
      for (const name of robot.links.keys()) {
        if (!parentLinks.has(name) && !name.includes("base") && !name.includes("world")) {
          resolvedTip = name;
          break;
        }
      }
      if (!resolvedTip) {
        resolvedTip = Array.from(robot.links.keys()).pop() || "";
      }
    }
  }

  const tStart = times[0]!;
  const tEnd = times[times.length - 1]!;
  const points: [number, number, number][] = [];

  const count = Math.max(10, Math.min(sampleCount, 300));
  for (let i = 0; i <= count; i++) {
    const t = tStart + ((tEnd - tStart) * i) / count;
    const qMap = interpolateJointTrajectory(trajectory, t);
    const poses = computeForwardKinematics(robot, qMap);
    const pose = poses.get(resolvedTip);
    if (pose) {
      points.push([pose.position[0], pose.position[1], pose.position[2]]);
    }
  }

  return {
    linkName: resolvedTip,
    points,
    color,
  };
}

