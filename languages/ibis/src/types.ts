// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Range triplet representation for Typical, Minimum, Maximum values.
 */
export interface Triplet {
  typ: number;
  min: number;
  max: number;
}

/**
 * A row in an IBIS I/V table or V/T waveform.
 */
export interface TableRow {
  vOrT: number;
  typ: number;
  min: number;
  max: number;
}

/**
 * Pin declaration in [Pin] section.
 */
export interface IbisPin {
  pinName: string;
  signalName: string;
  modelName: string;
  rPin?: number | undefined;
  lPin?: number | undefined;
  cPin?: number | undefined;
  line: number;
}

/**
 * Package RLC parasitics.
 */
export interface IbisPackage {
  rPkg: Triplet;
  lPkg: Triplet;
  cPkg: Triplet;
}

/**
 * Slew rate ramp specification in [Ramp].
 */
export interface IbisRamp {
  dvDtRising: Triplet;
  dvDtFalling: Triplet;
  rLoad?: number | undefined;
}

/**
 * Transition waveform in [Rising Waveform] or [Falling Waveform].
 */
export interface IbisWaveform {
  type: "rising" | "falling";
  rFixture: number;
  vFixture: number;
  vFixtureMin?: number | undefined;
  vFixtureMax?: number | undefined;
  cFixture?: number | undefined;
  lFixture?: number | undefined;
  rows: TableRow[];
}

/**
 * Buffer model type enumeration.
 */
export type IbisModelType =
  | "Input"
  | "Output"
  | "I/O"
  | "3-state"
  | "Open_drain"
  | "Open_sink"
  | "Open_source"
  | "Input_ECL"
  | "Output_ECL"
  | "I/O_ECL"
  | "Series"
  | "Terminator";

/**
 * Buffer model declaration in [Model] section.
 */
export interface IbisModel {
  name: string;
  modelType: IbisModelType;
  polarity?: "Non-Inverting" | "Inverting" | undefined;
  enable?: "Active-High" | "Active-Low" | undefined;
  vinl?: number | undefined;
  vinh?: number | undefined;
  vmeas?: number | undefined;
  cref?: number | undefined;
  rref?: number | undefined;
  vref?: number | undefined;
  cComp: Triplet;
  voltageRange: Triplet;
  temperatureRange?: Triplet | undefined;
  pullup?: TableRow[] | undefined;
  pulldown?: TableRow[] | undefined;
  gndClamp?: TableRow[] | undefined;
  powerClamp?: TableRow[] | undefined;
  ramp?: IbisRamp | undefined;
  risingWaveforms?: IbisWaveform[] | undefined;
  fallingWaveforms?: IbisWaveform[] | undefined;
  line: number;
}

/**
 * Component declaration in [Component] section.
 */
export interface IbisComponent {
  name: string;
  manufacturer?: string | undefined;
  package: IbisPackage;
  pins: Map<string, IbisPin>;
  line: number;
}

/**
 * Complete parsed IBIS document AST.
 */
export interface IbisDeck {
  ibisVer: string;
  fileName?: string | undefined;
  fileRev?: string | undefined;
  date?: string | undefined;
  source?: string | undefined;
  notes?: string | undefined;
  disclaimer?: string | undefined;
  components: Map<string, IbisComponent>;
  models: Map<string, IbisModel>;
  comments: string[];
  sourceFile?: string | undefined;
}
