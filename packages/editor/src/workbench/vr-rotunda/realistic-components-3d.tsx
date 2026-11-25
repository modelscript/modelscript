// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useMemo } from "react";
import * as THREE from "three";

export type RealisticComponentKind =
  "battery" | "resistor" | "capacitor" | "inductor" | "diode" | "ic-chip" | "gear" | "spring-damper" | "valve";

export const REALISTIC_COMPONENT_KINDS: readonly RealisticComponentKind[] = [
  "battery",
  "resistor",
  "capacitor",
  "inductor",
  "diode",
  "ic-chip",
  "gear",
  "spring-damper",
  "valve",
] as const;

const NOOP_RAYCAST: THREE.Object3D["raycast"] = () => {};

/**
 * Classifies a component's identifier / className / label into a curated
 * realistic 3D hardware model when available, or returns `null` so the node
 * renders as a crisp auto-extruded 3D schematic wafer card.
 */
export function resolveRealisticComponentKind(hint: string): RealisticComponentKind | null {
  const s = hint.toLowerCase();
  if (!s.trim()) return null;

  // Battery / DC voltage source
  if (
    s.includes("battery") ||
    s.includes("constantvoltage") ||
    s.includes("constant_voltage") ||
    s.includes("dcvoltage") ||
    s.includes("voltagesource") ||
    s.includes("msl-constant-voltage")
  ) {
    return "battery";
  }

  // Axial through-hole resistor
  if (s.includes("resistor") || /\br[0-9]+\b/.test(s)) {
    return "resistor";
  }

  // Electrolytic capacitor (exclude thermal HeatCapacitor so thermal blocks keep their card)
  if (s.includes("capacitor") && !s.includes("heat") && !s.includes("thermal")) {
    return "capacitor";
  }

  // Toroidal copper-wound inductor
  if (s.includes("inductor") || s.includes("choke") || s.includes("coil")) {
    return "inductor";
  }

  // Axial diode / rectifier
  if (s.includes("diode") || s.includes("1n4148") || s.includes("rectifier")) {
    return "diode";
  }

  // 8-pin DIP IC chip (op-amps, PID & digital controllers, AUTOSAR SW-Cs)
  if (
    s.includes("opamp") ||
    s.includes("op-amp") ||
    s.includes("msl-pid") ||
    s.includes("pid controller") ||
    s.includes("autosar") ||
    s.includes("microcontroller") ||
    s.includes("ic_chip")
  ) {
    return "ic-chip";
  }

  // Machined brass/steel spur gear
  if (s.includes("idealgear") || s.includes("msl-ideal-gear") || /\bgear\b/.test(s)) {
    return "gear";
  }

  // Coil-over spring-damper strut
  if (s.includes("springdamper") || s.includes("spring-damper") || s.includes("spring_damper")) {
    return "spring-damper";
  }

  // Industrial brass globe valve with red handwheel
  if (s.includes("valve")) {
    return "valve";
  }

  return null;
}

interface SharedHardwareGeometries {
  // Common leads & shafts
  leadCylH: THREE.CylinderGeometry;
  leadCylV: THREE.CylinderGeometry;
  // Battery
  battBodyLower: THREE.CylinderGeometry;
  battBodyCopper: THREE.CylinderGeometry;
  battCapPos: THREE.CylinderGeometry;
  battCapNeg: THREE.CylinderGeometry;
  battRingRed: THREE.CylinderGeometry;
  // Resistor
  resBodyCenter: THREE.CylinderGeometry;
  resBodyBulb: THREE.CylinderGeometry;
  resBand: THREE.CylinderGeometry;
  // Capacitor
  capCan: THREE.CylinderGeometry;
  capTopDisc: THREE.CylinderGeometry;
  capStripe: THREE.BoxGeometry;
  // Inductor
  indCore: THREE.TorusGeometry;
  indTurn: THREE.TorusGeometry;
  // Diode
  diodeBody: THREE.CylinderGeometry;
  diodeBand: THREE.CylinderGeometry;
  // IC Chip
  icBody: THREE.BoxGeometry;
  icNotch: THREE.CylinderGeometry;
  icPin: THREE.BoxGeometry;
  icDot: THREE.CylinderGeometry;
  // Gear
  gearWeb: THREE.CylinderGeometry;
  gearHub: THREE.CylinderGeometry;
  gearBore: THREE.CylinderGeometry;
  gearTooth: THREE.BoxGeometry;
  // Spring-Damper
  sdCylinder: THREE.CylinderGeometry;
  sdRod: THREE.CylinderGeometry;
  sdCoilRing: THREE.TorusGeometry;
  sdCap: THREE.CylinderGeometry;
  // Valve
  valvePipe: THREE.CylinderGeometry;
  valveFlange: THREE.CylinderGeometry;
  valveBonnet: THREE.CylinderGeometry;
  valveStem: THREE.CylinderGeometry;
  valveWheelRim: THREE.TorusGeometry;
  valveSpoke: THREE.BoxGeometry;
}

let cachedGeoms: SharedHardwareGeometries | null = null;

function getSharedHardwareGeometries(): SharedHardwareGeometries {
  if (cachedGeoms) return cachedGeoms;

  const cylH = (rTop: number, rBot: number, len: number, segs = 16) => {
    const g = new THREE.CylinderGeometry(rTop, rBot, len, segs);
    g.rotateZ(Math.PI / 2);
    return g;
  };

  cachedGeoms = {
    leadCylH: cylH(0.0028, 0.0028, 0.148, 10),
    leadCylV: new THREE.CylinderGeometry(0.0026, 0.0026, 0.044, 10),

    // Battery (horizontal AA/18650 cell spanning ~0.11m + end leads to 0.148m)
    battBodyLower: cylH(0.025, 0.025, 0.068, 20),
    battBodyCopper: cylH(0.0254, 0.0254, 0.032, 20),
    battCapPos: cylH(0.0095, 0.0095, 0.009, 16),
    battCapNeg: cylH(0.021, 0.021, 0.004, 18),
    battRingRed: cylH(0.0258, 0.0258, 0.0045, 20),

    // Resistor (axial carbon film body + 2 bulbs + 4 color bands)
    resBodyCenter: cylH(0.0155, 0.0155, 0.056, 18),
    resBodyBulb: cylH(0.0185, 0.0175, 0.018, 18),
    resBand: cylH(0.0162, 0.0162, 0.0065, 18),

    // Electrolytic Capacitor (vertical blue aluminum can + silver stripe + horizontal leads)
    capCan: new THREE.CylinderGeometry(0.025, 0.025, 0.072, 20),
    capTopDisc: new THREE.CylinderGeometry(0.0235, 0.0235, 0.004, 20),
    capStripe: new THREE.BoxGeometry(0.009, 0.068, 0.006),

    // Toroidal Inductor (ferrite donut + copper windings)
    indCore: new THREE.TorusGeometry(0.029, 0.0115, 12, 24),
    indTurn: new THREE.TorusGeometry(0.0132, 0.0026, 8, 14),

    // Axial Diode
    diodeBody: cylH(0.0145, 0.0145, 0.058, 18),
    diodeBand: cylH(0.0151, 0.0151, 0.011, 18),

    // 8-pin DIP IC Package
    icBody: new THREE.BoxGeometry(0.098, 0.048, 0.018),
    icNotch: new THREE.CylinderGeometry(0.007, 0.007, 0.019, 12),
    icPin: new THREE.BoxGeometry(0.0075, 0.014, 0.005),
    icDot: new THREE.CylinderGeometry(0.0036, 0.0036, 0.002, 10),

    // Spur Gear
    gearWeb: new THREE.CylinderGeometry(0.036, 0.036, 0.016, 22),
    gearHub: new THREE.CylinderGeometry(0.014, 0.014, 0.024, 16),
    gearBore: new THREE.CylinderGeometry(0.0065, 0.0065, 0.026, 12),
    gearTooth: new THREE.BoxGeometry(0.011, 0.012, 0.015),

    // Spring-Damper Strut
    sdCylinder: cylH(0.014, 0.014, 0.058, 16),
    sdRod: cylH(0.0055, 0.0055, 0.064, 12),
    sdCoilRing: new THREE.TorusGeometry(0.021, 0.0036, 8, 18),
    sdCap: cylH(0.022, 0.022, 0.007, 16),

    // Industrial Brass Valve
    valvePipe: cylH(0.016, 0.016, 0.092, 16),
    valveFlange: cylH(0.024, 0.024, 0.009, 16),
    valveBonnet: new THREE.CylinderGeometry(0.014, 0.017, 0.026, 14),
    valveStem: new THREE.CylinderGeometry(0.0045, 0.0045, 0.024, 10),
    valveWheelRim: new THREE.TorusGeometry(0.026, 0.0042, 8, 20),
    valveSpoke: new THREE.BoxGeometry(0.048, 0.004, 0.004),
  };

  // Orient gear discs to face +Z so the toothed wheel faces the viewer cleanly
  cachedGeoms.gearWeb.rotateX(Math.PI / 2);
  cachedGeoms.gearHub.rotateX(Math.PI / 2);
  cachedGeoms.gearBore.rotateX(Math.PI / 2);
  cachedGeoms.icNotch.rotateX(Math.PI / 2);
  cachedGeoms.icDot.rotateX(Math.PI / 2);
  cachedGeoms.valveWheelRim.rotateX(Math.PI / 2);

  return cachedGeoms;
}

export interface RealisticComponentMesh3DProps {
  kind: RealisticComponentKind;
  /** Uniform scale multiplier (1.0 on Diagram Stage; ~0.72 on Stockroom plaques). */
  scale?: number | undefined;
  /** Emissive tint when hovered, grabbed, or over delete ring. */
  emissiveColor?: string | undefined;
  emissiveIntensity?: number | undefined;
  /** Disable pointer raycasting (e.g. when used as a decorative miniature on a Stockroom plaque). */
  disableRaycast?: boolean | undefined;
}

const GEAR_TOOTH_ANGLES = Array.from({ length: 12 }, (_, i) => (i / 12) * Math.PI * 2);
const INDUCTOR_TURN_ANGLES = Array.from({ length: 10 }, (_, i) => (i / 10) * Math.PI * 2);
const SPRING_COIL_XS = [-0.036, -0.024, -0.012, 0.0, 0.012, 0.024, 0.036] as const;
const IC_PIN_XS = [-0.033, -0.011, 0.011, 0.033] as const;

/**
 * Renders a tactile, recognizable real-world 3D hardware model (battery, resistor,
 * capacitor, inductor, diode, DIP IC chip, spur gear, spring-damper, or globe valve)
 * sized to fit the exact `~0.148 m` diagram node footprint and align with magnetic ports.
 */
export function RealisticComponentMesh3D({
  kind,
  scale = 1,
  emissiveColor = "#000000",
  emissiveIntensity = 0,
  disableRaycast = false,
}: RealisticComponentMesh3DProps): React.ReactElement {
  const g = useMemo(() => getSharedHardwareGeometries(), []);
  const rc = disableRaycast ? NOOP_RAYCAST : undefined;

  return (
    <group name={`realistic-component-${kind}`} scale={scale}>
      {kind === "battery" && (
        <group>
          {/* Steel terminal leads aligning with left (-) and right (+) magnetic ports */}
          <mesh geometry={g.leadCylH} raycast={rc}>
            <meshStandardMaterial color="#cbd5e1" roughness={0.28} metalness={0.85} />
          </mesh>
          {/* Matte obsidian lower battery jacket */}
          <mesh geometry={g.battBodyLower} position={[-0.016, 0, 0]} raycast={rc}>
            <meshStandardMaterial
              color="#111827"
              roughness={0.34}
              metalness={0.22}
              emissive={emissiveColor}
              emissiveIntensity={emissiveIntensity}
            />
          </mesh>
          {/* Iconic metallic copper/amber top sleeve */}
          <mesh geometry={g.battBodyCopper} position={[0.034, 0, 0]} raycast={rc}>
            <meshStandardMaterial
              color="#d97706"
              roughness={0.26}
              metalness={0.78}
              emissive={emissiveColor}
              emissiveIntensity={emissiveIntensity * 0.7}
            />
          </mesh>
          {/* Subtle positive polarity red collar ring */}
          <mesh geometry={g.battRingRed} position={[0.017, 0, 0]} raycast={rc}>
            <meshStandardMaterial color="#dc2626" roughness={0.38} metalness={0.18} />
          </mesh>
          {/* Brushed steel positive button nub (+ side) */}
          <mesh geometry={g.battCapPos} position={[0.054, 0, 0]} raycast={rc}>
            <meshStandardMaterial color="#e2e8f0" roughness={0.2} metalness={0.92} />
          </mesh>
          {/* Brushed steel flat negative base (- side) */}
          <mesh geometry={g.battCapNeg} position={[-0.051, 0, 0]} raycast={rc}>
            <meshStandardMaterial color="#cbd5e1" roughness={0.24} metalness={0.88} />
          </mesh>
        </group>
      )}

      {kind === "resistor" && (
        <group>
          {/* Tinned-copper axial leads */}
          <mesh geometry={g.leadCylH} raycast={rc}>
            <meshStandardMaterial color="#d1d5db" roughness={0.22} metalness={0.9} />
          </mesh>
          {/* Warm tan ceramic carbon-film resistor barrel */}
          <mesh geometry={g.resBodyCenter} raycast={rc}>
            <meshStandardMaterial
              color="#e7c697"
              roughness={0.42}
              metalness={0.08}
              emissive={emissiveColor}
              emissiveIntensity={emissiveIntensity}
            />
          </mesh>
          {/* Rounded end bulbs */}
          <mesh geometry={g.resBodyBulb} position={[-0.031, 0, 0]} raycast={rc}>
            <meshStandardMaterial
              color="#e2be8a"
              roughness={0.42}
              metalness={0.08}
              emissive={emissiveColor}
              emissiveIntensity={emissiveIntensity}
            />
          </mesh>
          <mesh geometry={g.resBodyBulb} position={[0.031, 0, 0]} raycast={rc}>
            <meshStandardMaterial
              color="#e2be8a"
              roughness={0.42}
              metalness={0.08}
              emissive={emissiveColor}
              emissiveIntensity={emissiveIntensity}
            />
          </mesh>
          {/* 4-Band Color Code: Brown (1), Black (0), Red (×100 = 1kΩ), Gold (±5%) */}
          <mesh geometry={g.resBand} position={[-0.019, 0, 0]} raycast={rc}>
            <meshStandardMaterial color="#78350f" roughness={0.35} metalness={0.1} />
          </mesh>
          <mesh geometry={g.resBand} position={[-0.006, 0, 0]} raycast={rc}>
            <meshStandardMaterial color="#111827" roughness={0.35} metalness={0.1} />
          </mesh>
          <mesh geometry={g.resBand} position={[0.007, 0, 0]} raycast={rc}>
            <meshStandardMaterial color="#dc2626" roughness={0.35} metalness={0.1} />
          </mesh>
          <mesh geometry={g.resBand} position={[0.021, 0, 0]} raycast={rc}>
            <meshStandardMaterial color="#eab308" roughness={0.22} metalness={0.82} />
          </mesh>
        </group>
      )}

      {kind === "capacitor" && (
        <group>
          {/* Horizontal connection leads emerging from bottom to left/right ports */}
          <mesh geometry={g.leadCylH} position={[0, -0.022, 0]} raycast={rc}>
            <meshStandardMaterial color="#cbd5e1" roughness={0.22} metalness={0.9} />
          </mesh>
          {/* Deep sapphire electrolytic can */}
          <mesh geometry={g.capCan} position={[0, 0.006, 0]} raycast={rc}>
            <meshStandardMaterial
              color="#1d4ed8"
              roughness={0.28}
              metalness={0.42}
              emissive={emissiveColor}
              emissiveIntensity={emissiveIntensity}
            />
          </mesh>
          {/* Brushed aluminum scored top pressure vent */}
          <mesh geometry={g.capTopDisc} position={[0, 0.043, 0]} raycast={rc}>
            <meshStandardMaterial color="#e2e8f0" roughness={0.2} metalness={0.92} />
          </mesh>
          {/* Silver negative polarity stripe on right face */}
          <mesh geometry={g.capStripe} position={[0.022, 0.006, 0.008]} rotation={[0, 0.35, 0]} raycast={rc}>
            <meshStandardMaterial color="#e2e8f0" roughness={0.35} metalness={0.3} />
          </mesh>
        </group>
      )}

      {kind === "inductor" && (
        <group>
          {/* Copper lead bar aligning with ports */}
          <mesh geometry={g.leadCylH} position={[0, -0.018, 0]} raycast={rc}>
            <meshStandardMaterial color="#d97706" roughness={0.26} metalness={0.85} />
          </mesh>
          {/* Matte charcoal ferrite torus core */}
          <mesh geometry={g.indCore} position={[0, 0.004, 0]} raycast={rc}>
            <meshStandardMaterial
              color="#1e293b"
              roughness={0.58}
              metalness={0.28}
              emissive={emissiveColor}
              emissiveIntensity={emissiveIntensity}
            />
          </mesh>
          {/* Enameled copper windings wrapped around the ferrite torus */}
          {INDUCTOR_TURN_ANGLES.map((angle, i) => {
            const x = Math.cos(angle) * 0.029;
            const y = Math.sin(angle) * 0.029 + 0.004;
            return (
              <mesh key={i} geometry={g.indTurn} position={[x, y, 0]} rotation={[Math.PI / 2, angle, 0]} raycast={rc}>
                <meshStandardMaterial color="#b45309" roughness={0.22} metalness={0.86} />
              </mesh>
            );
          })}
        </group>
      )}

      {kind === "diode" && (
        <group>
          {/* Axial tinned-copper leads */}
          <mesh geometry={g.leadCylH} raycast={rc}>
            <meshStandardMaterial color="#cbd5e1" roughness={0.22} metalness={0.9} />
          </mesh>
          {/* Matte black epoxy diode package */}
          <mesh geometry={g.diodeBody} raycast={rc}>
            <meshStandardMaterial
              color="#18181b"
              roughness={0.38}
              metalness={0.2}
              emissive={emissiveColor}
              emissiveIntensity={emissiveIntensity}
            />
          </mesh>
          {/* Crisp silver cathode band */}
          <mesh geometry={g.diodeBand} position={[0.017, 0, 0]} raycast={rc}>
            <meshStandardMaterial color="#e2e8f0" roughness={0.24} metalness={0.82} />
          </mesh>
        </group>
      )}

      {kind === "ic-chip" && (
        <group>
          {/* Matte black 8-pin DIP epoxy body */}
          <mesh geometry={g.icBody} raycast={rc}>
            <meshStandardMaterial
              color="#18181b"
              roughness={0.44}
              metalness={0.18}
              emissive={emissiveColor}
              emissiveIntensity={emissiveIntensity}
            />
          </mesh>
          {/* Recessed Pin-1 orientation notch on left edge */}
          <mesh geometry={g.icNotch} position={[-0.048, 0, 0.001]} raycast={rc}>
            <meshStandardMaterial color="#334155" roughness={0.5} metalness={0.25} />
          </mesh>
          {/* Gold Pin-1 index dot */}
          <mesh geometry={g.icDot} position={[-0.036, -0.014, 0.0095]} raycast={rc}>
            <meshStandardMaterial color="#f59e0b" roughness={0.25} metalness={0.78} />
          </mesh>
          {/* Top & bottom rows of 4 silver-plated DIP legs */}
          {IC_PIN_XS.map((px, i) => (
            <React.Fragment key={i}>
              <mesh geometry={g.icPin} position={[px, 0.029, -0.002]} raycast={rc}>
                <meshStandardMaterial color="#cbd5e1" roughness={0.22} metalness={0.9} />
              </mesh>
              <mesh geometry={g.icPin} position={[px, -0.029, -0.002]} raycast={rc}>
                <meshStandardMaterial color="#cbd5e1" roughness={0.22} metalness={0.9} />
              </mesh>
            </React.Fragment>
          ))}
        </group>
      )}

      {kind === "gear" && (
        <group>
          {/* Machined steel drive shafts to left/right mechanical ports */}
          <mesh geometry={g.leadCylH} raycast={rc}>
            <meshStandardMaterial color="#94a3b8" roughness={0.26} metalness={0.88} />
          </mesh>
          {/* Brass spur gear web */}
          <mesh geometry={g.gearWeb} raycast={rc}>
            <meshStandardMaterial
              color="#ca8a04"
              roughness={0.28}
              metalness={0.82}
              emissive={emissiveColor}
              emissiveIntensity={emissiveIntensity}
            />
          </mesh>
          {/* 12 precision machined radial teeth */}
          {GEAR_TOOTH_ANGLES.map((angle, i) => (
            <mesh
              key={i}
              geometry={g.gearTooth}
              position={[Math.cos(angle) * 0.039, Math.sin(angle) * 0.039, 0]}
              rotation={[0, 0, angle]}
              raycast={rc}
            >
              <meshStandardMaterial color="#eab308" roughness={0.26} metalness={0.84} />
            </mesh>
          ))}
          {/* Brushed steel center hub & bore */}
          <mesh geometry={g.gearHub} raycast={rc}>
            <meshStandardMaterial color="#cbd5e1" roughness={0.22} metalness={0.9} />
          </mesh>
          <mesh geometry={g.gearBore} raycast={rc}>
            <meshStandardMaterial color="#0f172a" roughness={0.6} metalness={0.3} />
          </mesh>
        </group>
      )}

      {kind === "spring-damper" && (
        <group>
          {/* End mounting shafts */}
          <mesh geometry={g.leadCylH} raycast={rc}>
            <meshStandardMaterial color="#94a3b8" roughness={0.26} metalness={0.88} />
          </mesh>
          {/* Anodized crimson hydraulic damper barrel */}
          <mesh geometry={g.sdCylinder} position={[-0.018, 0, 0]} raycast={rc}>
            <meshStandardMaterial
              color="#dc2626"
              roughness={0.28}
              metalness={0.62}
              emissive={emissiveColor}
              emissiveIntensity={emissiveIntensity}
            />
          </mesh>
          {/* Polished chrome piston rod */}
          <mesh geometry={g.sdRod} position={[0.022, 0, 0]} raycast={rc}>
            <meshStandardMaterial color="#f1f5f9" roughness={0.14} metalness={0.95} />
          </mesh>
          {/* End spring retainers */}
          <mesh geometry={g.sdCap} position={[-0.044, 0, 0]} raycast={rc}>
            <meshStandardMaterial color="#334155" roughness={0.32} metalness={0.78} />
          </mesh>
          <mesh geometry={g.sdCap} position={[0.044, 0, 0]} raycast={rc}>
            <meshStandardMaterial color="#334155" roughness={0.32} metalness={0.78} />
          </mesh>
          {/* Helical spring coils */}
          {SPRING_COIL_XS.map((cx, i) => (
            <mesh key={i} geometry={g.sdCoilRing} position={[cx, 0, 0]} rotation={[0, Math.PI / 2, 0.16]} raycast={rc}>
              <meshStandardMaterial color="#0284c7" roughness={0.28} metalness={0.65} />
            </mesh>
          ))}
        </group>
      )}

      {kind === "valve" && (
        <group position={[0, -0.01, 0]}>
          {/* Horizontal pipe connections */}
          <mesh geometry={g.leadCylH} raycast={rc}>
            <meshStandardMaterial color="#94a3b8" roughness={0.3} metalness={0.85} />
          </mesh>
          {/* Brushed brass globe valve body & bolted end flanges */}
          <mesh geometry={g.valvePipe} raycast={rc}>
            <meshStandardMaterial
              color="#d97706"
              roughness={0.3}
              metalness={0.8}
              emissive={emissiveColor}
              emissiveIntensity={emissiveIntensity}
            />
          </mesh>
          <mesh geometry={g.valveFlange} position={[-0.045, 0, 0]} raycast={rc}>
            <meshStandardMaterial color="#b45309" roughness={0.32} metalness={0.82} />
          </mesh>
          <mesh geometry={g.valveFlange} position={[0.045, 0, 0]} raycast={rc}>
            <meshStandardMaterial color="#b45309" roughness={0.32} metalness={0.82} />
          </mesh>
          {/* Vertical brass bonnet & steel valve stem */}
          <mesh geometry={g.valveBonnet} position={[0, 0.022, 0]} raycast={rc}>
            <meshStandardMaterial color="#ca8a04" roughness={0.3} metalness={0.82} />
          </mesh>
          <mesh geometry={g.valveStem} position={[0, 0.042, 0]} raycast={rc}>
            <meshStandardMaterial color="#cbd5e1" roughness={0.22} metalness={0.9} />
          </mesh>
          {/* Iconic industrial crimson spoked handwheel */}
          <group position={[0, 0.052, 0]}>
            <mesh geometry={g.valveWheelRim} raycast={rc}>
              <meshStandardMaterial color="#dc2626" roughness={0.34} metalness={0.25} />
            </mesh>
            <mesh geometry={g.valveSpoke} raycast={rc}>
              <meshStandardMaterial color="#b91c1c" roughness={0.36} metalness={0.28} />
            </mesh>
            <mesh geometry={g.valveSpoke} rotation={[0, Math.PI / 2, 0]} raycast={rc}>
              <meshStandardMaterial color="#b91c1c" roughness={0.36} metalness={0.28} />
            </mesh>
          </group>
        </group>
      )}
    </group>
  );
}
