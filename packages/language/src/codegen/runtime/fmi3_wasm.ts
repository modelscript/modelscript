import { DaeBuilder, VAR_STRIDE, VAR_FLAGS, FLAG_VAR_STATE } from "./dae";
import { computeDerivatives, stepEuler } from "./integrators";
import { atomicChunkAlloc } from "./arena";

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

  // Zero-copy memory pointers:
  // - varValuesPtr: f64[nVars]
  // - derivativesPtr: f64[nStates]
  // - eventIndicatorsPtr: f64[nEventIndicators]
  // - continuousStatesPtr: f64[nStates]
  // - stateVarIndicesPtr: u32[nStates]
  varValuesPtr: usize;
  derivativesPtr: usize;
  eventIndicatorsPtr: usize;
  continuousStatesPtr: usize;
  stateVarIndicesPtr: usize;

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

    this.varValuesPtr = atomicChunkAlloc(nV * 8);
    this.derivativesPtr = atomicChunkAlloc(nS * 8);
    this.continuousStatesPtr = atomicChunkAlloc(nS * 8);
    this.eventIndicatorsPtr = atomicChunkAlloc(nE * 8);
    this.stateVarIndicesPtr = atomicChunkAlloc(nS * 4);

    // Initialize state mapping
    let sIdx: u32 = 0;
    for (let v: u32 = 0; v < totalVars; v++) {
      let startVal = dae.getVarStartValue(v);
      store<f64>(this.varValuesPtr + v * 8, startVal);

      if ((dae.getVarData().get(v * VAR_STRIDE + VAR_FLAGS) & FLAG_VAR_STATE) != 0) {
        store<u32>(this.stateVarIndicesPtr + sIdx * 4, v);
        store<f64>(this.continuousStatesPtr + sIdx * 8, startVal);
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

  for (let i: u32 = 0; i < count; i++) {
    let vIdx = load<u32>(inst.stateVarIndicesPtr + i * 4);
    let val = load<f64>(inst.varValuesPtr + vIdx * 8);
    store<f64>(statesPtr + i * 8, val);
  }
  return FMI3_OK;
}

export function fmi3SetContinuousStates(instancePtr: u32, statesPtr: u32, nStates: u32): i32 {
  if (instancePtr == 0) return FMI3_FATAL;
  let inst = changetype<Fmi3Instance>(instancePtr);
  let count = nStates < inst.nStates ? nStates : inst.nStates;

  for (let i: u32 = 0; i < count; i++) {
    let vIdx = load<u32>(inst.stateVarIndicesPtr + i * 4);
    let val = load<f64>(statesPtr + i * 8);
    store<f64>(inst.varValuesPtr + vIdx * 8, val);
    store<f64>(inst.continuousStatesPtr + i * 8, val);
  }
  return FMI3_OK;
}

export function fmi3GetDerivatives(instancePtr: u32, derivativesPtr: u32, nDerivatives: u32): i32 {
  if (instancePtr == 0) return FMI3_FATAL;
  let inst = changetype<Fmi3Instance>(instancePtr);
  let dae = changetype<DaeBuilder>(inst.daePtr);

  computeDerivatives(dae, inst.varValuesPtr as u32, inst.derivativesPtr as u32);
  let count = nDerivatives < inst.nStates ? nDerivatives : inst.nStates;

  for (let i: u32 = 0; i < count; i++) {
    let dVal = load<f64>(inst.derivativesPtr + i * 8);
    store<f64>(derivativesPtr + i * 8, dVal);
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
  return load<f64>(inst.varValuesPtr + valueReference * 8);
}

export function fmi3SetFloat64(instancePtr: u32, valueReference: u32, value: f64): i32 {
  if (instancePtr == 0) return FMI3_FATAL;
  let inst = changetype<Fmi3Instance>(instancePtr);
  if (valueReference >= inst.nVars) return FMI3_ERROR;
  store<f64>(inst.varValuesPtr + valueReference * 8, value);
  return FMI3_OK;
}

/**
 * Returns zero-copy linear memory pointer to FMU state buffer for direct WebGPU storage buffer dispatch.
 */
export function fmi3GetGpuBufferPointer(instancePtr: u32): u32 {
  if (instancePtr == 0) return 0;
  return changetype<Fmi3Instance>(instancePtr).varValuesPtr as u32;
}

/**
 * Returns total byte length of the GPU state buffer.
 */
export function fmi3GetGpuBufferByteLength(instancePtr: u32): u32 {
  if (instancePtr == 0) return 0;
  return changetype<Fmi3Instance>(instancePtr).nVars * 8;
}
