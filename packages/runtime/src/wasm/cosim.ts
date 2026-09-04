// SPDX-License-Identifier: AGPL-3.0-or-later
// @ts-nocheck
import { atomicChunkAlloc } from "./arena";
import { fmi2DoStep, fmi2GetReal, fmi2SetReal, Fmi2Instance, FMI2_OK } from "./fmi2_wasm";
import { fmi3DoStep, fmi3GetFloat64, fmi3SetFloat64, Fmi3Instance, FMI3_OK } from "./fmi3_wasm";

// Co-Simulation Master Algorithms
export const COSIM_METHOD_JACOBI: i32 = 0;       // Parallel, non-iterative
export const COSIM_METHOD_GAUSS_SEIDEL: i32 = 1; // Sequential, with relaxation

// Maximum supported participants and couplings per orchestrator instance
export const COSIM_MAX_PARTICIPANTS: i32 = 64;
export const COSIM_MAX_COUPLINGS: i32 = 512;

/**
 * Direct zero-copy variable coupling entry connecting source FMU output
 * to destination FMU input:
 *   dstVal = srcVal * scale + offset
 */
@unmanaged
export class CosimCoupling {
  srcInstancePtr: u32;
  srcVr: u32;
  srcFmiVersion: u32; // 2 or 3
  dstInstancePtr: u32;
  dstVr: u32;
  dstFmiVersion: u32; // 2 or 3
  scale: f64;
  offset: f64;
  lastValue: f64;
}

/**
 * Co-simulation participant descriptor in WASM linear memory.
 */
@unmanaged
export class CosimParticipant {
  instancePtr: u32;
  fmiVersion: u32; // 2 for FMI 2.0, 3 for FMI 3.0
  stepRatio: u32;   // Multi-rate integer multiplier (1 = base rate)
  stepsTaken: u32;
}

/**
 * Standardized Co-Simulation Orchestrator in WASM Linear Memory.
 * Orchestrates multi-rate FMI 2.0 and FMI 3.0 FMU instances with zero-copy
 * memory-mapped coupling exchanges.
 */
@unmanaged
export class CosimOrchestrator {
  method: i32;
  maxIterations: i32;
  tolerance: f64;
  relaxation: f64; // Relaxation factor omega in (0, 1] for Gauss-Seidel

  participantCount: u32;
  couplingCount: u32;

  // Linear memory pointers to descriptor arrays:
  // participantsPtr: CosimParticipant[COSIM_MAX_PARTICIPANTS]
  // couplingsPtr: CosimCoupling[COSIM_MAX_COUPLINGS]
  participantsPtr: usize;
  couplingsPtr: usize;

  init(method: i32, maxIterations: i32, tolerance: f64, relaxation: f64): void {
    this.method = method;
    this.maxIterations = maxIterations > 0 ? maxIterations : 10;
    this.tolerance = tolerance > 0.0 ? tolerance : 1e-6;
    this.relaxation = relaxation > 0.0 && relaxation <= 1.0 ? relaxation : 1.0;

    this.participantCount = 0;
    this.couplingCount = 0;

    this.participantsPtr = atomicChunkAlloc(COSIM_MAX_PARTICIPANTS * sizeof<CosimParticipant>());
    this.couplingsPtr = atomicChunkAlloc(COSIM_MAX_COUPLINGS * sizeof<CosimCoupling>());
  }

  addParticipant(instancePtr: u32, fmiVersion: u32, stepRatio: u32): i32 {
    if (this.participantCount >= (COSIM_MAX_PARTICIPANTS as u32)) return -1;
    let idx = this.participantCount;
    let pPtr = this.participantsPtr + idx * sizeof<CosimParticipant>();
    let p = changetype<CosimParticipant>(pPtr);
    p.instancePtr = instancePtr;
    p.fmiVersion = fmiVersion == 3 ? 3 : 2;
    p.stepRatio = stepRatio > 0 ? stepRatio : 1;
    p.stepsTaken = 0;
    this.participantCount++;
    return idx as i32;
  }

  addCoupling(
    srcInstancePtr: u32,
    srcVr: u32,
    srcFmiVersion: u32,
    dstInstancePtr: u32,
    dstVr: u32,
    dstFmiVersion: u32,
    scale: f64,
    offset: f64
  ): i32 {
    if (this.couplingCount >= (COSIM_MAX_COUPLINGS as u32)) return -1;
    let idx = this.couplingCount;
    let cPtr = this.couplingsPtr + idx * sizeof<CosimCoupling>();
    let c = changetype<CosimCoupling>(cPtr);
    c.srcInstancePtr = srcInstancePtr;
    c.srcVr = srcVr;
    c.srcFmiVersion = srcFmiVersion == 3 ? 3 : 2;
    c.dstInstancePtr = dstInstancePtr;
    c.dstVr = dstVr;
    c.dstFmiVersion = dstFmiVersion == 3 ? 3 : 2;
    c.scale = scale;
    c.offset = offset;
    c.lastValue = 0.0;
    this.couplingCount++;
    return idx as i32;
  }

  /**
   * Reads a scalar Real / Float64 from an FMU instance (FMI 2.0 or FMI 3.0).
   */
  getReal(instancePtr: u32, vr: u32, fmiVersion: u32): f64 {
    if (instancePtr == 0) return 0.0;
    if (fmiVersion == 3) {
      return fmi3GetFloat64(instancePtr, vr);
    } else {
      let inst = changetype<Fmi2Instance>(instancePtr);
      if (vr < inst.nVars) {
        return load<f64>(inst.varValuesPtr + vr * 8);
      }
      return 0.0;
    }
  }

  /**
   * Writes a scalar Real / Float64 into an FMU instance (FMI 2.0 or FMI 3.0).
   */
  setReal(instancePtr: u32, vr: u32, fmiVersion: u32, value: f64): void {
    if (instancePtr == 0) return;
    if (fmiVersion == 3) {
      fmi3SetFloat64(instancePtr, vr, value);
    } else {
      let inst = changetype<Fmi2Instance>(instancePtr);
      if (vr < inst.nVars) {
        store<f64>(inst.varValuesPtr + vr * 8, value);
      }
    }
  }

  /**
   * Propagates all connected variable couplings across instances.
   * Returns the maximum change (infinity norm) for convergence checking.
   */
  propagateCouplings(): f64 {
    let maxDiff: f64 = 0.0;
    let count = this.couplingCount;
    let cBase = this.couplingsPtr;

    for (let i: u32 = 0; i < count; i++) {
      let cPtr = cBase + i * sizeof<CosimCoupling>();
      let c = changetype<CosimCoupling>(cPtr);

      let rawSrc = this.getReal(c.srcInstancePtr, c.srcVr, c.srcFmiVersion);
      let targetVal = rawSrc * c.scale + c.offset;

      // Apply relaxation for Gauss-Seidel: val = lastVal + omega * (targetVal - lastVal)
      let val = c.lastValue + this.relaxation * (targetVal - c.lastValue);
      let diff = Math.abs(val - c.lastValue);
      if (diff > maxDiff) maxDiff = diff;

      c.lastValue = val;
      this.setReal(c.dstInstancePtr, c.dstVr, c.dstFmiVersion, val);
    }
    return maxDiff;
  }

  /**
   * Advances all participants by one master communication step.
   * Returns 0 (OK) on success, or non-zero status on error.
   */
  step(currentTime: f64, communicationStepSize: f64): i32 {
    let pCount = this.participantCount;
    let pBase = this.participantsPtr;

    if (this.method == COSIM_METHOD_GAUSS_SEIDEL && this.couplingCount > 0) {
      // Iterative Gauss-Seidel with algebraic loop resolution
      for (let iter: i32 = 0; iter < this.maxIterations; iter++) {
        let diff = this.propagateCouplings();
        if (iter > 0 && diff < this.tolerance) break;
      }
    } else {
      // Non-iterative Jacobi step: propagate couplings once before stepping
      this.propagateCouplings();
    }

    // Advance each participant
    for (let i: u32 = 0; i < pCount; i++) {
      let pPtr = pBase + i * sizeof<CosimParticipant>();
      let p = changetype<CosimParticipant>(pPtr);

      let subStep = communicationStepSize / (p.stepRatio as f64);
      for (let s: u32 = 0; s < p.stepRatio; s++) {
        let t = currentTime + (s as f64) * subStep;
        let status: i32 = 0;
        if (p.fmiVersion == 3) {
          status = fmi3DoStep(p.instancePtr, t, subStep, false);
          if (status != FMI3_OK) return status;
        } else {
          status = fmi2DoStep(p.instancePtr, t, subStep, false);
          if (status != FMI2_OK) return status;
        }
      }
      p.stepsTaken += p.stepRatio;
    }

    // Final coupling propagation at end of communication step
    this.propagateCouplings();
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// C/WASM Standard Export API
// ─────────────────────────────────────────────────────────────────────────────

export function cosimCreateOrchestrator(
  method: i32,
  maxIterations: i32,
  tolerance: f64,
  relaxation: f64
): u32 {
  let ptr = atomicChunkAlloc(sizeof<CosimOrchestrator>());
  let orchestrator = changetype<CosimOrchestrator>(ptr);
  orchestrator.init(method, maxIterations, tolerance, relaxation);
  return ptr as u32;
}

export function cosimAddParticipant(
  orchestratorPtr: u32,
  instancePtr: u32,
  fmiVersion: u32,
  stepRatio: u32
): i32 {
  if (orchestratorPtr == 0) return -1;
  return changetype<CosimOrchestrator>(orchestratorPtr).addParticipant(instancePtr, fmiVersion, stepRatio);
}

export function cosimAddCoupling(
  orchestratorPtr: u32,
  srcInstancePtr: u32,
  srcVr: u32,
  srcFmiVersion: u32,
  dstInstancePtr: u32,
  dstVr: u32,
  dstFmiVersion: u32,
  scale: f64,
  offset: f64
): i32 {
  if (orchestratorPtr == 0) return -1;
  return changetype<CosimOrchestrator>(orchestratorPtr).addCoupling(
    srcInstancePtr,
    srcVr,
    srcFmiVersion,
    dstInstancePtr,
    dstVr,
    dstFmiVersion,
    scale,
    offset
  );
}

export function cosimStep(
  orchestratorPtr: u32,
  currentTime: f64,
  communicationStepSize: f64
): i32 {
  if (orchestratorPtr == 0) return -1;
  return changetype<CosimOrchestrator>(orchestratorPtr).step(currentTime, communicationStepSize);
}

export function cosimPropagateCouplings(orchestratorPtr: u32): f64 {
  if (orchestratorPtr == 0) return 0.0;
  return changetype<CosimOrchestrator>(orchestratorPtr).propagateCouplings();
}

export function cosimGetParticipantCount(orchestratorPtr: u32): u32 {
  if (orchestratorPtr == 0) return 0;
  return changetype<CosimOrchestrator>(orchestratorPtr).participantCount;
}

export function cosimGetCouplingCount(orchestratorPtr: u32): u32 {
  if (orchestratorPtr == 0) return 0;
  return changetype<CosimOrchestrator>(orchestratorPtr).couplingCount;
}
