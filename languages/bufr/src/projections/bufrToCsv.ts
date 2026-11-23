// SPDX-License-Identifier: AGPL-3.0-or-later

import { solveBufrMeteorology } from "../solver/meteo-qa.js";
import type { BufrMessage } from "../types.js";

function csvCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Projects a WMO BUFR message into a flat RFC-4180 CSV table.
 * Emits upper-air sounding levels if present, otherwise surface station summaries.
 */
export function bufrToCsv(message: BufrMessage): string {
  const sol = solveBufrMeteorology(message);

  if (sol.soundingLevels.length > 0) {
    const header = [
      "pressure_pa",
      "altitude_m",
      "isa_altitude_m",
      "hypsometric_altitude_m",
      "temperature_k",
      "dewpoint_k",
      "relative_humidity_pct",
      "potential_temperature_k",
      "wind_dir_deg",
      "wind_speed_ms",
    ];
    const rows = sol.soundingLevels.map((lv) =>
      [
        lv.pressurePa.toFixed(1),
        lv.altitudeM.toFixed(1),
        lv.isaAltitudeM.toFixed(1),
        lv.hypsometricAltitudeM?.toFixed(1) ?? "",
        lv.temperatureK.toFixed(2),
        lv.dewpointK?.toFixed(2) ?? "",
        lv.relativeHumidityPct?.toFixed(1) ?? "",
        lv.potentialTemperatureK.toFixed(2),
        lv.windDirectionDeg?.toFixed(0) ?? "",
        lv.windSpeedMs?.toFixed(1) ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
    return [header.join(","), ...rows].join("\n") + "\n";
  }

  const header = [
    "station_id",
    "timestamp_utc",
    "latitude_deg",
    "longitude_deg",
    "elevation_m",
    "surface_pressure_pa",
    "sea_level_pressure_pa",
    "temperature_k",
    "dewpoint_k",
    "relative_humidity_pct",
    "wind_dir_deg",
    "wind_speed_ms",
    "precipitation_mm",
  ];
  const rows = sol.stations.map((st) =>
    [
      st.stationId,
      st.timestampIso,
      st.latitude?.toFixed(5) ?? "",
      st.longitude?.toFixed(5) ?? "",
      st.elevationM?.toFixed(1) ?? "",
      st.surfacePressurePa?.toFixed(1) ?? "",
      st.seaLevelPressurePa?.toFixed(1) ?? "",
      st.temperatureK?.toFixed(2) ?? "",
      st.dewpointK?.toFixed(2) ?? "",
      st.relativeHumidityPct?.toFixed(1) ?? "",
      st.windDirectionDeg?.toFixed(0) ?? "",
      st.windSpeedMs?.toFixed(1) ?? "",
      st.precipitationMm?.toFixed(1) ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n") + "\n";
}
