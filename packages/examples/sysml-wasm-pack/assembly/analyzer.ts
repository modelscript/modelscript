// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  allocF64,
  decodeUtf8,
  kernelResultJson,
  loadF64,
  msx_alloc,
  plotSeriesRefJson,
  returnJsonResult,
  storeF64,
} from "@modelscript/sdk/assembly";

export { msx_alloc };

function extractIntField(json: string, key: string): i32 {
  const needle = '"' + key + '":';
  const idx = json.indexOf(needle);
  if (idx < 0) return -1;
  let start = idx + needle.length;
  let end = start;
  while (end < json.length) {
    const c = json.charCodeAt(end);
    if (c < 48 || c > 57) break;
    end++;
  }
  return start < end ? I32.parseInt(json.slice(start, end)) : -1;
}

export function msx_run_json(_expPtr: usize, _expLen: i32, inPtr: usize, inLen: i32): u64 {
  const inputJson = decodeUtf8(inPtr, inLen);
  const xPtr = extractIntField(inputJson, "xPtr") as usize;
  const yPtr = extractIntField(inputJson, "yPtr") as usize;
  const len = extractIntField(inputJson, "len");

  if (len > 0 && xPtr > 0 && yPtr > 0) {
    let peak: f64 = 0.0;
    for (let i = 0; i < len; i++) {
      const v = loadF64(yPtr, i);
      if (v > peak) peak = v;
    }
    const finalVal = loadF64(yPtr, len - 1);
    const overshoot = peak > 1.0 ? peak - 1.0 : 0.0;
    const settlingError = Math.abs(1.0 - finalVal);
    const plot = plotSeriesRefJson("timeseries", "step", "Plant Step Response", "t (s)", "y", "Simulated", xPtr, yPtr, len);
    const summary = `Analyzed ${len} samples: overshoot=${overshoot.toString()}, settlingError=${settlingError.toString()}`;
    return returnJsonResult(
      `{"ok":true,"kernelId":"analyzeStep","parameters":{"overshoot":${overshoot},"settlingError":${settlingError}},"summary":"${summary}","artifacts":[${plot}]}`
    );
  }

  // Fallback synthetic curve if no waveform was attached
  const n = 20;
  const tx = allocF64(n);
  const ty = allocF64(n);
  for (let i = 0; i < n; i++) {
    const t = (i as f64) * 0.1;
    storeF64(tx, i, t);
    storeF64(ty, i, 1.0 - Math.exp(-t / 0.2));
  }
  const plot = plotSeriesRefJson("timeseries", "step", "Synthetic Step Response", "t (s)", "y", "Analytic", tx, ty, n);
  return returnJsonResult(
    `{"ok":true,"kernelId":"analyzeStep","parameters":{"overshoot":0.0,"settlingError":0.0067},"summary":"Synthesized 20-point step response","artifacts":[${plot}]}`
  );
}
