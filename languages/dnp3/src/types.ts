// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE 1815 / DNP3 SCADA Device Profile & Point Map Type Definitions.
 *
 * Supports utility SCADA RTU/PLC point lists across electric power,
 * municipal water distribution, and wastewater telemetry.
 */

export type Dnp3EventClass = 0 | 1 | 2 | 3;

export interface Dnp3BinaryInput {
  index: number;
  name: string;
  description?: string | undefined;
  eventClass: Dnp3EventClass;
  normalState?: 0 | 1 | undefined;
}

export interface Dnp3BinaryOutput {
  index: number;
  name: string;
  description?: string | undefined;
  supportedControls?: Array<"Pulse" | "LatchOn" | "LatchOff"> | undefined;
}

export interface Dnp3AnalogInput {
  index: number;
  name: string;
  description?: string | undefined;
  eventClass: Dnp3EventClass;
  deadband: number;
  scalingMultiplier: number;
  scalingOffset: number;
  units: string; // e.g. "kV", "A", "MW", "MVAR", "psi", "m3/s", "gpm"
  minVal?: number | undefined;
  maxVal?: number | undefined;
}

export interface Dnp3AnalogOutput {
  index: number;
  name: string;
  description?: string | undefined;
  units?: string | undefined;
  minVal?: number | undefined;
  maxVal?: number | undefined;
}

export interface Dnp3Counter {
  index: number;
  name: string;
  description?: string | undefined;
  eventClass: Dnp3EventClass;
  units?: string | undefined; // e.g. "kWh", "gal", "m3"
  rollover?: number | undefined;
}

export interface Dnp3DeviceProfile {
  id: string;
  deviceName: string;
  vendor: string;
  version: string;
  outstationAddress: number;
  masterAddress: number;
  binaryInputs: Dnp3BinaryInput[];
  binaryOutputs: Dnp3BinaryOutput[];
  analogInputs: Dnp3AnalogInput[];
  analogOutputs: Dnp3AnalogOutput[];
  counters: Dnp3Counter[];
}
