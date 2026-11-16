// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE C37.239 (COMFEDE) Common Format for Event Data Exchange (Sequence of Events / SOE).
 *
 * Parses and serializes time-synchronized SOE records (breaker trips, close commands,
 * relay targets, PMU/DFR triggers) used to correlate field switching with EMT validation.
 */

export interface ComfedeHeader {
  stationName: string;
  deviceId: string;
  revisionYear: number;
  startTimestampIso: string;
  timeCode?: string | undefined;
}

export interface ComfedeEventRecord {
  sequenceNumber: number;
  timestampIso: string;
  offsetMs: number;
  channelId: string;
  description: string;
  state: "OPEN" | "CLOSED" | "ASSERTED" | "CLEARED" | "TRIP" | string;
  phase?: "A" | "B" | "C" | "3P" | undefined;
}

export interface ComfedeDocument {
  header: ComfedeHeader;
  events: ComfedeEventRecord[];
}

import { createWasmParserSync } from "@modelscript/comtrade/wasm-parser";
import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { parseXml, type XmlElement } from "@modelscript/dsl/xml";
import { cstLineText, groupAllCstTokensByLine } from "@modelscript/runtime";
import type { ComtradeRecord } from "../types.js";
import { splitCstLineByComma } from "./comname.js";

function getComtradeWasmParser() {
  return getOrLoadLanguageWasmParser("comtrade", import.meta.url, createWasmParserSync);
}

function xmlAttr(el: XmlElement, name: string): string | undefined {
  const lower = name.toLowerCase();
  return el.attributes.find((a) => a.name.toLowerCase() === lower)?.value;
}

function xmlChildText(el: XmlElement, name: string): string | undefined {
  const lower = name.toLowerCase();
  const child = el.children.find((c) => {
    const tag = c.name.includes(":") ? c.name.split(":").pop()! : c.name;
    return tag.toLowerCase() === lower;
  });
  return child?.text?.trim() || undefined;
}

function escapeXml(val: string): string {
  return val
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Parses an IEEE C37.239 COMFEDE XML document (`<COMFEDE>` / `<EventData>`).
 */
export function parseComfedeXml(xmlText: string): ComfedeDocument {
  const doc = parseXml(xmlText);
  const root = doc.root;
  if (!root) {
    throw new Error("Invalid COMFEDE XML: missing root element.");
  }

  const headerEl = root.children.find((c) => c.name.toLowerCase().endsWith("header")) ?? root;

  const header: ComfedeHeader = {
    stationName:
      xmlAttr(headerEl, "stationName") ??
      xmlChildText(headerEl, "StationName") ??
      xmlChildText(headerEl, "Station") ??
      "UNKNOWN_STATION",
    deviceId:
      xmlAttr(headerEl, "deviceId") ??
      xmlChildText(headerEl, "DeviceId") ??
      xmlChildText(headerEl, "Device") ??
      "SOE_1",
    revisionYear:
      Number.parseInt(xmlAttr(headerEl, "revisionYear") ?? xmlChildText(headerEl, "RevisionYear") ?? "2010", 10) ||
      2010,
    startTimestampIso:
      xmlAttr(headerEl, "startTimestamp") ??
      xmlChildText(headerEl, "StartTimestamp") ??
      xmlChildText(headerEl, "StartTime") ??
      new Date(0).toISOString(),
    timeCode: xmlAttr(headerEl, "timeCode") ?? xmlChildText(headerEl, "TimeCode"),
  };

  const eventElements: XmlElement[] = [];
  const collectEvents = (el: XmlElement): void => {
    const local = (el.name.includes(":") ? el.name.split(":").pop()! : el.name).toLowerCase();
    if (local === "event" || local === "eventrecord" || local === "soerecord") {
      eventElements.push(el);
    }
    for (const child of el.children) collectEvents(child);
  };
  collectEvents(root);

  const events: ComfedeEventRecord[] = eventElements.map((ev, idx) => ({
    sequenceNumber:
      Number.parseInt(
        xmlAttr(ev, "sequenceNumber") ?? xmlAttr(ev, "seq") ?? xmlChildText(ev, "SequenceNumber") ?? String(idx + 1),
        10,
      ) || idx + 1,
    timestampIso: xmlAttr(ev, "timestamp") ?? xmlChildText(ev, "Timestamp") ?? header.startTimestampIso,
    offsetMs: Number.parseFloat(xmlAttr(ev, "offsetMs") ?? xmlChildText(ev, "OffsetMs") ?? "0") || 0,
    channelId: xmlAttr(ev, "channelId") ?? xmlChildText(ev, "ChannelId") ?? `CH_${idx + 1}`,
    description: xmlAttr(ev, "description") ?? xmlChildText(ev, "Description") ?? "",
    state: xmlAttr(ev, "state") ?? xmlChildText(ev, "State") ?? "ASSERTED",
    phase: (xmlAttr(ev, "phase") ?? xmlChildText(ev, "Phase")) as ComfedeEventRecord["phase"],
  }));

  return { header, events };
}

/**
 * Serializes a `ComfedeDocument` into IEEE C37.239 XML format.
 */
export function serializeComfedeXml(doc: ComfedeDocument): string {
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<COMFEDE revisionYear="${doc.header.revisionYear}">`,
    `  <Header stationName="${escapeXml(doc.header.stationName)}" deviceId="${escapeXml(doc.header.deviceId)}" startTimestamp="${escapeXml(doc.header.startTimestampIso)}"${doc.header.timeCode ? ` timeCode="${escapeXml(doc.header.timeCode)}"` : ""} />`,
    `  <Events>`,
  ];
  for (const ev of doc.events) {
    lines.push(
      `    <Event sequenceNumber="${ev.sequenceNumber}" timestamp="${escapeXml(ev.timestampIso)}" offsetMs="${ev.offsetMs.toFixed(3)}" channelId="${escapeXml(ev.channelId)}" description="${escapeXml(ev.description)}" state="${escapeXml(ev.state)}"${ev.phase ? ` phase="${escapeXml(ev.phase)}"` : ""} />`,
    );
  }
  lines.push(`  </Events>`, `</COMFEDE>`);
  return lines.join("\n");
}

/**
 * Parses an IEEE C37.239 COMFEDE (SOE) XML or CSV/ASCII document.
 */
export function parseComfede(text: string): ComfedeDocument {
  if (text.trimStart().startsWith("<")) {
    return parseComfedeXml(text);
  }
  const cstTree = getComtradeWasmParser().parse(text);
  const cstLines = groupAllCstTokensByLine(cstTree?.rootNode).filter(({ tokens }) => {
    const line = cstLineText(text, tokens).trim();
    return line.length > 0 && !line.startsWith("#");
  });

  if (cstLines.length < 2) {
    throw new Error("Invalid COMFEDE document: missing header lines.");
  }

  const hdrParts = splitCstLineByComma(text, cstLines[0]!.tokens);
  const timeParts = splitCstLineByComma(text, cstLines[1]!.tokens);

  const header: ComfedeHeader = {
    stationName: hdrParts[0] || "UNKNOWN_STATION",
    deviceId: hdrParts[1] || "SOE_1",
    revisionYear: Number.parseInt(hdrParts[2] ?? "2010", 10) || 2010,
    startTimestampIso: timeParts[0] || new Date(0).toISOString(),
    timeCode: timeParts[1],
  };

  const events: ComfedeEventRecord[] = [];
  for (let idx = 2; idx < cstLines.length; idx++) {
    const cols = splitCstLineByComma(text, cstLines[idx]!.tokens);
    if (cols.length < 6) continue;
    events.push({
      sequenceNumber: Number.parseInt(cols[0]!, 10) || idx - 1,
      timestampIso: cols[1]!,
      offsetMs: Number.parseFloat(cols[2]!) || 0,
      channelId: cols[3]!,
      description: cols[4]!,
      state: cols[5]!,
      phase: cols[6] as ComfedeEventRecord["phase"],
    });
  }

  return { header, events };
}

/**
 * Serializes a `ComfedeDocument` into IEEE C37.239 CSV/ASCII format.
 */
export function serializeComfede(doc: ComfedeDocument): string {
  const lines: string[] = [
    `${doc.header.stationName},${doc.header.deviceId},${doc.header.revisionYear}`,
    `${doc.header.startTimestampIso}${doc.header.timeCode ? `,${doc.header.timeCode}` : ""}`,
  ];
  for (const ev of doc.events) {
    lines.push(
      `${ev.sequenceNumber},${ev.timestampIso},${ev.offsetMs.toFixed(3)},${ev.channelId},${ev.description},${ev.state}${ev.phase ? `,${ev.phase}` : ""}`,
    );
  }
  return lines.join("\n");
}

export interface ComfedeWaveformCorrelation {
  event: ComfedeEventRecord;
  comtradeTimeSec: number;
  nearestSampleIndex: number;
  inWindow: boolean;
}

/**
 * Aligns IEEE C37.239 COMFEDE sequence-of-events records with an IEEE C37.111 COMTRADE waveform.
 */
export function correlateComfedeWithComtrade(
  doc: ComfedeDocument,
  comtrade: ComtradeRecord,
): ComfedeWaveformCorrelation[] {
  const times =
    comtrade.timeSec ?? (comtrade.timestamps ? Float64Array.from(comtrade.timestamps) : new Float64Array(0));
  const comtradeStartMs = comtrade.config?.startTime ? new Date(comtrade.config.startTime).getTime() : Number.NaN;
  const soeStartMs = new Date(doc.header.startTimestampIso).getTime();
  const baseShiftSec =
    Number.isFinite(comtradeStartMs) && Number.isFinite(soeStartMs) ? (soeStartMs - comtradeStartMs) / 1000 : 0;

  const tMin = times.length > 0 ? times[0]! : 0;
  const tMax = times.length > 0 ? times[times.length - 1]! : 0;

  return doc.events.map((event) => {
    const comtradeTimeSec = baseShiftSec + event.offsetMs / 1000;
    let nearestSampleIndex = -1;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (let i = 0; i < times.length; i++) {
      const diff = Math.abs(times[i]! - comtradeTimeSec);
      if (diff < bestDiff) {
        bestDiff = diff;
        nearestSampleIndex = i;
      }
    }
    return {
      event,
      comtradeTimeSec,
      nearestSampleIndex,
      inWindow: times.length > 0 && comtradeTimeSec >= tMin && comtradeTimeSec <= tMax,
    };
  });
}
