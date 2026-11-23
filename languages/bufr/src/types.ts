// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core TypeScript data structures for WMO BUFR (FM 94 BUFR, Editions 3 & 4).
 */

export interface BufrDescriptor {
  /** F: 0 = Table B element, 1 = Replication, 2 = Table C operator, 3 = Table D sequence */
  f: number;
  /** X: Class / category (0..63) */
  x: number;
  /** Y: Element / count / operator operand (0..255) */
  y: number;
  /** Canonical F-XX-YYY string representation, e.g. "0-12-101" */
  code: string;
  /** 1-based source line number if parsed from text */
  line?: number | undefined;
  /** 0-based byte/char start offset if parsed from text */
  startOffset?: number | undefined;
  /** 0-based byte/char end offset if parsed from text */
  endOffset?: number | undefined;
}

export interface BufrTableBEntry {
  code: string;
  f: 0;
  x: number;
  y: number;
  name: string;
  unit: string;
  scale: number;
  referenceValue: number;
  bitWidth: number;
  isString?: boolean | undefined;
  minPhysical?: number | undefined;
  maxPhysical?: number | undefined;
  category?: string | undefined;
}

export interface BufrTableDEntry {
  code: string;
  f: 3;
  x: number;
  y: number;
  name: string;
  descriptors: string[];
  category?: string | undefined;
}

export interface BufrSection0 {
  magic: string;
  totalLength: number;
  edition: 3 | 4;
  line?: number | undefined;
}

export interface BufrSection1 {
  masterTable: number;
  originatingCentre: number;
  originatingSubCentre: number;
  updateSequence: number;
  optionalSection: boolean;
  dataCategory: number;
  internationalSubCategory: number;
  localSubCategory: number;
  masterTableVersion: number;
  localTableVersion: number;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  line?: number | undefined;
}

export interface BufrSection3 {
  subsetCount: number;
  isObserved: boolean;
  isCompressed: boolean;
  descriptors: BufrDescriptor[];
  line?: number | undefined;
}

export interface BufrObservationValue {
  descriptor: string;
  name?: string | undefined;
  value: number | string | null;
  unit?: string | undefined;
  line?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface BufrSubset {
  index: number;
  label?: string | undefined;
  values: BufrObservationValue[];
  line?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface BufrMessage {
  name: string;
  section0: BufrSection0;
  section1: BufrSection1;
  section3: BufrSection3;
  subsets: BufrSubset[];
  customTableB: Map<string, BufrTableBEntry>;
  customTableD: Map<string, BufrTableDEntry>;
  hasEndMarker: boolean;
  hasMagicHeader: boolean;
  syntaxErrors: Array<{ message: string; line: number; column: number }>;
  rawText?: string | undefined;
}

export interface BufrExpandedElement {
  descriptor: BufrDescriptor;
  tableB?: BufrTableBEntry | undefined;
  effectiveScale: number;
  effectiveReferenceValue: number;
  effectiveBitWidth: number;
  sequencePath: string[];
  replicationIndex?: number | undefined;
  isDelayedReplicationCount?: boolean | undefined;
}

export interface BufrSoundingLevel {
  pressurePa: number;
  altitudeM: number;
  temperatureK: number;
  dewpointK?: number | undefined;
  relativeHumidityPct?: number | undefined;
  windDirectionDeg?: number | undefined;
  windSpeedMs?: number | undefined;
  isaAltitudeM: number;
  hypsometricAltitudeM?: number | undefined;
  virtualTemperatureK: number;
  potentialTemperatureK: number;
  mixingRatioKgKg?: number | undefined;
}

export interface BufrStationSummary {
  stationId: string;
  latitude?: number | undefined;
  longitude?: number | undefined;
  elevationM?: number | undefined;
  timestampIso: string;
  surfacePressurePa?: number | undefined;
  seaLevelPressurePa?: number | undefined;
  temperatureK?: number | undefined;
  dewpointK?: number | undefined;
  relativeHumidityPct?: number | undefined;
  windDirectionDeg?: number | undefined;
  windSpeedMs?: number | undefined;
  precipitationMm?: number | undefined;
}
