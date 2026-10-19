// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Semantic Linter for SSP SystemStructureDescription (.ssd) XML files.
 *
 * Validates component declarations, connector definitions, connection endpoint
 * resolution, connector type compatibility, causal signal direction, parameter
 * binding prefixes, and default experiment time bounds — reporting exact,
 * narrow byte and 1-indexed line/column ranges for each offending XML attribute value.
 */

import type { SspConnectorKind, SspConnectorType } from "./types.js";

/**
 * Diagnostic emitted by the SSP/SSV semantic linter with exact byte and 1-indexed line/column spans.
 */
export interface SspDiagnostic {
  /** Machine-readable diagnostic code (e.g., `"SSP_CONNECTOR_TYPE_MISMATCH"`). */
  code: string;
  /** Diagnostic severity level. */
  severity: "error" | "warning" | "info";
  /** Human-readable diagnostic description. */
  message: string;
  /** 0-indexed character/byte start offset in XML */
  startOffset: number;
  /** 0-indexed character/byte end offset in XML */
  endOffset: number;
  /** 1-indexed start line */
  line: number;
  /** 1-indexed start column */
  column: number;
  /** 1-indexed end line */
  endLine: number;
  /** 1-indexed end column */
  endColumn: number;
}

/** Allowed values for the `kind` attribute on `<ssd:Connector>` elements per SSP 1.0. */
const VALID_CONNECTOR_KINDS = new Set<string>(["input", "output", "inout", "parameter", "calculatedParameter"]);

/**
 * Binary-search line/column locator over raw XML source text.
 */
class LineLocator {
  private lineStarts: number[] = [0];

  constructor(private source: string) {
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10) {
        this.lineStarts.push(i + 1);
      }
    }
  }

  /**
   * Convert a 0-indexed character offset into a 1-indexed `{ line, column }` position.
   */
  offsetToPos(offset: number): { line: number; column: number } {
    const clamped = Math.max(0, Math.min(offset, this.source.length));
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (this.lineStarts[mid]! <= clamped) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const lineIdx = Math.max(0, low - 1);
    return {
      line: lineIdx + 1,
      column: clamped - this.lineStarts[lineIdx]! + 1,
    };
  }
}

/**
 * Source byte spans of a located XML element tag, its attributes, and its inner body.
 */
interface LocatedTag {
  tagName: string;
  tagStart: number;
  tagNameEnd: number;
  attrsStart: number;
  attrsEnd: number;
  bodyStart: number;
  bodyEnd: number;
}

/**
 * Source byte spans of an XML attribute and its quoted value within a `LocatedTag`.
 */
interface LocatedAttr {
  value: string;
  valueStart: number;
  valueEnd: number;
  attrStart: number;
  attrEnd: number;
}

/**
 * Find all occurrences of `<tag ...>` within `[rangeStart, rangeEnd)` along with their attribute and body spans.
 */
function findTagOccurrences(xml: string, tag: string, rangeStart = 0, rangeEnd = xml.length): LocatedTag[] {
  const results: LocatedTag[] = [];
  const openTag = `<${tag}`;
  const closeTag = `</${tag}>`;
  let pos = rangeStart;

  while (pos < rangeEnd) {
    const startIdx = xml.indexOf(openTag, pos);
    if (startIdx === -1 || startIdx >= rangeEnd) break;

    const afterOpen = startIdx + openTag.length;
    const charAfter = xml[afterOpen];
    if (
      charAfter !== undefined &&
      charAfter !== " " &&
      charAfter !== "\t" &&
      charAfter !== "\r" &&
      charAfter !== "\n" &&
      charAfter !== ">" &&
      charAfter !== "/"
    ) {
      pos = afterOpen;
      continue;
    }

    const tagEnd = xml.indexOf(">", afterOpen);
    if (tagEnd === -1 || tagEnd >= rangeEnd) break;

    const isSelfClosing = xml[tagEnd - 1] === "/";
    const attrsEnd = isSelfClosing ? tagEnd - 1 : tagEnd;

    if (isSelfClosing) {
      results.push({
        tagName: tag,
        tagStart: startIdx,
        tagNameEnd: afterOpen,
        attrsStart: afterOpen,
        attrsEnd,
        bodyStart: tagEnd + 1,
        bodyEnd: tagEnd + 1,
      });
      pos = tagEnd + 1;
    } else {
      const closeIdx = xml.indexOf(closeTag, tagEnd + 1);
      if (closeIdx === -1 || closeIdx > rangeEnd) {
        results.push({
          tagName: tag,
          tagStart: startIdx,
          tagNameEnd: afterOpen,
          attrsStart: afterOpen,
          attrsEnd,
          bodyStart: tagEnd + 1,
          bodyEnd: tagEnd + 1,
        });
        pos = tagEnd + 1;
      } else {
        results.push({
          tagName: tag,
          tagStart: startIdx,
          tagNameEnd: afterOpen,
          attrsStart: afterOpen,
          attrsEnd,
          bodyStart: tagEnd + 1,
          bodyEnd: closeIdx,
        });
        pos = closeIdx + closeTag.length;
      }
    }
  }

  return results;
}

/**
 * Locate a named XML attribute within `tag` and compute exact byte offsets for its value.
 */
function locateAttr(xml: string, tag: LocatedTag, attrName: string): LocatedAttr | null {
  const attrsSlice = xml.slice(tag.attrsStart, tag.attrsEnd);
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b(${escaped})\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
  const m = re.exec(attrsSlice);
  if (!m) return null;

  const attrStart = tag.attrsStart + m.index;
  const attrEnd = attrStart + m[0].length;
  const val = m[2] ?? m[3] ?? "";
  // Quote char is the last char of m[0], and opening quote is at attrEnd - val.length - 1
  const rawValueStart = attrEnd - val.length - 1;
  const rawValueEnd = attrEnd - 1;

  // If the value is empty `""`, highlight the quotes `""` so the diagnostic range is non-empty
  const valueStart = val.length > 0 ? rawValueStart : rawValueStart - 1;
  const valueEnd = val.length > 0 ? rawValueEnd : rawValueEnd + 1;

  return {
    value: val,
    valueStart,
    valueEnd,
    attrStart,
    attrEnd,
  };
}

/**
 * Metadata and source byte range for a validated `<ssd:Connector>` declaration.
 */
interface ParsedConnectorInfo {
  name: string;
  kind: SspConnectorKind;
  type: SspConnectorType;
  unit?: string | undefined;
  nameRange: { start: number; end: number };
}

/**
 * Determine the SSP scalar data type and optional physical unit from a connector's `<ssc:*>` child element.
 */
function detectConnectorType(
  xml: string,
  bodyStart: number,
  bodyEnd: number,
): { type: SspConnectorType; unit?: string | undefined } {
  const body = xml.slice(bodyStart, bodyEnd);
  const realTags = findTagOccurrences(xml, "ssc:Real", bodyStart, bodyEnd);
  if (realTags.length > 0) {
    const unitAttr = locateAttr(xml, realTags[0]!, "unit");
    return { type: "Real", unit: unitAttr?.value };
  }
  if (body.includes("<ssc:Integer")) return { type: "Integer" };
  if (body.includes("<ssc:Boolean")) return { type: "Boolean" };
  if (body.includes("<ssc:String")) return { type: "String" };
  if (body.includes("<ssc:Enumeration")) return { type: "Enumeration" };
  return { type: "Real" };
}

/**
 * Perform semantic linting on a SystemStructure.ssd XML string.
 */
export function lintSsd(xml: string): SspDiagnostic[] {
  const diagnostics: SspDiagnostic[] = [];
  const locator = new LineLocator(xml);

  const emit = (
    startOffset: number,
    endOffset: number,
    code: string,
    severity: "error" | "warning" | "info",
    message: string,
  ) => {
    const safeStart = Math.max(0, startOffset);
    const safeEnd = Math.max(safeStart + 1, endOffset);
    const startPos = locator.offsetToPos(safeStart);
    const endPos = locator.offsetToPos(safeEnd);
    diagnostics.push({
      code,
      severity,
      message,
      startOffset: safeStart,
      endOffset: safeEnd,
      line: startPos.line,
      column: startPos.column,
      endLine: endPos.line,
      endColumn: endPos.column,
    });
  };

  const ssdRootTags = findTagOccurrences(xml, "ssd:SystemStructureDescription");
  const rootName = ssdRootTags.length > 0 ? locateAttr(xml, ssdRootTags[0]!, "name")?.value : undefined;
  const systemTags = findTagOccurrences(xml, "ssd:System");
  if (systemTags.length === 0) {
    return diagnostics;
  }
  const sysTag = systemTags[0]!;
  const systemName = locateAttr(xml, sysTag, "name")?.value ?? rootName ?? "System";

  // Helper to parse and lint a `<ssd:Connectors>` block
  const parseAndLintConnectors = (
    rangeStart: number,
    rangeEnd: number,
    ownerLabel: string,
  ): Map<string, ParsedConnectorInfo> => {
    const map = new Map<string, ParsedConnectorInfo>();
    const connectorsBlocks = findTagOccurrences(xml, "ssd:Connectors", rangeStart, rangeEnd);
    if (connectorsBlocks.length === 0) return map;

    const block = connectorsBlocks[0]!;
    const connTags = findTagOccurrences(xml, "ssd:Connector", block.bodyStart, block.bodyEnd);
    for (const cTag of connTags) {
      const nameAttr = locateAttr(xml, cTag, "name");
      const kindAttr = locateAttr(xml, cTag, "kind");
      const connName = nameAttr?.value ?? "";
      const nameStart = nameAttr?.valueStart ?? cTag.tagStart;
      const nameEnd = nameAttr?.valueEnd ?? cTag.tagNameEnd;

      if (!connName) {
        emit(nameStart, nameEnd, "SSP_EMPTY_CONNECTOR_NAME", "error", `Connector in ${ownerLabel} has an empty name.`);
        continue;
      }

      if (map.has(connName)) {
        emit(
          nameStart,
          nameEnd,
          "SSP_DUPLICATE_CONNECTOR",
          "error",
          `Duplicate connector '${connName}' in ${ownerLabel}.`,
        );
      }

      const rawKind = kindAttr?.value ?? "input";
      if (kindAttr && !VALID_CONNECTOR_KINDS.has(rawKind)) {
        emit(
          kindAttr.valueStart,
          kindAttr.valueEnd,
          "SSP_INVALID_CONNECTOR_KIND",
          "error",
          `Invalid connector kind '${rawKind}' on connector '${connName}'. Expected one of: input, output, inout, parameter, calculatedParameter.`,
        );
      }

      const { type, unit } = detectConnectorType(xml, cTag.bodyStart, cTag.bodyEnd);
      map.set(connName, {
        name: connName,
        kind: (VALID_CONNECTOR_KINDS.has(rawKind) ? rawKind : "input") as SspConnectorKind,
        type,
        unit,
        nameRange: { start: nameStart, end: nameEnd },
      });
    }

    return map;
  };

  // 1. System boundary connectors (before <ssd:Elements>)
  const elementsBlocks = findTagOccurrences(xml, "ssd:Elements", sysTag.bodyStart, sysTag.bodyEnd);
  const boundaryEnd = elementsBlocks.length > 0 ? elementsBlocks[0]!.tagStart : sysTag.bodyEnd;
  const systemConnectors = parseAndLintConnectors(sysTag.bodyStart, boundaryEnd, "system boundary");

  // 2. Components and their connectors
  const components = new Map<
    string,
    { connectors: Map<string, ParsedConnectorInfo>; nameRange: { start: number; end: number } }
  >();
  if (elementsBlocks.length > 0) {
    const elBlock = elementsBlocks[0]!;
    const compTags = findTagOccurrences(xml, "ssd:Component", elBlock.bodyStart, elBlock.bodyEnd);
    for (const compTag of compTags) {
      const nameAttr = locateAttr(xml, compTag, "name");
      const sourceAttr = locateAttr(xml, compTag, "source");
      const compName = nameAttr?.value ?? "";
      const nameStart = nameAttr?.valueStart ?? compTag.tagStart;
      const nameEnd = nameAttr?.valueEnd ?? compTag.tagNameEnd;

      if (!compName) {
        emit(
          nameStart,
          nameEnd,
          "SSP_EMPTY_COMPONENT_NAME",
          "error",
          "Component declaration is missing a valid 'name'.",
        );
        continue;
      }

      if (components.has(compName)) {
        emit(nameStart, nameEnd, "SSP_DUPLICATE_COMPONENT", "error", `Duplicate component '${compName}' in system.`);
      }

      if (!sourceAttr || !sourceAttr.value.trim()) {
        const srcStart = sourceAttr?.valueStart ?? compTag.tagStart;
        const srcEnd = sourceAttr?.valueEnd ?? compTag.tagNameEnd;
        emit(
          srcStart,
          srcEnd,
          "SSP_MISSING_COMPONENT_SOURCE",
          "warning",
          `Component '${compName}' has no FMU 'source' URI specified.`,
        );
      }

      const compConnectors = parseAndLintConnectors(compTag.bodyStart, compTag.bodyEnd, `component '${compName}'`);
      components.set(compName, {
        connectors: compConnectors,
        nameRange: { start: nameStart, end: nameEnd },
      });
    }
  }

  // 3. Connections
  const connectionsBlocks = findTagOccurrences(xml, "ssd:Connections", sysTag.bodyStart, sysTag.bodyEnd);
  if (connectionsBlocks.length > 0) {
    const connBlock = connectionsBlocks[0]!;
    const connTags = findTagOccurrences(xml, "ssd:Connection", connBlock.bodyStart, connBlock.bodyEnd);

    for (const cTag of connTags) {
      const startElAttr = locateAttr(xml, cTag, "startElement");
      const startConnAttr = locateAttr(xml, cTag, "startConnector");
      const endElAttr = locateAttr(xml, cTag, "endElement");
      const endConnAttr = locateAttr(xml, cTag, "endConnector");

      const startEl = startElAttr?.value ?? "";
      const startConnName = startConnAttr?.value ?? "";
      const endEl = endElAttr?.value ?? "";
      const endConnName = endConnAttr?.value ?? "";

      const isStartBoundary = startEl === "" || (startEl === systemName && !components.has(startEl));
      const isEndBoundary = endEl === "" || (endEl === systemName && !components.has(endEl));

      // Resolve startElement
      let startConnectorsMap: Map<string, ParsedConnectorInfo> | null = null;
      if (isStartBoundary) {
        startConnectorsMap = systemConnectors;
      } else {
        const comp = components.get(startEl);
        if (!comp) {
          emit(
            startElAttr?.valueStart ?? cTag.tagStart,
            startElAttr?.valueEnd ?? cTag.tagNameEnd,
            "SSP_UNRESOLVED_ELEMENT",
            "error",
            `Unresolved startElement '${startEl}': no component with this name exists in <ssd:Elements>.`,
          );
        } else {
          startConnectorsMap = comp.connectors;
        }
      }

      // Resolve endElement
      let endConnectorsMap: Map<string, ParsedConnectorInfo> | null = null;
      if (isEndBoundary) {
        endConnectorsMap = systemConnectors;
      } else {
        const comp = components.get(endEl);
        if (!comp) {
          emit(
            endElAttr?.valueStart ?? cTag.tagStart,
            endElAttr?.valueEnd ?? cTag.tagNameEnd,
            "SSP_UNRESOLVED_ELEMENT",
            "error",
            `Unresolved endElement '${endEl}': no component with this name exists in <ssd:Elements>.`,
          );
        } else {
          endConnectorsMap = comp.connectors;
        }
      }

      // Resolve startConnector
      let startConn: ParsedConnectorInfo | undefined;
      if (!startConnAttr || !startConnName) {
        emit(
          startConnAttr?.valueStart ?? cTag.tagStart,
          startConnAttr?.valueEnd ?? cTag.tagNameEnd,
          "SSP_UNRESOLVED_CONNECTOR",
          "error",
          "Connection is missing a non-empty 'startConnector' attribute.",
        );
      } else if (startConnectorsMap) {
        startConn = startConnectorsMap.get(startConnName);
        if (!startConn) {
          const targetDesc = !isStartBoundary ? `component '${startEl}'` : "system boundary";
          emit(
            startConnAttr.valueStart,
            startConnAttr.valueEnd,
            "SSP_UNRESOLVED_CONNECTOR",
            "error",
            `Unresolved startConnector '${startConnName}' on ${targetDesc}.`,
          );
        }
      }

      // Resolve endConnector
      let endConn: ParsedConnectorInfo | undefined;
      if (!endConnAttr || !endConnName) {
        emit(
          endConnAttr?.valueStart ?? cTag.tagStart,
          endConnAttr?.valueEnd ?? cTag.tagNameEnd,
          "SSP_UNRESOLVED_CONNECTOR",
          "error",
          "Connection is missing a non-empty 'endConnector' attribute.",
        );
      } else if (endConnectorsMap) {
        endConn = endConnectorsMap.get(endConnName);
        if (!endConn) {
          const targetDesc = !isEndBoundary ? `component '${endEl}'` : "system boundary";
          emit(
            endConnAttr.valueStart,
            endConnAttr.valueEnd,
            "SSP_UNRESOLVED_CONNECTOR",
            "error",
            `Unresolved endConnector '${endConnName}' on ${targetDesc}.`,
          );
        }
      }

      // If both connectors resolved, validate self-connection, data type match, and causality
      if (startConn && endConn && startConnAttr && endConnAttr) {
        const startLabel = startEl ? `${startEl}.${startConnName}` : startConnName;
        const endLabel = endEl ? `${endEl}.${endConnName}` : endConnName;

        if (isStartBoundary === isEndBoundary && startEl === endEl && startConnName === endConnName) {
          emit(
            endConnAttr.valueStart,
            endConnAttr.valueEnd,
            "SSP_SELF_CONNECTION",
            "error",
            `Self-connection on '${startLabel}' is not allowed.`,
          );
          continue;
        }

        if (startConn.type !== endConn.type) {
          emit(
            endConnAttr.valueStart,
            endConnAttr.valueEnd,
            "SSP_CONNECTOR_TYPE_MISMATCH",
            "error",
            `Connector type mismatch in connection '${startLabel}' (${startConn.type}) -> '${endLabel}' (${endConn.type}).`,
          );
        }

        // Component-to-component causality validation
        if (!isStartBoundary && !isEndBoundary) {
          if (startConn.kind === "input" && endConn.kind === "input") {
            emit(
              endConnAttr.valueStart,
              endConnAttr.valueEnd,
              "SSP_CONNECTOR_CAUSALITY_CONFLICT",
              "error",
              `Invalid connection between two input connectors: '${startLabel}' (input) and '${endLabel}' (input).`,
            );
          } else if (startConn.kind === "output" && endConn.kind === "output") {
            emit(
              endConnAttr.valueStart,
              endConnAttr.valueEnd,
              "SSP_CONNECTOR_CAUSALITY_CONFLICT",
              "error",
              `Invalid connection between two output connectors: '${startLabel}' (output) and '${endLabel}' (output).`,
            );
          } else if (startConn.kind === "input" && endConn.kind === "output") {
            emit(
              startConnAttr.valueStart,
              startConnAttr.valueEnd,
              "SSP_CONNECTOR_CAUSALITY_CONFLICT",
              "warning",
              `Reversed signal flow: startConnector '${startLabel}' has causality 'input' while endConnector '${endLabel}' has causality 'output'.`,
            );
          }
        }
      }
    }
  }

  // 4. ParameterBindings & inline SSV parameter values
  const bindTags = findTagOccurrences(xml, "ssd:ParameterBinding", sysTag.bodyStart, sysTag.bodyEnd);
  for (const bTag of bindTags) {
    const prefixAttr = locateAttr(xml, bTag, "prefix");
    if (prefixAttr && prefixAttr.value) {
      const rootComp = prefixAttr.value.split(".")[0]!.trim();
      if (rootComp && !components.has(rootComp)) {
        emit(
          prefixAttr.valueStart,
          prefixAttr.valueEnd,
          "SSP_UNRESOLVED_BINDING_PREFIX",
          "error",
          `ParameterBinding prefix '${prefixAttr.value}' references unknown component '${rootComp}'.`,
        );
      }
    }

    // Validate inline <ssv:Parameter> declarations within this ParameterBinding
    if (bTag.bodyEnd > bTag.bodyStart) {
      const inlineDiags = lintSsvRange(xml, bTag.bodyStart, bTag.bodyEnd, locator);
      diagnostics.push(...inlineDiags);
    }
  }

  // 5. DefaultExperiment bounds
  const expTags = [
    ...findTagOccurrences(xml, "ssd:DefaultExperiment"),
    ...findTagOccurrences(xml, "DefaultExperiment"),
  ];
  for (const expTag of expTags) {
    const startAttr = locateAttr(xml, expTag, "startTime");
    const stopAttr = locateAttr(xml, expTag, "stopTime");
    const startVal = startAttr ? Number(startAttr.value) : undefined;
    const stopVal = stopAttr ? Number(stopAttr.value) : undefined;

    if (startAttr && (!startAttr.value.trim() || Number.isNaN(startVal))) {
      emit(
        startAttr.valueStart,
        startAttr.valueEnd,
        "SSP_INVALID_EXPERIMENT_BOUNDS",
        "error",
        `Invalid non-numeric startTime '${startAttr.value}' in DefaultExperiment.`,
      );
    }
    if (stopAttr && (!stopAttr.value.trim() || Number.isNaN(stopVal))) {
      emit(
        stopAttr.valueStart,
        stopAttr.valueEnd,
        "SSP_INVALID_EXPERIMENT_BOUNDS",
        "error",
        `Invalid non-numeric stopTime '${stopAttr.value}' in DefaultExperiment.`,
      );
    }
    if (
      startVal !== undefined &&
      stopVal !== undefined &&
      !Number.isNaN(startVal) &&
      !Number.isNaN(stopVal) &&
      startVal >= stopVal
    ) {
      const targetAttr = stopAttr ?? startAttr!;
      emit(
        targetAttr.valueStart,
        targetAttr.valueEnd,
        "SSP_INVALID_EXPERIMENT_BOUNDS",
        "error",
        `Invalid DefaultExperiment time bounds: startTime (${startVal}) must be strictly less than stopTime (${stopVal}).`,
      );
    }
  }

  return diagnostics;
}

/** Supported SSV scalar type child tags inside `<ssv:Parameter>`. */
const SSV_TYPE_TAGS = ["ssv:Real", "ssv:Integer", "ssv:Boolean", "ssv:String", "ssv:Enumeration"] as const;

/**
 * Validate `<ssv:Parameter>` declarations within `[rangeStart, rangeEnd)` of an XML document.
 */
function lintSsvRange(xml: string, rangeStart: number, rangeEnd: number, locator: LineLocator): SspDiagnostic[] {
  const diagnostics: SspDiagnostic[] = [];

  const emit = (
    startOffset: number,
    endOffset: number,
    code: string,
    severity: "error" | "warning" | "info",
    message: string,
  ) => {
    const safeStart = Math.max(0, startOffset);
    const safeEnd = Math.max(safeStart + 1, endOffset);
    const startPos = locator.offsetToPos(safeStart);
    const endPos = locator.offsetToPos(safeEnd);
    diagnostics.push({
      code,
      severity,
      message,
      startOffset: safeStart,
      endOffset: safeEnd,
      line: startPos.line,
      column: startPos.column,
      endLine: endPos.line,
      endColumn: endPos.column,
    });
  };

  const paramTags = findTagOccurrences(xml, "ssv:Parameter", rangeStart, rangeEnd);
  const seenParams = new Set<string>();

  for (const pTag of paramTags) {
    const nameAttr = locateAttr(xml, pTag, "name");
    const paramName = nameAttr?.value ?? "";
    const nameStart = nameAttr?.valueStart ?? pTag.tagStart;
    const nameEnd = nameAttr?.valueEnd ?? pTag.tagNameEnd;

    if (!paramName.trim()) {
      emit(
        nameStart,
        nameEnd,
        "SSV_EMPTY_PARAMETER_NAME",
        "error",
        "SSV Parameter declaration is missing a non-empty 'name' attribute.",
      );
    } else if (seenParams.has(paramName)) {
      emit(
        nameStart,
        nameEnd,
        "SSV_DUPLICATE_PARAMETER",
        "error",
        `Duplicate SSV parameter '${paramName}' in parameter set.`,
      );
    } else {
      seenParams.add(paramName);
    }

    // Locate type child tag (<ssv:Real>, <ssv:Integer>, <ssv:Boolean>, <ssv:String>, <ssv:Enumeration>)
    let foundTypeTag: LocatedTag | null = null;
    for (const typeTagName of SSV_TYPE_TAGS) {
      const matches = findTagOccurrences(xml, typeTagName, pTag.bodyStart, pTag.bodyEnd);
      if (matches.length > 0) {
        foundTypeTag = matches[0]!;
        break;
      }
    }

    if (!foundTypeTag) {
      emit(
        nameStart,
        nameEnd,
        "SSV_MISSING_PARAMETER_TYPE",
        "error",
        `SSV parameter '${paramName || "<unnamed>"}' is missing a type element (<ssv:Real>, <ssv:Integer>, <ssv:Boolean>, <ssv:String>, or <ssv:Enumeration>).`,
      );
      continue;
    }

    const valAttr = locateAttr(xml, foundTypeTag, "value");
    if (!valAttr) {
      emit(
        foundTypeTag.tagStart,
        foundTypeTag.tagNameEnd,
        "SSV_MISSING_PARAMETER_VALUE",
        "error",
        `Type element '<${foundTypeTag.tagName}>' for parameter '${paramName}' is missing a 'value' attribute.`,
      );
      continue;
    }

    const rawVal = valAttr.value.trim();
    if (foundTypeTag.tagName === "ssv:Real") {
      if (!rawVal || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(rawVal)) {
        emit(
          valAttr.valueStart,
          valAttr.valueEnd,
          "SSV_INVALID_REAL_VALUE",
          "error",
          `Invalid Real value '${valAttr.value}' for SSV parameter '${paramName}'.`,
        );
      }
    } else if (foundTypeTag.tagName === "ssv:Integer") {
      if (!rawVal || !/^[+-]?\d+$/.test(rawVal)) {
        emit(
          valAttr.valueStart,
          valAttr.valueEnd,
          "SSV_INVALID_INTEGER_VALUE",
          "error",
          `Invalid Integer value '${valAttr.value}' for SSV parameter '${paramName}'.`,
        );
      }
    } else if (foundTypeTag.tagName === "ssv:Boolean") {
      if (rawVal !== "true" && rawVal !== "false" && rawVal !== "1" && rawVal !== "0") {
        emit(
          valAttr.valueStart,
          valAttr.valueEnd,
          "SSV_INVALID_BOOLEAN_VALUE",
          "error",
          `Invalid Boolean value '${valAttr.value}' for SSV parameter '${paramName}': expected 'true', 'false', '1', or '0'.`,
        );
      }
    }
  }

  return diagnostics;
}

/**
 * Perform semantic linting on a System Structure Parameter Values (.ssv) XML string.
 */
export function lintSsv(xml: string): SspDiagnostic[] {
  const locator = new LineLocator(xml);
  return lintSsvRange(xml, 0, xml.length, locator);
}
