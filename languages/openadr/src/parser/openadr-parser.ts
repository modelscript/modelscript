// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { parseXmlSync, type XmlElement } from "@modelscript/dsl/xml";
import { createWasmParserSync, type SyntaxNode } from "@modelscript/openadr/wasm-parser";
import type { OadrEvent, OadrEventStatus, OadrInterval, OadrProgram, OadrSignalType, OpenAdrDeck } from "../types.js";

function getOadrWasmParser(): ReturnType<typeof createWasmParserSync>["parser"] {
  return getOrLoadLanguageWasmParser("openadr", import.meta.url, createWasmParserSync);
}

export function parseOpenAdr(text: string): OpenAdrDeck {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJsonOpenAdr(trimmed);
  }
  if (trimmed.startsWith("<")) {
    return parseXmlOpenAdr(text);
  }
  return parseDeclarativeOpenAdr(text);
}

function parseJsonOpenAdr(jsonStr: string): OpenAdrDeck {
  try {
    const raw = JSON.parse(jsonStr);
    const events: OadrEvent[] = [];
    const programs: OadrProgram[] = [];

    const rawEvents = Array.isArray(raw) ? raw : Array.isArray(raw.events) ? raw.events : [raw];

    for (let i = 0; i < rawEvents.length; i++) {
      const e = rawEvents[i];
      if (!e) continue;
      const intervals: OadrInterval[] = [];
      if (Array.isArray(e.intervals)) {
        for (const it of e.intervals) {
          intervals.push({
            start: String(it.start || it.dtstart || new Date().toISOString()),
            durationSeconds: Number(it.durationSeconds || it.duration || 3600),
            payload: Number(it.payload ?? it.signalPayload ?? 100.0),
            line: i + 1,
          });
        }
      }

      events.push({
        id: String(e.id || e.eventID || `EVENT-${i + 1}`),
        programId: e.programId || e.programName,
        status: (e.status || e.eventStatus || "active") as OadrEventStatus,
        signalType: (e.signalType || "setpoint") as OadrSignalType,
        targetVenId: e.targetVenId || e.venId,
        intervals,
        line: i + 1,
      });
    }

    if (events.length > 0 && events[0]?.programId) {
      programs.push({
        id: events[0]!.programId,
        name: events[0]!.programId,
        events,
        line: 1,
      });
    }

    return { programs, events };
  } catch {
    return { programs: [], events: [] };
  }
}

function localName(name: string): string {
  const idx = name.indexOf(":");
  return idx >= 0 ? name.slice(idx + 1) : name;
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function offsetToLine(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid]! <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi + 1;
}

function findDescendants(root: XmlElement, targetLocalLower: string, out: XmlElement[] = []): XmlElement[] {
  for (const child of root.children) {
    if (localName(child.name).toLowerCase() === targetLocalLower) {
      out.push(child);
    }
    findDescendants(child, targetLocalLower, out);
  }
  return out;
}

function findFirstDescendant(root: XmlElement, targetLocalLower: string): XmlElement | undefined {
  for (const child of root.children) {
    if (localName(child.name).toLowerCase() === targetLocalLower) return child;
    const nested = findFirstDescendant(child, targetLocalLower);
    if (nested) return nested;
  }
  return undefined;
}

function getElementText(el: XmlElement): string {
  return (el.cdata.length > 0 ? el.cdata.join("") : el.text).trim();
}

function parseIsoDurationSeconds(raw: string): number | undefined {
  const s = raw.trim().toUpperCase();
  if (!s.startsWith("PT") || !s.endsWith("S")) return undefined;
  const digits = s.slice(2, -1);
  if (digits.length === 0) return undefined;
  for (let i = 0; i < digits.length; i++) {
    const code = digits.charCodeAt(i);
    if (code < 48 || code > 57) return undefined;
  }
  return Number.parseInt(digits, 10);
}

function parseXmlOpenAdr(xmlStr: string): OpenAdrDeck {
  const doc = parseXmlSync(xmlStr);
  if (!doc.root) return { programs: [], events: [] };

  const lineStarts = computeLineStarts(xmlStr);
  const eventEls =
    localName(doc.root.name).toLowerCase() === "eievent" ? [doc.root] : findDescendants(doc.root, "eievent");

  const events: OadrEvent[] = [];
  for (let i = 0; i < eventEls.length; i++) {
    const evtEl = eventEls[i]!;
    const idEl = findFirstDescendant(evtEl, "eventid");
    const statusEl = findFirstDescendant(evtEl, "eventstatus");
    const venEl = findFirstDescendant(evtEl, "venid");
    const signalTypeEl = findFirstDescendant(evtEl, "signaltype");

    const intervalEls = findDescendants(evtEl, "interval");
    const intervals: OadrInterval[] = [];
    for (const itEl of intervalEls) {
      const dtstartEl = findFirstDescendant(itEl, "dtstart");
      const dateTimeEl = dtstartEl
        ? findFirstDescendant(dtstartEl, "date-time")
        : findFirstDescendant(itEl, "date-time");

      let durSec = 3600;
      const outerDurEl = findFirstDescendant(itEl, "duration");
      if (outerDurEl) {
        const innerDurEl = findFirstDescendant(outerDurEl, "duration") ?? outerDurEl;
        const parsedDur = parseIsoDurationSeconds(getElementText(innerDurEl));
        if (parsedDur !== undefined) durSec = parsedDur;
      }

      const payloadEl = findFirstDescendant(itEl, "payloadfloat");
      const payloadRaw = payloadEl ? Number.parseFloat(getElementText(payloadEl)) : Number.NaN;
      const payload = Number.isFinite(payloadRaw) ? payloadRaw : 100.0;

      intervals.push({
        start: dateTimeEl ? getElementText(dateTimeEl) : new Date().toISOString(),
        durationSeconds: durSec,
        payload,
        line: offsetToLine(lineStarts, itEl.start),
      });
    }

    const idText = idEl ? getElementText(idEl) : "";
    const statusText = statusEl ? getElementText(statusEl).toLowerCase() : "";
    const signalTypeText = signalTypeEl ? getElementText(signalTypeEl).toLowerCase() : "";
    const venText = venEl ? getElementText(venEl) : "";

    events.push({
      id: idText || `OADR-EVT-${i + 1}`,
      status: (statusText || "active") as OadrEventStatus,
      signalType: (signalTypeText || "setpoint") as OadrSignalType,
      targetVenId: venText || undefined,
      intervals,
      line: offsetToLine(lineStarts, evtEl.start),
    });
  }

  return { programs: [], events };
}

function unquote(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

function applyProperty(
  key: string,
  val: string,
  currentProgram: OadrProgram | null,
  currentEvent: OadrEvent | null,
  currentInterval: OadrInterval | null,
): void {
  if (currentInterval) {
    if (key === "start") currentInterval.start = val;
    else if (key === "durationSeconds" || key === "duration") currentInterval.durationSeconds = Number.parseFloat(val);
    else if (key === "payload" || key === "signalPayload") currentInterval.payload = Number.parseFloat(val);
  } else if (currentEvent) {
    if (key === "status") currentEvent.status = val as OadrEventStatus;
    else if (key === "signalType") currentEvent.signalType = val as OadrSignalType;
    else if (key === "targetVenId") currentEvent.targetVenId = val;
    else if (key === "programId") currentEvent.programId = val;
  } else if (currentProgram) {
    if (key === "programId" || key === "id") currentProgram.id = val;
    else if (key === "name") currentProgram.name = val;
  }
}

function walkDeclarativeNode(
  node: SyntaxNode,
  currentProgram: OadrProgram | null,
  currentEvent: OadrEvent | null,
  currentInterval: OadrInterval | null,
  programs: OadrProgram[],
  allEvents: OadrEvent[],
): void {
  if (node.type === "ProgramDecl") {
    const nameNode = node.childForFieldName("name");
    const progName = nameNode ? unquote(nameNode.text) : `PROGRAM-${programs.length + 1}`;
    const prog: OadrProgram = {
      id: progName,
      name: progName,
      events: [],
      line: node.startPosition.row + 1,
    };
    programs.push(prog);
    for (const child of node.children) {
      walkDeclarativeNode(child, prog, null, null, programs, allEvents);
    }
    return;
  }

  if (node.type === "EventDecl") {
    const nameNode = node.childForFieldName("name");
    const evtId = nameNode ? unquote(nameNode.text) : `EVENT-${allEvents.length + 1}`;
    const evt: OadrEvent = {
      id: evtId,
      status: "active",
      signalType: "setpoint",
      intervals: [],
      line: node.startPosition.row + 1,
    };
    if (currentProgram) {
      currentProgram.events.push(evt);
    }
    allEvents.push(evt);
    for (const child of node.children) {
      walkDeclarativeNode(child, currentProgram, evt, null, programs, allEvents);
    }
    return;
  }

  if (node.type === "IntervalDecl") {
    if (!currentEvent) return;
    const interval: OadrInterval = {
      start: new Date().toISOString(),
      durationSeconds: 3600,
      payload: 100.0,
      line: node.startPosition.row + 1,
    };
    currentEvent.intervals.push(interval);
    for (const child of node.children) {
      walkDeclarativeNode(child, currentProgram, currentEvent, interval, programs, allEvents);
    }
    return;
  }

  if (node.type === "PropertyDecl") {
    const keyNode = node.childForFieldName("key");
    const valNode = node.childForFieldName("value");
    if (keyNode && valNode) {
      applyProperty(keyNode.text.trim(), unquote(valNode.text), currentProgram, currentEvent, currentInterval);
    }
    return;
  }

  for (const child of node.children) {
    walkDeclarativeNode(child, currentProgram, currentEvent, currentInterval, programs, allEvents);
  }
}

function parseDeclarativeOpenAdr(text: string): OpenAdrDeck {
  const parser = getOadrWasmParser();
  const tree = parser.parse(text);
  const programs: OadrProgram[] = [];
  const allEvents: OadrEvent[] = [];
  if (tree?.rootNode) {
    walkDeclarativeNode(tree.rootNode, null, null, null, programs, allEvents);
  }
  return { programs, events: allEvents };
}
