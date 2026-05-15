// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  options: {
    tolerance: { type: "string", default: "1e-5" },
    json: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

if (positionals.length < 2) {
  console.error("Usage: npx tsx scripts/compare-trajectories.ts <file1.csv> <file2.csv> [--tolerance=1e-5] [--json]");
  process.exit(1);
}

const file1 = positionals[0]!;
const file2 = positionals[1]!;
const tolerance = parseFloat(values.tolerance as string);

function parseCSV(filePath: string) {
  const content = fs.readFileSync(filePath, "utf-8").trim();
  const lines = content.split("\n");
  const header = lines[0]?.split(",") ?? [];
  const timeIdx = header.indexOf("time");
  if (timeIdx === -1) throw new Error(`No 'time' column in ${filePath}`);

  const times: number[] = [];
  const data: Record<string, number[]> = {};
  for (const col of header) {
    if (col !== "time") data[col] = [];
  }

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]?.trim()) continue;
    const parts = lines[i]!.split(",");
    const t = parseFloat(parts[timeIdx]!);
    times.push(t);
    for (let j = 0; j < header.length; j++) {
      if (j !== timeIdx) {
        data[header[j]!]!.push(parseFloat(parts[j]!));
      }
    }
  }

  return { header, times, data };
}

const csv1 = parseCSV(file1);
const csv2 = parseCSV(file2);

// Find common variables
const commonVars = csv1.header.filter((h) => h !== "time" && csv2.header.includes(h));

// Linear interpolation function
function interpolate(t: number, times: number[], values: number[]): number {
  if (t <= times[0]!) return values[0]!;
  if (t >= times[times.length - 1]!) return values[values.length - 1]!;

  // binary search
  let low = 0,
    high = times.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (times[mid] === t) return values[mid]!;
    if (times[mid]! < t) low = mid + 1;
    else high = mid - 1;
  }

  const idx1 = high;
  const idx2 = low;
  const t1 = times[idx1]!;
  const t2 = times[idx2]!;
  const v1 = values[idx1]!;
  const v2 = values[idx2]!;

  return v1 + (v2 - v1) * ((t - t1) / (t2 - t1));
}

// Compare by interpolating csv2 onto csv1's time grid
const metrics: Record<string, { maxError: number; l2Norm: number; pass: boolean }> = {};

let allPass = true;

for (const v of commonVars) {
  let maxErr = 0;
  let sse = 0;
  let count = 0;

  for (let i = 0; i < csv1.times.length; i++) {
    const t = csv1.times[i]!;
    const val1 = csv1.data[v]![i]!;
    const val2 = interpolate(t, csv2.times, csv2.data[v]!);

    const err = Math.abs(val1 - val2);
    if (err > maxErr) maxErr = err;
    sse += err * err;
    count++;
  }

  const l2Norm = Math.sqrt(sse / count); // RMS error
  const pass = maxErr <= tolerance;
  if (!pass) allPass = false;

  metrics[v] = {
    maxError: maxErr,
    l2Norm: l2Norm,
    pass,
  };
}

const result = {
  file1,
  file2,
  tolerance,
  allPass,
  metrics,
};

if (values.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Comparing: ${file1} vs ${file2}`);
  console.log(`Tolerance: ${tolerance}`);
  console.log(`Overall Result: ${allPass ? "PASS" : "FAIL"}\n`);

  console.log("Variable Metrics:");
  for (const [v, m] of Object.entries(metrics)) {
    console.log(`  ${v}:`);
    console.log(`    Max Error: ${m.maxError.toExponential(4)}`);
    console.log(`    L2 Norm  : ${m.l2Norm.toExponential(4)}`);
    console.log(`    Status   : ${m.pass ? "PASS" : "FAIL"}`);
  }
}

process.exit(allPass ? 0 : 1);
