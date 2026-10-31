// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ccsds — Zero-Regex OMG XTCE Telemetry & Command XML Parser.
 *
 * Ingests OMG XTCE v1.2 telemetry dictionaries, parameter definitions,
 * sequence containers, and command metadata without external XML dependencies.
 */

import type {
  CcsdsRange,
  XtceCommand,
  XtceCommandArgument,
  XtceContainer,
  XtceContainerEntry,
  XtceDocument,
  XtceParameter,
  XtceParameterType,
} from "../types.js";

function parseAttributes(tagContent: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let i = 0;
  const n = tagContent.length;

  // Skip tag name
  while (i < n && !/\s/.test(tagContent[i]!)) i++;

  while (i < n) {
    while (i < n && /\s/.test(tagContent[i]!)) i++;
    if (i >= n) break;

    const keyStart = i;
    while (i < n && tagContent[i] !== "=" && !/\s/.test(tagContent[i]!)) i++;
    const key = tagContent.slice(keyStart, i).trim();

    while (i < n && tagContent[i] !== "=") i++;
    if (i >= n) break;
    i++; // Skip '='

    while (i < n && /\s/.test(tagContent[i]!)) i++;
    if (i >= n) break;

    const quote = tagContent[i];
    if (quote === '"' || quote === "'") {
      i++; // Skip open quote
      const valStart = i;
      while (i < n && tagContent[i] !== quote) i++;
      const val = tagContent.slice(valStart, i);
      if (key) attrs[key] = val;
      if (i < n) i++; // Skip close quote
    } else {
      const valStart = i;
      while (i < n && !/\s/.test(tagContent[i]!) && tagContent[i] !== ">") i++;
      const val = tagContent.slice(valStart, i);
      if (key) attrs[key] = val;
    }
  }

  return attrs;
}

export function parseXtce(source: string): XtceDocument {
  const lines = source.split(/\r?\n/);
  const totalLength = source.length;

  let spaceSystemName = "SatelliteSystem";
  const parameters: XtceParameter[] = [];
  const containers: XtceContainer[] = [];
  const commands: XtceCommand[] = [];

  let currentContainer: Partial<XtceContainer> | null = null;
  let currentEntry: XtceContainerEntry | null = null;
  let currentEntryPrevEndBit = 0;
  let currentLocationRef = "containerStart";
  let currentCommand: Partial<XtceCommand> | null = null;

  let offset = 0;
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx]!;
    const lineStartOffset = offset;
    offset += rawLine.length + 1;
    const line = rawLine.trim();

    if (!line || line.startsWith("<!--")) continue;

    // Check for SpaceSystem
    if (line.includes("<SpaceSystem")) {
      const attrs = parseAttributes(line.slice(line.indexOf("<SpaceSystem")));
      if (attrs["name"]) spaceSystemName = attrs["name"];
    }

    // Check for Parameter definition
    if (line.includes("<Parameter ") || line.includes("<Parameter\t")) {
      const attrs = parseAttributes(line.slice(line.indexOf("<Parameter")));
      const name = attrs["name"] ?? "param";
      const typeRef = (attrs["parameterTypeRef"] ?? "int").toLowerCase();

      let paramType: XtceParameterType = "integer";
      let bitLength = 16;
      if (typeRef.includes("float") || typeRef.includes("double")) {
        paramType = "float";
        bitLength = 32;
      } else if (typeRef.includes("str") || typeRef.includes("char")) {
        paramType = "string";
        bitLength = 64;
      } else if (typeRef.includes("bool")) {
        paramType = "boolean";
        bitLength = 1;
      } else if (typeRef.includes("enum")) {
        paramType = "enumeration";
        bitLength = 8;
      }

      const pRange: CcsdsRange = {
        startLine: lineIdx + 1,
        startColumn: 1,
        endLine: lineIdx + 1,
        endColumn: line.length,
        startOffset: lineStartOffset,
        endOffset: lineStartOffset + line.length,
      };

      parameters.push({
        name,
        paramType,
        bitLength,
        signed: typeRef.includes("uint") ? false : true,
        units: attrs["units"],
        range: pRange,
      });
    }

    // Check for SequenceContainer
    if (line.includes("<SequenceContainer")) {
      const attrs = parseAttributes(line.slice(line.indexOf("<SequenceContainer")));
      const name = attrs["name"] ?? "TelemetryContainer";
      currentContainer = {
        name,
        entries: [],
        range: {
          startLine: lineIdx + 1,
          startColumn: 1,
          endLine: lineIdx + 1,
          endColumn: line.length,
          startOffset: lineStartOffset,
          endOffset: lineStartOffset + line.length,
        },
      };
    }

    if (currentContainer && line.includes("<ParameterRefEntry")) {
      const attrs = parseAttributes(line.slice(line.indexOf("<ParameterRefEntry")));
      const pref = attrs["parameterRef"] ?? "";
      let bitOff = 0;
      if (currentContainer.entries && currentContainer.entries.length > 0) {
        const last = currentContainer.entries[currentContainer.entries.length - 1]!;
        bitOff = last.bitOffset + last.bitLength;
      }
      currentEntryPrevEndBit = bitOff;
      if (attrs["bitOffset"] !== undefined) {
        const parsedOff = parseInt(attrs["bitOffset"], 10);
        if (!Number.isNaN(parsedOff)) bitOff = parsedOff;
      }

      const matchedParam = parameters.find((p) => p.name.toLowerCase() === pref.toLowerCase());
      const bLen =
        attrs["bitLength"] !== undefined
          ? parseInt(attrs["bitLength"], 10)
          : matchedParam
            ? matchedParam.bitLength
            : 16;

      const entry: XtceContainerEntry = {
        parameterRef: pref,
        bitOffset: bitOff,
        bitLength: bLen,
      };
      currentContainer.entries!.push(entry);
      currentEntry = line.includes("/>") || line.includes("</ParameterRefEntry>") ? null : entry;
      currentLocationRef = "containerStart";
    }

    if (currentEntry && line.includes("<LocationInContainerInBits")) {
      const attrs = parseAttributes(line.slice(line.indexOf("<LocationInContainerInBits")));
      currentLocationRef = attrs["referenceLocation"] ?? "containerStart";
      if (attrs["fixedValue"] !== undefined) {
        const v = parseInt(attrs["fixedValue"], 10);
        if (!Number.isNaN(v)) {
          currentEntry.bitOffset = currentLocationRef === "previousEntry" ? currentEntryPrevEndBit + v : v;
        }
      }
    }

    if (currentEntry && line.includes("<FixedValue>") && line.includes("</FixedValue>")) {
      const start = line.indexOf("<FixedValue>") + "<FixedValue>".length;
      const end = line.indexOf("</FixedValue>");
      const v = parseInt(line.slice(start, end).trim(), 10);
      if (!Number.isNaN(v)) {
        currentEntry.bitOffset = currentLocationRef === "previousEntry" ? currentEntryPrevEndBit + v : v;
      }
    }

    if (currentEntry && line.includes("</ParameterRefEntry>")) {
      currentEntry = null;
    }

    if (currentContainer && line.includes("</SequenceContainer>")) {
      containers.push(currentContainer as XtceContainer);
      currentContainer = null;
      currentEntry = null;
    }

    // Check for MetaCommand
    if (line.includes("<MetaCommand")) {
      const attrs = parseAttributes(line.slice(line.indexOf("<MetaCommand")));
      const name = attrs["name"] ?? "Command";
      currentCommand = {
        name,
        arguments: [],
        range: {
          startLine: lineIdx + 1,
          startColumn: 1,
          endLine: lineIdx + 1,
          endColumn: line.length,
          startOffset: lineStartOffset,
          endOffset: lineStartOffset + line.length,
        },
      };
    }

    if (currentCommand && line.includes("<Argument ")) {
      const attrs = parseAttributes(line.slice(line.indexOf("<Argument")));
      const arg: XtceCommandArgument = {
        name: attrs["name"] ?? "arg",
        argType: attrs["argumentTypeRef"] ?? "integer",
        bitLength: 16,
      };
      currentCommand.arguments!.push(arg);
    }

    if (currentCommand && line.includes("</MetaCommand>")) {
      commands.push(currentCommand as XtceCommand);
      currentCommand = null;
    }
  }

  const docRange: CcsdsRange = {
    startLine: 1,
    startColumn: 1,
    endLine: lines.length,
    endColumn: (lines[lines.length - 1]?.length ?? 0) + 1,
    startOffset: 0,
    endOffset: totalLength,
  };

  return {
    format: "XTCE",
    name: spaceSystemName,
    parameters,
    containers,
    commands,
    range: docRange,
  };
}
