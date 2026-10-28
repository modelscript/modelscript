// SPDX-License-Identifier: AGPL-3.0-or-later

export interface NormalizedTrajectory {
  time: number[];
  signals: Record<string, number[]>;
}

/**
 * Normalizes simulation outputs from any of the 44 polyglot domain solvers
 * into the canonical `{ time, signals }` trajectory structure expected by `SimulationPanel`.
 */
export function normalizeToTrajectory(raw: unknown): NormalizedTrajectory | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;

  // 1. Canonical { time: number[], signals: Record<string, number[]> }
  if (Array.isArray(data["time"]) && data["signals"] && typeof data["signals"] === "object") {
    return { time: data["time"] as number[], signals: data["signals"] as Record<string, number[]> };
  }

  // 2. { time: number[], series: Record<string, number[]> } (e.g. OpenSCENARIO, SIMA)
  if (
    Array.isArray(data["time"]) &&
    data["series"] &&
    typeof data["series"] === "object" &&
    !Array.isArray(data["series"])
  ) {
    return { time: data["time"] as number[], signals: data["series"] as Record<string, number[]> };
  }

  // 3. { timeS / t / time_s / timeHours: number[], <var>: number[] } (e.g. RELAP5, Adams, URDF, Verilog-A, EnergyPlus, EPANET, SWMM)
  const timeKey = ["time", "timeS", "t", "time_s", "timeHours", "frequencies", "freqHz"].find(
    (k) => Array.isArray(data[k]) && (data[k] as unknown[]).length > 0 && typeof (data[k] as unknown[])[0] === "number",
  );
  if (timeKey) {
    const timeArr: number[] = data[timeKey] as number[];
    const signals: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(data)) {
      if (k === timeKey) continue;
      if (Array.isArray(v) && v.length === timeArr.length && typeof v[0] === "number") {
        signals[k] = v as number[];
      } else if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const [subK, subV] of Object.entries(v as Record<string, unknown>)) {
          if (Array.isArray(subV) && subV.length === timeArr.length && typeof subV[0] === "number") {
            signals[`${k}.${subK}`] = subV as number[];
          }
        }
      }
    }
    if (Object.keys(signals).length > 0) {
      return { time: timeArr, signals };
    }
  }

  // 4. Array of step records: { steps / history / trajectory / frames / points: Array<Record<string, number>> }
  const arrayKey = ["steps", "history", "trajectory", "frames", "points", "states", "samples"].find(
    (k) => Array.isArray(data[k]) && (data[k] as unknown[]).length > 0 && typeof (data[k] as unknown[])[0] === "object",
  );
  if (arrayKey) {
    const rows = data[arrayKey] as Record<string, unknown>[];
    const tField = ["t", "time", "timeS", "step", "index", "s"].find((f) => typeof rows[0]?.[f] === "number");
    const time = rows.map((r, idx) => (tField && typeof r[tField] === "number" ? (r[tField] as number) : idx));
    const signals: Record<string, number[]> = {};
    const first = rows[0] ?? {};
    for (const key of Object.keys(first)) {
      if (key === tField) continue;
      if (typeof first[key] === "number") {
        signals[key] = rows.map((r) => (typeof r[key] === "number" ? (r[key] as number) : 0));
      }
    }
    if (Object.keys(signals).length > 0) {
      return { time, signals };
    }
  }

  return null;
}
