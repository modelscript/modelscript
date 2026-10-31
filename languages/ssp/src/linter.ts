// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Semantic Linter for SSP SystemStructureDescription (.ssd) XML files.
 *
 * Validates component declarations, connector definitions, connection endpoint
 * resolution, connector type compatibility, causal signal direction, parameter
 * binding prefixes, and default experiment time bounds — reporting exact,
 * narrow byte and 1-indexed line/column ranges for each offending XML attribute value.
 */

import { parseXmlSync, type XmlElement } from "@modelscript/dsl/xml";
import { SspErrorCode } from "./errors.js";
import type { SspConnectorKind, SspConnectorType } from "./types.js";

/**
 * Diagnostic emitted by the SSP/SSV semantic linter with exact byte and 1-indexed line/column spans.
 */
export interface SspDiagnostic {
  /** Machine-readable diagnostic code (e.g., `"SSP_CONNECTOR_TYPE_MISMATCH"`). */
  code: string;
  /** Standard ModelScript alphanumeric diagnostic code (e.g., `"S7009"`). */
  standardCode?: string | undefined;
  /** Numeric error code (e.g., `7009`). */
  numericCode?: number | undefined;
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
 * Source byte spans of an XML attribute and its quoted value within an `XmlElement` opening tag.
 */
interface LocatedAttr {
  value: string;
  valueStart: number;
  valueEnd: number;
  attrStart: number;
  attrEnd: number;
}

/**
 * Strip any XML namespace prefix (e.g. `ssd:System` -> `System`).
 */
function localName(tagName: string): string {
  const colonIdx = tagName.indexOf(":");
  return colonIdx >= 0 ? tagName.slice(colonIdx + 1) : tagName;
}

/**
 * Return direct child `XmlElement` nodes, optionally filtered by namespace-agnostic local tag name.
 */
function childElements(node: XmlElement | null | undefined, expectedLocalName?: string): XmlElement[] {
  if (!node) return [];
  if (!expectedLocalName) return node.children;
  return node.children.filter((child) => localName(child.name) === expectedLocalName);
}

/**
 * Recursively collect descendant `XmlElement` nodes matching `expectedLocalName`.
 */
function findDescendants(node: XmlElement | null | undefined, expectedLocalName: string): XmlElement[] {
  if (!node) return [];
  const result: XmlElement[] = [];
  const visit = (n: XmlElement) => {
    for (const child of n.children) {
      if (localName(child.name) === expectedLocalName) {
        result.push(child);
      }
      visit(child);
    }
  };
  visit(node);
  return result;
}

/**
 * Compute the byte offset of the end of `<tagName` in an `XmlElement`.
 */
function tagNameEndOffset(el: XmlElement): number {
  return el.start + 1 + el.name.length;
}

/**
 * Look up an attribute value on an `XmlElement` by local name.
 */
function getAttrValue(el: XmlElement, attrName: string): string | undefined {
  return el.attributes.find((a) => a.name === attrName || localName(a.name) === attrName)?.value;
}

/**
 * Locate a named XML attribute on `el` using its CST `XmlAttribute` span.
 */
function locateAttrOnElement(_xml: string, el: XmlElement, attrName: string): LocatedAttr | null {
  const attr = el.attributes.find((a) => a.name === attrName || localName(a.name) === attrName);
  if (!attr) return null;

  const val = attr.value;
  // If the value is empty `""`, highlight the quotes `""` so the diagnostic range is non-empty
  const valueStart = val.length > 0 ? attr.valueStart : attr.valueStart - 1;
  const valueEnd = val.length > 0 ? attr.valueEnd : attr.valueEnd + 1;

  return {
    value: val,
    valueStart,
    valueEnd,
    attrStart: attr.start,
    attrEnd: attr.end,
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
 * Determine the SSP scalar data type and optional physical unit from a connector's child type element
 * (`<ssc:Real>`, `<Real>`, `<ssc:Integer>`, `<Integer>`, etc.).
 */
function detectConnectorTypeOnElement(
  xml: string,
  connectorEl: XmlElement,
): { type: SspConnectorType; unit?: string | undefined } {
  for (const child of childElements(connectorEl)) {
    const ln = localName(child.name);
    if (ln === "Real") {
      const unitAttr = locateAttrOnElement(xml, child, "unit");
      return { type: "Real", unit: unitAttr?.value };
    }
    if (ln === "Integer") return { type: "Integer" };
    if (ln === "Boolean") return { type: "Boolean" };
    if (ln === "String") return { type: "String" };
    if (ln === "Enumeration") return { type: "Enumeration" };
  }
  return { type: "Real" };
}

/**
 * Map linter rule identifiers (including historical aliases) to `SspErrorCode` entries.
 */
const RULE_TO_ERROR_ENTRY: Record<string, { code: number; stdCode: string }> = (() => {
  const table: Record<string, { code: number; stdCode: string }> = {};
  for (const entry of Object.values(SspErrorCode)) {
    table[entry.rule] = { code: entry.code, stdCode: entry.stdCode };
  }
  // Map diagnostic code aliases to their canonical S70xx error codes
  table["SSP_MISSING_COMPONENT_SOURCE"] = {
    code: SspErrorCode.EMPTY_SOURCE.code,
    stdCode: SspErrorCode.EMPTY_SOURCE.stdCode,
  };
  table["SSP_UNRESOLVED_ELEMENT"] = {
    code: SspErrorCode.UNDEFINED_COMPONENT.code,
    stdCode: SspErrorCode.UNDEFINED_COMPONENT.stdCode,
  };
  table["SSP_UNRESOLVED_BINDING_PREFIX"] = {
    code: SspErrorCode.UNDEFINED_COMPONENT.code,
    stdCode: SspErrorCode.UNDEFINED_COMPONENT.stdCode,
  };
  table["SSP_UNRESOLVED_CONNECTOR"] = {
    code: SspErrorCode.UNDEFINED_CONNECTOR.code,
    stdCode: SspErrorCode.UNDEFINED_CONNECTOR.stdCode,
  };
  table["SSP_SELF_CONNECTION"] = {
    code: SspErrorCode.CYCLIC_CONNECTION.code,
    stdCode: SspErrorCode.CYCLIC_CONNECTION.stdCode,
  };
  return table;
})();

/**
 * Directed component-to-component signal edge used for algebraic loop detection.
 */
interface DirectedSignalEdge {
  fromComp: string;
  fromConn: string;
  toComp: string;
  toConn: string;
  unit?: string | undefined;
  explicitFeedthrough: boolean;
  spanStart: number;
  spanEnd: number;
}

/**
 * Perform semantic linting on a SystemStructure.ssd XML string using the @modelscript/dsl/xml AST.
 *
 * Supports both `ssd:`/`ssc:`/`ssv:` prefixed tags and default-namespace XML elements,
 * recursively validates nested `<ssd:System>` / `<System>` hierarchies, and detects
 * zero-delay algebraic feedthrough loops (`S7014`).
 */
export function lintSsd(xml: string): SspDiagnostic[] {
  const diagnostics: SspDiagnostic[] = [];
  const locator = new LineLocator(xml);
  const doc = parseXmlSync(xml);

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
    const stdMatch = RULE_TO_ERROR_ENTRY[code];
    diagnostics.push({
      code,
      standardCode: stdMatch?.stdCode,
      numericCode: stdMatch?.code,
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

  // Locate root <SystemStructureDescription> or top-level <System>
  const docRoot = doc.root;
  if (!docRoot) {
    return diagnostics;
  }
  const rootEl = localName(docRoot.name) === "SystemStructureDescription" ? docRoot : undefined;
  const rootName = rootEl
    ? (locateAttrOnElement(xml, rootEl, "name")?.value ?? getAttrValue(rootEl, "name"))
    : undefined;

  const topSystems = rootEl
    ? childElements(rootEl, "System")
    : localName(docRoot.name) === "System"
      ? [docRoot]
      : childElements(docRoot, "System");
  if (topSystems.length === 0) {
    return diagnostics;
  }

  /**
   * Parse and lint `<Connectors>` children of a `<System>` or `<Component>` element.
   */
  const parseAndLintConnectorsOnElement = (
    ownerEl: XmlElement,
    ownerLabel: string,
  ): Map<string, ParsedConnectorInfo> => {
    const map = new Map<string, ParsedConnectorInfo>();
    const connectorsBlocks = childElements(ownerEl, "Connectors");
    if (connectorsBlocks.length === 0) return map;

    for (const block of connectorsBlocks) {
      const connTags = childElements(block, "Connector");
      for (const cTag of connTags) {
        const nameAttr = locateAttrOnElement(xml, cTag, "name");
        const kindAttr = locateAttrOnElement(xml, cTag, "kind");
        const connName = nameAttr?.value ?? "";
        const nameStart = nameAttr?.valueStart ?? cTag.start;
        const nameEnd = nameAttr?.valueEnd ?? tagNameEndOffset(cTag);

        if (!connName) {
          emit(
            nameStart,
            nameEnd,
            "SSP_EMPTY_CONNECTOR_NAME",
            "error",
            `Connector in ${ownerLabel} has an empty name.`,
          );
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

        const { type, unit } = detectConnectorTypeOnElement(xml, cTag);
        map.set(connName, {
          name: connName,
          kind: (VALID_CONNECTOR_KINDS.has(rawKind) ? rawKind : "input") as SspConnectorKind,
          type,
          unit,
          nameRange: { start: nameStart, end: nameEnd },
        });
      }
    }

    return map;
  };

  /**
   * Recursively lint a `<ssd:System>` / `<System>` element and return its boundary connectors.
   */
  const lintSystemElement = (sysEl: XmlElement, fallbackName: string): Map<string, ParsedConnectorInfo> => {
    const systemName = locateAttrOnElement(xml, sysEl, "name")?.value ?? getAttrValue(sysEl, "name") ?? fallbackName;

    // 1. System boundary connectors
    const systemConnectors = parseAndLintConnectorsOnElement(sysEl, "system boundary");

    // 2. Child elements (<Component> and nested <System>) inside <Elements>
    const components = new Map<
      string,
      {
        connectors: Map<string, ParsedConnectorInfo>;
        nameRange: { start: number; end: number };
        directFeedthrough: boolean;
      }
    >();

    const elementsBlocks = childElements(sysEl, "Elements");
    for (const elBlock of elementsBlocks) {
      // 2a. Recursively validate nested <ssd:System> / <System> elements
      const nestedSystems = childElements(elBlock, "System");
      for (const nestedSys of nestedSystems) {
        const nestedNameAttr = locateAttrOnElement(xml, nestedSys, "name");
        const nestedName = nestedNameAttr?.value ?? getAttrValue(nestedSys, "name") ?? "";
        const nameStart = nestedNameAttr?.valueStart ?? nestedSys.start;
        const nameEnd = nestedNameAttr?.valueEnd ?? tagNameEndOffset(nestedSys);

        if (!nestedName) {
          emit(
            nameStart,
            nameEnd,
            "SSP_EMPTY_COMPONENT_NAME",
            "error",
            "Subsystem declaration is missing a valid 'name'.",
          );
        } else if (components.has(nestedName)) {
          emit(nameStart, nameEnd, "SSP_DUPLICATE_COMPONENT", "error", `Duplicate element '${nestedName}' in system.`);
        }

        const nestedBoundaryConnectors = lintSystemElement(nestedSys, nestedName || "Subsystem");
        if (nestedName) {
          components.set(nestedName, {
            connectors: nestedBoundaryConnectors,
            nameRange: { start: nameStart, end: nameEnd },
            directFeedthrough: false,
          });
        }
      }

      // 2b. Validate <ssd:Component> / <Component> elements
      const compTags = childElements(elBlock, "Component");
      for (const compTag of compTags) {
        const nameAttr = locateAttrOnElement(xml, compTag, "name");
        const sourceAttr = locateAttrOnElement(xml, compTag, "source");
        const compName = nameAttr?.value ?? "";
        const nameStart = nameAttr?.valueStart ?? compTag.start;
        const nameEnd = nameAttr?.valueEnd ?? tagNameEndOffset(compTag);

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
          const srcStart = sourceAttr?.valueStart ?? compTag.start;
          const srcEnd = sourceAttr?.valueEnd ?? tagNameEndOffset(compTag);
          emit(
            srcStart,
            srcEnd,
            "SSP_MISSING_COMPONENT_SOURCE",
            "warning",
            `Component '${compName}' has no FMU 'source' URI specified.`,
          );
        }

        const compConnectors = parseAndLintConnectorsOnElement(compTag, `component '${compName}'`);
        const ftAttr =
          getAttrValue(compTag, "feedThrough") ??
          getAttrValue(compTag, "directFeedThrough") ??
          getAttrValue(compTag, "algebraicFeedThrough");
        components.set(compName, {
          connectors: compConnectors,
          nameRange: { start: nameStart, end: nameEnd },
          directFeedthrough: ftAttr === "true" || ftAttr === "1",
        });
      }
    }

    // 3. Connections & Directed Signal Graph
    const signalEdges: DirectedSignalEdge[] = [];
    const connectionsBlocks = childElements(sysEl, "Connections");
    for (const connBlock of connectionsBlocks) {
      const connTags = childElements(connBlock, "Connection");
      for (const cTag of connTags) {
        const startElAttr = locateAttrOnElement(xml, cTag, "startElement");
        const startConnAttr = locateAttrOnElement(xml, cTag, "startConnector");
        const endElAttr = locateAttrOnElement(xml, cTag, "endElement");
        const endConnAttr = locateAttrOnElement(xml, cTag, "endConnector");

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
              startElAttr?.valueStart ?? cTag.start,
              startElAttr?.valueEnd ?? tagNameEndOffset(cTag),
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
              endElAttr?.valueStart ?? cTag.start,
              endElAttr?.valueEnd ?? tagNameEndOffset(cTag),
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
            startConnAttr?.valueStart ?? cTag.start,
            startConnAttr?.valueEnd ?? tagNameEndOffset(cTag),
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
            endConnAttr?.valueStart ?? cTag.start,
            endConnAttr?.valueEnd ?? tagNameEndOffset(cTag),
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
          } else if (startConn.unit && endConn.unit && startConn.unit !== endConn.unit) {
            emit(
              endConnAttr.valueStart,
              endConnAttr.valueEnd,
              "SSP_CONNECTOR_UNIT_MISMATCH",
              "warning",
              `Connector unit mismatch in connection '${startLabel}' [${startConn.unit}] -> '${endLabel}' [${endConn.unit}].`,
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
            } else if (
              (startConn.kind === "output" || startConn.kind === "inout") &&
              (endConn.kind === "input" || endConn.kind === "inout") &&
              startEl !== endEl
            ) {
              const connFeedthrough =
                getAttrValue(cTag, "feedThrough") === "true" ||
                getAttrValue(cTag, "directFeedThrough") === "true" ||
                components.get(startEl)?.directFeedthrough === true ||
                components.get(endEl)?.directFeedthrough === true;
              signalEdges.push({
                fromComp: startEl,
                fromConn: startConnName,
                toComp: endEl,
                toConn: endConnName,
                unit: startConn.unit ?? endConn.unit,
                explicitFeedthrough: connFeedthrough,
                spanStart: endConnAttr.valueStart,
                spanEnd: endConnAttr.valueEnd,
              });
            }
          }
        }
      }
    }

    // 3b. Detect zero-delay algebraic feedthrough loops (S7014) across connected components
    detectAlgebraicFeedthroughLoops(signalEdges, emit);

    // 4. ParameterBindings & inline SSV parameter values (direct children of this System)
    const paramBindingsBlocks = childElements(sysEl, "ParameterBindings");
    const directBindTags = [
      ...childElements(sysEl, "ParameterBinding"),
      ...paramBindingsBlocks.flatMap((pb) => childElements(pb, "ParameterBinding")),
    ];
    for (const bTag of directBindTags) {
      const prefixAttr = locateAttrOnElement(xml, bTag, "prefix");
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

      // Validate inline <ssv:Parameter> / <Parameter> declarations within this ParameterBinding
      const inlineDiags = lintSsvElement(xml, bTag, locator);
      diagnostics.push(...inlineDiags);
    }

    return systemConnectors;
  };

  for (const sysEl of topSystems) {
    lintSystemElement(sysEl, rootName ?? "System");
  }

  // 5. DefaultExperiment bounds across the document
  const expTags = findDescendants(docRoot, "DefaultExperiment");
  for (const expTag of expTags) {
    const startAttr = locateAttrOnElement(xml, expTag, "startTime");
    const stopAttr = locateAttrOnElement(xml, expTag, "stopTime");
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

/**
 * Alias for `lintSsd` so callers can invoke either `lintSsd` or `lintSsp`.
 */
export const lintSsp = lintSsd;

/**
 * Detect zero-delay algebraic feedthrough loops (`S7014`) in component connection graphs.
 *
 * Bilateral physical effort/flow port couplings between two plant components with distinct
 * conjugate physical units (e.g., `V`/`A` or `N.m`/`rpm` without explicit `feedThrough="true"`)
 * are distinguished from signal-level algebraic loops.
 */
function detectAlgebraicFeedthroughLoops(
  edges: DirectedSignalEdge[],
  emit: (
    startOffset: number,
    endOffset: number,
    code: string,
    severity: "error" | "warning" | "info",
    message: string,
  ) => void,
): void {
  if (edges.length < 2) return;

  const adj = new Map<string, DirectedSignalEdge[]>();
  for (const e of edges) {
    let list = adj.get(e.fromComp);
    if (!list) {
      list = [];
      adj.set(e.fromComp, list);
    }
    list.push(e);
  }

  const reportedCycles = new Set<string>();

  for (const startNode of adj.keys()) {
    const pathNodes: string[] = [startNode];
    const pathEdges: DirectedSignalEdge[] = [];
    const onStack = new Set<string>([startNode]);

    const dfs = (curr: string) => {
      const outgoing = adj.get(curr) ?? [];
      for (const edge of outgoing) {
        const next = edge.toComp;
        if (next === startNode) {
          const cycleEdges = [...pathEdges, edge];
          const cycleNodes = [...pathNodes];

          // Check if this 2-node cycle is a bilateral physical conjugate effort/flow pair (e.g. V/A or N.m/rpm)
          if (cycleEdges.length === 2) {
            const [e1, e2] = cycleEdges as [DirectedSignalEdge, DirectedSignalEdge];
            const hasExplicitFt = e1.explicitFeedthrough || e2.explicitFeedthrough;
            const isConjugatePhysicalPair =
              !hasExplicitFt && Boolean(e1.unit) && Boolean(e2.unit) && e1.unit !== e2.unit;
            if (isConjugatePhysicalPair) {
              continue;
            }
          }

          // Canonicalize cycle key by rotating lexicographically smallest component name to front
          let minIdx = 0;
          for (let i = 1; i < cycleNodes.length; i++) {
            if (cycleNodes[i]! < cycleNodes[minIdx]!) {
              minIdx = i;
            }
          }
          const canonical = [...cycleNodes.slice(minIdx), ...cycleNodes.slice(0, minIdx)].join(" -> ");
          if (!reportedCycles.has(canonical)) {
            reportedCycles.add(canonical);
            const closingEdge = cycleEdges[cycleEdges.length - 1]!;
            const cyclePath = [...cycleNodes, startNode].join(" -> ");
            emit(
              closingEdge.spanStart,
              closingEdge.spanEnd,
              SspErrorCode.ALGEBRAIC_FEEDTHROUGH_LOOP.rule,
              SspErrorCode.ALGEBRAIC_FEEDTHROUGH_LOOP.severity,
              SspErrorCode.ALGEBRAIC_FEEDTHROUGH_LOOP.message(cyclePath),
            );
          }
        } else if (!onStack.has(next)) {
          onStack.add(next);
          pathNodes.push(next);
          pathEdges.push(edge);
          dfs(next);
          pathEdges.pop();
          pathNodes.pop();
          onStack.delete(next);
        }
      }
    };

    dfs(startNode);
  }
}

/** Supported SSV scalar type local tag names inside `<ssv:Parameter>` / `<Parameter>`. */
const SSV_TYPE_LOCAL_NAMES = new Set<string>(["Real", "Integer", "Boolean", "String", "Enumeration"]);

/**
 * Validate `<ssv:Parameter>` / `<Parameter>` declarations within an XML element subtree.
 */
function lintSsvElement(
  xml: string,
  containerEl: XmlElement | null | undefined,
  locator: LineLocator,
): SspDiagnostic[] {
  const diagnostics: SspDiagnostic[] = [];
  if (!containerEl) return diagnostics;

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

  const paramTags = findDescendants(containerEl, "Parameter");
  const seenParams = new Set<string>();

  for (const pTag of paramTags) {
    const nameAttr = locateAttrOnElement(xml, pTag, "name");
    const paramName = nameAttr?.value ?? "";
    const nameStart = nameAttr?.valueStart ?? pTag.start;
    const nameEnd = nameAttr?.valueEnd ?? tagNameEndOffset(pTag);

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

    // Locate type child tag (<ssv:Real>, <Real>, <ssv:Integer>, <Integer>, etc.)
    const foundTypeTag = childElements(pTag).find((c) => SSV_TYPE_LOCAL_NAMES.has(localName(c.name))) ?? null;

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

    const valAttr = locateAttrOnElement(xml, foundTypeTag, "value");
    if (!valAttr) {
      emit(
        foundTypeTag.start,
        tagNameEndOffset(foundTypeTag),
        "SSV_MISSING_PARAMETER_VALUE",
        "error",
        `Type element '<${foundTypeTag.name}>' for parameter '${paramName}' is missing a 'value' attribute.`,
      );
      continue;
    }

    const rawVal = valAttr.value.trim();
    const typeLocal = localName(foundTypeTag.name);
    if (typeLocal === "Real") {
      if (!rawVal || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(rawVal)) {
        emit(
          valAttr.valueStart,
          valAttr.valueEnd,
          "SSV_INVALID_REAL_VALUE",
          "error",
          `Invalid Real value '${valAttr.value}' for SSV parameter '${paramName}'.`,
        );
      }
    } else if (typeLocal === "Integer") {
      if (!rawVal || !/^[+-]?\d+$/.test(rawVal)) {
        emit(
          valAttr.valueStart,
          valAttr.valueEnd,
          "SSV_INVALID_INTEGER_VALUE",
          "error",
          `Invalid Integer value '${valAttr.value}' for SSV parameter '${paramName}'.`,
        );
      }
    } else if (typeLocal === "Boolean") {
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
  const doc = parseXmlSync(xml);
  return lintSsvElement(xml, doc.root, locator);
}
