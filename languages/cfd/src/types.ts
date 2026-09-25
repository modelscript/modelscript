export interface BoundaryActionPayload {
  kind: "fix" | "force" | "inlet" | "outlet" | "wall" | "heatflux" | "isothermal";
  targetId: number | string;
  dofs?: number[];
  magnitude?: number;
  vector?: [number, number, number];
  temperature?: number;
}

export interface CfdMarker {
  name: string;
  type: string; // e.g. "INLET", "OUTLET", "HEATFLUX", "ISOTHERMAL", "EULER", "WALL"
  options: (string | number)[];
}

export interface CfdModelData {
  dialect: string;
  mathProblem?: string;
  machNumber?: number;
  aoa?: number;
  reynoldsNumber?: number;
  freestreamVelocity?: number;
  inletVelocity?: [number, number, number];
  density?: number;
  viscosity?: number;
  inletMarker?: string;
  outletMarker?: string;
  wallMarkers: string[];
  meshFilename?: string;
  directives: Map<string, string>;
  rawDirectives: Map<string, string>;
  markers: Map<string, CfdMarker>;
}

export type ParameterLookup = (name: string) => number | string | undefined;

export interface MaterializeOptions {
  evaluator?: ParameterLookup | Record<string, number | string>;
  formatNumber?: (val: number) => string;
}

export interface CfdDialect {
  readonly id: string;
  readonly name: string;
  readonly extensions: string[];
  parse(content: string): CfdModelData;
  materialize(templateText: string, options?: MaterializeOptions): string;
}
