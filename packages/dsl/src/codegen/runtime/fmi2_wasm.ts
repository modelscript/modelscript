import { DaeBuilder, VAR_STRIDE, VAR_FLAGS, FLAG_VAR_STATE } from "./dae";
import { computeDerivatives, stepEuler } from "./integrators";
import { atomicChunkAlloc } from "./arena";

// FMI 2.0 Status Enums
export const FMI2_OK: i32 = 0;
export const FMI2_WARNING: i32 = 1;
export const FMI2_DISCARD: i32 = 2;
export const FMI2_ERROR: i32 = 3;
export const FMI2_FATAL: i32 = 4;
export const FMI2_PENDING: i32 = 5;

// FMI 2.0 Execution States
export const FMI2_STATE_INSTANTIATED: i32 = 1;
export const FMI2_STATE_INITIALIZATION_MODE: i32 = 2;
export const FMI2_STATE_CONTINUOUS_TIME_MODE: i32 = 3;
export const FMI2_STATE_STEP_COMPLETE: i32 = 4;
export const FMI2_STATE_TERMINATED: i32 = 5;

/**
 * FMI 2.0 Standardized FMU Instance in WASM Linear Memory
 */
@unmanaged
export class Fmi2Instance {
  daePtr: u32;
  fmuState: i32;
  currentTime: f64;
  stopTime: f64;
  nStates: u32;
  nVars: u32;
  nEventIndicators: u32;

  varValuesPtr: usize;
  derivativesPtr: usize;
  eventIndicatorsPtr: usize;
  continuousStatesPtr: usize;
  stateVarIndicesPtr: usize;

  init(daePtr: u32, nEventIndicators: u32): void {
    this.daePtr = daePtr;
    this.fmuState = FMI2_STATE_INSTANTIATED;
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
// FMI 2.0 Standardized C/WASM Function Implementations
// ─────────────────────────────────────────────────────────────────────────────

export function fmi2Instantiate(daePtr: u32): u32 {
  if (daePtr == 0) return 0;
  let ptr = atomicChunkAlloc(256);
  let instance = changetype<Fmi2Instance>(ptr);
  instance.init(daePtr, 0);
  return ptr as u32;
}

export function fmi2SetupExperiment(instancePtr: u32, toleranceDefined: bool, tolerance: f64, startTime: f64, stopTimeDefined: bool, stopTime: f64): i32 {
  if (instancePtr == 0) return FMI2_FATAL;
  let inst = changetype<Fmi2Instance>(instancePtr);
  inst.currentTime = startTime;
  if (stopTimeDefined) {
    inst.stopTime = stopTime;
  }
  return FMI2_OK;
}

export function fmi2EnterInitializationMode(instancePtr: u32): i32 {
  if (instancePtr == 0) return FMI2_FATAL;
  let inst = changetype<Fmi2Instance>(instancePtr);
  inst.fmuState = FMI2_STATE_INITIALIZATION_MODE;
  return FMI2_OK;
}

export function fmi2ExitInitializationMode(instancePtr: u32): i32 {
  if (instancePtr == 0) return FMI2_FATAL;
  let inst = changetype<Fmi2Instance>(instancePtr);
  inst.fmuState = FMI2_STATE_CONTINUOUS_TIME_MODE;
  return FMI2_OK;
}

export function fmi2SetTime(instancePtr: u32, time: f64): i32 {
  if (instancePtr == 0) return FMI2_FATAL;
  changetype<Fmi2Instance>(instancePtr).currentTime = time;
  return FMI2_OK;
}

export function fmi2GetContinuousStates(instancePtr: u32, statesPtr: u32, nStates: u32): i32 {
  if (instancePtr == 0) return FMI2_FATAL;
  let inst = changetype<Fmi2Instance>(instancePtr);
  let count = nStates < inst.nStates ? nStates : inst.nStates;

  for (let i: u32 = 0; i < count; i++) {
    let vIdx = load<u32>(inst.stateVarIndicesPtr + i * 4);
    let val = load<f64>(inst.varValuesPtr + vIdx * 8);
    store<f64>(statesPtr + i * 8, val);
  }
  return FMI2_OK;
}

export function fmi2SetContinuousStates(instancePtr: u32, statesPtr: u32, nStates: u32): i32 {
  if (instancePtr == 0) return FMI2_FATAL;
  let inst = changetype<Fmi2Instance>(instancePtr);
  let count = nStates < inst.nStates ? nStates : inst.nStates;

  for (let i: u32 = 0; i < count; i++) {
    let vIdx = load<u32>(inst.stateVarIndicesPtr + i * 4);
    let val = load<f64>(statesPtr + i * 8);
    store<f64>(inst.varValuesPtr + vIdx * 8, val);
    store<f64>(inst.continuousStatesPtr + i * 8, val);
  }
  return FMI2_OK;
}

export function fmi2GetDerivatives(instancePtr: u32, derivativesPtr: u32, nDerivatives: u32): i32 {
  if (instancePtr == 0) return FMI2_FATAL;
  let inst = changetype<Fmi2Instance>(instancePtr);
  let dae = changetype<DaeBuilder>(inst.daePtr);

  computeDerivatives(dae, inst.varValuesPtr as u32, inst.derivativesPtr as u32);
  let count = nDerivatives < inst.nStates ? nDerivatives : inst.nStates;

  for (let i: u32 = 0; i < count; i++) {
    let dVal = load<f64>(inst.derivativesPtr + i * 8);
    store<f64>(derivativesPtr + i * 8, dVal);
  }
  return FMI2_OK;
}

export function fmi2DoStep(
  instancePtr: u32,
  currentCommunicationPoint: f64,
  communicationStepSize: f64,
  noSetFMUStatePriorToCurrentPoint: bool
): i32 {
  if (instancePtr == 0) return FMI2_FATAL;
  let inst = changetype<Fmi2Instance>(instancePtr);
  let dae = changetype<DaeBuilder>(inst.daePtr);

  stepEuler(dae, inst.varValuesPtr as u32, communicationStepSize);
  inst.currentTime = currentCommunicationPoint + communicationStepSize;
  inst.fmuState = FMI2_STATE_STEP_COMPLETE;
  return FMI2_OK;
}

export function fmi2GetReal(instancePtr: u32, vrPtr: u32, nvr: u32, valuePtr: u32): i32 {
  if (instancePtr == 0) return FMI2_FATAL;
  let inst = changetype<Fmi2Instance>(instancePtr);
  for (let i: u32 = 0; i < nvr; i++) {
    let vr = load<u32>(vrPtr + i * 4);
    if (vr < inst.nVars) {
      let val = load<f64>(inst.varValuesPtr + vr * 8);
      store<f64>(valuePtr + i * 8, val);
    }
  }
  return FMI2_OK;
}

export function fmi2SetReal(instancePtr: u32, vrPtr: u32, nvr: u32, valuePtr: u32): i32 {
  if (instancePtr == 0) return FMI2_FATAL;
  let inst = changetype<Fmi2Instance>(instancePtr);
  for (let i: u32 = 0; i < nvr; i++) {
    let vr = load<u32>(vrPtr + i * 4);
    if (vr < inst.nVars) {
      let val = load<f64>(valuePtr + i * 8);
      store<f64>(inst.varValuesPtr + vr * 8, val);
    }
  }
  return FMI2_OK;
}
