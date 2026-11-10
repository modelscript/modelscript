// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  ChargingProfile,
  ChargingSession,
  ChargingStation,
  Connector,
  Evse,
  OcppNetwork,
} from "../types.js";

export function parseOcpp(text: string): OcppNetwork {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJsonOcpp(trimmed);
  }
  return parseDeclarativeOcpp(text);
}

function parseJsonOcpp(jsonStr: string): OcppNetwork {
  try {
    const raw = JSON.parse(jsonStr);

    // Case 1: An OcppNetwork object { stations: [...] }
    if (raw && Array.isArray(raw.stations)) {
      return {
        stations: raw.stations.map((s: any, idx: number) => normalizeStation(s, idx + 1)),
      };
    }

    // Case 2: Array of stations [...]
    if (Array.isArray(raw)) {
      return {
        stations: raw.map((s: any, idx: number) => normalizeStation(s, idx + 1)),
      };
    }

    // Case 3: Single station or SetChargingProfileRequest
    if (raw && typeof raw === "object") {
      if (raw.chargingProfile || raw.csChargingProfiles) {
        const cp = raw.chargingProfile || raw.csChargingProfiles;
        const profile: ChargingProfile = {
          id: cp.chargingProfileId ?? cp.id ?? 1,
          stackLevel: cp.stackLevel ?? 0,
          chargingProfilePurpose: cp.chargingProfilePurpose ?? "TxDefaultProfile",
          chargingSchedule: {
            id: cp.chargingSchedule?.chargingScheduleId ?? 1,
            chargingRateUnit: cp.chargingSchedule?.chargingRateUnit ?? "kW",
            durationSeconds: cp.chargingSchedule?.duration,
            chargingSchedulePeriod: (cp.chargingSchedule?.chargingSchedulePeriod ?? []).map((p: any) => ({
              startPeriod: p.startPeriod ?? 0,
              limit: p.limit ?? 0,
              numberPhases: p.numberPhases,
            })),
          },
        };
        const maxKw = profile.chargingSchedule.chargingSchedulePeriod.reduce(
          (max, p) => Math.max(max, p.limit),
          100.0,
        );
        return {
          stations: [
            {
              id: raw.chargingStationId ?? "Station_1",
              gridLimitKW: maxKw,
              evses: [
                {
                  id: raw.evseId ?? 1,
                  connectors: [
                    {
                      id: raw.connectorId ?? 1,
                      type: "CCS2",
                      maxPowerKW: maxKw,
                      status: "Charging",
                      currentSession: {
                        transactionId: String(raw.transactionId ?? "TX-1"),
                        evBatteryCapacityKWh: 80.0,
                        currentSoC: 0.2,
                        targetSoC: 0.8,
                        departureMinutes: 60,
                      },
                      line: 1,
                    },
                  ],
                  line: 1,
                },
              ],
              chargingProfiles: [profile],
              line: 1,
            },
          ],
        };
      }

      return {
        stations: [normalizeStation(raw, 1)],
      };
    }

    return { stations: [] };
  } catch {
    return { stations: [] };
  }
}

function normalizeStation(s: any, defaultLine: number): ChargingStation {
  const evses: Evse[] = [];
  if (Array.isArray(s.evses)) {
    for (const e of s.evses) {
      const connectors: Connector[] = [];
      if (Array.isArray(e.connectors)) {
        for (const c of e.connectors) {
          let session: ChargingSession | undefined;
          if (c.currentSession) {
            session = {
              transactionId: String(c.currentSession.transactionId || `TX-${connectors.length + 1}`),
              evBatteryCapacityKWh: Number(c.currentSession.evBatteryCapacityKWh || 80.0),
              currentSoC: Number(c.currentSession.currentSoC ?? 0.2),
              targetSoC: Number(c.currentSession.targetSoC ?? 0.8),
              departureMinutes: Number(c.currentSession.departureMinutes ?? 60),
              allocatedPowerKW: c.currentSession.allocatedPowerKW ? Number(c.currentSession.allocatedPowerKW) : undefined,
            };
          }
          connectors.push({
            id: Number(c.id ?? connectors.length + 1),
            type: String(c.type || "CCS2"),
            maxPowerKW: Number(c.maxPowerKW || 50.0),
            status: c.status || (session ? "Charging" : "Available"),
            currentSession: session,
            line: defaultLine,
          });
        }
      }
      evses.push({
        id: Number(e.id ?? evses.length + 1),
        connectors,
        line: defaultLine,
      });
    }
  }

  return {
    id: String(s.id || s.stationId || "Station_1"),
    model: s.model,
    vendor: s.vendor,
    gridLimitKW: Number(s.gridLimitKW || s.maxPowerKW || 150.0),
    evses,
    line: defaultLine,
  };
}

function parseDeclarativeOcpp(text: string): OcppNetwork {
  const lines = text.split(/\r?\n/);
  const stations: ChargingStation[] = [];

  let currentStation: ChargingStation | null = null;
  let currentEvse: Evse | null = null;
  let currentConnector: Connector | null = null;
  let currentSession: ChargingSession | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) continue;

    // Station header: station "ID" {
    const stMatch = /^station\s+["']?([^"'{]+)["']?\s*\{?/.exec(line);
    if (stMatch) {
      currentStation = {
        id: stMatch[1]!.trim(),
        gridLimitKW: 150.0,
        evses: [],
        line: i + 1,
      };
      stations.push(currentStation);
      continue;
    }

    // EVSE header: evse <id> {
    const evseMatch = /^evse\s+(\d+)\s*\{?/.exec(line);
    if (evseMatch && currentStation) {
      currentEvse = {
        id: parseInt(evseMatch[1]!, 10),
        connectors: [],
        line: i + 1,
      };
      currentStation.evses.push(currentEvse);
      continue;
    }

    // Connector header: connector <id> {
    const connMatch = /^connector\s+(\d+)\s*\{?/.exec(line);
    if (connMatch && currentEvse) {
      currentConnector = {
        id: parseInt(connMatch[1]!, 10),
        type: "CCS2",
        maxPowerKW: 50.0,
        status: "Available",
        line: i + 1,
      };
      currentEvse.connectors.push(currentConnector);
      continue;
    }

    // Current Session block: currentSession: {
    if (line.includes("currentSession") && line.includes("{") && currentConnector) {
      currentSession = {
        transactionId: `TX-${currentConnector.id}`,
        evBatteryCapacityKWh: 80.0,
        currentSoC: 0.2,
        targetSoC: 0.8,
        departureMinutes: 60,
      };
      currentConnector.currentSession = currentSession;
      currentConnector.status = "Charging";
      continue;
    }

    // Key-value pairs
    const kvMatch = /^([A-Za-z0-9_]+)\s*[:=]\s*(.+)/.exec(line);
    if (kvMatch) {
      const key = kvMatch[1]!;
      let val = kvMatch[2]!.replace(/[;,]/g, "").trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.substring(1, val.length - 1);
      }

      if (currentSession) {
        if (key === "transactionId") currentSession.transactionId = val;
        else if (key === "evBatteryCapacityKWh") currentSession.evBatteryCapacityKWh = parseFloat(val);
        else if (key === "currentSoC") currentSession.currentSoC = parseFloat(val);
        else if (key === "targetSoC") currentSession.targetSoC = parseFloat(val);
        else if (key === "departureMinutes") currentSession.departureMinutes = parseFloat(val);
      } else if (currentConnector) {
        if (key === "type") currentConnector.type = val;
        else if (key === "maxPowerKW") currentConnector.maxPowerKW = parseFloat(val);
        else if (key === "status") currentConnector.status = val as any;
      } else if (currentStation) {
        if (key === "model") currentStation.model = val;
        else if (key === "vendor") currentStation.vendor = val;
        else if (key === "gridLimitKW") currentStation.gridLimitKW = parseFloat(val);
      }
      continue;
    }

    // Block closes
    if (line === "}" || line.startsWith("}")) {
      if (currentSession) {
        currentSession = null;
      } else if (currentConnector) {
        currentConnector = null;
      } else if (currentEvse) {
        currentEvse = null;
      } else if (currentStation) {
        currentStation = null;
      }
    }
  }

  return { stations };
}
