// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChargingProfile, ChargingSession, ChargingStation, Connector, Evse, OcppNetwork } from "../types.js";

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
        stations: raw.stations.map((s: RawOcppStation, idx: number) => normalizeStation(s, idx + 1)),
      };
    }

    // Case 2: Array of stations [...]
    if (Array.isArray(raw)) {
      return {
        stations: raw.map((s: RawOcppStation, idx: number) => normalizeStation(s, idx + 1)),
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
            chargingSchedulePeriod: (cp.chargingSchedule?.chargingSchedulePeriod ?? []).map(
              (p: { startPeriod?: number; limit?: number; numberPhases?: number }) => ({
                startPeriod: p.startPeriod ?? 0,
                limit: p.limit ?? 0,
                numberPhases: p.numberPhases,
              }),
            ),
          },
        };
        const maxKw = profile.chargingSchedule.chargingSchedulePeriod.reduce((max, p) => Math.max(max, p.limit), 100.0);
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

interface RawOcppSession {
  transactionId?: unknown;
  evBatteryCapacityKWh?: unknown;
  currentSoC?: unknown;
  targetSoC?: unknown;
  departureMinutes?: unknown;
  allocatedPowerKW?: unknown;
}

interface RawOcppConnector {
  id?: unknown;
  type?: unknown;
  maxPowerKW?: unknown;
  status?: Connector["status"];
  currentSession?: RawOcppSession;
}

interface RawOcppEvse {
  id?: unknown;
  connectors?: RawOcppConnector[];
}

interface RawOcppStation {
  id?: unknown;
  stationId?: unknown;
  model?: string | undefined;
  vendor?: string | undefined;
  gridLimitKW?: unknown;
  maxPowerKW?: unknown;
  evses?: RawOcppEvse[];
}

function normalizeStation(s: RawOcppStation, defaultLine: number): ChargingStation {
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
              allocatedPowerKW: c.currentSession.allocatedPowerKW
                ? Number(c.currentSession.allocatedPowerKW)
                : undefined,
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
  const tokens = tokenizeDeclarativeOcpp(text);
  return parseDeclarativeOcppTokens(tokens);
}

interface OcppToken {
  kind: "ident" | "string" | "number" | "punct";
  value: string;
  line: number;
}

function isOcppIdentStart(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

function isOcppIdentPart(code: number): boolean {
  return isOcppIdentStart(code) || (code >= 48 && code <= 57) || code === 45;
}

function isOcppDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function tokenizeDeclarativeOcpp(text: string): OcppToken[] {
  const tokens: OcppToken[] = [];
  const len = text.length;
  let i = 0;
  let line = 1;

  while (i < len) {
    const ch = text.charCodeAt(i);

    if (ch === 10) {
      line++;
      i++;
      continue;
    }
    if (ch <= 32) {
      i++;
      continue;
    }

    // Comments: '#' or '//'
    if (ch === 35 || (ch === 47 && i + 1 < len && text.charCodeAt(i + 1) === 47)) {
      while (i < len && text.charCodeAt(i) !== 10) i++;
      continue;
    }

    // Quoted strings
    if (ch === 34 || ch === 39) {
      const quote = ch;
      const startLine = line;
      i++;
      let val = "";
      while (i < len) {
        const c = text.charCodeAt(i);
        if (c === 92 && i + 1 < len) {
          val += text[i + 1]!;
          i += 2;
          continue;
        }
        if (c === quote) {
          i++;
          break;
        }
        if (c === 10) line++;
        val += text[i]!;
        i++;
      }
      tokens.push({ kind: "string", value: val, line: startLine });
      continue;
    }

    // Punctuation
    if (ch === 123 || ch === 125 || ch === 58 || ch === 61 || ch === 44 || ch === 59) {
      tokens.push({ kind: "punct", value: text[i]!, line });
      i++;
      continue;
    }

    // Numbers (including negative and scientific notation)
    if (
      isOcppDigit(ch) ||
      ((ch === 45 || ch === 43) &&
        i + 1 < len &&
        (isOcppDigit(text.charCodeAt(i + 1)) || text.charCodeAt(i + 1) === 46))
    ) {
      const start = i;
      if (ch === 45 || ch === 43) i++;
      while (i < len && isOcppDigit(text.charCodeAt(i))) i++;
      if (i < len && text.charCodeAt(i) === 46) {
        i++;
        while (i < len && isOcppDigit(text.charCodeAt(i))) i++;
      }
      if (i < len && (text.charCodeAt(i) === 101 || text.charCodeAt(i) === 69)) {
        let e = i + 1;
        if (e < len && (text.charCodeAt(e) === 43 || text.charCodeAt(e) === 45)) e++;
        if (e < len && isOcppDigit(text.charCodeAt(e))) {
          i = e;
          while (i < len && isOcppDigit(text.charCodeAt(i))) i++;
        }
      }
      tokens.push({ kind: "number", value: text.slice(start, i), line });
      continue;
    }

    // Identifiers
    if (isOcppIdentStart(ch)) {
      const start = i;
      i++;
      while (i < len && isOcppIdentPart(text.charCodeAt(i))) i++;
      tokens.push({ kind: "ident", value: text.slice(start, i), line });
      continue;
    }

    i++;
  }

  return tokens;
}

function parseDeclarativeOcppTokens(tokens: OcppToken[]): OcppNetwork {
  const stations: ChargingStation[] = [];
  let pos = 0;

  const peek = (offset = 0): OcppToken | undefined => tokens[pos + offset];
  const next = (): OcppToken | undefined => tokens[pos++];
  const skipSeparators = (): void => {
    while (
      pos < tokens.length &&
      tokens[pos]!.kind === "punct" &&
      (tokens[pos]!.value === "," || tokens[pos]!.value === ";")
    ) {
      pos++;
    }
  };
  const consumePunct = (ch: string): boolean => {
    const t = peek();
    if (t && t.kind === "punct" && t.value === ch) {
      pos++;
      return true;
    }
    return false;
  };

  const parseSessionBlock = (connector: Connector): void => {
    const session: ChargingSession = {
      transactionId: `TX-${connector.id}`,
      evBatteryCapacityKWh: 80.0,
      currentSoC: 0.2,
      targetSoC: 0.8,
      departureMinutes: 60,
    };
    connector.currentSession = session;
    connector.status = "Charging";

    consumePunct("{");
    while (pos < tokens.length) {
      skipSeparators();
      if (consumePunct("}")) break;
      const keyTok = next();
      if (!keyTok) break;
      if (consumePunct(":") || consumePunct("=")) {
        const valTok = next();
        if (valTok) {
          const val = valTok.value;
          if (keyTok.value === "transactionId") session.transactionId = val;
          else if (keyTok.value === "evBatteryCapacityKWh") session.evBatteryCapacityKWh = Number.parseFloat(val);
          else if (keyTok.value === "currentSoC") session.currentSoC = Number.parseFloat(val);
          else if (keyTok.value === "targetSoC") session.targetSoC = Number.parseFloat(val);
          else if (keyTok.value === "departureMinutes") session.departureMinutes = Number.parseFloat(val);
        }
      }
      skipSeparators();
    }
  };

  const parseConnectorBlock = (evse: Evse, startLine: number): void => {
    const idTok = peek();
    const id = idTok && idTok.kind === "number" ? Number.parseInt(next()!.value, 10) : evse.connectors.length + 1;
    const connector: Connector = {
      id,
      type: "CCS2",
      maxPowerKW: 50.0,
      status: "Available",
      line: startLine,
    };
    evse.connectors.push(connector);

    consumePunct("{");
    while (pos < tokens.length) {
      skipSeparators();
      if (consumePunct("}")) break;
      const keyTok = next();
      if (!keyTok) break;

      if (keyTok.value === "currentSession") {
        consumePunct(":");
        consumePunct("=");
        if (peek()?.kind === "punct" && peek()?.value === "{") {
          parseSessionBlock(connector);
        }
        continue;
      }

      if (consumePunct(":") || consumePunct("=")) {
        const valTok = next();
        if (valTok) {
          const val = valTok.value;
          if (keyTok.value === "type") connector.type = val;
          else if (keyTok.value === "maxPowerKW") connector.maxPowerKW = Number.parseFloat(val);
          else if (keyTok.value === "status") connector.status = val as Connector["status"];
        }
      }
      skipSeparators();
    }
  };

  const parseEvseBlock = (station: ChargingStation, startLine: number): void => {
    const idTok = peek();
    const id = idTok && idTok.kind === "number" ? Number.parseInt(next()!.value, 10) : station.evses.length + 1;
    const evse: Evse = {
      id,
      connectors: [],
      line: startLine,
    };
    station.evses.push(evse);

    consumePunct("{");
    while (pos < tokens.length) {
      skipSeparators();
      if (consumePunct("}")) break;
      const tok = next();
      if (!tok) break;
      if (tok.kind === "ident" && tok.value === "connector") {
        parseConnectorBlock(evse, tok.line);
      }
      skipSeparators();
    }
  };

  const parseStationBlock = (startLine: number): void => {
    const nameTok = peek();
    const id =
      nameTok && (nameTok.kind === "string" || nameTok.kind === "ident")
        ? next()!.value.trim()
        : `Station_${stations.length + 1}`;
    const station: ChargingStation = {
      id,
      gridLimitKW: 150.0,
      evses: [],
      line: startLine,
    };
    stations.push(station);

    consumePunct("{");
    while (pos < tokens.length) {
      skipSeparators();
      if (consumePunct("}")) break;
      const tok = next();
      if (!tok) break;

      if (tok.kind === "ident" && tok.value === "evse") {
        parseEvseBlock(station, tok.line);
        continue;
      }

      if (consumePunct(":") || consumePunct("=")) {
        const valTok = next();
        if (valTok) {
          const val = valTok.value;
          if (tok.value === "model") station.model = val;
          else if (tok.value === "vendor") station.vendor = val;
          else if (tok.value === "gridLimitKW") station.gridLimitKW = Number.parseFloat(val);
        }
      }
      skipSeparators();
    }
  };

  while (pos < tokens.length) {
    skipSeparators();
    const tok = next();
    if (!tok) break;
    if (tok.kind === "ident" && tok.value === "station") {
      parseStationBlock(tok.line);
    }
  }

  return { stations };
}
