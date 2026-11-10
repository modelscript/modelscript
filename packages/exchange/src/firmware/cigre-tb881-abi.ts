// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CIGRE Technical Brochure 881 / IEEE P2800.2 Real-Code Firmware Standard C-ABI.
 *
 * Defines the vendor-neutral application binary interface (ABI) for black-box
 * inverter and wind turbine digital twin control firmware execution across
 * EMT (PSCAD/EMTP) and RMS (PSS/E/PSLF) simulation platforms.
 */

/**
 * Static metadata returned by `Model_GetInfo`.
 */
export interface CigreModelInfo {
  modelName: string;
  vendorName: string;
  firmwareVersion: string;
  buildTimestamp: string;
  abiVersion: "CIGRE_TB881_v1" | "IEEE_P2800.2_v1";
  numInputs: number;
  numOutputs: number;
  numParameters: number;
  numStates: number;
  recommendedTimeStepSec: number; // e.g. 50e-6 s (50 microseconds)
  minTimeStepSec: number;
  maxTimeStepSec: number;
}

/**
 * Plant operational settings supplied to `Model_Initialize`.
 */
export interface CigreModelInitParams {
  nominalFreqHz: number; // e.g. 60.0 or 50.0 Hz
  mbaseMva: number; // Plant rated MVA
  vNominalKv: number; // Rated POI kV
  controlMode: "voltage_control" | "power_factor" | "q_droop" | "grid_forming";
  parameters: Record<string, number>;
}

/**
 * Instantaneous electrical inputs provided to `Model_Outputs` at time step t.
 */
export interface CigreModelInputs {
  timeSec: number;
  // Three-phase instantaneous POI terminal voltages (kV or pu)
  va: number;
  vb: number;
  vc: number;
  // Three-phase instantaneous POI branch currents (kA or pu)
  ia: number;
  ib: number;
  ic: number;
  // External supervisory references (from Plant Controller / PPC)
  pRefPu: number;
  qRefPu?: number | undefined;
  vRefPu?: number | undefined;
  freqRefHz?: number | undefined;
}

/**
 * Instantaneous converter modulation and current commands calculated by the firmware.
 */
export interface CigreModelOutputs {
  timeSec: number;
  // d-q reference frame converter currents (pu on plant base)
  idTargetPu: number;
  iqTargetPu: number;
  // Modulation references
  mRealPu: number;
  mImagPu: number;
  // Diagnostic and compliance status flags
  isRideThroughActive: boolean;
  isCurrentLimitReached: boolean;
  isMomentaryCessation: boolean;
  isTripped: boolean;
  tripReasonCode?: number | undefined;
}

/**
 * Memory byte offsets and layout for WebAssembly linear memory marshalling.
 *
 * All floating point quantities are IEEE 754 64-bit double precision (8 bytes).
 */
export const CIGRE_WASM_MEMORY_LAYOUT = {
  // Input struct buffer: 10 doubles = 80 bytes
  // [time, va, vb, vc, ia, ib, ic, pRef, qRef, vRef]
  INPUT_OFFSET_BYTES: 1024,
  INPUT_SIZE_DOUBLES: 10,
  INPUT_SIZE_BYTES: 80,

  // Output struct buffer: 8 doubles = 64 bytes
  // [time, idTarget, iqTarget, mReal, mImag, flags, tripCode, reserved]
  OUTPUT_OFFSET_BYTES: 2048,
  OUTPUT_SIZE_DOUBLES: 8,
  OUTPUT_SIZE_BYTES: 64,

  // Flag bitmasks packed into flags double
  FLAG_RIDE_THROUGH: 1 << 0,
  FLAG_CURRENT_LIMIT: 1 << 1,
  FLAG_MOMENTARY_CESSATION: 1 << 2,
  FLAG_TRIPPED: 1 << 3,
};
