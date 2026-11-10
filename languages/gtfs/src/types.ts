// SPDX-License-Identifier: AGPL-3.0-or-later

export interface GtfsStop {
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  line?: number | undefined;
}

export interface GtfsRoute {
  route_id: string;
  route_short_name: string;
  route_long_name: string;
  route_type: number; // 0 = Tram, 1 = Subway, 2 = Rail, 3 = Bus, 4 = Ferry
  line?: number | undefined;
}

export interface GtfsTrip {
  route_id: string;
  trip_id: string;
  service_id?: string | undefined;
  shape_id?: string | undefined;
  line?: number | undefined;
}

export interface GtfsStopTime {
  trip_id: string;
  arrival_time: string;
  departure_time: string;
  stop_id: string;
  stop_sequence: number;
  shape_dist_traveled?: number | undefined; // Distance from trip origin in meters
  line?: number | undefined;
}

export interface VehicleKinematicsParams {
  massKg: number;          // Total vehicle mass including passengers (kg)
  frontalAreaM2: number;   // Frontal cross-sectional area (m^2)
  dragCoeff: number;       // Aerodynamic drag coefficient C_d
  rollingResist: number;   // Rolling resistance coefficient mu_rr
  auxPowerKW: number;      // Auxiliary loads (HVAC, lighting, steering)
  batteryKWh: number;      // Total usable battery capacity (kWh)
  regenEfficiency?: number | undefined; // Regenerative braking capture ratio (default 0.65)
}

export interface GtfsFeed {
  stops: GtfsStop[];
  routes: GtfsRoute[];
  trips: GtfsTrip[];
  stopTimes: GtfsStopTime[];
  vehicle?: VehicleKinematicsParams | undefined;
}

export interface TripTractionProfile {
  tripId: string;
  totalDistanceM: number;
  durationSeconds: number;
  averageSpeedKmh: number;
  peakSpeedKmh: number;
  peakTractionKW: number;
  totalEnergyKWh: number;
  finalSoc: number;
}

export interface DepotChargingProfile {
  depotName: string;
  totalFleetCount: number;
  peakDemandKW: number;
  totalDailyEnergyKWh: number;
  hourlyDemandKW: number[];
}
