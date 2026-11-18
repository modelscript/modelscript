// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/iec104 — Parser for IEC 60870-5-104 Station Profiles (JSON / line-based config).
 */

import type { Iec104InformationObject, Iec104StationProfile, Iec104TypeId } from "../types.js";

const VALID_TYPE_IDS = new Set<string>([
  "M_SP_NA_1",
  "M_SP_TB_1",
  "M_DP_NA_1",
  "M_DP_TB_1",
  "M_ME_NC_1",
  "M_ME_TF_1",
  "M_IT_NA_1",
  "C_SC_NA_1",
  "C_DC_NA_1",
  "C_SE_NC_1",
]);

/**
 * Parse an IEC 60870-5-104 station profile from JSON or key-value text.
 */
export function parseIec104(source: string): Iec104StationProfile {
  const trimmed = source.trim();
  if (trimmed.startsWith("{")) {
    const raw = JSON.parse(trimmed) as Partial<Iec104StationProfile>;
    return {
      id: raw.id ?? "iec104_station",
      stationName: raw.stationName ?? "IEC104_RTU",
      commonAddress: raw.commonAddress ?? 1,
      originatorAddress: raw.originatorAddress ?? 0,
      apci: {
        port: raw.apci?.port ?? 2404,
        k: raw.apci?.k ?? 12,
        w: raw.apci?.w ?? 8,
        t0: raw.apci?.t0 ?? 30,
        t1: raw.apci?.t1 ?? 15,
        t2: raw.apci?.t2 ?? 10,
        t3: raw.apci?.t3 ?? 20,
      },
      points: (raw.points ?? []).map((p) => ({
        ioa: Number(p.ioa),
        name: String(p.name ?? `IOA_${p.ioa}`),
        typeId: (VALID_TYPE_IDS.has(p.typeId) ? p.typeId : "M_ME_NC_1") as Iec104TypeId,
        units: p.units,
        scale: p.scale,
        offset: p.offset,
        deadband: p.deadband,
        initialValue: p.initialValue,
      })),
    };
  }

  // Line-oriented .iec104 text format:
  // station <name> ca=<num> oa=<num> port=2404 k=12 w=8
  // point <ioa> <typeId> <name> [units=kV] [scale=1.0] [deadband=0.1]
  let stationName = "IEC104_RTU";
  let commonAddress = 1;
  let originatorAddress = 0;
  let port = 2404;
  let k = 12;
  let w = 8;
  let t0 = 30;
  let t1 = 15;
  let t2 = 10;
  let t3 = 20;
  const points: Iec104InformationObject[] = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine
      .replace(/#.*$/, "")
      .replace(/\/\/.*$/, "")
      .trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    if (cmd === "station") {
      stationName = parts[1] ?? stationName;
      for (const tok of parts.slice(2)) {
        const [kvKey, kvVal] = tok.split("=");
        const n = Number(kvVal);
        if (!Number.isFinite(n)) continue;
        if (kvKey === "ca") commonAddress = n;
        else if (kvKey === "oa") originatorAddress = n;
        else if (kvKey === "port") port = n;
        else if (kvKey === "k") k = n;
        else if (kvKey === "w") w = n;
        else if (kvKey === "t0") t0 = n;
        else if (kvKey === "t1") t1 = n;
        else if (kvKey === "t2") t2 = n;
        else if (kvKey === "t3") t3 = n;
      }
    } else if (cmd === "point" && parts.length >= 4) {
      const ioa = Number(parts[1]);
      const typeId = (VALID_TYPE_IDS.has(parts[2]!) ? parts[2]! : "M_ME_NC_1") as Iec104TypeId;
      const name = parts[3]!;
      let units: string | undefined;
      let scale: number | undefined;
      let offset: number | undefined;
      let deadband: number | undefined;
      let initialValue: number | undefined;
      for (const tok of parts.slice(4)) {
        const [kvKey, kvVal] = tok.split("=");
        if (kvKey === "units") units = kvVal;
        else if (kvKey === "scale") scale = Number(kvVal);
        else if (kvKey === "offset") offset = Number(kvVal);
        else if (kvKey === "deadband") deadband = Number(kvVal);
        else if (kvKey === "init") initialValue = Number(kvVal);
      }
      points.push({ ioa, name, typeId, units, scale, offset, deadband, initialValue });
    }
  }

  return {
    id: stationName,
    stationName,
    commonAddress,
    originatorAddress,
    apci: { port, k, w, t0, t1, t2, t3 },
    points,
  };
}
