// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/c37118 — Parser for IEEE C37.118 PMU Configurations & Synchrophasor Frames.
 */

import type {
  C37118AnalogChannel,
  C37118DataFrame,
  C37118DigitalChannel,
  C37118PhasorChannel,
  C37118PmuConfig,
} from "../types.js";

/**
 * Parse an IEEE C37.118 PMU configuration from JSON or line-based .c37118 / .pmu text.
 */
export function parseC37118(source: string): C37118PmuConfig {
  const trimmed = source.trim();
  if (trimmed.startsWith("{")) {
    const raw = JSON.parse(trimmed) as Partial<C37118PmuConfig>;
    return {
      idcode: Number(raw.idcode ?? 1),
      stn: String(raw.stn ?? "PMU_1"),
      fnom: raw.fnom === 50 ? 50 : 60,
      dataRate: Number(raw.dataRate ?? 30),
      phasors: (raw.phasors ?? []).map((p) => ({
        name: String(p.name),
        type: p.type === "I" ? "I" : "V",
        format: p.format === "rectangular" ? "rectangular" : "polar",
        scaleFactor: Number(p.scaleFactor ?? 1.0),
        initialMag: p.initialMag,
        initialAngleDeg: p.initialAngleDeg,
      })),
      analogs: (raw.analogs ?? []).map((a) => ({
        name: String(a.name),
        units: a.units,
        scaleFactor: Number(a.scaleFactor ?? 1.0),
        initialValue: a.initialValue,
      })),
      digitals: (raw.digitals ?? []).map((d) => ({
        name: String(d.name),
        normalMask: d.normalMask,
      })),
      frames: raw.frames ?? [],
    };
  }

  let idcode = 1;
  let stn = "PMU_1";
  let fnom: 50 | 60 = 60;
  let dataRate = 30;
  const phasors: C37118PhasorChannel[] = [];
  const analogs: C37118AnalogChannel[] = [];
  const digitals: C37118DigitalChannel[] = [];
  const frames: C37118DataFrame[] = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine
      .replace(/#.*$/, "")
      .replace(/\/\/.*$/, "")
      .trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    if (cmd === "pmu") {
      stn = parts[1] ?? stn;
      for (const tok of parts.slice(2)) {
        const [k, v] = tok.split("=");
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        if (k === "idcode") idcode = n;
        else if (k === "fnom") fnom = n === 50 ? 50 : 60;
        else if (k === "rate") dataRate = n;
      }
    } else if (cmd === "phasor" && parts.length >= 3) {
      const name = parts[1]!;
      const type = parts[2]?.toUpperCase() === "I" ? "I" : "V";
      let format: "polar" | "rectangular" = "polar";
      let scaleFactor = 1.0;
      let initialMag: number | undefined;
      let initialAngleDeg: number | undefined;
      for (const tok of parts.slice(3)) {
        const [k, v] = tok.split("=");
        if (k === "format" && v === "rectangular") format = "rectangular";
        else if (k === "scale") scaleFactor = Number(v);
        else if (k === "mag") initialMag = Number(v);
        else if (k === "ang") initialAngleDeg = Number(v);
      }
      phasors.push({ name, type, format, scaleFactor, initialMag, initialAngleDeg });
    } else if (cmd === "analog" && parts.length >= 2) {
      const name = parts[1]!;
      let units: string | undefined;
      let scaleFactor = 1.0;
      let initialValue: number | undefined;
      for (const tok of parts.slice(2)) {
        const [k, v] = tok.split("=");
        if (k === "units") units = v;
        else if (k === "scale") scaleFactor = Number(v);
        else if (k === "init") initialValue = Number(v);
      }
      analogs.push({ name, units, scaleFactor, initialValue });
    } else if (cmd === "digital" && parts.length >= 2) {
      digitals.push({ name: parts[1]! });
    } else if (cmd === "frame" && parts.length >= 4) {
      const timestamp = parts[1]!;
      const freqHz = Number(parts[2]);
      const rocofHzPerSec = Number(parts[3]);
      frames.push({ timestamp, freqHz, rocofHzPerSec, phasors: [] });
    }
  }

  return { idcode, stn, fnom, dataRate, phasors, analogs, digitals, frames };
}
