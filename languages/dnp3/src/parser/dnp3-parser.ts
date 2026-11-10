// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE 1815 / DNP3 SCADA Device Profile Parser.
 *
 * Ingests XML Device Profile documents (compliant with IEEE Std 1815-2012 / DNP3 Technical Committee)
 * and JSON SCADA point map configurations.
 */

import type {
  Dnp3AnalogInput,
  Dnp3AnalogOutput,
  Dnp3BinaryInput,
  Dnp3BinaryOutput,
  Dnp3Counter,
  Dnp3DeviceProfile,
  Dnp3EventClass,
} from "../types.js";

function parseXmlAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*["']([^"']*)["']/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrString)) !== null) {
    attrs[match[1]!] = match[2]!;
  }
  return attrs;
}

export function parseDnp3(content: string): Dnp3DeviceProfile {
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    return parseDnp3Json(trimmed);
  }
  return parseDnp3Xml(trimmed);
}

export function parseDnp3Xml(xmlText: string): Dnp3DeviceProfile {
  let id = "DNP3_Device";
  let deviceName = "DNP3 Outstation";
  let vendor = "Generic Utility";
  let version = "1.0";
  let outstationAddress = 10;
  let masterAddress = 1;

  const idMatch = /<[a-zA-Z0-9_:-]*DeviceIdentity\b[^>]*>([\s\S]*?)<\/[a-zA-Z0-9_:-]*DeviceIdentity>/i.exec(xmlText);
  if (idMatch && idMatch[1]) {
    const c = idMatch[1];
    const devMatch = /<[a-zA-Z0-9_:-]*DeviceName\b[^>]*>([^<]*)<\//i.exec(c);
    if (devMatch && devMatch[1]) deviceName = devMatch[1].trim();

    const vMatch = /<[a-zA-Z0-9_:-]*Vendor\b[^>]*>([^<]*)<\//i.exec(c);
    if (vMatch && vMatch[1]) vendor = vMatch[1].trim();

    const verMatch = /<[a-zA-Z0-9_:-]*Version\b[^>]*>([^<]*)<\//i.exec(c);
    if (verMatch && verMatch[1]) version = verMatch[1].trim();
  }

  const addrMatch = /<[a-zA-Z0-9_:-]*OutstationAddress\b[^>]*>([^<]*)<\//i.exec(xmlText);
  if (addrMatch && addrMatch[1]) outstationAddress = parseInt(addrMatch[1].trim(), 10) || 10;

  const mAddrMatch = /<[a-zA-Z0-9_:-]*MasterAddress\b[^>]*>([^<]*)<\//i.exec(xmlText);
  if (mAddrMatch && mAddrMatch[1]) masterAddress = parseInt(mAddrMatch[1].trim(), 10) || 1;

  const binaryInputs: Dnp3BinaryInput[] = [];
  const biRegex = /<[a-zA-Z0-9_:-]*BinaryInput\b([^>]*?)(?:\/>|>([\s\S]*?)<\/[a-zA-Z0-9_:-]*BinaryInput>)/gi;
  let biMatch: RegExpExecArray | null;
  while ((biMatch = biRegex.exec(xmlText)) !== null) {
    const attrs = parseXmlAttrs(biMatch[1] || "");
    const idx = parseInt(attrs["index"] || attrs["idx"] || String(binaryInputs.length), 10);
    const name = attrs["name"] || attrs["pointName"] || `BI_${idx}`;
    const cls = (parseInt(attrs["class"] || "1", 10) as Dnp3EventClass) || 1;
    const normal = attrs["normalState"] ? (parseInt(attrs["normalState"], 10) as 0 | 1) : undefined;
    binaryInputs.push({ index: idx, name, eventClass: cls, normalState: normal });
  }

  const binaryOutputs: Dnp3BinaryOutput[] = [];
  const boRegex = /<[a-zA-Z0-9_:-]*BinaryOutput\b([^>]*?)(?:\/>|>([\s\S]*?)<\/[a-zA-Z0-9_:-]*BinaryOutput>)/gi;
  let boMatch: RegExpExecArray | null;
  while ((boMatch = boRegex.exec(xmlText)) !== null) {
    const attrs = parseXmlAttrs(boMatch[1] || "");
    const idx = parseInt(attrs["index"] || attrs["idx"] || String(binaryOutputs.length), 10);
    const name = attrs["name"] || attrs["pointName"] || `BO_${idx}`;
    binaryOutputs.push({ index: idx, name });
  }

  const analogInputs: Dnp3AnalogInput[] = [];
  const aiRegex = /<[a-zA-Z0-9_:-]*AnalogInput\b([^>]*?)(?:\/>|>([\s\S]*?)<\/[a-zA-Z0-9_:-]*AnalogInput>)/gi;
  let aiMatch: RegExpExecArray | null;
  while ((aiMatch = aiRegex.exec(xmlText)) !== null) {
    const attrs = parseXmlAttrs(aiMatch[1] || "");
    const idx = parseInt(attrs["index"] || attrs["idx"] || String(analogInputs.length), 10);
    const name = attrs["name"] || attrs["pointName"] || `AI_${idx}`;
    const cls = (parseInt(attrs["class"] || "2", 10) as Dnp3EventClass) || 2;
    const deadband = parseFloat(attrs["deadband"] || "0.0") || 0.0;
    const mult = parseFloat(attrs["mult"] || attrs["multiplier"] || "1.0") || 1.0;
    const offset = parseFloat(attrs["offset"] || "0.0") || 0.0;
    const units = attrs["units"] || attrs["unit"] || "";
    const minVal = attrs["min"] ? parseFloat(attrs["min"]) : undefined;
    const maxVal = attrs["max"] ? parseFloat(attrs["max"]) : undefined;

    analogInputs.push({
      index: idx,
      name,
      eventClass: cls,
      deadband,
      scalingMultiplier: mult,
      scalingOffset: offset,
      units,
      minVal,
      maxVal,
    });
  }

  const analogOutputs: Dnp3AnalogOutput[] = [];
  const aoRegex = /<[a-zA-Z0-9_:-]*AnalogOutput\b([^>]*?)(?:\/>|>([\s\S]*?)<\/[a-zA-Z0-9_:-]*AnalogOutput>)/gi;
  let aoMatch: RegExpExecArray | null;
  while ((aoMatch = aoRegex.exec(xmlText)) !== null) {
    const attrs = parseXmlAttrs(aoMatch[1] || "");
    const idx = parseInt(attrs["index"] || attrs["idx"] || String(analogOutputs.length), 10);
    const name = attrs["name"] || attrs["pointName"] || `AO_${idx}`;
    const units = attrs["units"] || attrs["unit"] || undefined;
    const minVal = attrs["min"] ? parseFloat(attrs["min"]) : undefined;
    const maxVal = attrs["max"] ? parseFloat(attrs["max"]) : undefined;
    analogOutputs.push({ index: idx, name, units, minVal, maxVal });
  }

  const counters: Dnp3Counter[] = [];
  const ctrRegex = /<[a-zA-Z0-9_:-]*Counter\b([^>]*?)(?:\/>|>([\s\S]*?)<\/[a-zA-Z0-9_:-]*Counter>)/gi;
  let ctrMatch: RegExpExecArray | null;
  while ((ctrMatch = ctrRegex.exec(xmlText)) !== null) {
    const attrs = parseXmlAttrs(ctrMatch[1] || "");
    const idx = parseInt(attrs["index"] || attrs["idx"] || String(counters.length), 10);
    const name = attrs["name"] || attrs["pointName"] || `CTR_${idx}`;
    const cls = (parseInt(attrs["class"] || "1", 10) as Dnp3EventClass) || 1;
    const units = attrs["units"] || attrs["unit"] || undefined;
    counters.push({ index: idx, name, eventClass: cls, units });
  }

  return {
    id,
    deviceName,
    vendor,
    version,
    outstationAddress,
    masterAddress,
    binaryInputs,
    binaryOutputs,
    analogInputs,
    analogOutputs,
    counters,
  };
}

export function parseDnp3Json(jsonText: string): Dnp3DeviceProfile {
  const data = JSON.parse(jsonText);
  return {
    id: data.id || "DNP3_JSON_Device",
    deviceName: data.deviceName || "DNP3 Device",
    vendor: data.vendor || "Generic Vendor",
    version: data.version || "1.0",
    outstationAddress: data.outstationAddress ?? 10,
    masterAddress: data.masterAddress ?? 1,
    binaryInputs: data.binaryInputs || [],
    binaryOutputs: data.binaryOutputs || [],
    analogInputs: data.analogInputs || [],
    analogOutputs: data.analogOutputs || [],
    counters: data.counters || [],
  };
}
