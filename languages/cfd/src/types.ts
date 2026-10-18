// SPDX-License-Identifier: AGPL-3.0-or-later

export interface BoundaryActionPayload {
  kind: "fix" | "force" | "inlet" | "outlet" | "wall" | "heatflux" | "isothermal";
  targetId: number | string;
  dofs?: number[] | undefined;
  magnitude?: number | undefined;
  vector?: [number, number, number] | undefined;
  temperature?: number | undefined;
}

export interface CfdMarker {
  name: string;
  type: string; // e.g. "INLET", "OUTLET", "HEATFLUX", "ISOTHERMAL", "EULER", "WALL"
  options: (string | number)[];
}

export interface CaeDiagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  line?: number | undefined;
  column?: number | undefined;
  expression?: string | undefined;
}

export interface CfdModelData {
  dialect: string;
  mathProblem?: string | undefined;
  machNumber?: number | undefined;
  aoa?: number | undefined;
  reynoldsNumber?: number | undefined;
  freestreamVelocity?: number | undefined;
  inletVelocity?: [number, number, number] | undefined;
  density?: number | undefined;
  viscosity?: number | undefined;
  inletMarker?: string | undefined;
  outletMarker?: string | undefined;
  inletMarkers: string[];
  outletMarkers: string[];
  wallMarkers: string[];
  meshFilename?: string | undefined;
  directives: Map<string, string>;
  rawDirectives: Map<string, string>;
  markers: Map<string, CfdMarker>;
}

export type ParameterLookup = (name: string) => number | string | undefined;

export interface MaterializeOptions {
  evaluator?: ParameterLookup | Record<string, number | string> | undefined;
  formatNumber?: ((val: number) => string) | undefined;
  diagnostics?: CaeDiagnostic[] | undefined;
}

export interface CfdDialect {
  readonly id: string;
  readonly name: string;
  readonly extensions: string[];
  parse(content: string): CfdModelData;
  materialize(templateText: string, options?: MaterializeOptions): string;
}
