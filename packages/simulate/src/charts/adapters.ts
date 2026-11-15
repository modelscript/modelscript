// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IndexAxisDescriptor, IndexedDataset, SeriesDescriptor } from "./types.js";

const DEPTH_KEYS = new Set(["depth", "dept", "md", "tvd", "tvdss", "z"]);
const TIME_KEYS = new Set(["time", "t", "elapsed", "timestamp"]);
const FREQ_KEYS = new Set(["frequency", "freq", "f", "hz"]);

/**
 * Infers an `IndexAxisDescriptor` from row data and an optional explicit key.
 */
export function detectIndexAxis(
  rows: Record<string, unknown>[],
  explicit?: {
    key?: string | undefined;
    label?: string | undefined;
    unit?: string | undefined;
    inverted?: boolean | undefined;
    nullValue?: number | undefined;
    scale?: "linear" | "log" | undefined;
  },
): IndexAxisDescriptor {
  const buildAxis = (
    key: string,
    defaultLabel: string,
    defaultUnit: string | undefined,
    defaultInverted: boolean,
  ): IndexAxisDescriptor => ({
    key,
    label: explicit?.label ?? defaultLabel,
    unit: explicit?.unit ?? defaultUnit,
    inverted: explicit?.inverted ?? defaultInverted,
    nullValue: explicit?.nullValue,
    scale: explicit?.scale,
  });

  if (explicit?.key) {
    const lower = explicit.key.toLowerCase();
    const isDepth = DEPTH_KEYS.has(lower);
    const isTime = TIME_KEYS.has(lower);
    const isFreq = FREQ_KEYS.has(lower);
    return buildAxis(
      explicit.key,
      isDepth ? "Depth" : isTime ? "Time" : isFreq ? "Frequency" : explicit.key,
      isTime ? "s" : isFreq ? "Hz" : undefined,
      isDepth,
    );
  }

  const candidateKeys: string[] = [];
  const seen = new Set<string>();
  const sampleCount = Math.min(rows.length, 50);
  for (let i = 0; i < sampleCount; i++) {
    const row = rows[i];
    if (!row) continue;
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        candidateKeys.push(k);
      }
    }
  }

  const hasNumeric = (key: string): boolean =>
    rows.some((r) => typeof r?.[key] === "number" && Number.isFinite(r[key]));

  for (const key of candidateKeys) {
    if (TIME_KEYS.has(key.toLowerCase()) && hasNumeric(key)) {
      return buildAxis(key, "Time", "s", false);
    }
  }
  for (const key of candidateKeys) {
    if (DEPTH_KEYS.has(key.toLowerCase()) && hasNumeric(key)) {
      return buildAxis(key, "Depth", undefined, true);
    }
  }
  for (const key of candidateKeys) {
    if (FREQ_KEYS.has(key.toLowerCase()) && hasNumeric(key)) {
      return buildAxis(key, "Frequency", "Hz", false);
    }
  }

  const fallback = candidateKeys.find(hasNumeric) ?? "time";
  return buildAxis(fallback, fallback, undefined, false);
}

/**
 * Converts a ModelScript ODE/DAE simulation output (`{ t, y, states }`) into an `IndexedDataset`.
 */
export function simulationToDataset(input: {
  t: number[];
  y: number[][];
  states: string[];
  variableMetadata?: Record<string, { unit?: string | undefined; description?: string | undefined }> | undefined;
  title?: string | undefined;
  metadata?: Record<string, string | number | boolean> | undefined;
}): IndexedDataset {
  const n = input.t.length;
  const series: SeriesDescriptor[] = input.states.map((name, sIdx) => {
    const values = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      values[i] = input.y[i]?.[sIdx] ?? NaN;
    }
    const meta = input.variableMetadata?.[name];
    return {
      name,
      ...(meta?.unit !== undefined ? { unit: meta.unit } : {}),
      ...(meta?.description !== undefined ? { description: meta.description } : {}),
      values,
    };
  });

  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    sourceFormat: "simulation",
    indexAxis: {
      key: "time",
      label: "Time",
      unit: "s",
      inverted: false,
    },
    indexValues: input.t.slice(),
    series,
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  };
}

/**
 * Converts row-oriented tabular records (e.g., parsed CSV or JSON trajectories) into an `IndexedDataset`.
 */
export function rowsToDataset(
  rows: Record<string, unknown>[],
  options?: {
    indexKey?: string | undefined;
    indexLabel?: string | undefined;
    indexUnit?: string | undefined;
    inverted?: boolean | undefined;
    nullValue?: number | undefined;
    title?: string | undefined;
    sourceFormat?: string | undefined;
  },
): IndexedDataset {
  const indexAxis = detectIndexAxis(rows, {
    key: options?.indexKey,
    label: options?.indexLabel,
    unit: options?.indexUnit,
    inverted: options?.inverted,
    nullValue: options?.nullValue,
  });

  const keys = new Set<string>();
  const sampleCount = Math.min(rows.length, 50);
  for (let i = 0; i < sampleCount; i++) {
    const row = rows[i];
    if (!row) continue;
    for (const k of Object.keys(row)) keys.add(k);
  }

  const varNames = Array.from(keys).filter(
    (k) => k !== indexAxis.key && rows.some((row) => typeof row?.[k] === "number" && Number.isFinite(row[k])),
  );

  const indexValues = rows.map((row, i) => {
    const raw = row?.[indexAxis.key];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : i;
  });

  const series: SeriesDescriptor[] = varNames.map((name) => ({
    name,
    values: rows.map((row) => {
      const raw = row?.[name];
      return typeof raw === "number" && Number.isFinite(raw) ? raw : NaN;
    }),
  }));

  return {
    ...(options?.title !== undefined ? { title: options.title } : {}),
    sourceFormat: options?.sourceFormat ?? "tabular",
    indexAxis,
    indexValues,
    series,
  };
}

/**
 * Converts an `IndexedDataset` into row-oriented records for tabular/Recharts consumers.
 */
export function datasetToRows(dataset: IndexedDataset): Record<string, number>[] {
  const n = dataset.indexValues.length;
  const key = dataset.indexAxis.key;
  const rows: Record<string, number>[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const row: Record<string, number> = { [key]: dataset.indexValues[i]! };
    for (let s = 0; s < dataset.series.length; s++) {
      const ser = dataset.series[s]!;
      row[ser.name] = ser.values[i] ?? NaN;
    }
    rows[i] = row;
  }
  return rows;
}

function escapeCsvField(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Serializes an `IndexedDataset` into RFC-4180 CSV text.
 */
export function datasetToCsv(dataset: IndexedDataset): string {
  const headers = [dataset.indexAxis.key, ...dataset.series.map((s) => s.name)].map(escapeCsvField);
  const lines = [headers.join(",")];
  const n = dataset.indexValues.length;

  for (let i = 0; i < n; i++) {
    const idxVal = dataset.indexValues[i];
    const row = [Number.isFinite(idxVal) ? String(idxVal) : ""];
    for (let s = 0; s < dataset.series.length; s++) {
      const val = dataset.series[s]!.values[i];
      row.push(typeof val === "number" && Number.isFinite(val) ? String(val) : "");
    }
    lines.push(row.join(","));
  }
  return lines.join("\n");
}
