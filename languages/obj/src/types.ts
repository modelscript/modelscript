// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/obj — Core Wavefront OBJ & MTL data types.
 */

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type RgbColor = readonly [number, number, number];

/** Geometric vertex (`v x y z [w]`). */
export interface ObjVertex {
  x: number;
  y: number;
  z: number;
  w?: number | undefined;
  line: number;
}

/** Texture coordinate (`vt u [v] [w]`). */
export interface ObjTexCoord {
  u: number;
  v?: number | undefined;
  w?: number | undefined;
  line: number;
}

/** Vertex normal (`vn nx ny nz`). */
export interface ObjNormal {
  nx: number;
  ny: number;
  nz: number;
  line: number;
}

/** Parameter-space vertex (`vp u [v] [w]`). */
export interface ObjParamVertex {
  u: number;
  v?: number | undefined;
  w?: number | undefined;
  line: number;
}

/**
 * A single vertex reference in a face (`f v[/vt][/vn]`).
 *
 * `v`, `vt`, `vn` are resolved 0-based indices (or `-1` if invalid/out-of-range).
 * `rawV`, `rawVt`, `rawVn` preserve the original 1-based positive or negative relative indices.
 */
export interface ObjFaceVertexRef {
  v: number;
  vt?: number | undefined;
  vn?: number | undefined;
  rawV: number;
  rawVt?: number | undefined;
  rawVn?: number | undefined;
}

/** Polygonal face element (`f ...`). */
export interface ObjFace {
  vertices: ObjFaceVertexRef[];
  objectName: string;
  groupNames: string[];
  materialName?: string | undefined;
  smoothingGroup: number | null;
  /** Running counts of v/vt/vn at the time this face was parsed (for diagnostic verification). */
  vertexCountAtFace: number;
  texCoordCountAtFace: number;
  normalCountAtFace: number;
  line: number;
  startOffset: number;
  endOffset: number;
}

/** Polyline element (`l v1[/vt1] v2[/vt2] ...`). */
export interface ObjPolyline {
  vertices: Array<{
    v: number;
    vt?: number | undefined;
    rawV: number;
    rawVt?: number | undefined;
  }>;
  objectName: string;
  groupNames: string[];
  line: number;
}

/** Point cloud element (`p v1 v2 ...`). */
export interface ObjPointSet {
  vertices: Array<{
    v: number;
    rawV: number;
  }>;
  objectName: string;
  groupNames: string[];
  line: number;
}

/** Named object declaration (`o <name>`). */
export interface ObjObject {
  name: string;
  line: number;
  startOffset: number;
  endOffset: number;
  faceIndices: number[];
}

/** Named group declaration (`g <name1> [name2 ...]`). */
export interface ObjGroup {
  name: string;
  line: number;
  startOffset: number;
  endOffset: number;
  faceIndices: number[];
}

/** Material usage reference (`usemtl <name>`). */
export interface ObjMaterialUsage {
  name: string;
  line: number;
  startOffset: number;
  endOffset: number;
}

/** Parse error captured during non-throwing OBJ/MTL ingestion. */
export interface ObjParseError {
  line: number;
  column: number;
  message: string;
  raw: string;
}

/** Wavefront MTL material definition (`newmtl <name>`). */
export interface MtlMaterial {
  name: string;
  /** Ambient reflectivity RGB in [0, 1]. */
  Ka?: RgbColor | undefined;
  /** Diffuse reflectivity RGB in [0, 1]. */
  Kd?: RgbColor | undefined;
  /** Specular reflectivity RGB in [0, 1]. */
  Ks?: RgbColor | undefined;
  /** Emissive color RGB in [0, 1]. */
  Ke?: RgbColor | undefined;
  /** Specular exponent (shininess, typically 0..1000). */
  Ns?: number | undefined;
  /** Dissolve / opacity (1.0 = opaque, 0.0 = transparent). */
  d?: number | undefined;
  /** Transparency (0.0 = opaque, 1.0 = transparent; Tr = 1 - d). */
  Tr?: number | undefined;
  /** Optical density / index of refraction (typically 1.0..3.0). */
  Ni?: number | undefined;
  /** Illumination model (0..10). */
  illum?: number | undefined;
  /** Optional diffuse texture map path. */
  mapKd?: string | undefined;
  /** Optional ambient texture map path. */
  mapKa?: string | undefined;
  /** Optional specular texture map path. */
  mapKs?: string | undefined;
  /** Optional bump map path. */
  mapBump?: string | undefined;
  /** Source line of each color property for accurate diagnostics. */
  propertyLines: Record<string, number>;
  line: number;
  startOffset: number;
  endOffset: number;
}

/** Parsed Wavefront MTL document. */
export interface MtlDocument {
  materials: Map<string, MtlMaterial>;
  errors: ObjParseError[];
  rawLines: string[];
}

/** Parsed Wavefront OBJ document. */
export interface ObjDocument {
  vertices: ObjVertex[];
  texCoords: ObjTexCoord[];
  normals: ObjNormal[];
  paramVertices: ObjParamVertex[];
  faces: ObjFace[];
  polylines: ObjPolyline[];
  points: ObjPointSet[];
  objects: ObjObject[];
  groups: ObjGroup[];
  mtlLibs: string[];
  usedMaterials: ObjMaterialUsage[];
  /** Optional attached MTL materials map (populated by `parseObjWithMtl` or caller). */
  materials?: Map<string, MtlMaterial> | undefined;
  errors: ObjParseError[];
  rawLines: string[];
}
