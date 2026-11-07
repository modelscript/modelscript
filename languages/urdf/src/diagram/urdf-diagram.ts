// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  buildKinematicDiagram,
  renderKinematicSvg,
  type KinematicBodyLike,
  type KinematicDiagramGraph,
  type KinematicJointLike,
  type KinematicSystemLike,
} from "@modelscript/diagram/kinematic-diagram-builder";
import {
  computeForwardKinematics,
  type RotMatrix9,
  multRotVec,
  rotationMatrixFromRpy,
} from "../kinematics/featherstone.js";
import { computeRobotVisualAndCollisionPoses } from "../kinematics/trajectory.js";
import type { DigitalTwinEnvironmentAsset, DigitalTwinToolpathTrace, UrdfRobot } from "../types.js";

/**
 * Translates an UrdfRobot into a normalized KinematicSystemLike topology.
 */
export function urdfToKinematicSystem(robot: UrdfRobot): KinematicSystemLike {
  const bodies: KinematicBodyLike[] = [];
  const childLinks = new Set<string>();

  for (const j of robot.joints.values()) {
    childLinks.add(j.childLink);
  }

  // Add all links
  for (const link of robot.links.values()) {
    // If a link is not the child of any joint, or is named "base_link" / "world", consider it root/ground
    const isRoot = !childLinks.has(link.name) || link.name === "world" || link.name === "ground";

    bodies.push({
      id: link.name,
      name: link.name,
      mass: link.inertial?.mass,
      inertia: link.inertial ? { ixx: link.inertial.ixx, iyy: link.inertial.iyy, izz: link.inertial.izz } : undefined,
      isGround: isRoot,
    });
  }

  // Translate joints
  const joints: KinematicJointLike[] = [];
  for (const joint of robot.joints.values()) {
    joints.push({
      id: joint.name,
      name: joint.name,
      type: joint.type,
      fromBody: joint.parentLink,
      toBody: joint.childLink,
      limits: joint.limits ? { lower: joint.limits.lower, upper: joint.limits.upper } : undefined,
    });
  }

  return {
    title: robot.name || "URDF Kinematic Robot",
    bodies,
    joints,
  };
}

/**
 * Builds an interactive AntV X6 graph model for a URDF robot model.
 */
export function buildUrdfDiagram(robot: UrdfRobot): KinematicDiagramGraph {
  return buildKinematicDiagram(urdfToKinematicSystem(robot));
}

/**
 * Generates standalone SVG vector graphics for a URDF robot model (2D kinematic topology tree).
 */
export function renderUrdfSvg(
  robot: UrdfRobot,
  options?:
    | {
        isDark?: boolean | undefined;
        theme?: "dark" | "light" | undefined;
        width?: number | undefined;
        height?: number | undefined;
      }
    | undefined,
): string {
  return renderKinematicSvg(urdfToKinematicSystem(robot), options);
}

type Vec3 = [number, number, number];

interface Poly3D {
  pts: Vec3[];
  normal: Vec3;
  color: [number, number, number];
  opacity: number;
  strokeOpacity?: number;
  specularBoost?: number;
}

function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function normalizeVec3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function transformLocalPoint(center: Vec3, rot: RotMatrix9, local: Vec3): Vec3 {
  return addVec3(center, multRotVec(rot, local));
}

function addOrientedBox3D(
  polys: Poly3D[],
  center: Vec3,
  rot: RotMatrix9,
  size: [number, number, number],
  color: [number, number, number],
  opacity = 1.0,
  specularBoost = 0.15,
): void {
  const hx = size[0] * 0.5;
  const hy = size[1] * 0.5;
  const hz = size[2] * 0.5;

  const faces: { corners: Vec3[]; normal: Vec3 }[] = [
    {
      corners: [
        [hx, -hy, -hz],
        [hx, hy, -hz],
        [hx, hy, hz],
        [hx, -hy, hz],
      ],
      normal: [1, 0, 0],
    },
    {
      corners: [
        [-hx, hy, -hz],
        [-hx, -hy, -hz],
        [-hx, -hy, hz],
        [-hx, hy, hz],
      ],
      normal: [-1, 0, 0],
    },
    {
      corners: [
        [hx, hy, -hz],
        [-hx, hy, -hz],
        [-hx, hy, hz],
        [hx, hy, hz],
      ],
      normal: [0, 1, 0],
    },
    {
      corners: [
        [-hx, -hy, -hz],
        [hx, -hy, -hz],
        [hx, -hy, hz],
        [-hx, -hy, hz],
      ],
      normal: [0, -1, 0],
    },
    {
      corners: [
        [-hx, -hy, hz],
        [hx, -hy, hz],
        [hx, hy, hz],
        [-hx, hy, hz],
      ],
      normal: [0, 0, 1],
    },
    {
      corners: [
        [-hx, hy, -hz],
        [hx, hy, -hz],
        [hx, -hy, -hz],
        [-hx, -hy, -hz],
      ],
      normal: [0, 0, -1],
    },
  ];

  for (const f of faces) {
    polys.push({
      pts: f.corners.map((c) => transformLocalPoint(center, rot, c)),
      normal: normalizeVec3(multRotVec(rot, f.normal)),
      color,
      opacity,
      specularBoost,
    });
  }
}

function addOrientedCylinderZ3D(
  polys: Poly3D[],
  center: Vec3,
  rot: RotMatrix9,
  radius: number,
  length: number,
  color: [number, number, number],
  opacity = 1.0,
  segments = 14,
  specularBoost = 0.25,
): void {
  const halfL = length * 0.5;
  const topCap: Vec3[] = [];
  const botCap: Vec3[] = [];

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const am = (a0 + a1) * 0.5;

    const c0 = Math.cos(a0) * radius;
    const s0 = Math.sin(a0) * radius;
    const c1 = Math.cos(a1) * radius;
    const s1 = Math.sin(a1) * radius;

    const p0Bot = transformLocalPoint(center, rot, [c0, s0, -halfL]);
    const p1Bot = transformLocalPoint(center, rot, [c1, s1, -halfL]);
    const p1Top = transformLocalPoint(center, rot, [c1, s1, halfL]);
    const p0Top = transformLocalPoint(center, rot, [c0, s0, halfL]);

    const sideNormal = normalizeVec3(multRotVec(rot, [Math.cos(am), Math.sin(am), 0]));
    polys.push({
      pts: [p0Bot, p1Bot, p1Top, p0Top],
      normal: sideNormal,
      color,
      opacity,
      strokeOpacity: 0.14,
      specularBoost,
    });

    topCap.push(p0Top);
    botCap.unshift(p0Bot);
  }

  polys.push({
    pts: topCap,
    normal: normalizeVec3(multRotVec(rot, [0, 0, 1])),
    color,
    opacity,
    strokeOpacity: 0.28,
    specularBoost,
  });
  polys.push({
    pts: botCap,
    normal: normalizeVec3(multRotVec(rot, [0, 0, -1])),
    color,
    opacity,
    strokeOpacity: 0.22,
    specularBoost,
  });
}

function addSphere3D(
  polys: Poly3D[],
  center: Vec3,
  radius: number,
  color: [number, number, number],
  opacity = 1.0,
  rings = 6,
  sectors = 12,
): void {
  const identity: RotMatrix9 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let r = 0; r < rings; r++) {
    const phi0 = -Math.PI * 0.5 + (r / rings) * Math.PI;
    const phi1 = -Math.PI * 0.5 + ((r + 1) / rings) * Math.PI;
    const phim = (phi0 + phi1) * 0.5;

    for (let s = 0; s < sectors; s++) {
      const th0 = (s / sectors) * Math.PI * 2;
      const th1 = ((s + 1) / sectors) * Math.PI * 2;
      const thm = (th0 + th1) * 0.5;

      const pt = (phi: number, th: number): Vec3 =>
        transformLocalPoint(center, identity, [
          radius * Math.cos(phi) * Math.cos(th),
          radius * Math.cos(phi) * Math.sin(th),
          radius * Math.sin(phi),
        ]);

      const n: Vec3 = [Math.cos(phim) * Math.cos(thm), Math.cos(phim) * Math.sin(thm), Math.sin(phim)];
      polys.push({
        pts: [pt(phi0, th0), pt(phi0, th1), pt(phi1, th1), pt(phi1, th0)],
        normal: normalizeVec3(n),
        color,
        opacity,
        strokeOpacity: 0.1,
        specularBoost: 0.3,
      });
    }
  }
}

function parseHexColorRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "").trim();
  if (clean.length === 6) {
    const r = Number.parseInt(clean.slice(0, 2), 16);
    const g = Number.parseInt(clean.slice(2, 4), 16);
    const b = Number.parseInt(clean.slice(4, 6), 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return [r, g, b];
    }
  }
  return [203, 213, 225];
}

function buildDefaultShowcaseJointMap(
  robot: UrdfRobot,
  customJoints?: Map<string, number> | Record<string, number>,
): Map<string, number> {
  const q = new Map<string, number>();
  if (customJoints) {
    const entries = customJoints instanceof Map ? Array.from(customJoints.entries()) : Object.entries(customJoints);
    if (entries.length > 0) {
      for (const [k, v] of entries) {
        if (typeof v === "number" && Number.isFinite(v)) {
          q.set(k, v);
        }
      }
      return q;
    }
  }

  // Known expressive poses for standard cobot joint naming conventions
  const presets: Record<string, number> = {
    shoulder_pan_joint: -0.36,
    shoulder_lift_joint: -1.16,
    elbow_joint: 1.48,
    wrist_1_joint: -1.86,
    wrist_2_joint: -1.5708,
    wrist_3_joint: 0.42,
    gripper_finger_left_joint: 0.018,
    cnc_bridge_x_joint: 0.055,
    cnc_carriage_y_joint: 0.045,
    cnc_pipette_z_joint: -0.075,
    joint_1: 0.38,
    joint_2: -0.56,
    joint_3: 0.28,
    joint_4: 1.28,
    joint_5: -0.35,
    joint_6: 0.68,
    joint_7: 0.4,
  };

  const fallbackAngles = [0.35, -0.62, 0.92, -0.52, 0.42, -0.32];
  let idx = 0;
  for (const [name, joint] of robot.joints) {
    if (joint.type === "fixed" || joint.mimic) continue;
    if (name in presets) {
      q.set(name, presets[name]!);
    } else if (joint.type === "revolute" || joint.type === "continuous") {
      let val = fallbackAngles[idx % fallbackAngles.length]!;
      if (joint.limits) {
        const lower = joint.limits.lower ?? -Math.PI;
        const upper = joint.limits.upper ?? Math.PI;
        val = Math.max(lower, Math.min(upper, val));
      }
      q.set(name, val);
      idx++;
    } else if (joint.type === "prismatic") {
      q.set(name, 0);
    }
  }
  return q;
}

function renderEnvironmentAsset3D(polys: Poly3D[], asset: DigitalTwinEnvironmentAsset): void {
  const [x, y, z] = asset.position;
  const [dx, dy, dz] = asset.dimensions ?? [0.4, 0.4, 0.4];
  const rot: RotMatrix9 = asset.rotation
    ? rotationMatrixFromRpy({ x: asset.rotation[0], y: asset.rotation[1], z: asset.rotation[2] })
    : [1, 0, 0, 0, 1, 0, 0, 0, 1];

  if (asset.type === "workstation_cabinet" || asset.type === "table") {
    // Recessed dark base plinth
    addOrientedBox3D(polys, [x, y, z - dz * 0.46], rot, [dx * 0.92, dy * 0.89, 0.05], [15, 23, 42], 1.0, 0.08);
    // Main slate-blue steel cabinet body (#475569)
    addOrientedBox3D(polys, [x, y, z - 0.02], rot, [dx * 0.96, dy * 0.94, dz * 0.92], [71, 85, 105], 1.0, 0.14);
    // Left and right recessed front cabinet doors (#334155) + center seam + vertical silver handles (#cbd5e1)
    addOrientedBox3D(polys, [x - dx * 0.23, y - dy * 0.475, z - 0.02], rot, [dx * 0.42, 0.012, dz * 0.78], [51, 65, 85], 1.0, 0.12);
    addOrientedBox3D(polys, [x + dx * 0.23, y - dy * 0.475, z - 0.02], rot, [dx * 0.42, 0.012, dz * 0.78], [51, 65, 85], 1.0, 0.12);
    addOrientedBox3D(polys, [x - 0.04, y - dy * 0.49, z + 0.02], rot, [0.012, 0.016, 0.12], [203, 213, 225], 1.0, 0.35);
    addOrientedBox3D(polys, [x + 0.04, y - dy * 0.49, z + 0.02], rot, [0.012, 0.016, 0.12], [203, 213, 225], 1.0, 0.35);
    // Top perimeter aluminum extrusion frame + pitch-black anodized optical breadboard (#0b0f19)
    addOrientedBox3D(polys, [x, y, z + dz * 0.45], rot, [dx * 1.02, dy * 1.02, 0.036], [148, 163, 184], 1.0, 0.28);
    addOrientedBox3D(polys, [x, y, z + dz * 0.485], rot, [dx * 0.98, dy * 0.98, 0.026], [11, 15, 25], 1.0, 0.22);
    return;
  }

  if (asset.type === "vial_rack") {
    // Stepped white PTFE rack base & upper tier (#f8fafc)
    addOrientedBox3D(polys, [x, y, z - dz * 0.25], rot, [dx, dy, dz * 0.5], [241, 245, 249], 1.0, 0.16);
    for (const vxOff of [-dx * 0.22, dx * 0.22]) {
      const vx = x + vxOff;
      const vy = y + dy * 0.12;
      addOrientedCylinderZ3D(polys, [vx, vy, z + dz * 0.25], rot, 0.026, 0.056, [203, 213, 225], 0.88, 14, 0.35);
      addOrientedCylinderZ3D(polys, [vx, vy, z + dz * 0.55], rot, 0.028, 0.018, [29, 78, 216], 1.0, 14, 0.32);
    }
    for (const frac of [-0.3, -0.1, 0.1, 0.3]) {
      const vx = x + dx * frac;
      const vy = y - dy * 0.24;
      addOrientedCylinderZ3D(polys, [vx, vy, z + dz * 0.15], rot, 0.011, 0.038, [147, 197, 253], 0.85, 12, 0.35);
      addOrientedBox3D(polys, [vx, vy - 0.022, z + 0.002], rot, [0.016, 0.016, 0.01], [249, 115, 22], 1.0, 0.25);
    }
    return;
  }

  if (asset.type === "reactor_mixer") {
    // White powder-coated stirrer/reactor housing (#f1f5f9) + royal blue trim & front badge
    addOrientedBox3D(polys, [x, y, z], rot, [dx, dy, dz * 0.88], [241, 245, 249], 1.0, 0.18);
    addOrientedBox3D(polys, [x, y, z + dz * 0.46], rot, [dx * 1.01, dy * 1.01, dz * 0.09], [29, 78, 216], 1.0, 0.28);
    addOrientedBox3D(polys, [x, y - dy * 0.505, z + dz * 0.22], rot, [0.05, 0.006, 0.022], [29, 78, 216], 1.0, 0.25);
    addOrientedCylinderZ3D(polys, [x, y, z + dz * 0.54], rot, dx * 0.28, 0.045, [30, 41, 59], 1.0, 18, 0.35);
    return;
  }

  if (asset.type === "wash_cup") {
    const rgb = parseHexColorRgb(asset.color ?? "#eab308");
    addOrientedCylinderZ3D(polys, [x, y, z], rot, dx * 0.48, dz, rgb, 1.0, 16, 0.3);
    addOrientedCylinderZ3D(polys, [x, y, z + dz * 0.48], rot, dx * 0.42, 0.006, [15, 23, 42], 1.0, 16, 0.1);
    return;
  }

  if (asset.type === "cylinder") {
    const rgb = parseHexColorRgb(asset.color ?? "#64748b");
    addOrientedCylinderZ3D(polys, [x, y, z], rot, dx * 0.5, dz, rgb, asset.opacity ?? 0.9, 18, 0.3);
    return;
  }

  const rgb = parseHexColorRgb(asset.color ?? "#64748b");
  addOrientedBox3D(polys, [x, y, z], rot, [dx, dy, dz], rgb, asset.opacity ?? 0.9, 0.25);
}

/**
 * Renders a depth-sorted 3D Isometric Shaded Robot & Digital Twin Workstation Scene SVG
 * (`800×450`) matching the live Three.js CAD sub-assemblies (`UrdfRobotCadMeshes.tsx`).
 */
export function renderUrdfIsometric3DSvg(
  robot: UrdfRobot,
  options?: {
    width?: number;
    height?: number;
    jointPositions?: Map<string, number> | Record<string, number> | undefined;
    environment?: DigitalTwinEnvironmentAsset[] | undefined;
    toolpaths?: DigitalTwinToolpathTrace[] | undefined;
    title?: string | undefined;
  },
): string {
  const width = options?.width ?? 800;
  const height = options?.height ?? 450;
  const identityRot: RotMatrix9 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  const q = buildDefaultShowcaseJointMap(robot, options?.jointPositions);
  const linkPoses = computeForwardKinematics(robot, q);
  const { visuals: urdfVisuals } = computeRobotVisualAndCollisionPoses(robot, linkPoses);

  const hasWorkstationLinks =
    robot.links.has("workstation_table_link") && robot.links.has("cnc_portal_base_link");
  const envAssets: DigitalTwinEnvironmentAsset[] =
    options?.environment && options.environment.length > 0
      ? options.environment
      : hasWorkstationLinks
        ? [
            {
              id: "workstation_cabinet",
              name: "Optical Breadboard Workstation",
              type: "workstation_cabinet",
              position: [0.02, 0.0, -0.24],
              dimensions: [0.96, 0.72, 0.48],
            },
            {
              id: "reactor_mixer",
              name: "Heated Reactor Station",
              type: "reactor_mixer",
              position: [0.22, -0.08, 0.09],
              dimensions: [0.21, 0.21, 0.18],
            },
            {
              id: "vial_rack_a",
              name: "Sample Rack A",
              type: "vial_rack",
              position: [-0.04, 0.1, 0.04],
              dimensions: [0.22, 0.16, 0.08],
            },
            {
              id: "vial_rack_b",
              name: "Sample Rack B",
              type: "vial_rack",
              position: [-0.25, 0.1, 0.04],
              dimensions: [0.18, 0.16, 0.08],
            },
            {
              id: "wash_cup",
              name: "Ultrasonic Rinse Beaker",
              type: "wash_cup",
              position: [0.34, 0.2, 0.045],
              dimensions: [0.068, 0.068, 0.09],
              color: "#eab308",
            },
          ]
        : [];

  const isDigitalTwinCell = envAssets.length > 0 || hasWorkstationLinks;
  const polys: Poly3D[] = [];

  // 1. Render all environment assets from data (never hardcoded for unrelated URDFs)
  for (const asset of envAssets) {
    renderEnvironmentAsset3D(polys, asset);
  }

  // 2. If the URDF includes a CNC portal base frame, render its structural aluminum extrusions
  if (hasWorkstationLinks) {
    addOrientedBox3D(polys, [-0.36, -0.26, 0.19], identityRot, [0.024, 0.024, 0.38], [203, 213, 225], 1.0, 0.32);
    addOrientedBox3D(polys, [-0.36, 0.26, 0.19], identityRot, [0.024, 0.024, 0.38], [203, 213, 225], 1.0, 0.32);
    addOrientedBox3D(polys, [-0.14, -0.26, 0.045], identityRot, [0.46, 0.02, 0.02], [203, 213, 225], 1.0, 0.32);
    addOrientedBox3D(polys, [-0.36, 0, 0.37], identityRot, [0.026, 0.54, 0.026], [203, 213, 225], 1.0, 0.32);
  }

  // 3. Render all robot visual geometries (unified across all URDF models)
  for (const vis of urdfVisuals) {
    if (hasWorkstationLinks && (vis.linkName === "workstation_table_link" || vis.linkName === "cnc_portal_base_link")) {
      continue;
    }

    const lname = vis.linkName.toLowerCase();
    const vname = (vis.visualName ?? "").toLowerCase();
    const fname = (vis.geometry.filename ?? "").toLowerCase();
    const geom = vis.geometry;
    const alpha = Math.max(0.25, Math.min(1.0, vis.opacity ?? 1.0));

    const isArticulatedArmLink =
      lname === "base_link" ||
      lname.includes("shoulder") ||
      lname.includes("upper_arm") ||
      lname.includes("forearm") ||
      lname.includes("wrist") ||
      fname.includes("ur3e/") ||
      /^link_[1-7]$/.test(lname);

    if (isArticulatedArmLink && geom.type === "cylinder") {
      const r = (geom.radius ?? 0.04) * 1.06;
      const len = geom.length ?? 0.16;
      const bodyRgb = vis.color ? parseHexColorRgb(vis.color) : ([226, 232, 240] as [number, number, number]);
      addOrientedCylinderZ3D(polys, vis.position, vis.rotation, r, len, bodyRgb, alpha, 20, 0.38);
      // Dark charcoal actuator collar ring at proximal end (#1e293b)
      const collarPos = transformLocalPoint(vis.position, vis.rotation, [0, 0, -len * 0.5 + 0.012]);
      addOrientedCylinderZ3D(polys, collarPos, vis.rotation, r * 1.05, 0.02, [30, 41, 59], alpha, 20, 0.28);
      // Sky-blue joint housing cap at distal end (#38bdf8)
      const capPos = transformLocalPoint(vis.position, vis.rotation, [0, 0, len * 0.5 + 0.01]);
      addOrientedCylinderZ3D(polys, capPos, vis.rotation, r * 1.04, 0.02, [56, 189, 248], alpha, 20, 0.42);
    } else if (lname.includes("gripper") || lname.includes("tool0") || vname.includes("gripper")) {
      const r = geom.radius ?? 0.032;
      const len = geom.length ?? 0.085;
      addOrientedCylinderZ3D(polys, vis.position, vis.rotation, r, len, [30, 41, 59], alpha, 18, 0.3);
      const ledRingPos = transformLocalPoint(vis.position, vis.rotation, [0, 0, -len * 0.35]);
      addOrientedCylinderZ3D(polys, ledRingPos, vis.rotation, r * 1.03, 0.008, [16, 185, 129], alpha, 18, 0.4);
    } else if (geom.type === "box") {
      const sz: [number, number, number] = geom.size ? [geom.size.x, geom.size.y, geom.size.z] : [0.06, 0.06, 0.06];
      const baseRgb = parseHexColorRgb(vis.color ?? "#cbd5e1");
      addOrientedBox3D(polys, vis.position, vis.rotation, sz, baseRgb, alpha, 0.26);
    } else if (geom.type === "cylinder") {
      const r = geom.radius ?? 0.03;
      const len = geom.length ?? 0.14;
      const baseRgb = parseHexColorRgb(vis.color ?? "#cbd5e1");
      addOrientedCylinderZ3D(polys, vis.position, vis.rotation, r, len, baseRgb, alpha, 18, 0.34);
    } else if (geom.type === "sphere") {
      const baseRgb = parseHexColorRgb(vis.color ?? "#cbd5e1");
      addSphere3D(polys, vis.position, geom.radius ?? 0.04, baseRgb, alpha, 8, 14);
    } else {
      const baseRgb = parseHexColorRgb(vis.color ?? "#cbd5e1");
      addOrientedBox3D(polys, vis.position, vis.rotation, [0.06, 0.06, 0.06], baseRgb, alpha, 0.24);
    }
  }

  if (urdfVisuals.length === 0 && linkPoses.size > 0) {
    const palette: [number, number, number][] = [
      [56, 189, 248],
      [226, 232, 240],
      [59, 130, 246],
      [168, 85, 247],
      [16, 185, 129],
    ];
    let pIdx = 0;
    for (const [, pose] of linkPoses) {
      const c = palette[pIdx++ % palette.length]!;
      addOrientedCylinderZ3D(polys, pose.position, pose.rotation, 0.045, 0.09, c, 0.96, 16, 0.35);
    }
  }

  // ── Compute 3D Camera Framing (matching the live Three.js Isometric Camera angle) ──
  const allPts: Vec3[] = [];
  for (const poly of polys) {
    for (const pt of poly.pts) {
      allPts.push(pt);
    }
  }
  if (allPts.length === 0) {
    allPts.push([-0.3, -0.3, 0], [0.3, 0.3, 0.5]);
  }

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const [x, y, z] of allPts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;

  // Match the live Three.js viewport front-right isometric camera angle
  const yaw = -0.54;
  const pitch = 0.42;
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);

  const projectRaw = (p: Vec3): [number, number, number] => {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const dz = p[2] - cz;
    const rx = dx * cosY - dy * sinY;
    const ryPlanar = dx * sinY + dy * cosY;
    const screenX = rx;
    const screenY = -(dz * cosP - ryPlanar * sinP);
    const depth = ryPlanar * cosP + dz * sinP;
    return [screenX, screenY, depth];
  };

  let pMinX = Infinity,
    pMaxX = -Infinity,
    pMinY = Infinity,
    pMaxY = -Infinity;
  for (const pt of allPts) {
    const [px, py] = projectRaw(pt);
    if (px < pMinX) pMinX = px;
    if (px > pMaxX) pMaxX = px;
    if (py < pMinY) pMinY = py;
    if (py > pMaxY) pMaxY = py;
  }

  const pSpanX = Math.max(0.2, pMaxX - pMinX);
  const pSpanY = Math.max(0.2, pMaxY - pMinY);
  const padX = isDigitalTwinCell ? 64 : 88;
  const padY = isDigitalTwinCell ? 34 : 48;
  const scale = Math.min((width - padX * 2) / pSpanX, (height - padY * 2) / pSpanY);
  const midPX = (pMinX + pMaxX) * 0.5;
  const midPY = (pMinY + pMaxY) * 0.5;

  const projectScreen = (p: Vec3): [number, number, number] => {
    const [rx, ry, depth] = projectRaw(p);
    return [
      +(width * 0.5 + (rx - midPX) * scale).toFixed(1),
      +(height * 0.52 + (ry - midPY) * scale).toFixed(1),
      depth,
    ];
  };

  // ── 3D Perspective Studio Floor Grid (matching Three.js Grid in MultibodyViewport3D.tsx) ──
  const zFloor = isDigitalTwinCell ? -0.45 : Math.min(0, minZ);
  const gridRadius = isDigitalTwinCell ? 1.35 : Math.max(maxX - minX, maxY - minY, 0.55) * 0.9;
  const gridSteps = 12;
  const gridLinesSvg: string[] = [];
  for (let i = -gridSteps; i <= gridSteps; i++) {
    const offset = (i / gridSteps) * gridRadius;
    const isMajor = i === 0 || i % 4 === 0;
    const stroke = isMajor ? "rgba(30, 41, 59, 0.38)" : "rgba(51, 65, 85, 0.18)";
    const sw = isMajor ? "1.15" : "0.65";

    const a1 = projectScreen([cx - gridRadius, cy + offset, zFloor]);
    const a2 = projectScreen([cx + gridRadius, cy + offset, zFloor]);
    gridLinesSvg.push(
      `<line x1="${a1[0]}" y1="${a1[1]}" x2="${a2[0]}" y2="${a2[1]}" stroke="${stroke}" stroke-width="${sw}" />`,
    );

    const b1 = projectScreen([cx + offset, cy - gridRadius, zFloor]);
    const b2 = projectScreen([cx + offset, cy + gridRadius, zFloor]);
    gridLinesSvg.push(
      `<line x1="${b1[0]}" y1="${b1[1]}" x2="${b2[0]}" y2="${b2[1]}" stroke="${stroke}" stroke-width="${sw}" />`,
    );
  }

  // ── Shade and Depth-Sort All 3D Polygons (Painter's Algorithm) ──
  const keyLight: Vec3 = normalizeVec3([0.45, -0.62, 0.64]);
  const fillLight: Vec3 = normalizeVec3([-0.62, -0.28, 0.48]);
  const rimLight: Vec3 = normalizeVec3([0.12, 0.72, 0.58]);

  interface ProjectedFace {
    pts2d: [number, number][];
    depth: number;
    fill: string;
    stroke: string;
    opacity: number;
  }

  const projectedFaces: ProjectedFace[] = [];
  for (const poly of polys) {
    const proj = poly.pts.map(projectScreen);
    let sumDepth = 0;
    for (const p of proj) sumDepth += p[2];
    const avgDepth = sumDepth / proj.length;

    const n = poly.normal;
    const dotKey = Math.max(0, n[0] * keyLight[0] + n[1] * keyLight[1] + n[2] * keyLight[2]);
    const dotFill = Math.max(0, n[0] * fillLight[0] + n[1] * fillLight[1] + n[2] * fillLight[2]);
    const dotRim = Math.max(0, n[0] * rimLight[0] + n[1] * rimLight[1] + n[2] * rimLight[2]);

    const lighting = 0.38 + dotKey * 0.56 + dotFill * 0.22 + dotRim * 0.14;
    const spec = Math.pow(dotKey, 7) * (poly.specularBoost ?? 0.2) * 58;

    const r = Math.min(255, Math.max(0, Math.round(poly.color[0] * lighting + spec)));
    const g = Math.min(255, Math.max(0, Math.round(poly.color[1] * lighting + spec)));
    const b = Math.min(255, Math.max(0, Math.round(poly.color[2] * lighting + spec)));

    const strokeAlpha = poly.strokeOpacity ?? 0.24;
    projectedFaces.push({
      pts2d: proj.map((p) => [p[0], p[1]]),
      depth: avgDepth,
      fill: `rgb(${r}, ${g}, ${b})`,
      stroke: `rgba(15, 23, 42, ${strokeAlpha})`,
      opacity: poly.opacity,
    });
  }

  projectedFaces.sort((a, b) => a.depth - b.depth);

  const facesSvg = projectedFaces.map((f) => {
    const ptsAttr = f.pts2d.map((p) => `${p[0]},${p[1]}`).join(" ");
    const opAttr = f.opacity < 0.99 ? ` fill-opacity="${f.opacity.toFixed(2)}"` : "";
    return `<polygon points="${ptsAttr}" fill="${f.fill}"${opAttr} stroke="${f.stroke}" stroke-width="0.65" stroke-linejoin="round" />`;
  });

  // Subtle curved cyan reagent transfer tube on the right side of the reactor (matching live 3D scene)
  const extraAccentsSvg: string[] = [];
  if (isDigitalTwinCell) {
    const tubePts = [
      projectScreen([0.2, 0.08, 0.24]),
      projectScreen([0.26, 0.14, 0.28]),
      projectScreen([0.33, 0.18, 0.21]),
      projectScreen([0.36, 0.2, 0.06]),
    ];
    const tubeStr = tubePts.map((p) => `${p[0]},${p[1]}`).join(" ");
    extraAccentsSvg.push(
      `<polyline points="${tubeStr}" fill="none" stroke="#38bdf8" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.88" />`,
    );
  }

  const movableJointCount = Array.from(robot.joints.values()).filter((j) => j.type !== "fixed").length;
  const displayTitle = escapeXmlText(robot.name || "URDF Robot");

  // Bottom-Left 3D Axis Triad (matching the X/Y/Z gizmo in MultibodyViewport3D.tsx)
  const gizmoCx = 54;
  const gizmoCy = height - 44;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" data-urdf-3d="true">
  <!-- 3D Perspective Ground Grid (${displayTitle} • ${robot.links.size} Links • ${movableJointCount} DOF • 3D FK Pose) -->
  <g>
    ${gridLinesSvg.join("\n    ")}
  </g>

  <!-- Depth-Sorted 3D Shaded CAD Sub-Assemblies -->
  <g>
    ${facesSvg.join("\n    ")}
  </g>

  <!-- Subtle Scene Accents -->
  <g>
    ${extraAccentsSvg.join("\n    ")}
  </g>

  <!-- Bottom-Left 3D Orientation Gizmo (matching live Three.js GizmoHelper) -->
  <g>
    <line x1="${gizmoCx}" y1="${gizmoCy}" x2="${gizmoCx + 26}" y2="${gizmoCy + 6}" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" />
    <line x1="${gizmoCx}" y1="${gizmoCy}" x2="${gizmoCx}" y2="${gizmoCy - 28}" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" />
    <line x1="${gizmoCx}" y1="${gizmoCy}" x2="${gizmoCx - 20}" y2="${gizmoCy + 14}" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" />
    <circle cx="${gizmoCx + 28}" cy="${gizmoCy + 7}" r="8" fill="#ef4444" />
    <text x="${gizmoCx + 28}" y="${gizmoCy + 10.5}" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="9" font-weight="700">X</text>
    <circle cx="${gizmoCx}" cy="${gizmoCy - 30}" r="8" fill="#22c55e" />
    <text x="${gizmoCx}" y="${gizmoCy - 26.5}" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="9" font-weight="700">Y</text>
    <circle cx="${gizmoCx - 22}" cy="${gizmoCy + 15}" r="8" fill="#3b82f6" />
    <text x="${gizmoCx - 22}" y="${gizmoCy + 18.5}" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="9" font-weight="700">Z</text>
  </g>
</svg>
`;
}

