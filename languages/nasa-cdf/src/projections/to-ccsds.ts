// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nasa-cdf — Projection to CCSDS Tracking Data Message (TDM / KVN) Metadata.
 */

import { analyzeNasaCdfTelemetry } from "../solver/statistics.js";
import type { CdfDocument } from "../types.js";

function getGlobalAttrValue(doc: CdfDocument, name: string, fallback: string): string {
  const found = doc.globalAttributes.find((g) => g.name.toLowerCase() === name.toLowerCase());
  const val = found?.entries[0]?.values[0];
  return val !== undefined ? String(val) : fallback;
}

/**
 * Projects a `CdfDocument` to CCSDS KVN Tracking/Telemetry Data Message format.
 */
export function nasaCdfToCcsds(doc: CdfDocument): string {
  const summary = analyzeNasaCdfTelemetry(doc);
  const originator = getGlobalAttrValue(doc, "Project", "NASA_SPDF");
  const sourceName = getGlobalAttrValue(doc, "Source_name", doc.header.fileName);
  const discipline = getGlobalAttrValue(doc, "Discipline", "Space Physics");
  const nowIso = new Date().toISOString();

  const lines: string[] = [
    "CCSDS_TDM_VERS = 2.0",
    `CREATION_DATE  = ${summary.startIso ?? nowIso}`,
    `ORIGINATOR     = ${originator}`,
    "META_START",
    "TIME_SYSTEM    = UTC",
    `PARTICIPANT_1  = ${sourceName}`,
    `COMMENT        = Discipline: ${discipline}`,
    `COMMENT        = CDF File: ${doc.header.fileName} (${doc.formatVersion}, ${doc.header.majority})`,
  ];

  if (summary.startIso) lines.push(`START_TIME     = ${summary.startIso}`);
  if (summary.stopIso) lines.push(`STOP_TIME      = ${summary.stopIso}`);
  lines.push("META_STOP");
  lines.push("DATA_START");

  for (const ch of summary.channels) {
    if (Number.isFinite(ch.mean)) {
      lines.push(
        `COMMENT ${ch.name} [${ch.units || "unitless"}] MEAN=${ch.mean.toFixed(6)} MIN=${ch.min.toFixed(6)} MAX=${ch.max.toFixed(6)} RMS=${ch.rms.toFixed(6)}`,
      );
    }
  }
  if (summary.magneticField && Number.isFinite(summary.magneticField.stats.mean)) {
    lines.push(
      `COMMENT |B| (${summary.magneticField.sourceVariable}) [${summary.magneticField.stats.units || "nT"}] MEAN=${summary.magneticField.stats.mean.toFixed(6)}`,
    );
  }

  lines.push("DATA_STOP");
  return lines.join("\n") + "\n";
}
