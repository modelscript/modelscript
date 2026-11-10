// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — GeoJSON & GIS Pipe Network Ingestion Engine.
 *
 * Ingests municipal GIS pipe centerlines and junction assets from GeoJSON:
 * - Topological node snapping within spatial tolerance epsilon
 * - Geodesic polyline pipe length calculation (Haversine for WGS84, Euclidean for State Plane / UTM)
 * - Automatic DEM ground elevation extraction from digital elevation rasters
 * - Constructs standard, valid, ready-to-solve EpanetNetwork AST models
 */

import type { EpanetJunction, EpanetNetwork, EpanetPipe, EpanetReservoir, EpanetTank } from "../types.js";
import { DemRaster } from "./dem-raster.js";

export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

export interface GeoJsonFeature {
  type: "Feature";
  id?: string | number | undefined;
  geometry: GeoJsonGeometry;
  properties?: Record<string, unknown> | null | undefined;
}

export interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

export interface GisIngestionOptions {
  pipesGeoJson: string | GeoJsonFeatureCollection | GeoJsonFeature[];
  nodesGeoJson?: string | GeoJsonFeatureCollection | GeoJsonFeature[] | undefined;
  dem?: DemRaster | string | undefined; // DemRaster instance or ASCII Grid deck
  snapToleranceM?: number | undefined; // Distance in meters to snap endpoints to existing nodes (default: 1.5m)
  defaultDiameterMm?: number | undefined; // Default pipe diameter if missing (default: 200mm)
  defaultRoughness?: number | undefined; // Default Hazen-Williams C-factor (default: 120)
  defaultDemandLps?: number | undefined; // Default base demand (default: 0.0)
  defaultReservoirHeadM?: number | undefined; // Default head for reservoir sources (default: 75.0m)
  networkTitle?: string | undefined;
}

const EARTH_RADIUS_M = 6371008.8;

const DEFAULT_RANGE = {
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 1,
  startOffset: 0,
  endOffset: 0,
};

/**
 * Calculates geodesic distance between two [lon, lat] coordinates in meters using the Haversine formula.
 */
function haversineM(p1: [number, number], p2: [number, number]): number {
  const lon1 = (p1[0] * Math.PI) / 180.0;
  const lat1 = (p1[1] * Math.PI) / 180.0;
  const lon2 = (p2[0] * Math.PI) / 180.0;
  const lat2 = (p2[1] * Math.PI) / 180.0;

  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;

  const a = Math.sin(dLat / 2.0) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2.0) ** 2;
  const c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Calculates distance between two points, automatically selecting Haversine (for WGS84)
 * or Euclidean distance (for projected State Plane / UTM coordinates in meters).
 */
function computeDistanceM(p1: [number, number], p2: [number, number], isGeographic: boolean): number {
  if (isGeographic) {
    return haversineM(p1, p2);
  }
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function parseFeatures(input: string | GeoJsonFeatureCollection | GeoJsonFeature[]): GeoJsonFeature[] {
  if (typeof input === "string") {
    const parsed = JSON.parse(input) as unknown;
    if ((parsed as GeoJsonFeatureCollection).type === "FeatureCollection") {
      return (parsed as GeoJsonFeatureCollection).features;
    }
    if (Array.isArray(parsed)) {
      return parsed as GeoJsonFeature[];
    }
    if ((parsed as GeoJsonFeature).type === "Feature") {
      return [parsed as GeoJsonFeature];
    }
    return [];
  }
  if (Array.isArray(input)) return input;
  if (input.type === "FeatureCollection") return input.features;
  return [];
}

/**
 * Ingests GeoJSON vector features and optional DEM rasters into an EPANET network model.
 */
export function buildEpanetFromGis(options: GisIngestionOptions): EpanetNetwork {
  const pipeFeatures = parseFeatures(options.pipesGeoJson);
  const nodeFeatures = options.nodesGeoJson ? parseFeatures(options.nodesGeoJson) : [];
  const dem =
    typeof options.dem === "string"
      ? DemRaster.parseAsciiGrid(options.dem)
      : (options.dem ?? null);

  const snapTol = options.snapToleranceM ?? 1.5;
  const defDiam = options.defaultDiameterMm ?? 200.0;
  const defRough = options.defaultRoughness ?? 120.0;
  const defDemand = options.defaultDemandLps ?? 0.0;

  // Determine if coordinate system is geographic (WGS84 lon/lat)
  let isGeographic = false;
  if (pipeFeatures.length > 0) {
    const geom = pipeFeatures[0]!.geometry;
    let sampleCoord: [number, number] | null = null;
    if (geom.type === "LineString" && Array.isArray(geom.coordinates) && geom.coordinates.length > 0) {
      sampleCoord = geom.coordinates[0] as [number, number];
    } else if (geom.type === "MultiLineString" && Array.isArray(geom.coordinates)) {
      const ring = (geom.coordinates as [number, number][][])[0];
      if (ring && ring.length > 0) sampleCoord = ring[0]!;
    }
    if (sampleCoord && Math.abs(sampleCoord[0]) <= 180.0 && Math.abs(sampleCoord[1]) <= 90.0) {
      isGeographic = true;
    }
  }

  // Internal spatial node registry
  interface InternalNode {
    id: string;
    x: number;
    y: number;
    elevation: number;
    demand: number;
    type: "junction" | "reservoir" | "tank";
    totalHead?: number | undefined;
  }

  const nodesMap = new Map<string, InternalNode>();
  const nodesList: InternalNode[] = [];

  // 1. Process explicit node features
  let explicitNodeCount = 0;
  for (const feat of nodeFeatures) {
    if (!feat.geometry || feat.geometry.type !== "Point") continue;
    const coords = feat.geometry.coordinates as [number, number];
    const props = feat.properties ?? {};

    const id =
      String(props["id"] ?? props["ID"] ?? props["FACILITYID"] ?? props["name"] ?? feat.id ?? `N_${++explicitNodeCount}`);
    let elev = Number(props["elevation"] ?? props["ELEV"] ?? props["z"] ?? NaN);

    if (isNaN(elev) && dem) {
      const sampled = dem.sample(coords[0], coords[1]);
      elev = sampled !== null ? Math.round(sampled * 100) / 100 : 10.0;
    } else if (isNaN(elev)) {
      elev = 10.0;
    }

    const typeStr = String(props["type"] ?? props["TYPE"] ?? "junction").toLowerCase();
    const type: "junction" | "reservoir" | "tank" =
      typeStr.includes("reservoir") || typeStr.includes("source") || typeStr.includes("wtp")
        ? "reservoir"
        : typeStr.includes("tank") || typeStr.includes("standpipe")
          ? "tank"
          : "junction";

    const demand = Number(props["demand"] ?? props["BASE_DEMAND"] ?? props["flow"] ?? defDemand);
    const totalHead = type === "reservoir" ? Number(props["head"] ?? props["TOTAL_HEAD"] ?? elev + 50.0) : undefined;

    const node: InternalNode = {
      id,
      x: coords[0],
      y: coords[1],
      elevation: elev,
      demand: isNaN(demand) ? defDemand : demand,
      type,
      totalHead,
    };
    nodesMap.set(id, node);
    nodesList.push(node);
  }

  // Node snapping helper
  const findOrAddNode = (coord: [number, number]): string => {
    // Check if within snap tolerance of any existing node
    for (const node of nodesList) {
      const dist = computeDistanceM([node.x, node.y], coord, isGeographic);
      if (dist <= snapTol) {
        return node.id;
      }
    }

    // Create new junction at this coordinate
    const newId = `J_${nodesList.length + 1}`;
    let elev = 10.0;
    if (dem) {
      const sampled = dem.sample(coord[0], coord[1]);
      if (sampled !== null) elev = Math.round(sampled * 100) / 100;
    }

    const newNode: InternalNode = {
      id: newId,
      x: coord[0],
      y: coord[1],
      elevation: elev,
      demand: defDemand,
      type: "junction",
    };
    nodesMap.set(newId, newNode);
    nodesList.push(newNode);
    return newId;
  };

  // 2. Process pipes
  const pipes: EpanetPipe[] = [];
  let pipeCounter = 0;

  for (const feat of pipeFeatures) {
    if (!feat.geometry) continue;
    const geomType = feat.geometry.type;
    let lines: [number, number][][] = [];

    if (geomType === "LineString") {
      lines = [feat.geometry.coordinates as [number, number][]];
    } else if (geomType === "MultiLineString") {
      lines = feat.geometry.coordinates as [number, number][][];
    } else {
      continue;
    }

    const props = feat.properties ?? {};
    const baseId = String(props["id"] ?? props["ID"] ?? props["PIPE_ID"] ?? feat.id ?? `P_${++pipeCounter}`);
    const diam = Number(props["diameter"] ?? props["DIAMETER"] ?? props["DIAM_MM"] ?? props["size"] ?? defDiam);
    const rough = Number(props["roughness"] ?? props["ROUGHNESS"] ?? props["c_factor"] ?? props["C_FACTOR"] ?? defRough);
    const status = String(props["status"] ?? props["STATUS"] ?? "OPEN").toUpperCase() === "CLOSED" ? "CLOSED" : "OPEN";

    let segmentIdx = 0;
    for (const lineCoords of lines) {
      if (lineCoords.length < 2) continue;

      const pStart = lineCoords[0]!;
      const pEnd = lineCoords[lineCoords.length - 1]!;

      const node1Id = findOrAddNode(pStart);
      const node2Id = findOrAddNode(pEnd);

      if (node1Id === node2Id) continue; // Skip zero-length loops

      // Compute total pipe length along all vertices in polyline
      let totalLengthM = 0.0;
      for (let i = 0; i < lineCoords.length - 1; i++) {
        totalLengthM += computeDistanceM(lineCoords[i]!, lineCoords[i + 1]!, isGeographic);
      }

      // Check if explicit length is defined in attributes
      const attrLength = Number(props["length"] ?? props["LENGTH"] ?? props["LEN_M"] ?? NaN);
      const finalLength = !isNaN(attrLength) && attrLength > 0 ? attrLength : Math.max(1.0, Math.round(totalLengthM * 10) / 10);

      const pid = lines.length > 1 ? `${baseId}_${++segmentIdx}` : baseId;

      pipes.push({
        id: pid,
        node1: node1Id,
        node2: node2Id,
        length: finalLength,
        diameter: isNaN(diam) ? defDiam : diam,
        roughness: isNaN(rough) ? defRough : rough,
        minorLoss: 0.0,
        status,
        range: DEFAULT_RANGE,
      });
    }
  }

  // 3. Assemble Network
  const junctions: EpanetJunction[] = [];
  const reservoirs: EpanetReservoir[] = [];
  const tanks: EpanetTank[] = [];

  for (const node of nodesList) {
    if (node.type === "reservoir") {
      reservoirs.push({
        id: node.id,
        totalHead: node.totalHead ?? node.elevation + 50.0,
        range: DEFAULT_RANGE,
      });
    } else if (node.type === "tank") {
      tanks.push({
        id: node.id,
        elevation: node.elevation,
        initLevel: 5.0,
        minLevel: 1.0,
        maxLevel: 10.0,
        diameter: 15.0,
        minVol: 0.0,
        range: DEFAULT_RANGE,
      });
    } else {
      junctions.push({
        id: node.id,
        elevation: node.elevation,
        demand: node.demand,
        range: DEFAULT_RANGE,
      });
    }
  }

  return {
    title: options.networkTitle ?? "Imported GIS Hydraulic Network",
    junctions,
    reservoirs,
    tanks,
    pipes,
    pumps: [],
    valves: [],
    curves: [],
    patterns: [],
    controls: [],
    options: {
      units: "LPS",
      headloss: "H-W",
      specificGravity: 1.0,
      viscosity: 1.0,
      trials: 40,
      accuracy: 0.001,
      flowChange: 0.0,
    },
  };
}
