// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/c37118 — Core Types for IEEE C37.118 Synchrophasor (PMU) Profiles & Data.
 */

export interface C37118PhasorChannel {
  name: string;
  type: "V" | "I";
  format: "polar" | "rectangular";
  scaleFactor: number;
  initialMag?: number | undefined;
  initialAngleDeg?: number | undefined;
}

export interface C37118AnalogChannel {
  name: string;
  units?: string | undefined;
  scaleFactor: number;
  initialValue?: number | undefined;
}

export interface C37118DigitalChannel {
  name: string;
  normalMask?: number | undefined;
}

export interface C37118DataFrame {
  timestamp: string;
  freqHz: number;
  rocofHzPerSec: number;
  phasors: { mag: number; angleDeg: number }[];
}

export interface C37118PmuConfig {
  idcode: number;
  stn: string;
  fnom: 50 | 60;
  dataRate: number;
  phasors: C37118PhasorChannel[];
  analogs: C37118AnalogChannel[];
  digitals: C37118DigitalChannel[];
  frames: C37118DataFrame[];
}

export interface C37118Diagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  channelName?: string | undefined;
}
