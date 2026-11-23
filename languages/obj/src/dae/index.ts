// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/obj — Direct Linear-Memory DAE Arena Lowering.
 *
 * Lowers rigid-body inertial properties derived from a Wavefront OBJ mesh
 * (volume, mass = ρ·V, center of mass, diagonal inertia tensor Ixx/Iyy/Izz,
 * translational and rotational 6-DOF kinematics/dynamics) directly into
 * `@modelscript/runtime`'s `DAEBuilder`.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { computeMeshMetrics, type ObjMeshMetrics } from "../solver/index.js";
import type { ObjDocument } from "../types.js";

export interface ObjDaeOptions {
  /** Override model name. */
  name?: string | undefined;
  /** Uniform material mass density ρ in kg/m³. Default: 2700 (Aluminum). */
  density?: number | undefined;
  /** Gravitational acceleration along -Z in m/s². Default: 9.80665. */
  gravity?: number | undefined;
  /** Linear viscous damping coefficient in N·s/m. Default: 0.05. */
  linearDamping?: number | undefined;
  /** Angular viscous damping coefficient in N·m·s/rad. Default: 0.01. */
  angularDamping?: number | undefined;
}

export interface ObjDaeResult {
  dae: DAEBuilder;
  metrics: ObjMeshMetrics;
  mass: number;
  inertia: readonly [number, number, number];
}

function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `m_${cleaned}` : cleaned || "body";
}

/**
 * Lower an `ObjDocument`'s rigid-body inertial properties into an existing or new `DAEBuilder`.
 */
export function lowerObjToDae(doc: ObjDocument, builder?: DAEBuilder, options?: ObjDaeOptions): ObjDaeResult {
  const modelName = sanitizeId(options?.name ?? doc.objects[0]?.name ?? "ObjRigidBody");
  const dae = builder ?? new DAEBuilder(undefined, modelName);

  const density = options?.density ?? 2700.0;
  const gravity = options?.gravity ?? 9.80665;
  const linearDamping = options?.linearDamping ?? 0.05;
  const angularDamping = options?.angularDamping ?? 0.01;

  const metrics = computeMeshMetrics(doc);
  const volume = Math.max(metrics.volume, 1e-12);
  const mass = density * volume;
  const ixx = Math.max(density * metrics.unitDensityInertia.ixx, 1e-9);
  const iyy = Math.max(density * metrics.unitDensityInertia.iyy, 1e-9);
  const izz = Math.max(density * metrics.unitDensityInertia.izz, 1e-9);

  // Geometric & inertial parameters
  dae.addVariable(`${modelName}.volume`, VarType.Real, Variability.Parameter, Causality.Local, volume);
  dae.addVariable(
    `${modelName}.surfaceArea`,
    VarType.Real,
    Variability.Parameter,
    Causality.Local,
    metrics.surfaceArea,
  );
  dae.addVariable(`${modelName}.density`, VarType.Real, Variability.Parameter, Causality.Local, density);
  const massName = `${modelName}.mass`;
  const ixxName = `${modelName}.Ixx`;
  const iyyName = `${modelName}.Iyy`;
  const izzName = `${modelName}.Izz`;
  const gName = `${modelName}.g`;
  const cName = `${modelName}.damping`;
  const cRotName = `${modelName}.rotDamping`;

  dae.addVariable(massName, VarType.Real, Variability.Parameter, Causality.Local, mass);
  dae.addVariable(ixxName, VarType.Real, Variability.Parameter, Causality.Local, ixx);
  dae.addVariable(iyyName, VarType.Real, Variability.Parameter, Causality.Local, iyy);
  dae.addVariable(izzName, VarType.Real, Variability.Parameter, Causality.Local, izz);
  dae.addVariable(gName, VarType.Real, Variability.Parameter, Causality.Local, gravity);
  dae.addVariable(cName, VarType.Real, Variability.Parameter, Causality.Local, linearDamping);
  dae.addVariable(cRotName, VarType.Real, Variability.Parameter, Causality.Local, angularDamping);

  // Center-of-mass translational states: x, y, z and vx, vy, vz
  const axes = [
    { axis: "x", c0: metrics.centroid[0], grav: false },
    { axis: "y", c0: metrics.centroid[1], grav: false },
    { axis: "z", c0: metrics.centroid[2], grav: true },
  ] as const;

  for (const { axis, c0, grav } of axes) {
    const posVar = `${modelName}.${axis}`;
    const velVar = `${modelName}.v${axis}`;
    dae.addVariable(posVar, VarType.Real, Variability.Continuous, Causality.Local, c0);
    dae.addVariable(velVar, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // der(pos) = vel
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(posVar)), dae.addNameExpr(velVar));

    // mass * der(vel) = -damping * vel (- mass * g for z)
    const lhs = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(massName), dae.addDerExpr(dae.addNameExpr(velVar)));
    const drag = dae.addBinaryExpr(
      BinOp.Mul,
      dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(0.0), dae.addNameExpr(cName)),
      dae.addNameExpr(velVar),
    );
    const rhs = grav
      ? dae.addBinaryExpr(
          BinOp.Sub,
          drag,
          dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(massName), dae.addNameExpr(gName)),
        )
      : drag;
    dae.addEquation(EqKind.Simple, lhs, rhs);
  }

  // Rotational angular velocity states: wx, wy, wz
  const rotAxes = [
    { axis: "x", inertiaVar: ixxName },
    { axis: "y", inertiaVar: iyyName },
    { axis: "z", inertiaVar: izzName },
  ] as const;

  for (const { axis, inertiaVar } of rotAxes) {
    const wVar = `${modelName}.w${axis}`;
    dae.addVariable(wVar, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const lhs = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(inertiaVar), dae.addDerExpr(dae.addNameExpr(wVar)));
    const rhs = dae.addBinaryExpr(
      BinOp.Mul,
      dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(0.0), dae.addNameExpr(cRotName)),
      dae.addNameExpr(wVar),
    );
    dae.addEquation(EqKind.Simple, lhs, rhs);
  }

  return {
    dae,
    metrics,
    mass,
    inertia: [ixx, iyy, izz],
  };
}

/**
 * Convenience wrapper creating a fresh `DAEBuilder` for an `ObjDocument`.
 */
export function objToDae(doc: ObjDocument, options?: ObjDaeOptions): ObjDaeResult {
  return lowerObjToDae(doc, undefined, options);
}
