// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  GtfsFeed,
  GtfsRoute,
  GtfsStop,
  GtfsStopTime,
  GtfsTrip,
  VehicleKinematicsParams,
} from "../types.js";

/**
 * Parses multi-table GTFS schedule text feeds or concatenated CSV sections.
 */
export function parseGtfs(content: string): GtfsFeed {
  const lines = content.split(/\r?\n/);

  const stops: GtfsStop[] = [];
  const routes: GtfsRoute[] = [];
  const trips: GtfsTrip[] = [];
  const stopTimes: GtfsStopTime[] = [];

  let vehicle: VehicleKinematicsParams = {
    massKg: 18500.0,       // Standard 12m electric city bus with passengers
    frontalAreaM2: 7.5,    // Bus frontal area
    dragCoeff: 0.65,       // Aerodynamic drag
    rollingResist: 0.008,  // Heavy vehicle rolling resistance
    auxPowerKW: 10.0,      // HVAC + auxiliary systems
    batteryKWh: 350.0,     // 350 kWh LFP/NMC battery pack
    regenEfficiency: 0.65,
  };

  let activeSection: "STOPS" | "ROUTES" | "TRIPS" | "STOP_TIMES" | "VEHICLE" | null = null;
  let headerMap: Map<string, number> = new Map();

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const line = rawLine.trim();
    if (!line) continue;

    // Detect section header: # STOPS or [STOPS] or stops.txt
    const sectionMatch = /^#?\s*\[?([A-Za-z0-9_.-]+)\]?/.exec(line);
    if (sectionMatch) {
      const tag = sectionMatch[1]!.toUpperCase().replace(/(\.TXT|\.CSV)$/, "");
      if (tag === "STOPS" || tag === "STOP") {
        activeSection = "STOPS";
        headerMap.clear();
        continue;
      } else if (tag === "ROUTES" || tag === "ROUTE") {
        activeSection = "ROUTES";
        headerMap.clear();
        continue;
      } else if (tag === "TRIPS" || tag === "TRIP") {
        activeSection = "TRIPS";
        headerMap.clear();
        continue;
      } else if (tag === "STOP_TIMES" || tag === "STOPTIMES") {
        activeSection = "STOP_TIMES";
        headerMap.clear();
        continue;
      } else if (tag === "VEHICLE" || tag === "BUS") {
        activeSection = "VEHICLE";
        continue;
      }
    }

    if (line.startsWith("#") || line.startsWith("//")) continue;

    // Handle CSV or whitespace tokens
    const delimiter = line.includes(",") ? "," : /\s+/;
    const tokens = typeof delimiter === "string" ? line.split(",").map((s) => s.trim()) : line.split(delimiter);

    // Header row detection
    if (headerMap.size === 0 && (tokens.includes("stop_id") || tokens.includes("route_id") || tokens.includes("trip_id"))) {
      for (let idx = 0; idx < tokens.length; idx++) {
        headerMap.set(tokens[idx]!.toLowerCase(), idx);
      }
      continue;
    }

    if (activeSection === "STOPS") {
      parseStopRow(tokens, headerMap, i + 1);
    } else if (activeSection === "ROUTES") {
      parseRouteRow(tokens, headerMap, i + 1);
    } else if (activeSection === "TRIPS") {
      parseTripRow(tokens, headerMap, i + 1);
    } else if (activeSection === "STOP_TIMES") {
      parseStopTimeRow(tokens, headerMap, i + 1);
    } else if (activeSection === "VEHICLE") {
      parseVehicleRow(tokens);
    } else {
      // Heuristic row detection if no section tag
      if (tokens.length >= 4 && (tokens[0]?.startsWith("STOP") || tokens[1]?.includes("Station") || tokens[1]?.includes("Center"))) {
        parseStopRow(tokens, headerMap, i + 1);
      }
    }
  }

  function parseStopRow(tokens: string[], headers: Map<string, number>, lineNum: number) {
    const idIdx = headers.get("stop_id") ?? 0;
    const nameIdx = headers.get("stop_name") ?? 1;
    const latIdx = headers.get("stop_lat") ?? 2;
    const lonIdx = headers.get("stop_lon") ?? 3;

    const stop_id = tokens[idIdx] ?? `STOP_${stops.length + 1}`;
    const stop_name = tokens[nameIdx] ?? stop_id;
    const stop_lat = parseFloat(tokens[latIdx] ?? "0");
    const stop_lon = parseFloat(tokens[lonIdx] ?? "0");

    stops.push({
      stop_id,
      stop_name,
      stop_lat: isNaN(stop_lat) ? 0 : stop_lat,
      stop_lon: isNaN(stop_lon) ? 0 : stop_lon,
      line: lineNum,
    });
  }

  function parseRouteRow(tokens: string[], headers: Map<string, number>, lineNum: number) {
    const idIdx = headers.get("route_id") ?? 0;
    const shortIdx = headers.get("route_short_name") ?? 1;
    const longIdx = headers.get("route_long_name") ?? 2;
    const typeIdx = headers.get("route_type") ?? 3;

    const route_id = tokens[idIdx] ?? `ROUTE_${routes.length + 1}`;
    const route_short_name = tokens[shortIdx] ?? route_id;
    const route_long_name = tokens[longIdx] ?? route_short_name;
    const route_type = parseInt(tokens[typeIdx] ?? "3", 10);

    routes.push({
      route_id,
      route_short_name,
      route_long_name,
      route_type: isNaN(route_type) ? 3 : route_type,
      line: lineNum,
    });
  }

  function parseTripRow(tokens: string[], headers: Map<string, number>, lineNum: number) {
    const routeIdx = headers.get("route_id") ?? 0;
    const serviceIdx = headers.get("service_id") ?? 1;
    const tripIdx = headers.get("trip_id") ?? 2;
    const shapeIdx = headers.get("shape_id") ?? 3;

    const route_id = tokens[routeIdx] ?? "DEFAULT_ROUTE";
    const service_id = tokens[serviceIdx];
    const trip_id = tokens[tripIdx] ?? `TRIP_${trips.length + 1}`;
    const shape_id = tokens[shapeIdx];

    trips.push({
      route_id,
      trip_id,
      service_id,
      shape_id,
      line: lineNum,
    });
  }

  function parseStopTimeRow(tokens: string[], headers: Map<string, number>, lineNum: number) {
    const tripIdx = headers.get("trip_id") ?? 0;
    const arrIdx = headers.get("arrival_time") ?? 1;
    const depIdx = headers.get("departure_time") ?? 2;
    const stopIdx = headers.get("stop_id") ?? 3;
    const seqIdx = headers.get("stop_sequence") ?? 4;
    const distIdx = headers.get("shape_dist_traveled") ?? 5;

    const trip_id = tokens[tripIdx] ?? "TRIP_1";
    const arrival_time = tokens[arrIdx] ?? "08:00:00";
    const departure_time = tokens[depIdx] ?? arrival_time;
    const stop_id = tokens[stopIdx] ?? "STOP_1";
    const stop_sequence = parseInt(tokens[seqIdx] ?? String(stopTimes.length + 1), 10);
    const dist = distIdx !== undefined && tokens[distIdx] ? parseFloat(tokens[distIdx]!) : undefined;

    stopTimes.push({
      trip_id,
      arrival_time,
      departure_time,
      stop_id,
      stop_sequence: isNaN(stop_sequence) ? stopTimes.length + 1 : stop_sequence,
      shape_dist_traveled: dist !== undefined && !isNaN(dist) ? dist : undefined,
      line: lineNum,
    });
  }

  function parseVehicleRow(tokens: string[]) {
    const k = tokens[0]!.toLowerCase();
    const v = parseFloat(tokens[1] ?? "0");
    if (isNaN(v)) return;

    if (k.includes("mass")) vehicle.massKg = v;
    else if (k.includes("battery") || k.includes("cap")) vehicle.batteryKWh = v;
    else if (k.includes("aux")) vehicle.auxPowerKW = v;
    else if (k.includes("drag")) vehicle.dragCoeff = v;
    else if (k.includes("area")) vehicle.frontalAreaM2 = v;
  }

  return {
    stops,
    routes,
    trips,
    stopTimes,
    vehicle,
  };
}
