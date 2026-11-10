// SPDX-License-Identifier: AGPL-3.0-or-later

export const GtfsErrorCode = {
  PARSE_ERROR: {
    code: 1001,
    rule: "gtfs-parse-error",
    severity: "error" as const,
    message: (err: string) => `Syntax or structure error in GTFS feed: ${err}.`,
  },
  STOP_NOT_FOUND: {
    code: 2001,
    rule: "gtfs-stop-not-found",
    severity: "error" as const,
    message: (stopId: string, tripId: string) =>
      `Stop '${stopId}' referenced in trip '${tripId}' is not declared in stops table.`,
  },
  ROUTE_NOT_FOUND: {
    code: 2002,
    rule: "gtfs-route-not-found",
    severity: "error" as const,
    message: (routeId: string, tripId: string) =>
      `Route '${routeId}' referenced in trip '${tripId}' is not declared in routes table.`,
  },
  EXCESSIVE_TRANSIT_SPEED: {
    code: 3001,
    rule: "gtfs-excessive-speed",
    severity: "error" as const,
    message: (tripId: string, speedKmh: number) =>
      `Trip '${tripId}' segment speed (${speedKmh.toFixed(1)} km/h) exceeds safe urban transit threshold (120 km/h).`,
  },
  EXCESSIVE_ACCELERATION: {
    code: 3002,
    rule: "gtfs-excessive-acceleration",
    severity: "warning" as const,
    message: (tripId: string, accel: number) =>
      `Trip '${tripId}' segment acceleration (${accel.toFixed(2)} m/s^2) exceeds passenger comfort standard (2.5 m/s^2).`,
  },
  BATTERY_DEPLETION: {
    code: 4001,
    rule: "gtfs-battery-depletion",
    severity: "error" as const,
    message: (tripId: string, socPercent: number) =>
      `Electric bus battery SOC drops to ${socPercent.toFixed(1)}% on trip '${tripId}', breaching 10% critical reserve limit.`,
  },
  TIME_REVERSAL: {
    code: 4002,
    rule: "gtfs-time-reversal",
    severity: "error" as const,
    message: (tripId: string, stopSeq: number) =>
      `Trip '${tripId}' sequence ${stopSeq} has arrival time before preceding departure time.`,
  },
};
