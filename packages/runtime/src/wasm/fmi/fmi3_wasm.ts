import { DaeBuilder, VAR_STRIDE, VAR_FLAGS, FLAG_VAR_STATE } from "../dae/builder";
import { computeDerivatives, stepEuler } from "../solvers/integrators";
import { atomicChunkAlloc } from "../arena";
import { UnmanagedFloat64Array, UnmanagedUint32Array } from "../core/array";

// FMI 3.0 Status Enums
export const FMI3_OK: i32 = 0;
export const FMI3_WARNING: i32 = 1;
export const FMI3_DISCARD: i32 = 2;
export const FMI3_ERROR: i32 = 3;
export const FMI3_FATAL: i32 = 4;

// FMI 3.0 Model Execution States
export const FMI3_STATE_INSTANTIATED: i32 = 1;
export const FMI3_STATE_INITIALIZATION: i32 = 2;
export const FMI3_STATE_CONTINUOUS_TIME: i32 = 3;
export const FMI3_STATE_STEP_COMPLETE: i32 = 4;
export const FMI3_STATE_TERMINATED: i32 = 5;

/**
 * FMI 3.0 Standardized FMU Instance in WASM Linear Memory
 */
@unmanaged
export class Fmi3Instance {
  daePtr: u32;
  fmuState: i32;
  currentTime: f64;
  stopTime: f64;
  nStates: u32;
  nVars: u32;
  nEventIndicators: u32;

  // Zero-copy memory arrays:
  // - varValues: f64[nVars]
  // - derivatives: f64[nStates]
  // - eventIndicators: f64[nEventIndicators]
  // - continuousStates: f64[nStates]
  // - stateVarIndices: u32[nStates]
  varValues: UnmanagedFloat64Array;
  derivatives: UnmanagedFloat64Array;
  eventIndicators: UnmanagedFloat64Array;
  continuousStates: UnmanagedFloat64Array;
  stateVarIndices: UnmanagedUint32Array;

  @inline get varValuesPtr(): usize { return changetype<usize>(this.varValues); }
  @inline get derivativesPtr(): usize { return changetype<usize>(this.derivatives); }
  @inline get eventIndicatorsPtr(): usize { return changetype<usize>(this.eventIndicators); }
  @inline get continuousStatesPtr(): usize { return changetype<usize>(this.continuousStates); }
  @inline get stateVarIndicesPtr(): usize { return changetype<usize>(this.stateVarIndices); }

  init(daePtr: u32, nEventIndicators: u32): void {
    this.daePtr = daePtr;
    this.fmuState = FMI3_STATE_INSTANTIATED;
    this.currentTime = 0.0;
    this.stopTime = 1.0;
    this.nEventIndicators = nEventIndicators;

    let dae = changetype<DaeBuilder>(daePtr);
    let totalVars = dae.varCount;
    this.nVars = totalVars;

    let stateCount: u32 = 0;
    for (let v: u32 = 0; v < totalVars; v++) {
      if ((dae.getVarData().get(v * VAR_STRIDE + VAR_FLAGS) & FLAG_VAR_STATE) != 0) {
        stateCount++;
      }
    }
    this.nStates = stateCount;

    let nV = totalVars > 0 ? totalVars : 1;
    let nS = stateCount > 0 ? stateCount : 1;
    let nE = nEventIndicators > 0 ? nEventIndicators : 1;

    this.varValues = changetype<UnmanagedFloat64Array>(atomicChunkAlloc(nV * 8));
    this.derivatives = changetype<UnmanagedFloat64Array>(atomicChunkAlloc(nS * 8));
    this.continuousStates = changetype<UnmanagedFloat64Array>(atomicChunkAlloc(nS * 8));
    this.eventIndicators = changetype<UnmanagedFloat64Array>(atomicChunkAlloc(nE * 8));
    this.stateVarIndices = changetype<UnmanagedUint32Array>(atomicChunkAlloc(nS * 4));

    // Initialize state mapping
    let sIdx: u32 = 0;
    for (let v: u32 = 0; v < totalVars; v++) {
      let startVal = dae.getVarStartValue(v);
      this.varValues[v] = startVal;

      if ((dae.getVarData().get(v * VAR_STRIDE + VAR_FLAGS) & FLAG_VAR_STATE) != 0) {
        this.stateVarIndices[sIdx] = v;
        this.continuousStates[sIdx] = startVal;
        sIdx++;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FMI 3.0 Standardized C/WASM Function Implementations
// ─────────────────────────────────────────────────────────────────────────────

export function fmi3InstantiateModelExchange(daePtr: u32): u32 {
  if (daePtr == 0) return 0;
  let ptr = atomicChunkAlloc(256);
  let instance = changetype<Fmi3Instance>(ptr);
  instance.init(daePtr, 0);
  return ptr as u32;
}

export function fmi3InstantiateCoSimulation(daePtr: u32): u32 {
  if (daePtr == 0) return 0;
  let ptr = atomicChunkAlloc(256);
  let instance = changetype<Fmi3Instance>(ptr);
  instance.init(daePtr, 0);
  return ptr as u32;
}

export function fmi3EnterInitializationMode(instancePtr: u32, tolerance: f64, startTime: f64, stopTime: f64): i32 {
  if (instancePtr == 0) return FMI3_FATAL;
  let inst = changetype<Fmi3Instance>(instancePtr);
  inst.currentTime = startTime;
  inst.stopTime = stopTime;
  inst.fmuState = FMI3_STATE_INITIALIZATION;
  return FMI3_OK;
}

export function fmi3ExitInitializationMode(instancePtr: u32): i32 {
  if (instancePtr == 0) return FMI3_FATAL;
  let inst = changetype<Fmi3Instance>(instancePtr);
  inst.fmuState = FMI3_STATE_CONTINUOUS_TIME;
  return FMI3_OK;
}

export function fmi3SetTime(instancePtr: u32, time: f64): i32 {
  if (instancePtr == 0) return FMI3_FATAL;
  changetype<Fmi3Instance>(instancePtr).currentTime = time;
  return FMI3_OK;
}

export function fmi3GetContinuousStates(instancePtr: u32, statesPtr: u32, nStates: u32): i32 {
  if (instancePtr == 0) return FMI3_FATAL;
  let inst = changetype<Fmi3Instance>(instancePtr);
  let count = nStates < inst.nStates ? nStates : inst.nStates;
  let states = changetype<UnmanagedFloat64Array>(statesPtr);

  for (let i: u32 = 0; i < count; i++) {
    let vIdx = inst.stateVarIndices[i];
    states[i] = inst.varValues[vIdx];
  }
  return FMI3_OK;
}

export function fmi3SetContinuousStates(instancePtr: u32, statesPtr: u32, nStates: u32): i32 {
  if (instancePtr == 0) return FMI3_FATAL;
  let inst = changetype<Fmi3Instance>(instancePtr);
  let count = nStates < inst.nStates ? nStates : inst.nStates;
  let states = changetype<UnmanagedFloat64Array>(statesPtr);

  for (let i: u32 = 0; i < count; i++) {
    let vIdx = inst.stateVarIndices[i];
    let val = states[i];
    inst.varValues[vIdx] = val;
    inst.continuousStates[i] = val;
  }
  return FMI3_OK;
}

export function fmi3GetDerivatives(instancePtr: u32, derivativesPtr: u32, nDerivatives: u32): i32 {
  if (instancePtr == 0) return FMI3_FATAL;
  let inst = changetype<Fmi3Instance>(instancePtr);
  let dae = changetype<DaeBuilder>(inst.daePtr);

  computeDerivatives(dae, inst.varValuesPtr as u32, inst.derivativesPtr as u32);
  let count = nDerivatives < inst.nStates ? nDerivatives : inst.nStates;
  let derivatives = changetype<UnmanagedFloat64Array>(derivativesPtr);

  for (let i: u32 = 0; i < count; i++) {
    derivatives[i] = inst.derivatives[i];
  }
  return FMI3_OK;
}

export function fmi3DoStep(
  instancePtr: u32,
  currentCommunicationPoint: f64,
  communicationStepSize: f64,
  noSetFMUStatePriorToCurrentPoint: bool
): i32 {
  if (instancePtr == 0) return FMI3_FATAL;
  let inst = changetype<Fmi3Instance>(instancePtr);
  let dae = changetype<DaeBuilder>(inst.daePtr);

  stepEuler(dae, inst.varValuesPtr as u32, communicationStepSize);
  inst.currentTime = currentCommunicationPoint + communicationStepSize;
  inst.fmuState = FMI3_STATE_STEP_COMPLETE;
  return FMI3_OK;
}

export function fmi3GetFloat64(instancePtr: u32, valueReference: u32): f64 {
  if (instancePtr == 0) return 0.0;
  let inst = changetype<Fmi3Instance>(instancePtr);
  if (valueReference >= inst.nVars) return 0.0;
  return inst.varValues[valueReference];
}

export function fmi3SetFloat64(instancePtr: u32, valueReference: u32, value: f64): i32 {
  if (instancePtr == 0) return FMI3_FATAL;
  let inst = changetype<Fmi3Instance>(instancePtr);
  if (valueReference >= inst.nVars) return FMI3_ERROR;
  inst.varValues[valueReference] = value;
  return FMI3_OK;
}

/**
 * Returns zero-copy linear memory pointer to FMU state buffer for direct WebGPU storage buffer dispatch.
 */
export function fmi3GetGpuBufferPointer(instancePtr: u32): u32 {
  if (instancePtr == 0) return 0;
  return changetype<usize>(changetype<Fmi3Instance>(instancePtr).varValues) as u32;
}

/**
 * Returns total byte length of the GPU state buffer.
 */
export function fmi3GetGpuBufferByteLength(instancePtr: u32): u32 {
  if (instancePtr == 0) return 0;
  return changetype<Fmi3Instance>(instancePtr).nVars * 8;
}
