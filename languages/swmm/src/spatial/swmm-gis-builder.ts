// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/swmm — GeoJSON & GIS Stormwater/Wastewater Network Ingestion Engine.
 *
 * Ingests municipal GIS conduit centerlines, manhole points, and catchment polygons from GeoJSON:
 * - Topological manhole snapping and connectivity
 * - Polygon area calculation via Green's theorem (hectares)
 * - Automatic nearest-manhole drainage outlet assignment from polygon centroid
 * - Overland flow width and DEM average ground slope estimation
 * - Produces complete, ready-to-route SwmmDeck AST models
 */

import type {
  SwmmConduit,
  SwmmCrossSection,
  SwmmDeck,
  SwmmJunction,
  SwmmOutfall,
  SwmmRange,
  SwmmSubcatchment,
} from "../types.js";
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

export interface SwmmGisIngestionOptions {
  conduitsGeoJson: string | GeoJsonFeatureCollection | GeoJsonFeature[];
  manholesGeoJson?: string | GeoJsonFeatureCollection | GeoJsonFeature[] | undefined;
  subcatchmentsGeoJson?: string | GeoJsonFeatureCollection | GeoJsonFeature[] | undefined;
  dem?: DemRaster | string | undefined; // DemRaster instance or ASCII Grid deck
  snapToleranceM?: number | undefined; // Distance in meters to snap endpoints (default: 2.0m)
  defaultDiameterM?: number | undefined; // Default conduit diameter (default: 0.6m / 24")
  defaultManningN?: number | undefined; // Default Manning's n (default: 0.013)
  defaultManholeDepthM?: number | undefined; // Default manhole depth (default: 2.5m)
  defaultImpervPct?: number | undefined; // Default subcatchment imperviousness % (default: 40.0%)
  title?: string | undefined;
}

const DEFAULT_RANGE: SwmmRange = {
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 1,
  startOffset: 0,
  endOffset: 0,
};

const EARTH_RADIUS_M = 6371008.8;

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
 * Computes polygon area in square meters and centroid [cx, cy] via Green's Theorem.
 */
function computePolygonMetrics(
  ring: [number, number][],
  isGeographic: boolean,
): { areaM2: number; areaHa: number; centroid: [number, number] } {
  const n = ring.length;
  if (n < 3) return { areaM2: 1000, areaHa: 0.1, centroid: [0, 0] };

  let signedArea = 0.0;
  let cx = 0.0;
  let cy = 0.0;

  for (let i = 0; i < n - 1; i++) {
    const x0 = ring[i]![0];
    const y0 = ring[i]![1];
    const x1 = ring[i + 1]![0];
    const y1 = ring[i + 1]![1];

    const cross = x0 * y1 - x1 * y0;
    signedArea += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }

  signedArea = signedArea / 2.0;
  const absAreaCoord = Math.abs(signedArea);

  if (absAreaCoord > 0) {
    cx = cx / (6.0 * signedArea);
    cy = cy / (6.0 * signedArea);
  } else {
    cx = ring[0]![0];
    cy = ring[0]![1];
  }

  let areaM2 = absAreaCoord;
  if (isGeographic) {
    // Convert coordinate degrees area to square meters on Earth surface
    const midLat = (cy * Math.PI) / 180.0;
    const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * midLat);
    const mPerDegLon = 111412.84 * Math.cos(midLat);
    areaM2 = absAreaCoord * mPerDegLat * mPerDegLon;
  }

  const areaHa = areaM2 / 10000.0; // 1 ha = 10,000 m^2
  return { areaM2, areaHa, centroid: [cx, cy] };
}

/**
 * Ingests GIS vector layers (conduits, manholes, subcatchments) and an optional DEM into a SWMM network model.
 */
export function buildSwmmFromGis(options: SwmmGisIngestionOptions): SwmmDeck {
  const conduitFeatures = parseFeatures(options.conduitsGeoJson);
  const manholeFeatures = options.manholesGeoJson ? parseFeatures(options.manholesGeoJson) : [];
  const catchFeatures = options.subcatchmentsGeoJson ? parseFeatures(options.subcatchmentsGeoJson) : [];

  const dem =
    typeof options.dem === "string"
      ? DemRaster.parseAsciiGrid(options.dem)
      : (options.dem ?? null);

  const snapTol = options.snapToleranceM ?? 2.0;
  const defDiam = options.defaultDiameterM ?? 0.6;
  const defManning = options.defaultManningN ?? 0.013;
  const defDepth = options.defaultManholeDepthM ?? 2.5;
  const defImperv = options.defaultImpervPct ?? 40.0;

  // Detect coordinate system
  let isGeographic = false;
  if (conduitFeatures.length > 0) {
    const geom = conduitFeatures[0]!.geometry;
    let sampleCoord: [number, number] | null = null;
    if (geom.type === "LineString" && Array.isArray(geom.coordinates) && geom.coordinates.length > 0) {
      sampleCoord = geom.coordinates[0] as [number, number];
    }
    if (sampleCoord && Math.abs(sampleCoord[0]) <= 180.0 && Math.abs(sampleCoord[1]) <= 90.0) {
      isGeographic = true;
    }
  }

  interface InternalManhole {
    id: string;
    x: number;
    y: number;
    elevation: number; // invert elevation
    maxDepth: number;
    isOutfall: boolean;
  }

  const manholesMap = new Map<string, InternalManhole>();
  const manholesList: InternalManhole[] = [];

  // 1. Process explicit manholes / outfalls
  let mhIdx = 0;
  for (const feat of manholeFeatures) {
    if (!feat.geometry || feat.geometry.type !== "Point") continue;
    const coords = feat.geometry.coordinates as [number, number];
    const props = feat.properties ?? {};

    const id = String(props["id"] ?? props["ID"] ?? props["MANHOLE_ID"] ?? feat.id ?? `MH_${++mhIdx}`);
    const isOutfall =
      String(props["type"] ?? "").toUpperCase() === "OUTFALL" ||
      Boolean(props["isOutfall"]) ||
      id.toLowerCase().includes("outfall");

    let rimElev = Number(props["rimElevation"] ?? props["RIM_ELEV"] ?? NaN);
    let invElev = Number(props["invertElevation"] ?? props["INVERT_ELEV"] ?? props["elevation"] ?? NaN);
    let depth = Number(props["maxDepth"] ?? props["DEPTH"] ?? defDepth);

    if (dem && isNaN(rimElev)) {
      const sampled = dem.sample(coords[0], coords[1]);
      rimElev = sampled !== null ? sampled : 10.0;
    }
    if (isNaN(invElev)) {
      invElev = isNaN(rimElev) ? 10.0 : rimElev - depth;
    }
    if (isNaN(depth)) {
      depth = isNaN(rimElev) ? defDepth : Math.max(0.5, rimElev - invElev);
    }

    const mh: InternalManhole = {
      id,
      x: coords[0],
      y: coords[1],
      elevation: Math.round(invElev * 100) / 100,
      maxDepth: Math.round(depth * 100) / 100,
      isOutfall,
    };
    manholesMap.set(id, mh);
    manholesList.push(mh);
  }

  // Snapping helper for conduit endpoints
  const findOrAddManhole = (coord: [number, number]): string => {
    for (const mh of manholesList) {
      const dist = computeDistanceM([mh.x, mh.y], coord, isGeographic);
      if (dist <= snapTol) return mh.id;
    }

    const newId = `MH_${manholesList.length + 1}`;
    let rimElev = 10.0;
    if (dem) {
      const sampled = dem.sample(coord[0], coord[1]);
      if (sampled !== null) rimElev = sampled;
    }
    const invElev = rimElev - defDepth;

    const newMh: InternalManhole = {
      id: newId,
      x: coord[0],
      y: coord[1],
      elevation: Math.round(invElev * 100) / 100,
      maxDepth: defDepth,
      isOutfall: false,
    };
    manholesMap.set(newId, newMh);
    manholesList.push(newMh);
    return newId;
  };

  // 2. Process Conduits
  const conduits = new Map<string, SwmmConduit>();
  const crossSections = new Map<string, SwmmCrossSection>();
  let condCounter = 0;

  for (const feat of conduitFeatures) {
    if (!feat.geometry) continue;
    let lines: [number, number][][] = [];
    if (feat.geometry.type === "LineString") {
      lines = [feat.geometry.coordinates as [number, number][]];
    } else if (feat.geometry.type === "MultiLineString") {
      lines = feat.geometry.coordinates as [number, number][][];
    } else {
      continue;
    }

    const props = feat.properties ?? {};
    const baseId = String(props["id"] ?? props["ID"] ?? props["CONDUIT_ID"] ?? feat.id ?? `C_${++condCounter}`);
    const diam = Number(props["diameter"] ?? props["DIAMETER"] ?? props["DIAM_M"] ?? defDiam);
    const manningN = Number(props["roughness"] ?? props["ROUGHNESS"] ?? props["manning"] ?? defManning);

    let seg = 0;
    for (const lineCoords of lines) {
      if (lineCoords.length < 2) continue;

      const p1 = lineCoords[0]!;
      const p2 = lineCoords[lineCoords.length - 1]!;

      const inletId = findOrAddManhole(p1);
      const outletId = findOrAddManhole(p2);

      if (inletId === outletId) continue;

      let lenM = 0.0;
      for (let i = 0; i < lineCoords.length - 1; i++) {
        lenM += computeDistanceM(lineCoords[i]!, lineCoords[i + 1]!, isGeographic);
      }

      const attrLen = Number(props["length"] ?? props["LENGTH"] ?? NaN);
      const finalLen = !isNaN(attrLen) && attrLen > 0 ? attrLen : Math.max(1.0, Math.round(lenM * 10) / 10);

      const cid = lines.length > 1 ? `${baseId}_${++seg}` : baseId;

      conduits.set(cid, {
        id: cid,
        inletNode: inletId,
        outletNode: outletId,
        length: finalLen,
        roughness: isNaN(manningN) ? defManning : manningN,
        range: DEFAULT_RANGE,
      });

      crossSections.set(cid, {
        linkId: cid,
        shape: "CIRCULAR",
        geom1: isNaN(diam) ? defDiam : diam,
        range: DEFAULT_RANGE,
      });
    }
  }

  // 3. Process Subcatchments
  const subcatchments = new Map<string, SwmmSubcatchment>();
  let catCounter = 0;

  for (const feat of catchFeatures) {
    if (!feat.geometry) continue;
    let rings: [number, number][][] = [];
    if (feat.geometry.type === "Polygon") {
      rings = feat.geometry.coordinates as [number, number][][];
    } else if (feat.geometry.type === "MultiPolygon") {
      const polys = feat.geometry.coordinates as [number, number][][][];
      if (polys.length > 0 && polys[0]) rings = polys[0];
    } else {
      continue;
    }

    if (rings.length === 0 || !rings[0]) continue;
    const outerRing = rings[0];

    const props = feat.properties ?? {};
    const id = String(props["id"] ?? props["ID"] ?? props["SUBCATCHMENT"] ?? feat.id ?? `S_${++catCounter}`);
    const { areaHa, centroid } = computePolygonMetrics(outerRing, isGeographic);

    // Find nearest manhole as outlet if not specified
    let outletNode = String(props["outlet"] ?? props["OUTLET"] ?? "");
    if (!outletNode || !manholesMap.has(outletNode)) {
      let minDist = Infinity;
      let closestMh = manholesList[0]?.id ?? "MH_1";
      for (const mh of manholesList) {
        const d = computeDistanceM([mh.x, mh.y], centroid, isGeographic);
        if (d < minDist) {
          minDist = d;
          closestMh = mh.id;
        }
      }
      outletNode = closestMh;
    }

    // Determine slope from DEM or attributes
    let slope = Number(props["slope"] ?? props["SLOPE"] ?? props["slopePct"] ?? NaN);
    if (isNaN(slope) && dem) {
      slope = dem.samplePolygonAverageSlope(outerRing);
    } else if (isNaN(slope)) {
      slope = 1.0;
    }

    const imperv = Number(props["imperv"] ?? props["PCT_IMPERV"] ?? defImperv);
    const attrArea = Number(props["area"] ?? props["AREA_HA"] ?? NaN);
    const finalAreaHa = !isNaN(attrArea) && attrArea > 0 ? attrArea : Math.max(0.01, Math.round(areaHa * 100) / 100);

    // Characteristic overland flow width W ~ 2 * sqrt(Area_m2)
    const areaM2 = finalAreaHa * 10000.0;
    const width = Math.max(10.0, Math.round(2.0 * Math.sqrt(areaM2)));

    subcatchments.set(id, {
      id,
      outlet: outletNode,
      area: finalAreaHa,
      impervPct: isNaN(imperv) ? defImperv : imperv,
      width,
      slopePct: Math.round(slope * 10) / 10,
      range: DEFAULT_RANGE,
    });
  }

  // 4. Assemble into SwmmDeck
  const junctions = new Map<string, SwmmJunction>();
  const outfalls = new Map<string, SwmmOutfall>();

  for (const mh of manholesList) {
    if (mh.isOutfall) {
      outfalls.set(mh.id, {
        id: mh.id,
        elevation: mh.elevation,
        type: "FREE",
        range: DEFAULT_RANGE,
      });
    } else {
      junctions.set(mh.id, {
        id: mh.id,
        elevation: mh.elevation,
        maxDepth: mh.maxDepth,
        range: DEFAULT_RANGE,
      });
    }
  }

  return {
    title: options.title ?? "Imported GIS Stormwater Drainage Network",
    flowUnits: "CMS",
    routingModel: "DYNWAVE",
    options: {
      FLOW_UNITS: "CMS",
      FLOW_ROUTING: "DYNWAVE",
      INFILTRATION: "HORTON",
    },
    junctions,
    outfalls,
    storage: new Map(),
    conduits,
    pumps: new Map(),
    orifices: new Map(),
    weirs: new Map(),
    crossSections,
    subcatchments,
  };
}
