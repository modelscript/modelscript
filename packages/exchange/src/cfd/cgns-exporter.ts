// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CGNS/SIDS (CFD General Notation System / Standard Interface Data Structures) JSON Exporter
 * and Tree Validator.
 *
 * Generates a SIDS-compliant hierarchical database object (`CGNSTree_t` -> `CGNSBase_t` ->
 * `Zone_t` -> `GridCoordinates_t`, `Elements_t`, `FlowSolution_t`, `ZoneBC_t`/`BC_t`,
 * `Descriptor_t`) with binary Base64 or TypedArray field serialization and V&V provenance metadata.
 */

export type CgnsNodeLabel =
  | "CGNSTree_t"
  | "CGNSLibraryVersion_t"
  | "CGNSBase_t"
  | "Zone_t"
  | "ZoneType_t"
  | "GridCoordinates_t"
  | "Elements_t"
  | "FlowSolution_t"
  | "GridLocation_t"
  | "ZoneBC_t"
  | "BC_t"
  | "IndexRange_t"
  | "IndexArray_t"
  | "DataArray_t"
  | "Descriptor_t"
  | "DataClass_t"
  | "DimensionalUnits_t";

export type CgnsDataType = "MT" | "C1" | "I4" | "I8" | "R4" | "R8";

export type CgnsZoneType = "Structured" | "Unstructured";

export type CgnsGridLocation =
  "Vertex" | "CellCenter" | "EdgeCenter" | "FaceCenter" | "IFaceCenter" | "JFaceCenter" | "KFaceCenter";

export type CgnsBcType =
  | "BCInflow"
  | "BCInflowSubsonic"
  | "BCInflowSupersonic"
  | "BCOutflow"
  | "BCOutflowSubsonic"
  | "BCOutflowSupersonic"
  | "BCWall"
  | "BCWallInviscid"
  | "BCWallViscous"
  | "BCWallViscousHeatFlux"
  | "BCWallViscousIsothermal"
  | "BCSymmetryPlane"
  | "BCFarfield"
  | "BCExtrapolate"
  | "BCGeneral"
  | "UserDefined";

export type CgnsElementType = "BAR_2" | "TRI_3" | "QUAD_4" | "TETRA_4" | "PYRA_5" | "PENTA_6" | "HEXA_8";

export type CgnsFieldEncoding = "base64" | "typed-array" | "inline";

export type NumericArrayLike = Float32Array | Float64Array | Int32Array | Uint32Array | number[];

export interface CgnsNode {
  name: string;
  label: CgnsNodeLabel;
  dataType: CgnsDataType;
  dimensions: number[];
  encoding?: CgnsFieldEncoding;
  data?: string | number | number[] | Float32Array | Float64Array | Int32Array | Uint32Array;
  children: CgnsNode[];
}

export interface CgnsBoundaryConditionSpec {
  name: string;
  type: CgnsBcType;
  gridLocation?: CgnsGridLocation;
  /** Structured index range [iMin, jMin, kMin, iMax, jMax, kMax] (1-based per CGNS/SIDS). */
  pointRange?: number[];
  /** Unstructured or general 1-based vertex/face index list. */
  pointList?: Int32Array | number[];
  /** Optional BC descriptor text. */
  description?: string;
}

export interface CgnsElementSectionSpec {
  name: string;
  elementType: CgnsElementType;
  /** 1-based inclusive element index range [start, end]. */
  elementRange: [number, number];
  /** 1-based vertex connectivity array. */
  connectivity: Int32Array | Uint32Array | number[];
}

export interface CgnsFlowSolutionSpec {
  name?: string;
  gridLocation?: CgnsGridLocation;
  fields: Record<string, NumericArrayLike>;
}

export interface CgnsZoneSpec {
  name: string;
  zoneType: CgnsZoneType;
  /**
   * For Structured zones: vertex counts [ni, nj, nk] (or [ni, nj]).
   * For Unstructured zones: [numVertices, numElements, numBoundaryVertices?].
   */
  vertexDimensions: number[];
  /** Explicit coordinate arrays (CoordinateX, CoordinateY, optional CoordinateZ). */
  coordinates?: {
    x: NumericArrayLike;
    y: NumericArrayLike;
    z?: NumericArrayLike;
  };
  /** Convenience uniform grid generator for Structured zones when `coordinates` is omitted. */
  uniformSpacing?: {
    dx: number;
    dy?: number;
    dz?: number;
    origin?: [number, number, number];
  };
  /** Unstructured element connectivity sections. */
  elements?: CgnsElementSectionSpec[];
  /** One or more FlowSolution_t datasets. */
  flowSolutions?: CgnsFlowSolutionSpec[];
  /** Boundary conditions under ZoneBC_t. */
  boundaryConditions?: CgnsBoundaryConditionSpec[];
}

export interface CgnsProvenanceSpec {
  solver?: string;
  solverVersion?: string;
  caseName?: string;
  timestamp?: string;
  turbulenceModel?: string;
  reynoldsNumber?: number;
  machNumber?: number;
  vvStatus?: string;
  vvMetrics?: Record<string, number | string | boolean>;
  extraDescriptors?: Record<string, string>;
}

export interface CgnsExportSpec {
  baseName?: string;
  cellDimension?: 1 | 2 | 3;
  physicalDimension?: 1 | 2 | 3;
  libraryVersion?: number;
  /** Field serialization format (default: "base64"). */
  encoding?: CgnsFieldEncoding;
  /** Numeric precision for floating-point DataArray_t nodes (default: "R8"). */
  floatPrecision?: "R4" | "R8";
  /** V&V provenance metadata serialized as Descriptor_t children under CGNSBase_t. */
  provenance?: CgnsProvenanceSpec;
  zones: CgnsZoneSpec[];
}

export interface CgnsValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    baseCount: number;
    zoneCount: number;
    fieldCount: number;
    bcCount: number;
    descriptorCount: number;
  };
}

// ============================================================================
// Binary Base64 / TypedArray serialization helpers
// ============================================================================

const VALID_BC_TYPES = new Set<string>([
  "BCInflow",
  "BCInflowSubsonic",
  "BCInflowSupersonic",
  "BCOutflow",
  "BCOutflowSubsonic",
  "BCOutflowSupersonic",
  "BCWall",
  "BCWallInviscid",
  "BCWallViscous",
  "BCWallViscousHeatFlux",
  "BCWallViscousIsothermal",
  "BCSymmetryPlane",
  "BCFarfield",
  "BCExtrapolate",
  "BCGeneral",
  "UserDefined",
]);

function bytesPerElement(dataType: CgnsDataType): number {
  switch (dataType) {
    case "R8":
    case "I8":
      return 8;
    case "R4":
    case "I4":
      return 4;
    case "C1":
      return 1;
    case "MT":
      return 0;
  }
}

function toTypedArray(arr: NumericArrayLike, dataType: "R4" | "R8" | "I4"): Float32Array | Float64Array | Int32Array {
  if (dataType === "R8") {
    return arr instanceof Float64Array ? arr : Float64Array.from(arr);
  }
  if (dataType === "R4") {
    return arr instanceof Float32Array ? arr : Float32Array.from(arr);
  }
  return arr instanceof Int32Array ? arr : Int32Array.from(arr);
}

function encodeTypedArrayBase64(typed: ArrayBufferView): string {
  const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/** Decode a Base64-encoded or typed-array CGNS `DataArray_t` node back into a TypedArray. */
export function decodeCgnsDataArray(node: CgnsNode): Float64Array | Float32Array | Int32Array | null {
  if (node.data === undefined || node.dataType === "MT" || node.dataType === "C1") {
    return null;
  }
  if (node.data instanceof Float64Array || node.data instanceof Float32Array || node.data instanceof Int32Array) {
    return node.data;
  }
  if (Array.isArray(node.data)) {
    if (node.dataType === "R8") return Float64Array.from(node.data);
    if (node.dataType === "R4") return Float32Array.from(node.data);
    if (node.dataType === "I4") return Int32Array.from(node.data);
    return null;
  }
  if (typeof node.data === "string" && node.encoding === "base64") {
    const buf =
      typeof Buffer !== "undefined"
        ? Buffer.from(node.data, "base64")
        : Uint8Array.from(atob(node.data), (c) => c.charCodeAt(0));
    const aligned = new Uint8Array(buf.byteLength);
    aligned.set(buf);
    if (node.dataType === "R8") {
      return new Float64Array(aligned.buffer, 0, Math.floor(aligned.byteLength / 8));
    }
    if (node.dataType === "R4") {
      return new Float32Array(aligned.buffer, 0, Math.floor(aligned.byteLength / 4));
    }
    if (node.dataType === "I4") {
      return new Int32Array(aligned.buffer, 0, Math.floor(aligned.byteLength / 4));
    }
  }
  return null;
}

function createDataArrayNode(
  name: string,
  values: NumericArrayLike,
  dimensions: number[],
  dataType: "R4" | "R8" | "I4",
  encoding: CgnsFieldEncoding,
): CgnsNode {
  const typed = toTypedArray(values, dataType);
  if (encoding === "base64") {
    return {
      name,
      label: "DataArray_t",
      dataType,
      dimensions,
      encoding: "base64",
      data: encodeTypedArrayBase64(typed),
      children: [],
    };
  }
  if (encoding === "typed-array") {
    return {
      name,
      label: "DataArray_t",
      dataType,
      dimensions,
      encoding: "typed-array",
      data: typed,
      children: [],
    };
  }
  return {
    name,
    label: "DataArray_t",
    dataType,
    dimensions,
    encoding: "inline",
    data: Array.from(typed),
    children: [],
  };
}

function createDescriptorNode(name: string, text: string): CgnsNode {
  return {
    name,
    label: "Descriptor_t",
    dataType: "C1",
    dimensions: [text.length],
    encoding: "inline",
    data: text,
    children: [],
  };
}

function generateUniformCoordinates(
  dims: number[],
  spacing: NonNullable<CgnsZoneSpec["uniformSpacing"]>,
): { x: Float64Array; y: Float64Array; z?: Float64Array } {
  const ni = dims[0] ?? 1;
  const nj = dims[1] ?? 1;
  const nk = dims[2] ?? 1;
  const dx = spacing.dx;
  const dy = spacing.dy ?? dx;
  const dz = spacing.dz ?? dx;
  const [ox, oy, oz] = spacing.origin ?? [0, 0, 0];

  const n = ni * nj * nk;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = dims.length >= 3 ? new Float64Array(n) : undefined;

  for (let k = 0; k < nk; k++) {
    for (let j = 0; j < nj; j++) {
      for (let i = 0; i < ni; i++) {
        const idx = (k * nj + j) * ni + i;
        x[idx] = ox + i * dx;
        y[idx] = oy + j * dy;
        if (z) z[idx] = oz + k * dz;
      }
    }
  }
  return z ? { x, y, z } : { x, y };
}

// ============================================================================
// CGNS/SIDS Exporter
// ============================================================================

/**
 * Export a structured or unstructured CFD dataset into a CGNS/SIDS-compliant JSON tree object.
 */
export function exportToCgnsJson(spec: CgnsExportSpec): CgnsNode {
  const baseName = spec.baseName ?? "Base";
  const cellDim = spec.cellDimension ?? 3;
  const physDim = spec.physicalDimension ?? 3;
  const libVersion = spec.libraryVersion ?? 4.4;
  const encoding: CgnsFieldEncoding = spec.encoding ?? "base64";
  const floatType: "R4" | "R8" = spec.floatPrecision ?? "R8";

  const baseChildren: CgnsNode[] = [];

  // 1. V&V Provenance Descriptor_t nodes
  const prov = spec.provenance;
  if (prov) {
    const provenanceSummary = JSON.stringify({
      solver: prov.solver ?? "ModelScript-CFD",
      solverVersion: prov.solverVersion ?? "1.0.0",
      caseName: prov.caseName ?? baseName,
      timestamp: prov.timestamp ?? new Date().toISOString(),
      ...(prov.turbulenceModel ? { turbulenceModel: prov.turbulenceModel } : {}),
      ...(prov.reynoldsNumber !== undefined ? { reynoldsNumber: prov.reynoldsNumber } : {}),
      ...(prov.machNumber !== undefined ? { machNumber: prov.machNumber } : {}),
      ...(prov.vvStatus ? { vvStatus: prov.vvStatus } : {}),
      ...(prov.vvMetrics ? { vvMetrics: prov.vvMetrics } : {}),
    });
    baseChildren.push(createDescriptorNode("SimulationProvenance", provenanceSummary));
    if (prov.extraDescriptors) {
      for (const [k, v] of Object.entries(prov.extraDescriptors)) {
        baseChildren.push(createDescriptorNode(k, v));
      }
    }
  } else {
    baseChildren.push(
      createDescriptorNode(
        "SimulationProvenance",
        JSON.stringify({
          solver: "ModelScript-CFD",
          timestamp: new Date().toISOString(),
        }),
      ),
    );
  }

  // 2. Zone_t nodes
  for (const zoneSpec of spec.zones) {
    const zoneChildren: CgnsNode[] = [];

    // Zone dimensions per CGNS/SIDS:
    // Structured (cellDim x 3): [vertexSize, cellSize, boundaryVertexSize]
    // Unstructured (1 x 3): [numVertices, numElements, numBoundaryVertices]
    let zoneSizeData: number[];
    let zoneSizeDims: number[];
    if (zoneSpec.zoneType === "Structured") {
      const verts = zoneSpec.vertexDimensions.slice(0, cellDim);
      const cells = verts.map((v) => Math.max(1, v - 1));
      const bnd = verts.map(() => 0);
      zoneSizeData = [...verts, ...cells, ...bnd];
      zoneSizeDims = [cellDim, 3];
    } else {
      const numVerts = zoneSpec.vertexDimensions[0] ?? 0;
      const numElems = zoneSpec.vertexDimensions[1] ?? 0;
      const numBnd = zoneSpec.vertexDimensions[2] ?? 0;
      zoneSizeData = [numVerts, numElems, numBnd];
      zoneSizeDims = [1, 3];
    }

    // ZoneType_t
    zoneChildren.push({
      name: "ZoneType",
      label: "ZoneType_t",
      dataType: "C1",
      dimensions: [zoneSpec.zoneType.length],
      encoding: "inline",
      data: zoneSpec.zoneType,
      children: [],
    });

    // GridCoordinates_t
    const coords =
      zoneSpec.coordinates ??
      (zoneSpec.zoneType === "Structured" && zoneSpec.uniformSpacing
        ? generateUniformCoordinates(zoneSpec.vertexDimensions, zoneSpec.uniformSpacing)
        : undefined);

    if (coords) {
      const coordDims =
        zoneSpec.zoneType === "Structured" ? zoneSpec.vertexDimensions.slice(0, cellDim) : [coords.x.length];
      const gridCoordChildren: CgnsNode[] = [
        createDataArrayNode("CoordinateX", coords.x, coordDims, floatType, encoding),
        createDataArrayNode("CoordinateY", coords.y, coordDims, floatType, encoding),
      ];
      if (coords.z) {
        gridCoordChildren.push(createDataArrayNode("CoordinateZ", coords.z, coordDims, floatType, encoding));
      }
      zoneChildren.push({
        name: "GridCoordinates",
        label: "GridCoordinates_t",
        dataType: "MT",
        dimensions: [],
        children: gridCoordChildren,
      });
    }

    // Elements_t (unstructured connectivity)
    if (zoneSpec.elements && zoneSpec.elements.length > 0) {
      for (const elem of zoneSpec.elements) {
        zoneChildren.push({
          name: elem.name,
          label: "Elements_t",
          dataType: "I4",
          dimensions: [2],
          encoding: "inline",
          data: [elementTypeCode(elem.elementType), 0],
          children: [
            {
              name: "ElementRange",
              label: "IndexRange_t",
              dataType: "I4",
              dimensions: [2],
              encoding: "inline",
              data: [elem.elementRange[0], elem.elementRange[1]],
              children: [],
            },
            createDataArrayNode("ElementConnectivity", elem.connectivity, [elem.connectivity.length], "I4", encoding),
          ],
        });
      }
    }

    // FlowSolution_t nodes
    if (zoneSpec.flowSolutions && zoneSpec.flowSolutions.length > 0) {
      for (let fsIdx = 0; fsIdx < zoneSpec.flowSolutions.length; fsIdx++) {
        const fs = zoneSpec.flowSolutions[fsIdx]!;
        const location: CgnsGridLocation = fs.gridLocation ?? "Vertex";
        const fsChildren: CgnsNode[] = [
          {
            name: "GridLocation",
            label: "GridLocation_t",
            dataType: "C1",
            dimensions: [location.length],
            encoding: "inline",
            data: location,
            children: [],
          },
        ];

        const fieldDims =
          zoneSpec.zoneType === "Structured"
            ? location === "CellCenter"
              ? zoneSpec.vertexDimensions.slice(0, cellDim).map((v) => Math.max(1, v - 1))
              : zoneSpec.vertexDimensions.slice(0, cellDim)
            : undefined;

        for (const [fieldName, values] of Object.entries(fs.fields)) {
          const dims = fieldDims ?? [values.length];
          fsChildren.push(createDataArrayNode(fieldName, values, dims, floatType, encoding));
        }

        zoneChildren.push({
          name: fs.name ?? (fsIdx === 0 ? "FlowSolution" : `FlowSolution_${fsIdx + 1}`),
          label: "FlowSolution_t",
          dataType: "MT",
          dimensions: [],
          children: fsChildren,
        });
      }
    }

    // ZoneBC_t & BC_t nodes
    if (zoneSpec.boundaryConditions && zoneSpec.boundaryConditions.length > 0) {
      const bcNodes: CgnsNode[] = [];
      for (const bc of zoneSpec.boundaryConditions) {
        const bcChildren: CgnsNode[] = [];
        if (bc.gridLocation) {
          bcChildren.push({
            name: "GridLocation",
            label: "GridLocation_t",
            dataType: "C1",
            dimensions: [bc.gridLocation.length],
            encoding: "inline",
            data: bc.gridLocation,
            children: [],
          });
        }
        if (bc.pointRange) {
          bcChildren.push({
            name: "PointRange",
            label: "IndexRange_t",
            dataType: "I4",
            dimensions: [Math.floor(bc.pointRange.length / 2), 2],
            encoding: "inline",
            data: [...bc.pointRange],
            children: [],
          });
        }
        if (bc.pointList) {
          const listTyped = toTypedArray(bc.pointList, "I4");
          bcChildren.push({
            name: "PointList",
            label: "IndexArray_t",
            dataType: "I4",
            dimensions: [1, listTyped.length],
            encoding: encoding === "typed-array" ? "typed-array" : "inline",
            data: encoding === "typed-array" ? listTyped : Array.from(listTyped),
            children: [],
          });
        }
        if (bc.description) {
          bcChildren.push(createDescriptorNode("BCDescription", bc.description));
        }

        bcNodes.push({
          name: bc.name,
          label: "BC_t",
          dataType: "C1",
          dimensions: [bc.type.length],
          encoding: "inline",
          data: bc.type,
          children: bcChildren,
        });
      }

      zoneChildren.push({
        name: "ZoneBC",
        label: "ZoneBC_t",
        dataType: "MT",
        dimensions: [],
        children: bcNodes,
      });
    }

    baseChildren.push({
      name: zoneSpec.name,
      label: "Zone_t",
      dataType: "I4",
      dimensions: zoneSizeDims,
      encoding: "inline",
      data: zoneSizeData,
      children: zoneChildren,
    });
  }

  return {
    name: "CGNSTree",
    label: "CGNSTree_t",
    dataType: "MT",
    dimensions: [],
    children: [
      {
        name: "CGNSLibraryVersion",
        label: "CGNSLibraryVersion_t",
        dataType: "R4",
        dimensions: [1],
        encoding: "inline",
        data: libVersion,
        children: [],
      },
      {
        name: baseName,
        label: "CGNSBase_t",
        dataType: "I4",
        dimensions: [2],
        encoding: "inline",
        data: [cellDim, physDim],
        children: baseChildren,
      },
    ],
  };
}

function elementTypeCode(t: CgnsElementType): number {
  switch (t) {
    case "BAR_2":
      return 3;
    case "TRI_3":
      return 5;
    case "QUAD_4":
      return 7;
    case "TETRA_4":
      return 10;
    case "PYRA_5":
      return 12;
    case "PENTA_6":
      return 14;
    case "HEXA_8":
      return 17;
  }
}

// ============================================================================
// CGNS/SIDS Tree Validator
// ============================================================================

/**
 * Validate a CGNS/SIDS JSON tree structure, checking SIDS node labels, dimensions,
 * unique sibling names, binary Base64/TypedArray payload integrity, and BC/Grid/Solution rules.
 */
export function validateCgnsTree(tree: CgnsNode): CgnsValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stats = {
    baseCount: 0,
    zoneCount: 0,
    fieldCount: 0,
    bcCount: 0,
    descriptorCount: 0,
  };

  if (!tree || typeof tree !== "object") {
    return {
      valid: false,
      errors: ["Root CGNS tree must be a non-null object."],
      warnings,
      stats,
    };
  }

  if (tree.label !== "CGNSTree_t") {
    errors.push(`Root node must have label 'CGNSTree_t' (got '${tree.label}').`);
  }

  // Recursive check for duplicate sibling names & count Descriptor_t nodes
  const checkUniqueChildren = (node: CgnsNode, path: string): void => {
    const seen = new Set<string>();
    if (!Array.isArray(node.children)) {
      errors.push(`${path}: children must be an array.`);
      return;
    }
    for (const child of node.children) {
      if (!child.name || typeof child.name !== "string") {
        errors.push(`${path}: child node is missing a valid name.`);
        continue;
      }
      if (seen.has(child.name)) {
        errors.push(`${path}: duplicate sibling node name '${child.name}'.`);
      }
      seen.add(child.name);
      if (child.label === "Descriptor_t") {
        stats.descriptorCount++;
      }
      checkUniqueChildren(child, `${path}/${child.name}`);
    }
  };
  checkUniqueChildren(tree, tree.name || "CGNSTree");

  // Validate CGNSLibraryVersion_t
  const libVer = tree.children.find((c) => c.label === "CGNSLibraryVersion_t");
  if (!libVer) {
    errors.push("Missing required 'CGNSLibraryVersion_t' child under root 'CGNSTree_t'.");
  } else if (typeof libVer.data !== "number" || libVer.data < 2.0) {
    errors.push(`Invalid CGNSLibraryVersion_t value: ${String(libVer.data)}.`);
  }

  // Validate CGNSBase_t nodes
  const bases = tree.children.filter((c) => c.label === "CGNSBase_t");
  stats.baseCount = bases.length;
  if (bases.length === 0) {
    errors.push("CGNS tree must contain at least one 'CGNSBase_t' node.");
  }

  for (const base of bases) {
    const basePath = `/${base.name}`;
    if (!Array.isArray(base.data) || base.data.length !== 2) {
      errors.push(`${basePath}: CGNSBase_t data must be [cellDimension, physicalDimension].`);
      continue;
    }
    const [cellDim, physDim] = base.data as [number, number];
    if (cellDim < 1 || cellDim > 3 || physDim < 1 || physDim > 3 || cellDim > physDim) {
      errors.push(`${basePath}: invalid dimensions cellDimension=${cellDim}, physicalDimension=${physDim}.`);
    }

    const baseDescriptors = base.children.filter((c) => c.label === "Descriptor_t");
    if (baseDescriptors.length === 0) {
      warnings.push(`${basePath}: no Descriptor_t V&V provenance node found.`);
    }

    const zones = base.children.filter((c) => c.label === "Zone_t");
    if (zones.length === 0) {
      warnings.push(`${basePath}: CGNSBase_t contains no Zone_t children.`);
    }

    for (const zone of zones) {
      stats.zoneCount++;
      const zonePath = `${basePath}/${zone.name}`;

      const zoneTypeNode = zone.children.find((c) => c.label === "ZoneType_t");
      if (!zoneTypeNode) {
        errors.push(`${zonePath}: missing required 'ZoneType_t' child.`);
      } else if (zoneTypeNode.data !== "Structured" && zoneTypeNode.data !== "Unstructured") {
        errors.push(
          `${zonePath}: invalid ZoneType_t '${String(zoneTypeNode.data)}' (expected 'Structured' or 'Unstructured').`,
        );
      }

      if (!Array.isArray(zone.data) || zone.data.length < 3) {
        errors.push(`${zonePath}: Zone_t size array is missing or malformed.`);
      }

      // Validate GridCoordinates_t
      const gridCoords = zone.children.find((c) => c.label === "GridCoordinates_t");
      if (!gridCoords) {
        errors.push(`${zonePath}: missing required 'GridCoordinates_t' child.`);
      } else {
        const coordArrays = gridCoords.children.filter((c) => c.label === "DataArray_t");
        if (!coordArrays.some((c) => c.name === "CoordinateX")) {
          errors.push(`${zonePath}/GridCoordinates: missing 'CoordinateX' DataArray_t.`);
        }
        for (const arr of coordArrays) {
          validateDataArrayNode(arr, `${zonePath}/GridCoordinates/${arr.name}`, errors);
        }
      }

      // Validate FlowSolution_t
      const solutions = zone.children.filter((c) => c.label === "FlowSolution_t");
      for (const sol of solutions) {
        const solPath = `${zonePath}/${sol.name}`;
        const arrays = sol.children.filter((c) => c.label === "DataArray_t");
        stats.fieldCount += arrays.length;
        if (arrays.length === 0) {
          warnings.push(`${solPath}: FlowSolution_t contains no DataArray_t fields.`);
        }
        for (const arr of arrays) {
          validateDataArrayNode(arr, `${solPath}/${arr.name}`, errors);
        }
      }

      // Validate ZoneBC_t / BC_t
      const zoneBCs = zone.children.filter((c) => c.label === "ZoneBC_t");
      for (const zbc of zoneBCs) {
        const bcs = zbc.children.filter((c) => c.label === "BC_t");
        for (const bc of bcs) {
          stats.bcCount++;
          const bcPath = `${zonePath}/${zbc.name}/${bc.name}`;
          if (typeof bc.data !== "string" || !VALID_BC_TYPES.has(bc.data)) {
            errors.push(`${bcPath}: invalid BCType '${String(bc.data)}'.`);
          }
          const hasRangeOrList = bc.children.some((c) => c.label === "IndexRange_t" || c.label === "IndexArray_t");
          if (!hasRangeOrList) {
            errors.push(`${bcPath}: BC_t must contain either 'PointRange' or 'PointList'.`);
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats,
  };
}

function validateDataArrayNode(node: CgnsNode, path: string, errors: string[]): void {
  if (!Array.isArray(node.dimensions) || node.dimensions.length === 0) {
    errors.push(`${path}: DataArray_t must declare non-empty dimensions.`);
    return;
  }
  const expectedCount = node.dimensions.reduce((acc, d) => acc * d, 1);
  if (expectedCount <= 0) {
    errors.push(`${path}: DataArray_t dimensions must have positive product.`);
    return;
  }
  const bpe = bytesPerElement(node.dataType);
  if (bpe === 0) {
    errors.push(`${path}: DataArray_t cannot have dataType 'MT'.`);
    return;
  }

  if (node.encoding === "base64") {
    if (typeof node.data !== "string" || node.data.length === 0) {
      errors.push(`${path}: Base64 DataArray_t must have a non-empty string payload.`);
      return;
    }
    const decoded = decodeCgnsDataArray(node);
    if (!decoded || decoded.length !== expectedCount) {
      errors.push(
        `${path}: Base64 decoded element count (${decoded?.length ?? 0}) does not match dimensions product (${expectedCount}).`,
      );
    }
  } else if (node.encoding === "typed-array") {
    if (
      !(node.data instanceof Float64Array) &&
      !(node.data instanceof Float32Array) &&
      !(node.data instanceof Int32Array) &&
      !(node.data instanceof Uint32Array)
    ) {
      errors.push(`${path}: typed-array DataArray_t must store a TypedArray.`);
      return;
    }
    if (node.data.length !== expectedCount) {
      errors.push(
        `${path}: TypedArray length (${node.data.length}) does not match dimensions product (${expectedCount}).`,
      );
    }
  } else if (Array.isArray(node.data)) {
    if (node.data.length !== expectedCount) {
      errors.push(
        `${path}: inline array length (${node.data.length}) does not match dimensions product (${expectedCount}).`,
      );
    }
  } else {
    errors.push(`${path}: DataArray_t has missing or unsupported data payload.`);
  }
}
