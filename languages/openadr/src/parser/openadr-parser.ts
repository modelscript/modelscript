// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  OadrEvent,
  OadrEventStatus,
  OadrInterval,
  OadrProgram,
  OadrSignalType,
  OpenAdrDeck,
} from "../types.js";

export function parseOpenAdr(text: string): OpenAdrDeck {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJsonOpenAdr(trimmed);
  }
  if (trimmed.startsWith("<")) {
    return parseXmlOpenAdr(trimmed);
  }
  return parseDeclarativeOpenAdr(text);
}

function parseJsonOpenAdr(jsonStr: string): OpenAdrDeck {
  try {
    const raw = JSON.parse(jsonStr);
    const events: OadrEvent[] = [];
    const programs: OadrProgram[] = [];

    const rawEvents = Array.isArray(raw)
      ? raw
      : Array.isArray(raw.events)
        ? raw.events
        : [raw];

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

function parseXmlOpenAdr(xmlStr: string): OpenAdrDeck {
  const events: OadrEvent[] = [];
  const eventMatches = Array.from(xmlStr.matchAll(/<(?:\w+:)?eiEvent\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?eiEvent>/gi));

  for (let i = 0; i < eventMatches.length; i++) {
    const block = eventMatches[i]![2]!;
    const idMatch = /<(?:\w+:)?eventID>([^<]+)<\//i.exec(block);
    const statusMatch = /<(?:\w+:)?eventStatus>([^<]+)<\//i.exec(block);
    const venMatch = /<(?:\w+:)?venID>([^<]+)<\//i.exec(block);
    const signalTypeMatch = /<(?:\w+:)?signalType>([^<]+)<\//i.exec(block);

    const intervals: OadrInterval[] = [];
    const intervalMatches = Array.from(block.matchAll(/<(?:\w+:)?interval\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?interval>/gi));

    for (let j = 0; j < intervalMatches.length; j++) {
      const itBlock = intervalMatches[j]![2]!;
      const dtMatch = /<(?:\w+:)?dtstart>[\s\S]*?<(?:\w+:)?date-time>([^<]+)<\//i.exec(itBlock);
      const durMatch = /<(?:\w+:)?duration>[\s\S]*?<(?:\w+:)?duration>PT(\d+)S<\//i.exec(itBlock);
      const durSec = durMatch ? parseInt(durMatch[1]!, 10) : 3600;
      const payloadMatch = /<(?:\w+:)?payloadFloat>([^<]+)<\//i.exec(itBlock);
      const payload = payloadMatch ? parseFloat(payloadMatch[1]!) : 100.0;

      intervals.push({
        start: dtMatch ? dtMatch[1]!.trim() : new Date().toISOString(),
        durationSeconds: durSec,
        payload,
        line: i + 1,
      });
    }

    events.push({
      id: idMatch ? idMatch[1]!.trim() : `OADR-EVT-${i + 1}`,
      status: (statusMatch ? statusMatch[1]!.trim().toLowerCase() : "active") as OadrEventStatus,
      signalType: (signalTypeMatch ? signalTypeMatch[1]!.trim().toLowerCase() : "setpoint") as OadrSignalType,
      targetVenId: venMatch ? venMatch[1]!.trim() : undefined,
      intervals,
      line: i + 1,
    });
  }

  return { programs: [], events };
}

function parseDeclarativeOpenAdr(text: string): OpenAdrDeck {
  const lines = text.split(/\r?\n/);
  const programs: OadrProgram[] = [];
  const allEvents: OadrEvent[] = [];

  let currentProgram: OadrProgram | null = null;
  let currentEvent: OadrEvent | null = null;
  let currentInterval: OadrInterval | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) continue;

    const progMatch = /^program\s+["']?([^"'{]+)["']?\s*\{?/.exec(line);
    if (progMatch) {
      currentProgram = {
        id: progMatch[1]!.trim(),
        name: progMatch[1]!.trim(),
        events: [],
        line: i + 1,
      };
      programs.push(currentProgram);
      continue;
    }

    const evtMatch = /^event\s+["']?([^"'{]+)["']?\s*\{?/.exec(line);
    if (evtMatch) {
      currentEvent = {
        id: evtMatch[1]!.trim(),
        status: "active",
        signalType: "setpoint",
        intervals: [],
        line: i + 1,
      };
      if (currentProgram) {
        currentProgram.events.push(currentEvent);
      }
      allEvents.push(currentEvent);
      continue;
    }

    if (line.startsWith("interval") && line.includes("{") && currentEvent) {
      currentInterval = {
        start: new Date().toISOString(),
        durationSeconds: 3600,
        payload: 100.0,
        line: i + 1,
      };
      currentEvent.intervals.push(currentInterval);
      continue;
    }

    const kvMatch = /^([A-Za-z0-9_]+)\s*[:=]\s*(.+)/.exec(line);
    if (kvMatch) {
      const key = kvMatch[1]!;
      let val = kvMatch[2]!.replace(/[;,]/g, "").trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.substring(1, val.length - 1);
      }

      if (currentInterval) {
        if (key === "start") currentInterval.start = val;
        else if (key === "durationSeconds" || key === "duration") currentInterval.durationSeconds = parseFloat(val);
        else if (key === "payload" || key === "signalPayload") currentInterval.payload = parseFloat(val);
      } else if (currentEvent) {
        if (key === "status") currentEvent.status = val as any;
        else if (key === "signalType") currentEvent.signalType = val as any;
        else if (key === "targetVenId") currentEvent.targetVenId = val;
        else if (key === "programId") currentEvent.programId = val;
      } else if (currentProgram) {
        if (key === "programId" || key === "id") currentProgram.id = val;
        else if (key === "name") currentProgram.name = val;
      }
      continue;
    }

    if (line === "}" || line.startsWith("}")) {
      if (currentInterval) {
        currentInterval = null;
      } else if (currentEvent) {
        currentEvent = null;
      } else if (currentProgram) {
        currentProgram = null;
      }
    }
  }

  return { programs, events: allEvents };
}
