// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ccsds — Zero-Regex OMG XTCE Telemetry & Command XML Parser.
 *
 * Ingests OMG XTCE v1.2 telemetry dictionaries, parameter definitions,
 * sequence containers, and command metadata using @modelscript/dsl/xml.
 */

import { parseXmlSync, type XmlElement } from "@modelscript/dsl/xml";
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

function computeLineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

function offsetToLineCol(offset: number, lineOffsets: number[]): { line: number; column: number } {
  let low = 0;
  let high = lineOffsets.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const midVal = lineOffsets[mid]!;
    if (midVal <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lineIndex = Math.max(0, low - 1);
  return {
    line: lineIndex + 1,
    column: offset - (lineOffsets[lineIndex] ?? 0) + 1,
  };
}

function makeRange(startOffset: number, endOffset: number, lineOffsets: number[]): CcsdsRange {
  const start = offsetToLineCol(startOffset, lineOffsets);
  const end = offsetToLineCol(endOffset, lineOffsets);
  return {
    startOffset,
    endOffset,
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

function getLocalName(name: string): string {
  const idx = name.indexOf(":");
  return (idx >= 0 ? name.slice(idx + 1) : name).toLowerCase();
}

function getAttr(el: XmlElement, ...names: string[]): string | undefined {
  for (const name of names) {
    const lower = name.toLowerCase();
    for (const a of el.attributes) {
      const aName = a.name.toLowerCase();
      const aLocal = aName.includes(":") ? aName.slice(aName.indexOf(":") + 1) : aName;
      if (aName === lower || aLocal === lower) return a.value;
    }
  }
  return undefined;
}

function walkElements(node: XmlElement, visit: (el: XmlElement) => void): void {
  visit(node);
  for (const child of node.children) {
    walkElements(child, visit);
  }
}

export function parseXtce(source: string): XtceDocument {
  const lineOffsets = computeLineOffsets(source);

  let xmlDoc = parseXmlSync(source);
  let offsetShift = 0;
  if ((!xmlDoc.root && source.includes("<")) || (xmlDoc.root && source.slice(xmlDoc.root.end).includes("<"))) {
    const prefix = "<_root_>";
    xmlDoc = parseXmlSync(prefix + source + "</_root_>");
    offsetShift = prefix.length;
  }

  let spaceSystemName = "SatelliteSystem";
  if (xmlDoc.root) {
    const rootTag = getLocalName(xmlDoc.root.name);
    if (rootTag === "spacesystem") {
      const nameAttr = getAttr(xmlDoc.root, "name");
      if (nameAttr) spaceSystemName = nameAttr;
    } else {
      walkElements(xmlDoc.root, (el) => {
        if (getLocalName(el.name) === "spacesystem") {
          const nameAttr = getAttr(el, "name");
          if (nameAttr) spaceSystemName = nameAttr;
        }
      });
    }
  }

  const parameters: XtceParameter[] = [];
  const containers: XtceContainer[] = [];
  const commands: XtceCommand[] = [];

  if (xmlDoc.root) {
    // 1. Extract Parameter definitions
    walkElements(xmlDoc.root, (el) => {
      if (getLocalName(el.name) === "parameter") {
        const name = getAttr(el, "name") ?? "param";
        const typeRef = (getAttr(el, "parameterTypeRef") ?? "int").toLowerCase();

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

        const pStart = Math.max(0, el.start - offsetShift);
        const pEnd = Math.max(0, el.end - offsetShift);
        parameters.push({
          name,
          paramType,
          bitLength,
          signed: typeRef.includes("uint") ? false : true,
          units: getAttr(el, "units"),
          range: makeRange(pStart, pEnd, lineOffsets),
        });
      }
    });

    // 2. Extract SequenceContainers and ParameterRefEntries
    walkElements(xmlDoc.root, (el) => {
      if (getLocalName(el.name) === "sequencecontainer") {
        const name = getAttr(el, "name") ?? "TelemetryContainer";
        const entries: XtceContainerEntry[] = [];
        let prevEndBit = 0;

        walkElements(el, (child) => {
          if (getLocalName(child.name) === "parameterrefentry") {
            const pref = getAttr(child, "parameterRef") ?? "";
            let bitOff = prevEndBit;
            const bitOffsetAttr = getAttr(child, "bitOffset");
            if (bitOffsetAttr !== undefined) {
              const parsedOff = parseInt(bitOffsetAttr, 10);
              if (!Number.isNaN(parsedOff)) bitOff = parsedOff;
            }

            const matchedParam = parameters.find((p) => p.name.toLowerCase() === pref.toLowerCase());
            const bitLenAttr = getAttr(child, "bitLength");
            const bLen =
              bitLenAttr !== undefined ? parseInt(bitLenAttr, 10) : matchedParam ? matchedParam.bitLength : 16;

            // Check for LocationInContainerInBits or FixedValue within this ParameterRefEntry
            let locationRef = "containerStart";
            walkElements(child, (locEl) => {
              const locTag = getLocalName(locEl.name);
              if (locTag === "locationincontainerinbits") {
                locationRef = getAttr(locEl, "referenceLocation") ?? "containerStart";
                const fixedValAttr = getAttr(locEl, "fixedValue");
                if (fixedValAttr !== undefined) {
                  const v = parseInt(fixedValAttr, 10);
                  if (!Number.isNaN(v)) {
                    bitOff = locationRef === "previousEntry" ? prevEndBit + v : v;
                  }
                }
              } else if (locTag === "fixedvalue") {
                const textVal = locEl.text.trim();
                if (textVal) {
                  const v = parseInt(textVal, 10);
                  if (!Number.isNaN(v)) {
                    bitOff = locationRef === "previousEntry" ? prevEndBit + v : v;
                  }
                }
              }
            });

            entries.push({
              parameterRef: pref,
              bitOffset: bitOff,
              bitLength: bLen,
            });
            prevEndBit = bitOff + bLen;
          }
        });

        const cStart = Math.max(0, el.start - offsetShift);
        const cEnd = Math.max(0, el.end - offsetShift);
        containers.push({
          name,
          entries,
          range: makeRange(cStart, cEnd, lineOffsets),
        });
      }
    });

    // 3. Extract MetaCommands and Arguments
    walkElements(xmlDoc.root, (el) => {
      if (getLocalName(el.name) === "metacommand") {
        const name = getAttr(el, "name") ?? "Command";
        const args: XtceCommandArgument[] = [];

        walkElements(el, (child) => {
          if (getLocalName(child.name) === "argument") {
            args.push({
              name: getAttr(child, "name") ?? "arg",
              argType: getAttr(child, "argumentTypeRef") ?? "integer",
              bitLength: 16,
            });
          }
        });

        const cmdStart = Math.max(0, el.start - offsetShift);
        const cmdEnd = Math.max(0, el.end - offsetShift);
        commands.push({
          name,
          arguments: args,
          range: makeRange(cmdStart, cmdEnd, lineOffsets),
        });
      }
    });
  }

  const lastLine = lineOffsets.length;
  const lastLineStart = lineOffsets[lastLine - 1] ?? 0;
  const docRange: CcsdsRange = {
    startLine: 1,
    startColumn: 1,
    endLine: lastLine,
    endColumn: source.length - lastLineStart + 1,
    startOffset: 0,
    endOffset: source.length,
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
