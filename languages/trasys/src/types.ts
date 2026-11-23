// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core domain types for NASA TRASYS (Thermal Radiation Analyzer System).
 */

export const STEFAN_BOLTZMANN = 5.670374419e-8; // W / (m^2 * K^4)
export const DEEP_SPACE_TEMP_K = 2.725; // Cosmic microwave background (K)

export type TrasysSurfaceKind = "RECTANGLE" | "DISK" | "CYLINDER" | "CONE" | "SPHERE" | "PARABOLOID" | "POLYGON";

export type TrasysActiveSide = "TOP" | "BOTTOM" | "BOTH" | "NONE";

export interface TrasysTransform {
  tx: number;
  ty: number;
  tz: number;
  /** Rotation about X axis in degrees. */
  rotx: number;
  /** Rotation about Y axis in degrees. */
  roty: number;
  /** Rotation about Z axis in degrees. */
  rotz: number;
}

export interface TrasysOpticalProp {
  /** Optional coating name (e.g. WHITE_PAINT_Z93, SILVER_TEFLON). */
  name?: string | undefined;
  /** Solar absorptance alpha_s in [0, 1]. */
  alpha: number;
  /** Infrared hemispherical emissivity epsilon_IR in [0, 1]. */
  epsilon: number;
  /** Transmissivity tau in [0, 1] (default 0). */
  transmissivity?: number | undefined;
  /** Specularity fraction rho_s in [0, 1] (default 0). */
  specularity?: number | undefined;
}

export interface TrasysSurface {
  id: string;
  name?: string | undefined;
  kind: TrasysSurfaceKind;
  /** Thermal node number for SINDA / DAE coupling. */
  nodeId?: number | undefined;
  prop: TrasysOpticalProp;
  active: TrasysActiveSide;
  /** Whether the surface participates in shading / shadowing. */
  shade: boolean;
  /** Primitive dimensions (e.g., width, height, radius, radiusTop, length, focalLength). */
  dims: Record<string, number>;
  /** 3D vertices for POLYGON primitives. */
  vertices?: Array<[number, number, number]> | undefined;
  transform: TrasysTransform;
  /** Optional initial or boundary temperature (K). */
  temperatureK?: number | undefined;
  /** Optional internal heat dissipation (W). */
  internalHeatW?: number | undefined;
  /** Source location metadata. */
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  line?: number | undefined;
}

export interface TrasysOrbit {
  planet: string;
  /** Orbit altitude above planet surface (km). */
  altitudeKm: number;
  /** Solar beta angle (degrees, -90 to +90). */
  betaDeg: number;
  /** Solar constant S (W/m^2), default 1361.0 for Earth. */
  solarFlux: number;
  /** Planetary bond albedo a in [0, 1], default 0.30 for Earth. */
  albedo: number;
  /** Planet emitted infrared flux q_IR (W/m^2), default 237.0 for Earth. */
  planetIr: number;
  /** Planet mean radius (km), inferred from planet name if omitted. */
  planetRadiusKm?: number | undefined;
  line?: number | undefined;
}

export type TrasysOperationKind = "FFCAL" | "RKCAL" | "QCAL";

export interface TrasysOperation {
  kind: TrasysOperationKind;
  args: Record<string, number | string | boolean>;
  line?: number | undefined;
}

export interface TrasysOptions {
  title?: string | undefined;
  units: "SI" | "ENG";
  stefanBoltzmann: number;
  rays: number;
  model?: string | undefined;
  raw: Record<string, string | number>;
}

export interface TrasysParseError {
  message: string;
  line: number;
  column: number;
}

export interface TrasysDeck {
  name: string;
  options: TrasysOptions;
  surfaces: TrasysSurface[];
  orbit?: TrasysOrbit | undefined;
  operations: TrasysOperation[];
  hasEndOfData: boolean;
  parseErrors: TrasysParseError[];
}

export interface TrasysDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line?: number | undefined;
  column?: number | undefined;
  surfaceId?: string | undefined;
}
