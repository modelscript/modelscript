// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/urdf — Arena-Native MuJoCo Soft Pyramidal Contact Lowering.
 *
 * Lowers collision geometry primitives directly into `DAEBuilder` expressions
 * implementing MuJoCo's soft impedance normal law (`solref`, `solimp`) and
 * regularized tangential friction pyramid (`friction`, `v_slip`), avoiding
 * verbose Modelica library boilerplate.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { MjcfContactParams, UrdfRobot, Vector3D } from "../types.js";

export interface SoftContactPointSpec {
  name: string;
  linkName: string;
  localOffset: Vector3D;
  radius?: number | undefined;
  contact?: MjcfContactParams | undefined;
  groundZ?: number | undefined;
  /** Effective body mass [kg] for solref stiffness/damping scaling. */
  effectiveMass?: number | undefined;
  /** Regularized slip velocity [m/s] for smooth tanh friction. Default: 0.01. */
  slipVelocity?: number | undefined;
}

export interface LoweredContactWrench {
  name: string;
  linkName: string;
  localOffset: Vector3D;
  fxExprId: number;
  fyExprId: number;
  fzExprId: number;
  fnExprId: number;
  penetrationExprId: number;
}

/**
 * Extracts discrete contact points from collision geoms in a `UrdfRobot`.
 * Plane geoms on `world` set the ground elevation (`groundZ`); box geoms expand
 * to their 4 bottom corners (or 8 corners); sphere/capsule geoms emit center points.
 */
export function extractContactPointsFromRobot(robot: UrdfRobot): SoftContactPointSpec[] {
  let groundZ = 0.0;
  const worldLink = robot.links.get("world");
  if (worldLink) {
    for (const col of worldLink.collisions) {
      if (col.geometry.type === "plane") {
        groundZ = col.origin?.xyz.z ?? 0.0;
      }
    }
  }

  const points: SoftContactPointSpec[] = [];
  for (const link of robot.links.values()) {
    if (link.name === "world") continue;
    const linkMass = link.inertial?.mass ?? 0.25;
    for (let gi = 0; gi < link.collisions.length; gi++) {
      const col = link.collisions[gi]!;
      if (col.geometry.type === "plane") continue;
      const ox = col.origin?.xyz.x ?? 0;
      const oy = col.origin?.xyz.y ?? 0;
      const oz = col.origin?.xyz.z ?? 0;
      const baseName = `${link.name}_${col.name ?? `col${gi}`}`;

      if (col.geometry.type === "box" && col.geometry.size) {
        const hx = col.geometry.size.x * 0.5;
        const hy = col.geometry.size.y * 0.5;
        const hz = col.geometry.size.z * 0.5;
        const corners: [number, number, number][] = [
          [-hx, -hy, -hz],
          [hx, -hy, -hz],
          [hx, hy, -hz],
          [-hx, hy, -hz],
        ];
        for (let ci = 0; ci < corners.length; ci++) {
          const [cx, cy, cz] = corners[ci]!;
          points.push({
            name: `${baseName}_pt${ci}`,
            linkName: link.name,
            localOffset: { x: ox + cx, y: oy + cy, z: oz + cz },
            radius: 0,
            contact: col.contact,
            groundZ,
            effectiveMass: linkMass,
          });
        }
      } else if (col.geometry.type === "sphere" || col.geometry.type === "capsule") {
        points.push({
          name: `${baseName}_pt0`,
          linkName: link.name,
          localOffset: { x: ox, y: oy, z: oz },
          radius: col.geometry.radius ?? 0.01,
          contact: col.contact,
          groundZ,
          effectiveMass: linkMass,
        });
      } else if (col.geometry.type === "cylinder") {
        const r = col.geometry.radius ?? 0.02;
        const hl = (col.geometry.length ?? 0.04) * 0.5;
        points.push({
          name: `${baseName}_pt0`,
          linkName: link.name,
          localOffset: { x: ox, y: oy, z: oz - hl },
          radius: r * 0.1,
          contact: col.contact,
          groundZ,
          effectiveMass: linkMass,
        });
      } else if (col.geometry.type === "mesh") {
        const hx = (col.geometry.scale?.x ?? 1) * 0.025;
        const hy = (col.geometry.scale?.y ?? 1) * 0.018;
        const corners: [number, number][] = [
          [-hx, -hy],
          [hx, -hy],
          [hx, hy],
          [-hx, hy],
        ];
        for (let ci = 0; ci < corners.length; ci++) {
          const [cx, cy] = corners[ci]!;
          points.push({
            name: `${baseName}_pt${ci}`,
            linkName: link.name,
            localOffset: { x: ox + cx, y: oy + cy, z: oz },
            radius: 0,
            contact: col.contact,
            groundZ,
            effectiveMass: linkMass,
          });
        }
      }
    }
  }
  return points;
}

/**
 * Lowers a single soft pyramidal contact point into `DAEBuilder` expressions.
 *
 * Uses MuJoCo's `solref = [tau_c, zeta]` and `solimp = [dmin, dmax, width]`
 * impedance parameterization together with regularized Coulomb friction:
 *   f_n = max(0, imp(delta) * (k_ref * delta - b_ref * v_z)) * gate(delta)
 *   f_t = -mu * f_n * tanh(v_t / v_slip)
 */
export function lowerSoftContactPointToDae(
  dae: DAEBuilder,
  spec: SoftContactPointSpec,
  worldPosExpr: { x: number; y: number; z: number },
  worldVelExpr: { vx: number; vy: number; vz: number },
): LoweredContactWrench {
  const groundZ = spec.groundZ ?? 0.0;
  const radius = spec.radius ?? 0.0;
  const effMass = Math.max(0.05, spec.effectiveMass ?? 0.25);

  const solref = spec.contact?.solref ?? [0.02, 1.0];
  const solimp = spec.contact?.solimp ?? [0.9, 0.95, 0.001];
  const mu = spec.contact?.friction?.[0] ?? 1.0;
  const slipVel = Math.max(1e-4, spec.slipVelocity ?? 0.01);

  const tauC = Math.max(1e-4, solref[0]);
  const zeta = Math.max(0.0, solref[1]);
  const dMin = solimp[0];
  const dMax = Math.max(1e-3, solimp[1]);
  const impWidth = Math.max(1e-5, solimp[2]);

  // MuJoCo stiffness & damping from solref + solimp
  const kRef = effMass / (tauC * tauC * dMax * dMax);
  const bRef = (2.0 * zeta * effMass) / (tauC * dMax);

  // penetration = max(0, groundZ + radius - p_z)
  const rawPen = dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(groundZ + radius), worldPosExpr.z);
  const penExpr = dae.addCallExpr("max", [dae.addRealLiteral(0.0), rawPen]);

  // Smooth impedance factor: imp = dMin + (dMax - dMin) * min(1, pen / impWidth)
  const penRatio = dae.addCallExpr("min", [
    dae.addRealLiteral(1.0),
    dae.addBinaryExpr(BinOp.Div, penExpr, dae.addRealLiteral(impWidth)),
  ]);
  const impExpr = dae.addBinaryExpr(
    BinOp.Add,
    dae.addRealLiteral(dMin),
    dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(dMax - dMin), penRatio),
  );

  // Active contact gate (prevents adhesive pull when pen == 0): gate = min(1, pen / 1e-5)
  const gateExpr = dae.addCallExpr("min", [
    dae.addRealLiteral(1.0),
    dae.addBinaryExpr(BinOp.Div, penExpr, dae.addRealLiteral(1e-5)),
  ]);

  // f_spring_damper = kRef * pen - bRef * vz
  const springTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kRef), penExpr);
  const dampTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(bRef), worldVelExpr.vz);
  const rawFn = dae.addBinaryExpr(BinOp.Mul, impExpr, dae.addBinaryExpr(BinOp.Sub, springTerm, dampTerm));
  const posFn = dae.addCallExpr("max", [dae.addRealLiteral(0.0), rawFn]);
  const fnExpr = dae.addBinaryExpr(BinOp.Mul, posFn, gateExpr);

  // Regularized pyramidal tangential friction: f_t = -mu * f_n * tanh(v_t / v_slip)
  const condim = spec.contact?.condim ?? 3;
  let fxExpr: number;
  let fyExpr: number;
  if (condim <= 1 || mu <= 0) {
    fxExpr = dae.addRealLiteral(0.0);
    fyExpr = dae.addRealLiteral(0.0);
  } else {
    const muFn = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-mu), fnExpr);
    const tanhVx = dae.addCallExpr("tanh", [
      dae.addBinaryExpr(BinOp.Div, worldVelExpr.vx, dae.addRealLiteral(slipVel)),
    ]);
    const tanhVy = dae.addCallExpr("tanh", [
      dae.addBinaryExpr(BinOp.Div, worldVelExpr.vy, dae.addRealLiteral(slipVel)),
    ]);
    fxExpr = dae.addBinaryExpr(BinOp.Mul, muFn, tanhVx);
    fyExpr = dae.addBinaryExpr(BinOp.Mul, muFn, tanhVy);
  }

  // Emit observable contact variables
  dae.addVariable(`${spec.name}.penetration`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  dae.addVariable(`${spec.name}.fn`, VarType.Real, Variability.Continuous, Causality.Output, 0.0);
  dae.addVariable(`${spec.name}.fx`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  dae.addVariable(`${spec.name}.fy`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  dae.addVariable(`${spec.name}.fz`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

  dae.addEquation(EqKind.Simple, dae.addNameExpr(`${spec.name}.penetration`), penExpr);
  dae.addEquation(EqKind.Simple, dae.addNameExpr(`${spec.name}.fn`), fnExpr);
  dae.addEquation(EqKind.Simple, dae.addNameExpr(`${spec.name}.fx`), fxExpr);
  dae.addEquation(EqKind.Simple, dae.addNameExpr(`${spec.name}.fy`), fyExpr);
  dae.addEquation(EqKind.Simple, dae.addNameExpr(`${spec.name}.fz`), fnExpr);

  return {
    name: spec.name,
    linkName: spec.linkName,
    localOffset: spec.localOffset,
    fxExprId: dae.addNameExpr(`${spec.name}.fx`),
    fyExprId: dae.addNameExpr(`${spec.name}.fy`),
    fzExprId: dae.addNameExpr(`${spec.name}.fz`),
    fnExprId: dae.addNameExpr(`${spec.name}.fn`),
    penetrationExprId: dae.addNameExpr(`${spec.name}.penetration`),
  };
}
