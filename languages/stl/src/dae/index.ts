// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import { computeStlMassProperties } from "../solver/index.js";
import type { StlMassProperties, StlMeshDocument } from "../types.js";

export interface StlDaeOptions {
  /** Model name in DAEBuilder. */
  modelName?: string | undefined;
  /** Material density (kg/m^3, default: 1.0). */
  density?: number | undefined;
  /** Gravitational acceleration along -Z (m/s^2, default: 9.80665). */
  gravity?: number | undefined;
}

export interface StlDaeLoweringResult {
  massProperties: StlMassProperties;
  stateVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
}

/**
 * Lowers an STL rigid-body solid's exact mass, centroid, and 3x3 inertia tensor
 * directly into `@modelscript/runtime`'s `IDaeBuilder` linear memory arena with
 * 6-DOF translational (Newton) and rotational (Euler) rigid-body equations of motion.
 */
export function lowerStlToDae(
  builder: IDaeBuilder,
  doc: StlMeshDocument,
  options?: StlDaeOptions,
): StlDaeLoweringResult {
  const density = options?.density ?? 1.0;
  const gravity = options?.gravity ?? 9.80665;
  const props = computeStlMassProperties(doc, { density });

  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  let equationCount = 0;

  function addParam(name: string, value: number): number {
    const idx = builder.addVariable(name, VarType.Real, Variability.Parameter, Causality.Local, value);
    variableMap.set(name, idx);
    return idx;
  }

  function addState(name: string, start: number): number {
    const idx = builder.addVariable(name, VarType.Real, Variability.Continuous, Causality.Local, start);
    variableMap.set(name, idx);
    stateVarIndices.push(idx);
    return idx;
  }

  function addInput(name: string, start = 0.0): number {
    const idx = builder.addVariable(name, VarType.Real, Variability.Continuous, Causality.Input, start);
    variableMap.set(name, idx);
    return idx;
  }

  const safeMass = props.mass > 1e-12 ? props.mass : 1.0;
  const safeIxx = Math.abs(props.inertiaTensor[0][0]) > 1e-12 ? props.inertiaTensor[0][0] : 1.0;
  const safeIyy = Math.abs(props.inertiaTensor[1][1]) > 1e-12 ? props.inertiaTensor[1][1] : 1.0;
  const safeIzz = Math.abs(props.inertiaTensor[2][2]) > 1e-12 ? props.inertiaTensor[2][2] : 1.0;

  // Mass & geometric parameters
  addParam("volume", props.volume);
  addParam("surface_area", props.surfaceArea);
  addParam("density", density);
  const pMass = addParam("mass", safeMass);
  addParam("cx", props.centroid[0]);
  addParam("cy", props.centroid[1]);
  addParam("cz", props.centroid[2]);
  const pIxx = addParam("Ixx", safeIxx);
  const pIyy = addParam("Iyy", safeIyy);
  const pIzz = addParam("Izz", safeIzz);
  addParam("Ixy", props.inertiaTensor[0][1]);
  addParam("Ixz", props.inertiaTensor[0][2]);
  addParam("Iyz", props.inertiaTensor[1][2]);
  const pGravity = addParam("g", gravity);

  // Translational position & velocity states (initialized at centroid)
  const px = addState("px", props.centroid[0]);
  const py = addState("py", props.centroid[1]);
  const pz = addState("pz", props.centroid[2]);
  const vx = addState("vx", 0.0);
  const vy = addState("vy", 0.0);
  const vz = addState("vz", 0.0);

  // Angular velocity states
  const wx = addState("wx", 0.0);
  const wy = addState("wy", 0.0);
  const wz = addState("wz", 0.0);

  // External forces and torques
  const fx = addInput("Fx", 0.0);
  const fy = addInput("Fy", 0.0);
  const fz = addInput("Fz", 0.0);
  const tx = addInput("Tx", 0.0);
  const ty = addInput("Ty", 0.0);
  const tz = addInput("Tz", 0.0);

  // Kinematics: der(p) = v
  builder.addEquation(EqKind.Simple, builder.addDer(px), builder.addName(vx));
  builder.addEquation(EqKind.Simple, builder.addDer(py), builder.addName(vy));
  builder.addEquation(EqKind.Simple, builder.addDer(pz), builder.addName(vz));
  equationCount += 3;

  // Newton's 2nd law: mass * der(v) = F (with -mass*g along Z)
  builder.addEquation(
    EqKind.Simple,
    builder.addBinaryExpr(BinOp.Mul, builder.addName(pMass), builder.addDer(vx)),
    builder.addName(fx),
  );
  builder.addEquation(
    EqKind.Simple,
    builder.addBinaryExpr(BinOp.Mul, builder.addName(pMass), builder.addDer(vy)),
    builder.addName(fy),
  );
  builder.addEquation(
    EqKind.Simple,
    builder.addBinaryExpr(BinOp.Mul, builder.addName(pMass), builder.addDer(vz)),
    builder.addBinaryExpr(
      BinOp.Sub,
      builder.addName(fz),
      builder.addBinaryExpr(BinOp.Mul, builder.addName(pMass), builder.addName(pGravity)),
    ),
  );
  equationCount += 3;

  // Euler rotational dynamics (principal/diagonal inertia): I * der(w) = T
  builder.addEquation(
    EqKind.Simple,
    builder.addBinaryExpr(BinOp.Mul, builder.addName(pIxx), builder.addDer(wx)),
    builder.addName(tx),
  );
  builder.addEquation(
    EqKind.Simple,
    builder.addBinaryExpr(BinOp.Mul, builder.addName(pIyy), builder.addDer(wy)),
    builder.addName(ty),
  );
  builder.addEquation(
    EqKind.Simple,
    builder.addBinaryExpr(BinOp.Mul, builder.addName(pIzz), builder.addDer(wz)),
    builder.addName(tz),
  );
  equationCount += 3;

  return {
    massProperties: props,
    stateVarIndices,
    equationCount,
    variableMap,
  };
}

/**
 * High-level helper that creates a `DAEBuilder` and lowers an STL rigid body into it.
 */
export function stlToDae(doc: StlMeshDocument, options?: StlDaeOptions): DAEBuilder {
  const rawName = options?.modelName ?? doc.solids[0]?.name ?? doc.header ?? "StlRigidBody";
  const modelName = rawName.replace(/[^A-Za-z0-9_]/g, "_") || "StlRigidBody";
  const builder = new DAEBuilder(undefined, modelName);
  lowerStlToDae(builder, doc, options);
  return builder;
}
