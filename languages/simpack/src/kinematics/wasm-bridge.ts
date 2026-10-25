// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAssembly Bridge and Linear Memory Manager for SIMPACK Kinematics Kernel.
 *
 * Provides high-performance, zero-allocation spatial transformations,
 * Tait-Bryan rotation matrix algebra, joint constraints, and kinematic
 * loop closure residual evaluations.
 */

import type { JointType, Vector3D } from "../types.js";
import type { JointConstraintResidual } from "./constraints.js";
import type { KinematicLoopConstraint } from "./loop-solver.js";
import type { RotationMatrix, SpatialTransform } from "./transformations.js";
import { getKinematicsWasmBinary } from "./wasm-binary.js";

export interface KinematicsWasmExports {
  memory: WebAssembly.Memory;
  kin_alloc(size: number): number;
  kin_free(ptr: number): void;
  kin_get_scratch_base(): number;
  kin_get_scratch_buffer(): number;
  kin_init(): void;
  kin_dot_product(uPtr: number, vPtr: number): number;
  kin_cross_product(uPtr: number, vPtr: number, outPtr: number): void;
  kin_vector_norm(vPtr: number): number;
  kin_rotation_from_euler(alpha: number, beta: number, gamma: number, outPtr: number): void;
  kin_identity_matrix(outPtr: number): void;
  kin_multiply_matrices(aPtr: number, bPtr: number, outPtr: number): void;
  kin_transform_vector(rPtr: number, vPtr: number, outPtr: number): void;
  kin_marker_spatial_transform(
    bodyPosPtr: number,
    bodyRotPtr: number,
    markerLocalPosPtr: number,
    markerLocalRotPtr: number,
    outPosPtr: number,
    outRotPtr: number,
  ): void;
  kin_evaluate_joint_constraint(
    typeId: number,
    markerAPosPtr: number,
    markerARotPtr: number,
    markerBPosPtr: number,
    markerBRotPtr: number,
    outResidualPtr: number,
  ): number;
  kin_solve_loop_closure(positionsPtr: number, chainCount: number, outResidualPtr: number): number;
  kin_batch_marker_transforms(
    markerCount: number,
    bodyIndicesPtr: number,
    bodyTransformsPtr: number,
    markerLocalsPtr: number,
    outGlobalsPtr: number,
  ): void;
  kin_batch_evaluate_joints(
    jointCount: number,
    jointTypesPtr: number,
    markerAIdxPtr: number,
    markerBIdxPtr: number,
    markerGlobalsPtr: number,
    outResidualsPtr: number,
  ): number;
}

export const JOINT_TYPE_MAP: Record<JointType, number> = {
  spherical: 0,
  revolute: 1,
  prismatic: 2,
  fixed: 3,
  cylindrical: 4,
  planar: 5,
  free: 6,
  universal: 7,
};

export const JOINT_TYPE_REV_MAP: JointType[] = [
  "spherical",
  "revolute",
  "prismatic",
  "fixed",
  "cylindrical",
  "planar",
  "free",
  "universal",
];

export class WasmKinematicsBridge {
  readonly instance: WebAssembly.Instance;
  readonly exports: KinematicsWasmExports;

  // Static scratch pointers
  private readonly scratchBase: number;
  private readonly scratchVec0: number;
  private readonly scratchVec1: number;
  private readonly scratchVec2: number;
  private readonly scratchMat0: number;
  private readonly scratchMat1: number;
  private readonly scratchMat2: number;
  private readonly scratchResidual0: number;
  private readonly scratchBuffer: number;

  private f64View: Float64Array;
  private i32View: Int32Array;

  private constructor(instance: WebAssembly.Instance) {
    this.instance = instance;
    this.exports = instance.exports as unknown as KinematicsWasmExports;
    this.exports.kin_init();

    this.scratchBase = this.exports.kin_get_scratch_base();
    this.scratchVec0 = this.scratchBase + 96;
    this.scratchVec1 = this.scratchBase + 120;
    this.scratchVec2 = this.scratchBase + 144;
    this.scratchMat0 = this.scratchBase + 168;
    this.scratchMat1 = this.scratchBase + 240;
    this.scratchMat2 = this.scratchBase + 312;
    this.scratchResidual0 = this.scratchBase + 384;
    this.scratchBuffer = this.exports.kin_get_scratch_buffer();

    this.f64View = new Float64Array(this.exports.memory.buffer);
    this.i32View = new Int32Array(this.exports.memory.buffer);
  }

  static create(): WasmKinematicsBridge {
    const wasmBytes = getKinematicsWasmBinary();
    const module = new WebAssembly.Module(wasmBytes.buffer as ArrayBuffer);
    const instance = new WebAssembly.Instance(module, {
      env: {
        abort: (msg: number, file: number, line: number, col: number) => {
          throw new Error(`AssemblyScript abort in kinematics.wasm at ${file}:${line}:${col} (msg: ${msg})`);
        },
      },
    });
    return new WasmKinematicsBridge(instance);
  }

  private refreshViews(): void {
    if (this.f64View.buffer !== this.exports.memory.buffer) {
      this.f64View = new Float64Array(this.exports.memory.buffer);
      this.i32View = new Int32Array(this.exports.memory.buffer);
    }
  }

  get memoryBuffer(): ArrayBuffer {
    return this.exports.memory.buffer;
  }

  alloc(size: number): number {
    const ptr = this.exports.kin_alloc(size);
    this.refreshViews();
    return ptr;
  }

  free(ptr: number): void {
    this.exports.kin_free(ptr);
  }

  /**
   * Computes 3x3 direction cosine rotation matrix from Tait-Bryan angles (Z-Y'-X'').
   */
  rotationMatrixFromEuler(alpha: number, beta: number, gamma: number): RotationMatrix {
    this.refreshViews();
    this.exports.kin_rotation_from_euler(alpha, beta, gamma, this.scratchMat0);
    const offset = this.scratchMat0 >> 3;
    const v = this.f64View;
    return [
      [v[offset + 0]!, v[offset + 1]!, v[offset + 2]!],
      [v[offset + 3]!, v[offset + 4]!, v[offset + 5]!],
      [v[offset + 6]!, v[offset + 7]!, v[offset + 8]!],
    ];
  }

  /**
   * Identity 3x3 matrix.
   */
  identityMatrix(): RotationMatrix {
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  }

  /**
   * Multiplies two 3x3 matrices: R = A * B
   */
  multiplyMatrices(A: RotationMatrix, B: RotationMatrix): RotationMatrix {
    this.refreshViews();
    const v = this.f64View;
    const offA = this.scratchMat0 >> 3;
    const offB = this.scratchMat1 >> 3;
    const offOut = this.scratchMat2 >> 3;

    v[offA + 0] = A[0]![0]!;
    v[offA + 1] = A[0]![1]!;
    v[offA + 2] = A[0]![2]!;
    v[offA + 3] = A[1]![0]!;
    v[offA + 4] = A[1]![1]!;
    v[offA + 5] = A[1]![2]!;
    v[offA + 6] = A[2]![0]!;
    v[offA + 7] = A[2]![1]!;
    v[offA + 8] = A[2]![2]!;

    v[offB + 0] = B[0]![0]!;
    v[offB + 1] = B[0]![1]!;
    v[offB + 2] = B[0]![2]!;
    v[offB + 3] = B[1]![0]!;
    v[offB + 4] = B[1]![1]!;
    v[offB + 5] = B[1]![2]!;
    v[offB + 6] = B[2]![0]!;
    v[offB + 7] = B[2]![1]!;
    v[offB + 8] = B[2]![2]!;

    this.exports.kin_multiply_matrices(this.scratchMat0, this.scratchMat1, this.scratchMat2);

    return [
      [v[offOut + 0]!, v[offOut + 1]!, v[offOut + 2]!],
      [v[offOut + 3]!, v[offOut + 4]!, v[offOut + 5]!],
      [v[offOut + 6]!, v[offOut + 7]!, v[offOut + 8]!],
    ];
  }

  /**
   * Transforms a local vector v into global frame: v_global = R * v_local
   */
  transformVector(R: RotationMatrix, v: Vector3D): Vector3D {
    this.refreshViews();
    const f64 = this.f64View;
    const offR = this.scratchMat0 >> 3;
    const offV = this.scratchVec0 >> 3;
    const offOut = this.scratchVec1 >> 3;

    f64[offR + 0] = R[0]![0]!;
    f64[offR + 1] = R[0]![1]!;
    f64[offR + 2] = R[0]![2]!;
    f64[offR + 3] = R[1]![0]!;
    f64[offR + 4] = R[1]![1]!;
    f64[offR + 5] = R[1]![2]!;
    f64[offR + 6] = R[2]![0]!;
    f64[offR + 7] = R[2]![1]!;
    f64[offR + 8] = R[2]![2]!;

    f64[offV + 0] = v.x;
    f64[offV + 1] = v.y;
    f64[offV + 2] = v.z;

    this.exports.kin_transform_vector(this.scratchMat0, this.scratchVec0, this.scratchVec1);

    return {
      x: f64[offOut + 0]!,
      y: f64[offOut + 1]!,
      z: f64[offOut + 2]!,
    };
  }

  /**
   * Vector dot product: u . v
   */
  dotProduct(u: Vector3D, v: Vector3D): number {
    this.refreshViews();
    const f64 = this.f64View;
    const offU = this.scratchVec0 >> 3;
    const offV = this.scratchVec1 >> 3;

    f64[offU + 0] = u.x;
    f64[offU + 1] = u.y;
    f64[offU + 2] = u.z;

    f64[offV + 0] = v.x;
    f64[offV + 1] = v.y;
    f64[offV + 2] = v.z;

    return this.exports.kin_dot_product(this.scratchVec0, this.scratchVec1);
  }

  /**
   * Vector cross product: u x v
   */
  crossProduct(u: Vector3D, v: Vector3D): Vector3D {
    this.refreshViews();
    const f64 = this.f64View;
    const offU = this.scratchVec0 >> 3;
    const offV = this.scratchVec1 >> 3;
    const offOut = this.scratchVec2 >> 3;

    f64[offU + 0] = u.x;
    f64[offU + 1] = u.y;
    f64[offU + 2] = u.z;

    f64[offV + 0] = v.x;
    f64[offV + 1] = v.y;
    f64[offV + 2] = v.z;

    this.exports.kin_cross_product(this.scratchVec0, this.scratchVec1, this.scratchVec2);

    return {
      x: f64[offOut + 0]!,
      y: f64[offOut + 1]!,
      z: f64[offOut + 2]!,
    };
  }

  /**
   * Spatial coordinate transformation for a marker attached to a body:
   *   r_marker = r_body + R_body * s_local
   *   R_marker = R_body * R_local
   */
  computeMarkerSpatialTransform(
    bodyPosition: Vector3D,
    bodyRotation: RotationMatrix,
    markerLocalPosition: Vector3D,
    markerLocalRotation: RotationMatrix,
  ): SpatialTransform {
    this.refreshViews();
    const f64 = this.f64View;

    // Body transform: pos (scratchVec0), rot (scratchMat0)
    const bPosOff = this.scratchVec0 >> 3;
    f64[bPosOff + 0] = bodyPosition.x;
    f64[bPosOff + 1] = bodyPosition.y;
    f64[bPosOff + 2] = bodyPosition.z;

    const bRotOff = this.scratchMat0 >> 3;
    f64[bRotOff + 0] = bodyRotation[0]![0]!;
    f64[bRotOff + 1] = bodyRotation[0]![1]!;
    f64[bRotOff + 2] = bodyRotation[0]![2]!;
    f64[bRotOff + 3] = bodyRotation[1]![0]!;
    f64[bRotOff + 4] = bodyRotation[1]![1]!;
    f64[bRotOff + 5] = bodyRotation[1]![2]!;
    f64[bRotOff + 6] = bodyRotation[2]![0]!;
    f64[bRotOff + 7] = bodyRotation[2]![1]!;
    f64[bRotOff + 8] = bodyRotation[2]![2]!;

    // Marker local: pos (scratchVec1), rot (scratchMat1)
    const mPosOff = this.scratchVec1 >> 3;
    f64[mPosOff + 0] = markerLocalPosition.x;
    f64[mPosOff + 1] = markerLocalPosition.y;
    f64[mPosOff + 2] = markerLocalPosition.z;

    const mRotOff = this.scratchMat1 >> 3;
    f64[mRotOff + 0] = markerLocalRotation[0]![0]!;
    f64[mRotOff + 1] = markerLocalRotation[0]![1]!;
    f64[mRotOff + 2] = markerLocalRotation[0]![2]!;
    f64[mRotOff + 3] = markerLocalRotation[1]![0]!;
    f64[mRotOff + 4] = markerLocalRotation[1]![1]!;
    f64[mRotOff + 5] = markerLocalRotation[1]![2]!;
    f64[mRotOff + 6] = markerLocalRotation[2]![0]!;
    f64[mRotOff + 7] = markerLocalRotation[2]![1]!;
    f64[mRotOff + 8] = markerLocalRotation[2]![2]!;

    // Output: pos (scratchVec2), rot (scratchMat2)
    this.exports.kin_marker_spatial_transform(
      this.scratchVec0,
      this.scratchMat0,
      this.scratchVec1,
      this.scratchMat1,
      this.scratchVec2,
      this.scratchMat2,
    );

    const outPosOff = this.scratchVec2 >> 3;
    const outRotOff = this.scratchMat2 >> 3;

    return {
      position: {
        x: f64[outPosOff + 0]!,
        y: f64[outPosOff + 1]!,
        z: f64[outPosOff + 2]!,
      },
      rotation: [
        [f64[outRotOff + 0]!, f64[outRotOff + 1]!, f64[outRotOff + 2]!],
        [f64[outRotOff + 3]!, f64[outRotOff + 4]!, f64[outRotOff + 5]!],
        [f64[outRotOff + 6]!, f64[outRotOff + 7]!, f64[outRotOff + 8]!],
      ],
    };
  }

  /**
   * Evaluates algebraic joint kinematic constraint equations Phi(q) = 0.
   */
  evaluateJointConstraint(
    jointId: string,
    type: JointType,
    markerA: SpatialTransform,
    markerB: SpatialTransform,
  ): JointConstraintResidual {
    this.refreshViews();
    const f64 = this.f64View;
    const typeId = JOINT_TYPE_MAP[type] ?? 6;

    // Marker A: pos (scratchVec0), rot (scratchMat0)
    const aPosOff = this.scratchVec0 >> 3;
    f64[aPosOff + 0] = markerA.position.x;
    f64[aPosOff + 1] = markerA.position.y;
    f64[aPosOff + 2] = markerA.position.z;

    const aRotOff = this.scratchMat0 >> 3;
    f64[aRotOff + 0] = markerA.rotation[0]![0]!;
    f64[aRotOff + 1] = markerA.rotation[0]![1]!;
    f64[aRotOff + 2] = markerA.rotation[0]![2]!;
    f64[aRotOff + 3] = markerA.rotation[1]![0]!;
    f64[aRotOff + 4] = markerA.rotation[1]![1]!;
    f64[aRotOff + 5] = markerA.rotation[1]![2]!;
    f64[aRotOff + 6] = markerA.rotation[2]![0]!;
    f64[aRotOff + 7] = markerA.rotation[2]![1]!;
    f64[aRotOff + 8] = markerA.rotation[2]![2]!;

    // Marker B: pos (scratchVec1), rot (scratchMat1)
    const bPosOff = this.scratchVec1 >> 3;
    f64[bPosOff + 0] = markerB.position.x;
    f64[bPosOff + 1] = markerB.position.y;
    f64[bPosOff + 2] = markerB.position.z;

    const bRotOff = this.scratchMat1 >> 3;
    f64[bRotOff + 0] = markerB.rotation[0]![0]!;
    f64[bRotOff + 1] = markerB.rotation[0]![1]!;
    f64[bRotOff + 2] = markerB.rotation[0]![2]!;
    f64[bRotOff + 3] = markerB.rotation[1]![0]!;
    f64[bRotOff + 4] = markerB.rotation[1]![1]!;
    f64[bRotOff + 5] = markerB.rotation[1]![2]!;
    f64[bRotOff + 6] = markerB.rotation[2]![0]!;
    f64[bRotOff + 7] = markerB.rotation[2]![1]!;
    f64[bRotOff + 8] = markerB.rotation[2]![2]!;

    this.exports.kin_evaluate_joint_constraint(
      typeId,
      this.scratchVec0,
      this.scratchMat0,
      this.scratchVec1,
      this.scratchMat1,
      this.scratchResidual0,
    );

    const resOff = this.scratchResidual0 >> 3;
    return {
      jointId,
      type,
      positionError: {
        x: f64[resOff + 0]!,
        y: f64[resOff + 1]!,
        z: f64[resOff + 2]!,
      },
      orientationError: {
        x: f64[resOff + 3]!,
        y: f64[resOff + 4]!,
        z: f64[resOff + 5]!,
      },
      constraintNorm: f64[resOff + 6]!,
    };
  }

  /**
   * Computes cut-joint closure equations for closed kinematic chains in spatial mechanisms.
   */
  solveLoopClosureResidual(bodyPositions: Map<string, Vector3D>, chain: string[]): KinematicLoopConstraint {
    this.refreshViews();
    const count = chain.length;
    const reqBytes = count * 24;

    let bufPtr: number;
    let shouldFree = false;

    if (reqBytes <= 2048) {
      bufPtr = this.scratchBuffer;
    } else {
      bufPtr = this.alloc(reqBytes);
      shouldFree = true;
    }

    const f64 = this.f64View;
    const baseOff = bufPtr >> 3;

    for (let i = 0; i < count; i++) {
      const pos = bodyPositions.get(chain[i]!) ?? { x: 0, y: 0, z: 0 };
      const off = baseOff + i * 3;
      f64[off + 0] = pos.x;
      f64[off + 1] = pos.y;
      f64[off + 2] = pos.z;
    }

    const errMag = this.exports.kin_solve_loop_closure(bufPtr, count, this.scratchResidual0);

    const resOff = this.scratchResidual0 >> 3;
    const closureError = {
      x: f64[resOff + 0]!,
      y: f64[resOff + 1]!,
      z: f64[resOff + 2]!,
    };

    if (shouldFree) {
      this.free(bufPtr);
    }

    return {
      loopId: `loop_${chain.join("_")}`,
      bodyIndices: chain,
      closureError,
      isClosed: errMag < 1e-4,
    };
  }

  /**
   * High-performance batched marker transformations.
   * Transforms hundreds of markers in a single WASM call.
   */
  batchMarkerTransforms(
    markers: { bodyIdx: number; localPos: Vector3D; localRot: RotationMatrix }[],
    bodyTransforms: SpatialTransform[],
  ): SpatialTransform[] {
    const markerCount = markers.length;
    if (markerCount === 0) return [];

    this.refreshViews();

    const bodyCount = bodyTransforms.length;
    const bodyTransformsBytes = bodyCount * 96;
    const bodyIndicesBytes = markerCount * 4;
    const markerLocalsBytes = markerCount * 96;
    const outGlobalsBytes = markerCount * 96;

    const bodyTransformsPtr = this.alloc(bodyTransformsBytes);
    const bodyIndicesPtr = this.alloc(bodyIndicesBytes);
    const markerLocalsPtr = this.alloc(markerLocalsBytes);
    const outGlobalsPtr = this.alloc(outGlobalsBytes);

    const f64 = this.f64View;
    const i32 = this.i32View;

    // 1. Pack body transforms
    let bOff = bodyTransformsPtr >> 3;
    for (let b = 0; b < bodyCount; b++) {
      const bt = bodyTransforms[b]!;
      f64[bOff + 0] = bt.position.x;
      f64[bOff + 1] = bt.position.y;
      f64[bOff + 2] = bt.position.z;

      f64[bOff + 3] = bt.rotation[0]![0]!;
      f64[bOff + 4] = bt.rotation[0]![1]!;
      f64[bOff + 5] = bt.rotation[0]![2]!;
      f64[bOff + 6] = bt.rotation[1]![0]!;
      f64[bOff + 7] = bt.rotation[1]![1]!;
      f64[bOff + 8] = bt.rotation[1]![2]!;
      f64[bOff + 9] = bt.rotation[2]![0]!;
      f64[bOff + 10] = bt.rotation[2]![1]!;
      f64[bOff + 11] = bt.rotation[2]![2]!;

      bOff += 12;
    }

    // 2. Pack marker locals and body indices
    const mIdxOff = bodyIndicesPtr >> 2;
    let mLocOff = markerLocalsPtr >> 3;
    for (let m = 0; m < markerCount; m++) {
      const mk = markers[m]!;
      i32[mIdxOff + m] = mk.bodyIdx;

      f64[mLocOff + 0] = mk.localPos.x;
      f64[mLocOff + 1] = mk.localPos.y;
      f64[mLocOff + 2] = mk.localPos.z;

      f64[mLocOff + 3] = mk.localRot[0]![0]!;
      f64[mLocOff + 4] = mk.localRot[0]![1]!;
      f64[mLocOff + 5] = mk.localRot[0]![2]!;
      f64[mLocOff + 6] = mk.localRot[1]![0]!;
      f64[mLocOff + 7] = mk.localRot[1]![1]!;
      f64[mLocOff + 8] = mk.localRot[1]![2]!;
      f64[mLocOff + 9] = mk.localRot[2]![0]!;
      f64[mLocOff + 10] = mk.localRot[2]![1]!;
      f64[mLocOff + 11] = mk.localRot[2]![2]!;

      mLocOff += 12;
    }

    // 3. Execute batch in WASM
    this.exports.kin_batch_marker_transforms(
      markerCount,
      bodyIndicesPtr,
      bodyTransformsPtr,
      markerLocalsPtr,
      outGlobalsPtr,
    );

    // 4. Unpack results
    const results: SpatialTransform[] = new Array(markerCount);
    let outOff = outGlobalsPtr >> 3;
    for (let m = 0; m < markerCount; m++) {
      results[m] = {
        position: {
          x: f64[outOff + 0]!,
          y: f64[outOff + 1]!,
          z: f64[outOff + 2]!,
        },
        rotation: [
          [f64[outOff + 3]!, f64[outOff + 4]!, f64[outOff + 5]!],
          [f64[outOff + 6]!, f64[outOff + 7]!, f64[outOff + 8]!],
          [f64[outOff + 9]!, f64[outOff + 10]!, f64[outOff + 11]!],
        ],
      };
      outOff += 12;
    }

    // 5. Free buffers
    this.free(bodyTransformsPtr);
    this.free(bodyIndicesPtr);
    this.free(markerLocalsPtr);
    this.free(outGlobalsPtr);

    return results;
  }

  /**
   * High-performance batched joint constraint evaluation.
   */
  batchEvaluateJoints(
    joints: { id: string; type: JointType; markerAIdx: number; markerBIdx: number }[],
    markerTransforms: SpatialTransform[],
  ): JointConstraintResidual[] {
    const jointCount = joints.length;
    if (jointCount === 0) return [];

    this.refreshViews();

    const markerCount = markerTransforms.length;
    const markerGlobalsBytes = markerCount * 96;
    const jointTypesBytes = jointCount * 4;
    const markerAIdxBytes = jointCount * 4;
    const markerBIdxBytes = jointCount * 4;
    const outResidualsBytes = jointCount * 56;

    const markerGlobalsPtr = this.alloc(markerGlobalsBytes);
    const jointTypesPtr = this.alloc(jointTypesBytes);
    const markerAIdxPtr = this.alloc(markerAIdxBytes);
    const markerBIdxPtr = this.alloc(markerBIdxBytes);
    const outResidualsPtr = this.alloc(outResidualsBytes);

    const f64 = this.f64View;
    const i32 = this.i32View;

    // Pack marker transforms
    let mOff = markerGlobalsPtr >> 3;
    for (let m = 0; m < markerCount; m++) {
      const mt = markerTransforms[m]!;
      f64[mOff + 0] = mt.position.x;
      f64[mOff + 1] = mt.position.y;
      f64[mOff + 2] = mt.position.z;

      f64[mOff + 3] = mt.rotation[0]![0]!;
      f64[mOff + 4] = mt.rotation[0]![1]!;
      f64[mOff + 5] = mt.rotation[0]![2]!;
      f64[mOff + 6] = mt.rotation[1]![0]!;
      f64[mOff + 7] = mt.rotation[1]![1]!;
      f64[mOff + 8] = mt.rotation[1]![2]!;
      f64[mOff + 9] = mt.rotation[2]![0]!;
      f64[mOff + 10] = mt.rotation[2]![1]!;
      f64[mOff + 11] = mt.rotation[2]![2]!;

      mOff += 12;
    }

    // Pack joint metadata
    const jTypeOff = jointTypesPtr >> 2;
    const jAOff = markerAIdxPtr >> 2;
    const jBOff = markerBIdxPtr >> 2;

    for (let j = 0; j < jointCount; j++) {
      const jt = joints[j]!;
      i32[jTypeOff + j] = JOINT_TYPE_MAP[jt.type] ?? 6;
      i32[jAOff + j] = jt.markerAIdx;
      i32[jBOff + j] = jt.markerBIdx;
    }

    // Execute in WASM
    this.exports.kin_batch_evaluate_joints(
      jointCount,
      jointTypesPtr,
      markerAIdxPtr,
      markerBIdxPtr,
      markerGlobalsPtr,
      outResidualsPtr,
    );

    // Unpack residuals
    const results: JointConstraintResidual[] = new Array(jointCount);
    let resOff = outResidualsPtr >> 3;
    for (let j = 0; j < jointCount; j++) {
      const jt = joints[j]!;
      results[j] = {
        jointId: jt.id,
        type: jt.type,
        positionError: {
          x: f64[resOff + 0]!,
          y: f64[resOff + 1]!,
          z: f64[resOff + 2]!,
        },
        orientationError: {
          x: f64[resOff + 3]!,
          y: f64[resOff + 4]!,
          z: f64[resOff + 5]!,
        },
        constraintNorm: f64[resOff + 6]!,
      };
      resOff += 7;
    }

    // Free buffers
    this.free(markerGlobalsPtr);
    this.free(jointTypesPtr);
    this.free(markerAIdxPtr);
    this.free(markerBIdxPtr);
    this.free(outResidualsPtr);

    return results;
  }
}

// Global cached instance
let cachedBridge: WasmKinematicsBridge | null = null;

export function getWasmKinematicsBridge(): WasmKinematicsBridge {
  if (!cachedBridge) {
    cachedBridge = WasmKinematicsBridge.create();
  }
  return cachedBridge;
}
