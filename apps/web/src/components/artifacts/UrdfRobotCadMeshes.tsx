// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DigitalTwinEnvironmentAsset, UrdfVisualPose3D } from "@modelscript/urdf";
import React, { useMemo } from "react";
import * as THREE from "three";

/**
 * Converts a URDF right-handed Z-up world position [x, y, z] and 3x3 rotation matrix
 * into Three.js right-handed Y-up coordinates:
 *   p_three = [x, z, -y]
 *   R_three = T * R_urdf * T^T, where T = [[1,0,0],[0,0,1],[0,-1,0]]
 */
export function urdfPoseToThree(
  pos: [number, number, number],
  rot?: [number, number, number, number, number, number, number, number, number],
): { position: [number, number, number]; quaternion: THREE.Quaternion } {
  const position: [number, number, number] = [pos[0], pos[2], -pos[1]];
  const quaternion = new THREE.Quaternion();
  if (rot && rot.length === 9) {
    const [r0, r1, r2, r3, r4, r5, r6, r7, r8] = rot;
    const m4 = new THREE.Matrix4();
    m4.set(
      r0, r2, -r1, 0,
      r6, r8, -r7, 0,
      -r3, -r5, r4, 0,
      0, 0, 0, 1,
    );
    quaternion.setFromRotationMatrix(m4);
  }
  return { position, quaternion };
}

const UR_BLUE = "#3b97d3";
const UR_SILVER = "#e2e8f0";
const UR_ALUMINUM = "#cbd5e1";
const UR_DARK = "#1e242b";
const UR_CHARCOAL = "#334155";
const STEEL_FLANGE = "#94a3b8";
const CNC_MAGENTA = "#d946ef";

/**
 * High-detail procedural CAD sub-assemblies for Universal Robots UR3e,
 * Robotiq Hand-E parallel gripper, Franka torque cobot, and 3-axis CNC pipetting gantry.
 * Note: In local Three.js visual coordinates, +Y corresponds to +Z_urdf,
 * +X corresponds to +X_urdf, and -Z corresponds to +Y_urdf.
 */
const ProceduralRobotPart: React.FC<{
  partKind: string;
  primaryColor?: string | undefined;
  radius?: number | undefined;
  length?: number | undefined;
  size?: { x: number; y: number; z: number } | undefined;
}> = ({ partKind, primaryColor, radius = 0.045, length = 0.2, size }) => {
  switch (partKind) {
    case "ur3e_base":
      return (
        <group>
          {/* Mounting flange plate */}
          <mesh position={[0, 0.008, 0]}>
            <cylinderGeometry args={[0.076, 0.08, 0.016, 32]} />
            <meshStandardMaterial color={STEEL_FLANGE} metalness={0.7} roughness={0.3} />
          </mesh>
          {/* 4 Mounting bolts */}
          {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((ang, idx) => (
            <mesh key={idx} position={[Math.cos(ang) * 0.064, 0.018, Math.sin(ang) * 0.064]}>
              <cylinderGeometry args={[0.005, 0.005, 0.006, 12]} />
              <meshStandardMaterial color={UR_DARK} metalness={0.8} roughness={0.2} />
            </mesh>
          ))}
          {/* Main pedestal cylinder */}
          <mesh position={[0, 0.052, 0]}>
            <cylinderGeometry args={[0.058, 0.062, 0.076, 32]} />
            <meshStandardMaterial color={UR_SILVER} metalness={0.25} roughness={0.35} />
          </mesh>
          {/* Top black elastomer joint seal ring */}
          <mesh position={[0, 0.094, 0]}>
            <cylinderGeometry args={[0.059, 0.059, 0.01, 32]} />
            <meshStandardMaterial color={UR_DARK} metalness={0.2} roughness={0.6} />
          </mesh>
          {/* Rear cable connector boss */}
          <mesh position={[-0.055, 0.032, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.016, 0.018, 0.03, 20]} />
            <meshStandardMaterial color={UR_CHARCOAL} metalness={0.5} roughness={0.4} />
          </mesh>
        </group>
      );

    case "ur3e_shoulder":
      return (
        <group>
          {/* Vertical shoulder turret housing */}
          <mesh position={[0, 0.045, 0]}>
            <cylinderGeometry args={[0.055, 0.056, 0.095, 32]} />
            <meshStandardMaterial color={UR_SILVER} metalness={0.25} roughness={0.32} />
          </mesh>
          {/* Signature UR Sky Blue top cap */}
          <mesh position={[0, 0.098, 0]}>
            <cylinderGeometry args={[0.05, 0.055, 0.018, 32]} />
            <meshStandardMaterial color={UR_BLUE} metalness={0.35} roughness={0.28} />
          </mesh>
          <mesh position={[0, 0.108, 0]}>
            <sphereGeometry args={[0.05, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.35]} />
            <meshStandardMaterial color={UR_BLUE} metalness={0.35} roughness={0.28} />
          </mesh>
          {/* Lateral output flange toward upper arm (-Z in Three = +Y in URDF) */}
          <mesh position={[0, 0.05, -0.055]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.048, 0.05, 0.06, 32]} />
            <meshStandardMaterial color={UR_SILVER} metalness={0.3} roughness={0.35} />
          </mesh>
          {/* Black elastomer seal ring on lateral joint */}
          <mesh position={[0, 0.05, -0.086]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.049, 0.049, 0.008, 32]} />
            <meshStandardMaterial color={UR_DARK} metalness={0.2} roughness={0.6} />
          </mesh>
        </group>
      );

    case "ur3e_upper_arm": {
      const L = length || 0.24355;
      return (
        <group>
          {/* Proximal shoulder joint housing */}
          <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.047, 0.047, 0.078, 32]} />
            <meshStandardMaterial color={UR_SILVER} metalness={0.25} roughness={0.32} />
          </mesh>
          {/* Proximal UR Blue cap */}
          <mesh position={[0, 0, -0.046]} rotation={[-Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.043, 0.047, 0.018, 32]} />
            <meshStandardMaterial color={UR_BLUE} metalness={0.35} roughness={0.28} />
          </mesh>
          {/* Proximal black collar */}
          <mesh position={[0, 0.036, 0]}>
            <cylinderGeometry args={[0.041, 0.044, 0.016, 28]} />
            <meshStandardMaterial color={UR_DARK} metalness={0.4} roughness={0.5} />
          </mesh>
          {/* Brushed aluminum main cylindrical tube */}
          <mesh position={[0, L * 0.5, 0]}>
            <cylinderGeometry args={[0.036, 0.038, Math.max(0.08, L - 0.07), 32]} />
            <meshStandardMaterial color={UR_ALUMINUM} metalness={0.55} roughness={0.28} />
          </mesh>
          {/* Distal black collar */}
          <mesh position={[0, L - 0.036, 0]}>
            <cylinderGeometry args={[0.041, 0.038, 0.016, 28]} />
            <meshStandardMaterial color={UR_DARK} metalness={0.4} roughness={0.5} />
          </mesh>
          {/* Distal elbow housing */}
          <mesh position={[0, L, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.042, 0.042, 0.07, 32]} />
            <meshStandardMaterial color={UR_SILVER} metalness={0.25} roughness={0.32} />
          </mesh>
          {/* Distal UR Blue cap */}
          <mesh position={[0, L, -0.041]} rotation={[-Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.038, 0.042, 0.016, 32]} />
            <meshStandardMaterial color={UR_BLUE} metalness={0.35} roughness={0.28} />
          </mesh>
        </group>
      );
    }

    case "ur3e_forearm": {
      const L = length || 0.2132;
      return (
        <group>
          {/* Proximal elbow joint housing */}
          <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.038, 0.038, 0.064, 32]} />
            <meshStandardMaterial color={UR_SILVER} metalness={0.25} roughness={0.32} />
          </mesh>
          {/* Proximal UR Blue cap */}
          <mesh position={[0, 0, 0.038]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.034, 0.038, 0.015, 32]} />
            <meshStandardMaterial color={UR_BLUE} metalness={0.35} roughness={0.28} />
          </mesh>
          {/* Tapered brushed aluminum forearm tube */}
          <mesh position={[0, L * 0.5, 0]}>
            <cylinderGeometry args={[0.028, 0.032, Math.max(0.06, L - 0.055), 32]} />
            <meshStandardMaterial color={UR_ALUMINUM} metalness={0.55} roughness={0.28} />
          </mesh>
          {/* Distal wrist housing */}
          <mesh position={[0, L, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.033, 0.033, 0.056, 28]} />
            <meshStandardMaterial color={UR_SILVER} metalness={0.25} roughness={0.32} />
          </mesh>
        </group>
      );
    }

    case "ur3e_wrist":
      return (
        <group>
          {/* Compact modular wrist housing */}
          <mesh position={[0, 0.025, 0]}>
            <cylinderGeometry args={[0.032, 0.032, 0.068, 28]} />
            <meshStandardMaterial color={UR_SILVER} metalness={0.25} roughness={0.32} />
          </mesh>
          {/* UR Sky Blue angled wrist cap */}
          <mesh position={[0, 0.064, 0]}>
            <cylinderGeometry args={[0.028, 0.032, 0.014, 28]} />
            <meshStandardMaterial color={UR_BLUE} metalness={0.35} roughness={0.28} />
          </mesh>
          {/* Black elastomer seal ring */}
          <mesh position={[0, -0.008, 0]}>
            <cylinderGeometry args={[0.033, 0.033, 0.007, 28]} />
            <meshStandardMaterial color={UR_DARK} metalness={0.2} roughness={0.6} />
          </mesh>
        </group>
      );

    case "ur3e_flange":
      return (
        <group>
          {/* Wrist 3 housing */}
          <mesh position={[0, 0.018, 0]}>
            <cylinderGeometry args={[0.031, 0.032, 0.042, 28]} />
            <meshStandardMaterial color={UR_SILVER} metalness={0.3} roughness={0.32} />
          </mesh>
          {/* Force-torque sensor collar */}
          <mesh position={[0, 0.044, 0]}>
            <cylinderGeometry args={[0.032, 0.032, 0.012, 28]} />
            <meshStandardMaterial color={UR_DARK} metalness={0.4} roughness={0.4} />
          </mesh>
          {/* Stainless ISO 9409-1 tool flange */}
          <mesh position={[0, 0.054, 0]}>
            <cylinderGeometry args={[0.0315, 0.0315, 0.008, 28]} />
            <meshStandardMaterial color={STEEL_FLANGE} metalness={0.75} roughness={0.25} />
          </mesh>
        </group>
      );

    case "robotiq_gripper":
      return (
        <group>
          {/* Adapter coupling */}
          <mesh position={[0, 0.01, 0]}>
            <cylinderGeometry args={[0.031, 0.031, 0.02, 24]} />
            <meshStandardMaterial color={UR_DARK} metalness={0.5} roughness={0.4} />
          </mesh>
          {/* Status LED ring */}
          <mesh position={[0, 0.021, 0]}>
            <cylinderGeometry args={[0.0315, 0.0315, 0.004, 24]} />
            <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.6} />
          </mesh>
          {/* Matte-black parallel gripper actuator body */}
          <mesh position={[0, 0.048, 0]}>
            <boxGeometry args={[0.056, 0.052, 0.078]} />
            <meshStandardMaterial color={UR_DARK} metalness={0.45} roughness={0.38} />
          </mesh>
          {/* Linear guideway rail */}
          <mesh position={[0, 0.078, 0]}>
            <boxGeometry args={[0.024, 0.01, 0.088]} />
            <meshStandardMaterial color={STEEL_FLANGE} metalness={0.75} roughness={0.25} />
          </mesh>
          {/* Left parallel jaw + silicone pad */}
          <mesh position={[0, 0.105, -0.026]}>
            <boxGeometry args={[0.018, 0.046, 0.01]} />
            <meshStandardMaterial color={UR_ALUMINUM} metalness={0.65} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.112, -0.019]}>
            <boxGeometry args={[0.018, 0.026, 0.004]} />
            <meshStandardMaterial color="#0f172a" roughness={0.8} />
          </mesh>
          {/* Right parallel jaw + silicone pad */}
          <mesh position={[0, 0.105, 0.026]}>
            <boxGeometry args={[0.018, 0.046, 0.01]} />
            <meshStandardMaterial color={UR_ALUMINUM} metalness={0.65} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.112, 0.019]}>
            <boxGeometry args={[0.018, 0.026, 0.004]} />
            <meshStandardMaterial color="#0f172a" roughness={0.8} />
          </mesh>
        </group>
      );

    case "cnc_gantry_carriage":
      return (
        <group>
          {/* Magenta anodized Z-carriage plate (matching reference cell) */}
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[0.068, 0.11, 0.055]} />
            <meshStandardMaterial color={CNC_MAGENTA} metalness={0.5} roughness={0.3} />
          </mesh>
          {/* Black NEMA-17 stepper motor at top */}
          <mesh position={[0, 0.072, 0]}>
            <boxGeometry args={[0.042, 0.042, 0.042]} />
            <meshStandardMaterial color={UR_DARK} metalness={0.4} roughness={0.5} />
          </mesh>
          {/* Dual stainless steel dispensing probes */}
          <mesh position={[0.014, -0.085, 0]}>
            <cylinderGeometry args={[0.0035, 0.0015, 0.09, 16]} />
            <meshStandardMaterial color="#f8fafc" metalness={0.85} roughness={0.15} />
          </mesh>
          <mesh position={[-0.014, -0.085, 0]}>
            <cylinderGeometry args={[0.0035, 0.0015, 0.09, 16]} />
            <meshStandardMaterial color="#f8fafc" metalness={0.85} roughness={0.15} />
          </mesh>
          {/* Probe holder block */}
          <mesh position={[0, -0.042, 0]}>
            <boxGeometry args={[0.048, 0.024, 0.036]} />
            <meshStandardMaterial color={UR_DARK} metalness={0.45} roughness={0.4} />
          </mesh>
        </group>
      );

    case "articulated_arm_link": {
      const r = radius || 0.038;
      const L = length || 0.2;
      return (
        <group>
          {/* Main brushed metallic link cylinder (centered at local origin along +Y_three = +Z_urdf) */}
          <mesh>
            <cylinderGeometry args={[r * 0.92, r, Math.max(0.04, L - 0.032), 28]} />
            <meshStandardMaterial color={primaryColor || UR_SILVER} metalness={0.42} roughness={0.3} />
          </mesh>
          {/* Proximal dark actuator collar ring */}
          <mesh position={[0, -L * 0.5 + 0.012, 0]}>
            <cylinderGeometry args={[r * 1.06, r * 1.06, 0.02, 28]} />
            <meshStandardMaterial color={UR_DARK} metalness={0.45} roughness={0.45} />
          </mesh>
          {/* Distal joint housing cap */}
          <mesh position={[0, L * 0.5 - 0.01, 0]}>
            <cylinderGeometry args={[r * 1.04, r * 1.04, 0.02, 28]} />
            <meshStandardMaterial color={UR_BLUE} metalness={0.38} roughness={0.28} />
          </mesh>
        </group>
      );
    }

    default: {
      // Standard primitive fallback with refined metallic/satin finish
      const sx = size?.x ?? radius * 2;
      const sy = size?.y ?? radius * 2;
      const sz = size?.z ?? length;
      return (
        <mesh>
          <boxGeometry args={[sx, sz, sy]} />
          <meshStandardMaterial
            color={primaryColor || UR_SILVER}
            metalness={0.35}
            roughness={0.35}
          />
        </mesh>
      );
    }
  }
};

function classifyCadPart(vis: UrdfVisualPose3D): string | null {
  const fn = (vis.geometry.filename || "").toLowerCase();
  const vn = (vis.visualName || "").toLowerCase();
  const ln = vis.linkName.toLowerCase();

  if (fn.includes("ur3e/base") || vn === "ur3e_base") return "ur3e_base";
  if (fn.includes("ur3e/shoulder") || vn === "ur3e_shoulder") return "ur3e_shoulder";
  if (fn.includes("ur3e/upperarm") || vn === "ur3e_upper_arm") return "ur3e_upper_arm";
  if (fn.includes("ur3e/forearm") || vn === "ur3e_forearm") return "ur3e_forearm";
  if (fn.includes("ur3e/wrist1") || fn.includes("ur3e/wrist2") || vn === "ur3e_wrist") return "ur3e_wrist";
  if (fn.includes("ur3e/wrist3") || vn === "ur3e_flange") return "ur3e_flange";
  if (fn.includes("robotiq") || vn === "robotiq_gripper" || ln === "tool0_gripper") return "robotiq_gripper";
  if (fn.includes("cnc_carriage") || vn === "cnc_gantry_carriage" || ln === "pipette_nozzle_link") {
    return "cnc_gantry_carriage";
  }
  if (
    vis.geometry.type === "cylinder" &&
    (Boolean(fn) ||
      /^link_[1-7]$/.test(ln) ||
      ln.includes("panda_link") ||
      ln.includes("iiwa_link") ||
      ln.includes("arm_link"))
  ) {
    return "articulated_arm_link";
  }
  return null;
}

export const UrdfVisualMesh: React.FC<{ visual: UrdfVisualPose3D }> = ({ visual }) => {
  const { position, quaternion } = useMemo(
    () => urdfPoseToThree(visual.position, visual.rotation),
    [visual.position, visual.rotation],
  );

  const cadPart = classifyCadPart(visual);
  const g = visual.geometry;
  const color = visual.color || (visual.isCollision ? "#22c55e" : "#cbd5e1");
  const isTransparent = visual.isCollision || (visual.opacity !== undefined && visual.opacity < 1);
  const opacity = visual.isCollision ? 0.25 : (visual.opacity ?? 1.0);

  return (
    <group position={position} quaternion={quaternion}>
      { !visual.isCollision && cadPart ? (
        <ProceduralRobotPart
          partKind={cadPart}
          primaryColor={color}
          radius={g.radius}
          length={g.length}
          size={g.size}
        />
      ) : g.type === "cylinder" ? (
        <mesh>
          <cylinderGeometry args={[g.radius ?? 0.04, g.radius ?? 0.04, g.length ?? 0.15, 28]} />
          <meshStandardMaterial
            color={color}
            metalness={visual.isCollision ? 0.1 : 0.4}
            roughness={0.32}
            transparent={isTransparent}
            opacity={opacity}
            wireframe={visual.isCollision}
          />
        </mesh>
      ) : g.type === "sphere" ? (
        <mesh>
          <sphereGeometry args={[g.radius ?? 0.05, 24, 24]} />
          <meshStandardMaterial
            color={color}
            metalness={visual.isCollision ? 0.1 : 0.35}
            roughness={0.35}
            transparent={isTransparent}
            opacity={opacity}
            wireframe={visual.isCollision}
          />
        </mesh>
      ) : (
        <mesh>
          <boxGeometry args={[g.size?.x ?? 0.1, g.size?.z ?? 0.1, g.size?.y ?? 0.1]} />
          <meshStandardMaterial
            color={color}
            metalness={visual.isCollision ? 0.1 : 0.4}
            roughness={0.35}
            transparent={isTransparent}
            opacity={opacity}
            wireframe={visual.isCollision}
          />
        </mesh>
      )}
    </group>
  );
};

function eulerRpyToThreeQuaternion(rpy?: [number, number, number]): THREE.Quaternion {
  if (!rpy) return new THREE.Quaternion();
  const [r, p, y] = rpy;
  if (Math.abs(r) < 1e-9 && Math.abs(p) < 1e-9 && Math.abs(y) < 1e-9) {
    return new THREE.Quaternion();
  }
  const cr = Math.cos(r),
    sr = Math.sin(r);
  const cp = Math.cos(p),
    sp = Math.sin(p);
  const cy = Math.cos(y),
    sy = Math.sin(y);
  return urdfPoseToThree(
    [0, 0, 0],
    [
      cy * cp,
      cy * sp * sr - sy * cr,
      cy * sp * cr + sy * sr,
      sy * cp,
      sy * sp * sr + cy * cr,
      sy * sp * cr - cy * sr,
      -sp,
      cp * sr,
      cp * cr,
    ],
  ).quaternion;
}

/**
 * Renders rich self-driving laboratory workstation fixtures or generic environment obstacles:
 * - Heavy aluminum-framed cabinet with optical breadboard top
 * - Heated magnetic stirrer / reactor housing with vessel & lid
 * - Twin white PTFE vial racks with glass vials & toggle clamps
 * - Yellow rinse/waste beaker
 * - Arbitrary box / cylinder / table obstacles with full 3D orientation support
 */
export const DigitalTwinEnvironmentMesh: React.FC<{
  asset: DigitalTwinEnvironmentAsset;
  showColliders?: boolean | undefined;
}> = ({ asset, showColliders = false }) => {
  const [x, y, z] = asset.position;
  const [dx, dy, dz] = asset.dimensions || [0.4, 0.4, 0.4];
  // Three.js position: [x, z, -y]
  const pos: [number, number, number] = [x, z, -y];
  const quat = useMemo(() => eulerRpyToThreeQuaternion(asset.rotation), [asset.rotation]);

  if (asset.type === "workstation_cabinet" || asset.type === "table") {
    return (
      <group position={pos} quaternion={quat}>
        {/* Subtle studio circular floor podium shadow disc */}
        <mesh position={[0, -dz * 0.5 + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1.65, 64]} />
          <meshStandardMaterial color="#1e293b" roughness={0.9} metalness={0.05} transparent opacity={0.45} />
        </mesh>

        {/* Main aluminum cabinet body */}
        <mesh position={[0, -0.02, 0]}>
          <boxGeometry args={[dx * 0.96, dz * 0.92, dy * 0.94]} />
          <meshStandardMaterial color="#64748b" metalness={0.45} roughness={0.45} />
        </mesh>

        {/* Front cabinet recessed doors (Left & Right) */}
        <mesh position={[-dx * 0.23, -0.02, dy * 0.475]}>
          <boxGeometry args={[dx * 0.42, dz * 0.78, 0.012]} />
          <meshStandardMaterial color="#475569" metalness={0.4} roughness={0.5} />
        </mesh>
        <mesh position={[dx * 0.23, -0.02, dy * 0.475]}>
          <boxGeometry args={[dx * 0.42, dz * 0.78, 0.012]} />
          <meshStandardMaterial color="#475569" metalness={0.4} roughness={0.5} />
        </mesh>

        {/* Brushed door handles */}
        <mesh position={[-0.04, 0.02, dy * 0.49]}>
          <boxGeometry args={[0.012, 0.14, 0.016]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.2} />
        </mesh>
        <mesh position={[0.04, 0.02, dy * 0.49]}>
          <boxGeometry args={[0.012, 0.14, 0.016]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.2} />
        </mesh>

        {/* Top perimeter heavy aluminum extrusion frame */}
        <mesh position={[0, dz * 0.45, 0]}>
          <boxGeometry args={[dx * 1.02, 0.045, dy * 1.02]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.65} roughness={0.3} />
        </mesh>

        {/* Dark anodized slotted optical breadboard / T-slot work surface */}
        <mesh position={[0, dz * 0.485, 0]}>
          <boxGeometry args={[dx * 0.98, 0.028, dy * 0.98]} />
          <meshStandardMaterial color="#1e242b" metalness={0.55} roughness={0.38} />
        </mesh>

        {/* T-slot surface grooves */}
        {[-0.32, -0.24, -0.16, -0.08, 0, 0.08, 0.16, 0.24, 0.32].map((zOff, idx) => (
          <mesh key={idx} position={[0, dz * 0.501, zOff * dy]}>
            <boxGeometry args={[dx * 0.95, 0.003, 0.004]} />
            <meshStandardMaterial color="#0f172a" roughness={0.8} />
          </mesh>
        ))}

        {/* 4 Leveling feet */}
        {[
          [-dx * 0.44, -dz * 0.49, -dy * 0.42],
          [dx * 0.44, -dz * 0.49, -dy * 0.42],
          [-dx * 0.44, -dz * 0.49, dy * 0.42],
          [dx * 0.44, -dz * 0.49, dy * 0.42],
        ].map(([fx, fy, fz], i) => (
          <mesh key={i} position={[fx!, fy!, fz!]}>
            <cylinderGeometry args={[0.025, 0.03, 0.04, 16]} />
            <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.5} />
          </mesh>
        ))}
      </group>
    );
  }

  if (asset.type === "reactor_mixer") {
    return (
      <group position={pos} quaternion={quat}>
        {/* Main white powder-coated stirrer/reactor housing */}
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[dx, dz * 0.88, dy]} />
          <meshStandardMaterial color="#e2e8f0" metalness={0.15} roughness={0.35} />
        </mesh>
        {/* Royal blue beveled upper trim */}
        <mesh position={[0, dz * 0.46, 0]}>
          <boxGeometry args={[dx * 1.01, dz * 0.09, dy * 1.01]} />
          <meshStandardMaterial color="#1d4ed8" metalness={0.3} roughness={0.3} />
        </mesh>
        {/* Top cylindrical heated reaction well */}
        <mesh position={[0, dz * 0.54, 0]}>
          <cylinderGeometry args={[dx * 0.28, dx * 0.3, 0.045, 28]} />
          <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.35} />
        </mesh>
        {/* Front status badge */}
        <mesh position={[0, dz * 0.22, dy * 0.505]}>
          <boxGeometry args={[0.055, 0.022, 0.004]} />
          <meshStandardMaterial color="#1d4ed8" />
        </mesh>
        {showColliders && (
          <mesh position={[0, 0.02, 0]}>
            <boxGeometry args={[dx * 1.06, dz * 1.12, dy * 1.06]} />
            <meshStandardMaterial color="#f59e0b" wireframe transparent opacity={0.45} />
          </mesh>
        )}
      </group>
    );
  }

  if (asset.type === "vial_rack") {
    return (
      <group position={pos} quaternion={quat}>
        {/* White machined PTFE vial tray base */}
        <mesh position={[0, -dz * 0.25, 0]}>
          <boxGeometry args={[dx, dz * 0.5, dy]} />
          <meshStandardMaterial color="#f1f5f9" metalness={0.1} roughness={0.3} />
        </mesh>
        {/* 2 Large reagent bottles with blue screw caps */}
        {[-dx * 0.22, dx * 0.22].map((vx, i) => (
          <group key={i} position={[vx, dz * 0.28, -dy * 0.12]}>
            <mesh>
              <cylinderGeometry args={[0.032, 0.032, 0.068, 24]} />
              <meshStandardMaterial color="#cbd5e1" transparent opacity={0.75} roughness={0.15} metalness={0.1} />
            </mesh>
            <mesh position={[0, 0.038, 0]}>
              <cylinderGeometry args={[0.034, 0.034, 0.024, 24]} />
              <meshStandardMaterial color="#2563eb" roughness={0.3} />
            </mesh>
          </group>
        ))}
        {/* 4 Front sample vials + orange/black fixture clamps */}
        {[-0.3, -0.1, 0.1, 0.3].map((frac, i) => (
          <group key={i} position={[dx * frac, dz * 0.15, dy * 0.24]}>
            <mesh>
              <cylinderGeometry args={[0.012, 0.012, 0.042, 16]} />
              <meshStandardMaterial color="#93c5fd" transparent opacity={0.8} roughness={0.15} />
            </mesh>
            <mesh position={[0, -0.012, 0.028]}>
              <boxGeometry args={[0.022, 0.018, 0.022]} />
              <meshStandardMaterial color="#1e293b" />
            </mesh>
            <mesh position={[0, 0.002, 0.032]}>
              <boxGeometry args={[0.016, 0.008, 0.016]} />
              <meshStandardMaterial color="#f97316" />
            </mesh>
          </group>
        ))}
        {showColliders && (
          <mesh position={[0, dz * 0.15, 0]}>
            <boxGeometry args={[dx * 1.05, dz * 1.2, dy * 1.05]} />
            <meshStandardMaterial color="#22c55e" wireframe transparent opacity={0.4} />
          </mesh>
        )}
      </group>
    );
  }

  if (asset.type === "wash_cup") {
    return (
      <group position={pos} quaternion={quat}>
        <mesh>
          <cylinderGeometry args={[dx * 0.5, dx * 0.46, dz, 28]} />
          <meshStandardMaterial color={asset.color || "#eab308"} roughness={0.32} metalness={0.15} />
        </mesh>
        <mesh position={[0, dz * 0.48, 0]}>
          <cylinderGeometry args={[dx * 0.42, dx * 0.42, 0.006, 24]} />
          <meshStandardMaterial color="#1e293b" roughness={0.8} />
        </mesh>
      </group>
    );
  }

  if (asset.type === "cylinder") {
    return (
      <group position={pos} quaternion={quat}>
        <mesh>
          <cylinderGeometry args={[dx * 0.5, dx * 0.5, dz, 24]} />
          <meshStandardMaterial
            color={asset.color || "#484f58"}
            roughness={0.4}
            metalness={0.3}
            transparent={asset.opacity !== undefined && asset.opacity < 1}
            opacity={asset.opacity ?? 0.9}
          />
        </mesh>
      </group>
    );
  }

  return (
    <group position={pos} quaternion={quat}>
      <mesh>
        <boxGeometry args={[dx, dz, dy]} />
        <meshStandardMaterial
          color={asset.color || "#484f58"}
          roughness={0.45}
          metalness={0.25}
          transparent={asset.opacity !== undefined && asset.opacity < 1}
          opacity={asset.opacity ?? (asset.isCollisionHull ? 0.4 : 0.9)}
          wireframe={Boolean(asset.isCollisionHull && showColliders)}
        />
      </mesh>
    </group>
  );
};
