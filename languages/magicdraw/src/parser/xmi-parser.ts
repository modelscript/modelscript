// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/magicdraw — Native WASM XML/XMI Parser for MagicDraw / Cameo UML 2.x / SysML 1.x.
 *
 * Uses `@modelscript/dsl/xml` via `parseMagicDrawXmlDocument` (native WASM GLR XML parser)
 * to perform a clean two-pass XMI parse:
 *   Pass 1: Index all UML elements (Packages, Classifiers, Properties, Ports, Operations,
 *           Constraints, Connectors, Relationships, StateMachines, and `mdOwnedViews` diagrams).
 *   Pass 2: Attach top-level stereotype applications (`<sysml:Block base_Class="..."/>`, etc.),
 *           resolve internal `xmi:id` references and external `href`s via clean-room standard
 *           profiles (`UML 2.5`, `SysML 1.6`, `QUDV`), and classify property compartments.
 */

import type { XmlAttribute, XmlElement } from "@modelscript/dsl/xml";
import {
  classifyClassifierKind,
  classifyPropertyCompartment,
  classifyRelationshipStereotype,
  isStereotypeKindOf,
  lookupUmlPrimitive,
  resolveStandardHref,
} from "../profiles/index.js";
import type {
  DiagramEdgePoints,
  DiagramViewBounds,
  DiagramViewStyle,
  MagicDrawArchiveMetadata,
  MagicDrawDiagramKind,
  MagicDrawDiagramMeta,
  MagicDrawDocument,
  SourceSpan,
  StereotypeApplication,
  TypeReference,
  UmlActivity,
  UmlActivityEdge,
  UmlActivityNode,
  UmlClassifier,
  UmlConnector,
  UmlConnectorEnd,
  UmlConstraint,
  UmlInteraction,
  UmlLifeline,
  UmlMessage,
  UmlOperation,
  UmlPackage,
  UmlPort,
  UmlProperty,
  UmlRelationshipKind,
  UmlState,
  UmlStateMachine,
  UmlTransition,
} from "../types.js";
import { parseMagicDrawXmlDocument } from "./wasm-loader.js";

function localName(tag: string): string {
  const idx = tag.indexOf(":");
  return idx >= 0 ? tag.slice(idx + 1) : tag;
}

function tagPrefix(tag: string): string {
  const idx = tag.indexOf(":");
  return idx >= 0 ? tag.slice(0, idx) : "";
}

function getAttr(el: XmlElement, name: string): string | undefined {
  const exact = el.attributes.find((a: XmlAttribute) => a.name === name);
  if (exact) return exact.value;
  const target = localName(name).toLowerCase();
  const byLocal = el.attributes.find((a: XmlAttribute) => localName(a.name).toLowerCase() === target);
  return byLocal?.value;
}

function getXmiId(el: XmlElement): string | undefined {
  return (
    el.attributes.find((a: XmlAttribute) => a.name === "xmi:id")?.value ??
    el.attributes.find((a: XmlAttribute) => a.name === "id")?.value
  );
}

function getXmiType(el: XmlElement): string | undefined {
  return (
    el.attributes.find((a: XmlAttribute) => a.name === "xmi:type")?.value ??
    el.attributes.find((a: XmlAttribute) => a.name === "xsi:type")?.value
  );
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function offsetToLineCol(lineStarts: number[], offset: number): { line: number; col: number } {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if ((lineStarts[mid] ?? 0) <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  const lineIdx = Math.max(0, hi);
  return { line: lineIdx + 1, col: offset - (lineStarts[lineIdx] ?? 0) + 1 };
}

function elementSpan(el: XmlElement, lineStarts: number[]): SourceSpan | undefined {
  const startOffset = el.start;
  const endOffset = el.end;
  if (typeof startOffset !== "number" || typeof endOffset !== "number") return undefined;
  const s = offsetToLineCol(lineStarts, startOffset);
  const e = offsetToLineCol(lineStarts, endOffset);
  return {
    startLine: s.line,
    startColumn: s.col,
    endLine: e.line,
    endColumn: e.col,
    startOffset,
    endOffset,
  };
}

function classifyDiagramKind(diagramType: string): MagicDrawDiagramKind {
  const lower = diagramType.toLowerCase();
  if (lower.includes("matrix")) return "MATRIX";
  if (lower.includes("table")) return "TABLE";
  if (lower.includes("block definition") || lower === "bdd" || lower.includes("sysml block definition")) return "BDD";
  if (lower.includes("internal block") || lower === "ibd" || lower.includes("sysml internal block")) return "IBD";
  if (lower.includes("requirement") || lower === "req") return "REQ";
  if (lower.includes("parametric") || lower === "par") return "PAR";
  if (lower.includes("state machine") || lower === "stm" || lower.includes("statechart")) return "STM";
  if (lower.includes("activity") || lower === "act") return "ACT";
  if (lower.includes("sequence") || lower === "seq" || lower.includes("interaction")) return "SEQ";
  if (lower.includes("package") || lower === "pkg") return "PKG";
  return "OTHER";
}

function extractReferentPath(el: XmlElement): string | undefined {
  for (const child of el.children) {
    const tag = localName(child.name);
    if (tag === "referenceExtension") {
      const rp = getAttr(child, "referentPath");
      if (rp) return rp;
    } else if (tag === "Extension") {
      const nested = extractReferentPath(child);
      if (nested) return nested;
    }
  }
  return undefined;
}

function stripHtmlText(raw: string): string {
  if (!raw.includes("<")) return raw.trim();
  return raw
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function parseTypeRefFromElement(el: XmlElement): TypeReference | undefined {
  const typeAttr = el.attributes.find((a: XmlAttribute) => a.name === "type")?.value;
  if (typeAttr) {
    return { rawId: typeAttr };
  }
  const typeChild = el.children.find((c: XmlElement) => localName(c.name) === "type");
  if (!typeChild) return undefined;
  const href = getAttr(typeChild, "href");
  const idref = getAttr(typeChild, "xmi:idref") ?? getXmiId(typeChild);
  const referentPath = extractReferentPath(typeChild);
  if (href) {
    const tailName = referentPath ? referentPath.split("::").pop()?.trim() : undefined;
    const prim = tailName ? lookupUmlPrimitive(tailName) : undefined;
    return {
      href,
      ...(tailName ? { resolvedName: prim?.name ?? tailName, isPrimitive: Boolean(prim) } : {}),
    };
  }
  if (idref) {
    return { rawId: idref };
  }
  return undefined;
}

function parseMultiplicity(el: XmlElement): { lower: string; upper: string } | undefined {
  const lowerEl = el.children.find((c: XmlElement) => localName(c.name) === "lowerValue");
  const upperEl = el.children.find((c: XmlElement) => localName(c.name) === "upperValue");
  if (!lowerEl && !upperEl) return undefined;
  const lower = lowerEl ? (getAttr(lowerEl, "value") ?? "0") : "1";
  const upper = upperEl ? (getAttr(upperEl, "value") ?? "1") : "1";
  return { lower, upper };
}

function parseDefaultValue(el: XmlElement): string | undefined {
  const defEl = el.children.find((c: XmlElement) => localName(c.name) === "defaultValue");
  if (!defEl) return undefined;
  const val = getAttr(defEl, "value");
  if (val !== undefined) return val;
  const bodyEl = defEl.children.find((c: XmlElement) => localName(c.name) === "body");
  if (bodyEl?.text.trim()) return bodyEl.text.trim();
  return defEl.text.trim() || undefined;
}

function parseDocumentation(el: XmlElement): string | undefined {
  const commentEl = el.children.find((c: XmlElement) => localName(c.name) === "ownedComment");
  if (!commentEl) return undefined;
  const bodyAttr = getAttr(commentEl, "body");
  if (bodyAttr) return bodyAttr;
  const bodyChild = commentEl.children.find((c: XmlElement) => localName(c.name) === "body");
  return bodyChild?.text.trim() || undefined;
}

function parseViewBounds(diagramEl: XmlElement): DiagramViewBounds[] {
  const bounds: DiagramViewBounds[] = [];
  const walk = (node: XmlElement) => {
    const tag = localName(node.name);
    if (tag === "mdElement" || tag === "children" || tag === "presentationElement") {
      const elemIdChild = node.children.find((c: XmlElement) => localName(c.name) === "elementID");
      const elemRef =
        getAttr(node, "elementID") ??
        getAttr(node, "element") ??
        (elemIdChild
          ? (getAttr(elemIdChild, "xmi:idref") ??
            getAttr(elemIdChild, "href")?.split("#").pop() ??
            elemIdChild.text.trim())
          : undefined);
      const geomStr =
        getAttr(node, "geometry") ??
        node.children.find((c: XmlElement) => localName(c.name) === "geometry")?.text.trim();
      if (elemRef && geomStr) {
        const parts = geomStr.split(",").map((s) => Number(s.trim()));
        if (parts.length >= 4 && parts.every((n) => Number.isFinite(n))) {
          bounds.push({
            elementId: elemRef,
            x: parts[0]!,
            y: parts[1]!,
            width: Math.max(60, parts[2]!),
            height: Math.max(40, parts[3]!),
          });
        }
      }
      // Also support explicit x/y/width/height attributes (OMG DI / simplified views)
      const xAttr = getAttr(node, "x");
      const yAttr = getAttr(node, "y");
      const wAttr = getAttr(node, "width");
      const hAttr = getAttr(node, "height");
      if (elemRef && xAttr !== undefined && yAttr !== undefined && wAttr !== undefined && hAttr !== undefined) {
        const x = Number(xAttr);
        const y = Number(yAttr);
        const width = Number(wAttr);
        const height = Number(hAttr);
        if ([x, y, width, height].every(Number.isFinite)) {
          bounds.push({ elementId: elemRef, x, y, width, height });
        }
      }
    }
    for (const child of node.children) walk(child);
  };
  walk(diagramEl);
  return bounds;
}

function parseEdgePoints(diagramEl: XmlElement): DiagramEdgePoints[] {
  const results: DiagramEdgePoints[] = [];
  const walk = (node: XmlElement) => {
    const tag = localName(node.name);
    if (tag === "mdElement" || tag === "children" || tag === "presentationElement") {
      const elemIdChild = node.children.find((c: XmlElement) => localName(c.name) === "elementID");
      const elemRef =
        getAttr(node, "elementID") ??
        getAttr(node, "element") ??
        (elemIdChild ? (getAttr(elemIdChild, "xmi:idref") ?? elemIdChild.text.trim()) : undefined);
      const geomText = node.children.find((c: XmlElement) => localName(c.name) === "geometry")?.text.trim();
      const ptsRaw =
        getAttr(node, "breakpoints") ??
        getAttr(node, "points") ??
        node.children
          .find((c: XmlElement) => {
            const n = localName(c.name);
            return n === "breakpoints" || n === "bendpoints" || n === "points";
          })
          ?.text.trim() ??
        (geomText && geomText.includes(";") ? geomText : undefined);

      if (elemRef && ptsRaw) {
        const pairs = ptsRaw
          .split(";")
          .map((seg) => seg.trim())
          .filter(Boolean);
        const pts: Array<{ x: number; y: number }> = [];
        for (const p of pairs) {
          const [xs, ys] = p.split(",");
          const x = Number(xs?.trim());
          const y = Number(ys?.trim());
          if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
        }
        if (pts.length >= 2) {
          results.push({ elementId: elemRef, points: pts });
        }
      }
    }
    for (const child of node.children) walk(child);
  };
  walk(diagramEl);
  return results;
}

function javaColorIntToHex(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) return undefined;
  const rgb = (n >>> 0) & 0xffffff;
  return `#${rgb.toString(16).padStart(6, "0")}`;
}

function parseViewStyles(diagramEl: XmlElement): DiagramViewStyle[] {
  const styles: DiagramViewStyle[] = [];
  const walk = (node: XmlElement) => {
    const tag = localName(node.name);
    if (tag === "mdElement") {
      const elemIdChild = node.children.find((c: XmlElement) => localName(c.name) === "elementID");
      const elemRef =
        getAttr(node, "elementID") ??
        (elemIdChild ? (getAttr(elemIdChild, "xmi:idref") ?? elemIdChild.text.trim()) : undefined);
      const propsEl = node.children.find((c: XmlElement) => localName(c.name) === "properties");
      if (elemRef && propsEl) {
        let fillColor: string | undefined;
        let strokeColor: string | undefined;
        const suppressedCompartments: string[] = [];
        for (const pEl of propsEl.children) {
          const propId = pEl.children.find((c: XmlElement) => localName(c.name) === "propertyID")?.text.trim();
          const valEl = pEl.children.find((c: XmlElement) => localName(c.name) === "value");
          const valStr = valEl
            ? (getAttr(valEl, "xmi:value") ?? getAttr(valEl, "value") ?? valEl.text.trim())
            : undefined;
          if (!propId) continue;
          if (propId === "FILL_COLOR") {
            fillColor = javaColorIntToHex(valStr);
          } else if (propId === "PEN_COLOR") {
            strokeColor = javaColorIntToHex(valStr);
          } else if (propId.startsWith("SUPPRESS_") && valStr === "true") {
            if (propId.includes("PARTS")) suppressedCompartments.push("parts");
            else if (propId.includes("REFERENCES")) suppressedCompartments.push("references");
            else if (propId.includes("VALUES") || propId.includes("ATTRIBUTES")) suppressedCompartments.push("values");
            else if (propId.includes("CONSTRAINTS")) suppressedCompartments.push("constraints");
            else if (propId.includes("OPERATIONS")) suppressedCompartments.push("operations");
            else if (propId.includes("FLOW")) suppressedCompartments.push("flow properties");
            else if (propId.includes("PORTS")) suppressedCompartments.push("ports");
          }
        }
        if (fillColor || strokeColor || suppressedCompartments.length > 0) {
          styles.push({ elementId: elemRef, fillColor, strokeColor, suppressedCompartments });
        }
      }
    }
    for (const ch of node.children) walk(ch);
  };
  walk(diagramEl);
  return styles;
}

function parseDiagramFrame(diagramEl: XmlElement): DiagramViewBounds | undefined {
  let found: DiagramViewBounds | undefined;
  const walk = (node: XmlElement) => {
    if (found) return;
    if (localName(node.name) === "mdElement" && getAttr(node, "elementClass") === "DiagramFrame") {
      const geomStr = node.children.find((c: XmlElement) => localName(c.name) === "geometry")?.text.trim();
      if (geomStr && !geomStr.includes(";")) {
        const parts = geomStr.split(",").map((s) => Number(s.trim()));
        if (parts.length >= 4 && parts.every(Number.isFinite)) {
          found = { elementId: "DiagramFrame", x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! };
          return;
        }
      }
    }
    for (const ch of node.children) walk(ch);
  };
  walk(diagramEl);
  return found;
}

/**
 * Lazily loads and caches Cameo `<mdOwnedViews>` bounds, edge waypoints, `SUPPRESS_*`
 * compartment flags, and colors from a diagram's `BINARY-<uuid>` stream on demand.
 */
export function loadDiagramView(doc: MagicDrawDocument, diagramId: string): MagicDrawDiagramMeta | undefined {
  const meta = doc.diagrams.find((d) => d.id === diagramId);
  if (!meta) return undefined;
  if (meta.viewLoaded) return meta;
  meta.viewLoaded = true;

  if (meta.streamContentId && doc.readBinaryEntry) {
    const binXml = doc.readBinaryEntry(meta.streamContentId);
    if (binXml && binXml.includes("<mdOwnedViews")) {
      try {
        const binDoc = parseMagicDrawXmlDocument(binXml);
        if (binDoc.root) {
          const bounds = parseViewBounds(binDoc.root);
          const edges = parseEdgePoints(binDoc.root);
          const styles = parseViewStyles(binDoc.root);
          const frame = parseDiagramFrame(binDoc.root);
          if (bounds.length > 0) meta.viewBounds = bounds;
          if (edges.length > 0) meta.edgePoints = edges;
          if (styles.length > 0) meta.viewStyles = styles;
          if (frame) meta.frameBounds = frame;
          meta.elementIds = Array.from(new Set([...meta.elementIds, ...bounds.map((b) => b.elementId)]));
        }
      } catch {
        // Ignore malformed binary view streams and fall back to auto-layout
      }
    }
  }
  return meta;
}

export interface ParseMagicDrawOptions {
  metadata?: Partial<MagicDrawArchiveMetadata> | undefined;
  externalResolver?:
    | ((href: string) => { name: string; id?: string; unit?: string; isPrimitive?: boolean } | undefined)
    | undefined;
  readBinaryEntry?: ((entryName: string) => string | undefined) | undefined;
}

/**
 * Parses a MagicDraw `.mdxml` / `.xmi` XML string into a typed `MagicDrawDocument`.
 */
export function parseMagicDrawXmi(xmlText: string, options?: ParseMagicDrawOptions): MagicDrawDocument {
  const metadata: MagicDrawArchiveMetadata = {
    format: options?.metadata?.format ?? (xmlText.includes("magicdraw") ? "mdxml" : "xmi"),
    status: options?.metadata?.status ?? "ok",
    statusMessage: options?.metadata?.statusMessage,
    projectName: options?.metadata?.projectName,
    magicDrawVersion: options?.metadata?.magicDrawVersion,
    entries: options?.metadata?.entries ?? [],
    mountedModules: options?.metadata?.mountedModules ?? [],
  };

  const doc: MagicDrawDocument = {
    metadata,
    packages: new Map(),
    classifiers: new Map(),
    stateMachines: new Map(),
    activities: new Map(),
    interactions: new Map(),
    relationships: [],
    stereotypes: [],
    diagrams: [],
    elementsById: new Map(),
    duplicateIds: [],
    unresolvedHrefs: [],
    orphanStereotypes: [],
    readBinaryEntry: options?.readBinaryEntry,
  };

  if (!xmlText.trim()) {
    return doc;
  }

  const lineStarts = computeLineStarts(xmlText);
  const xmlDoc = parseMagicDrawXmlDocument(xmlText);
  const root = xmlDoc.root;
  if (!root) {
    doc.metadata.status = "corrupt";
    doc.metadata.statusMessage = "XML root element could not be parsed.";
    return doc;
  }

  // Record XMI / UML versions from root attributes
  doc.metadata.xmiVersion = getAttr(root, "xmi:version") ?? getAttr(root, "version");

  const registerId = (id: string, name: string, qualifiedName: string, kind: string, span?: SourceSpan) => {
    if (doc.elementsById.has(id)) {
      doc.duplicateIds.push({ id, span });
    } else {
      doc.elementsById.set(id, { id, name, qualifiedName, kind, span });
    }
  };

  const seenStereotypesByTarget = new Map<string, StereotypeApplication[]>();
  const rawAbstractions = new Map<
    string,
    {
      id: string;
      name?: string | undefined;
      sourceId: string;
      targetId: string;
      sourceHref?: string | undefined;
      targetHref?: string | undefined;
      span?: SourceSpan | undefined;
    }
  >();

  const addStereotype = (st: StereotypeApplication) => {
    doc.stereotypes.push(st);
    const list = seenStereotypesByTarget.get(st.targetId) ?? [];
    list.push(st);
    seenStereotypesByTarget.set(st.targetId, list);
  };

  // Helper to collect top-level stereotype applications (siblings of uml:Model inside xmi:XMI)
  const parseStereotypeElement = (el: XmlElement) => {
    const baseAttrObj = el.attributes.find((a: XmlAttribute) => localName(a.name).startsWith("base_"));
    if (!baseAttrObj) return;
    const prefix = tagPrefix(el.name);
    const sName = localName(el.name);
    const id = getXmiId(el) ?? `st_${doc.stereotypes.length + 1}`;
    const tags: Record<string, string> = {};
    for (const a of el.attributes) {
      if (a.name === "xmi:id" || a.name === baseAttrObj.name || a.name.startsWith("xmlns")) {
        continue;
      }
      tags[localName(a.name)] = a.value;
    }
    // Also check child tag elements (e.g. <text>...</text> or <id>...</id>)
    for (const child of el.children) {
      const cName = localName(child.name);
      if (child.text.trim()) {
        tags[cName] = child.text.trim();
      } else {
        const href = getAttr(child, "href");
        if (href) tags[cName] = href;
      }
    }
    addStereotype({
      id,
      profilePrefix: prefix,
      name: sName,
      qualifiedName: prefix ? `${prefix}:${sName}` : sName,
      targetId: baseAttrObj.value,
      baseAttr: baseAttrObj.name,
      tags,
      span: elementSpan(el, lineStarts),
    });
  };

  const parseStateMachine = (smEl: XmlElement, ownerId: string, ownerQName: string): UmlStateMachine => {
    const id = getXmiId(smEl) ?? `sm_${doc.stateMachines.size + 1}`;
    const name = getAttr(smEl, "name") ?? "StateMachine";
    const qualifiedName = ownerQName ? `${ownerQName}::${name}` : name;
    const span = elementSpan(smEl, lineStarts);
    registerId(id, name, qualifiedName, "StateMachine", span);

    const states: UmlState[] = [];
    const transitions: UmlTransition[] = [];

    const walkRegion = (regionEl: XmlElement) => {
      for (const child of regionEl.children) {
        const cTag = localName(child.name);
        const cType = (getXmiType(child) ?? "").replace(/^uml:/i, "");
        if (cTag === "subvertex") {
          const sId = getXmiId(child) ?? `state_${states.length + 1}`;
          const sName =
            getAttr(child, "name") ?? (cType === "Pseudostate" ? (getAttr(child, "kind") ?? "initial") : "State");
          let kind: UmlState["kind"] = "state";
          if (cType === "FinalState") kind = "final";
          else if (cType === "Pseudostate") {
            const psKind = (getAttr(child, "kind") ?? "initial").toLowerCase();
            if (psKind === "choice") kind = "choice";
            else if (psKind === "fork") kind = "fork";
            else if (psKind === "join") kind = "join";
            else kind = "initial";
          }
          const entryEl = child.children.find((c: XmlElement) => localName(c.name) === "entry");
          const doEl = child.children.find((c: XmlElement) => localName(c.name) === "doActivity");
          const exitEl = child.children.find((c: XmlElement) => localName(c.name) === "exit");
          const stateSpan = elementSpan(child, lineStarts);
          states.push({
            id: sId,
            name: sName,
            kind,
            entryAction: entryEl
              ? (getAttr(entryEl, "name") ??
                entryEl.children.find((c: XmlElement) => localName(c.name) === "body")?.text.trim())
              : undefined,
            doAction: doEl
              ? (getAttr(doEl, "name") ??
                doEl.children.find((c: XmlElement) => localName(c.name) === "body")?.text.trim())
              : undefined,
            exitAction: exitEl
              ? (getAttr(exitEl, "name") ??
                exitEl.children.find((c: XmlElement) => localName(c.name) === "body")?.text.trim())
              : undefined,
            span: stateSpan,
          });
          registerId(sId, sName, `${qualifiedName}::${sName}`, "State", stateSpan);
        } else if (cTag === "transition") {
          const tId = getXmiId(child) ?? `tr_${transitions.length + 1}`;
          const sourceId = getAttr(child, "source") ?? "";
          const targetId = getAttr(child, "target") ?? "";
          const triggerEl = child.children.find((c: XmlElement) => localName(c.name) === "trigger");
          const guardEl = child.children.find((c: XmlElement) => localName(c.name) === "guard");
          const effectEl = child.children.find((c: XmlElement) => localName(c.name) === "effect");
          const guardBody =
            guardEl?.children
              .find((c: XmlElement) => localName(c.name) === "specification")
              ?.children.find((c: XmlElement) => localName(c.name) === "body")
              ?.text.trim() ?? (guardEl ? getAttr(guardEl, "name") : undefined);
          transitions.push({
            id: tId,
            name: getAttr(child, "name"),
            sourceId,
            targetId,
            trigger: triggerEl ? getAttr(triggerEl, "name") : undefined,
            guard: guardBody,
            effect: effectEl
              ? (getAttr(effectEl, "name") ??
                effectEl.children.find((c: XmlElement) => localName(c.name) === "body")?.text.trim())
              : undefined,
            span: elementSpan(child, lineStarts),
          });
        } else if (cTag === "region") {
          walkRegion(child);
        }
      }
    };

    for (const child of smEl.children) {
      if (localName(child.name) === "region") walkRegion(child);
    }

    const sm: UmlStateMachine = {
      id,
      name,
      qualifiedName,
      ownerId,
      states,
      transitions,
      span,
    };
    doc.stateMachines.set(id, sm);
    return sm;
  };

  const parseActivity = (actEl: XmlElement, ownerId: string, ownerQName: string): UmlActivity => {
    const id = getXmiId(actEl) ?? `act_${doc.activities.size + 1}`;
    const name = getAttr(actEl, "name") ?? "Activity";
    const qualifiedName = ownerQName ? `${ownerQName}::${name}` : name;
    const span = elementSpan(actEl, lineStarts);
    registerId(id, name, qualifiedName, "Activity", span);

    const nodes: UmlActivityNode[] = [];
    const edges: UmlActivityEdge[] = [];

    for (const child of actEl.children) {
      const cTag = localName(child.name);
      const cType = (getXmiType(child) ?? "").replace(/^uml:/i, "");
      if (cTag === "node") {
        const nId = getXmiId(child) ?? `actnode_${nodes.length + 1}`;
        const nName = getAttr(child, "name") ?? cType;
        let kind: UmlActivityNode["kind"] = "action";
        if (cType === "InitialNode") kind = "initial";
        else if (cType === "ActivityFinalNode" || cType === "FlowFinalNode") kind = "final";
        else if (cType === "DecisionNode" || cType === "MergeNode") kind = "decision";
        else if (cType === "ForkNode") kind = "fork";
        else if (cType === "JoinNode") kind = "join";
        else if (cType.includes("Object") || cType.includes("Pin") || cType.includes("Parameter")) kind = "object";
        const nSpan = elementSpan(child, lineStarts);
        nodes.push({ id: nId, name: nName, kind, span: nSpan });
        registerId(nId, nName, `${qualifiedName}::${nName}`, cType || "Action", nSpan);
      } else if (cTag === "edge") {
        const eId = getXmiId(child) ?? `actedge_${edges.length + 1}`;
        const sourceId = getAttr(child, "source") ?? "";
        const targetId = getAttr(child, "target") ?? "";
        const guardEl = child.children.find((c: XmlElement) => localName(c.name) === "guard");
        const guard =
          guardEl?.children.find((c: XmlElement) => localName(c.name) === "body")?.text.trim() ??
          (guardEl ? getAttr(guardEl, "value") : undefined);
        edges.push({
          id: eId,
          name: getAttr(child, "name"),
          sourceId,
          targetId,
          guard,
          isObjectFlow: cType === "ObjectFlow",
          span: elementSpan(child, lineStarts),
        });
      }
    }

    const act: UmlActivity = { id, name, qualifiedName, ownerId, nodes, edges, span };
    doc.activities.set(id, act);
    return act;
  };

  const parseInteraction = (intEl: XmlElement, ownerId: string, ownerQName: string): UmlInteraction => {
    const id = getXmiId(intEl) ?? `int_${doc.interactions.size + 1}`;
    const name = getAttr(intEl, "name") ?? "Interaction";
    const qualifiedName = ownerQName ? `${ownerQName}::${name}` : name;
    const span = elementSpan(intEl, lineStarts);
    registerId(id, name, qualifiedName, "Interaction", span);

    const lifelines: UmlLifeline[] = [];
    const messages: UmlMessage[] = [];
    const fragmentToLifeline = new Map<string, string>();

    for (const child of intEl.children) {
      const cTag = localName(child.name);
      if (cTag === "lifeline") {
        const lId = getXmiId(child) ?? `ll_${lifelines.length + 1}`;
        const lName = getAttr(child, "name") ?? `Lifeline_${lifelines.length + 1}`;
        const lSpan = elementSpan(child, lineStarts);
        lifelines.push({
          id: lId,
          name: lName,
          representsId: getAttr(child, "represents"),
          span: lSpan,
        });
        registerId(lId, lName, `${qualifiedName}::${lName}`, "Lifeline", lSpan);
      } else if (cTag === "fragment") {
        const fId = getXmiId(child);
        const covered = getAttr(child, "covered");
        if (fId && covered) fragmentToLifeline.set(fId, covered.split(/\s+/)[0]!);
      }
    }

    for (const child of intEl.children) {
      if (localName(child.name) === "message") {
        const mId = getXmiId(child) ?? `msg_${messages.length + 1}`;
        const mName = getAttr(child, "name") ?? `msg_${messages.length + 1}`;
        const sendEv = getAttr(child, "sendEvent") ?? "";
        const recvEv = getAttr(child, "receiveEvent") ?? "";
        const sortRaw = getAttr(child, "messageSort") ?? "synchCall";
        const messageSort: UmlMessage["messageSort"] =
          sortRaw === "asynchCall" || sortRaw === "reply" || sortRaw === "createMessage" || sortRaw === "deleteMessage"
            ? sortRaw
            : "synchCall";
        messages.push({
          id: mId,
          name: mName,
          sourceLifelineId: fragmentToLifeline.get(sendEv) ?? sendEv,
          targetLifelineId: fragmentToLifeline.get(recvEv) ?? recvEv,
          messageSort,
          span: elementSpan(child, lineStarts),
        });
      }
    }

    const interaction: UmlInteraction = { id, name, qualifiedName, ownerId, lifelines, messages, span };
    doc.interactions.set(id, interaction);
    return interaction;
  };

  const parseDiagramExtension = (el: XmlElement, ownerId: string) => {
    // Check both uml:Diagram (ownedDiagram) and MagicDraw <xmi:Extension><diagramRepresentation><diagram:DiagramRepresentationObject type='...'>
    const dId = getXmiId(el) ?? `diag_${doc.diagrams.length + 1}`;
    const name = getAttr(el, "name") ?? "Diagram";
    const exactAttr = (node: XmlElement, name: string) =>
      node.attributes.find((a: XmlAttribute) => a.name === name)?.value;
    let diagramType = exactAttr(el, "type") ?? exactAttr(el, "diagramType");
    if (!diagramType) {
      const findDroType = (node: XmlElement): string | undefined => {
        if (localName(node.name) === "DiagramRepresentationObject") {
          return exactAttr(node, "type") ?? exactAttr(node, "umlType");
        }
        for (const ch of node.children) {
          const found = findDroType(ch);
          if (found) return found;
        }
        return undefined;
      };
      diagramType = findDroType(el) ?? "Block Definition Diagram";
    }
    const usedIds: string[] = [];
    let streamContentId: string | undefined;
    const collectDiagramContents = (node: XmlElement) => {
      const nTag = localName(node.name);
      if (nTag === "binaryObject") {
        const sid = exactAttr(node, "streamContentID") ?? getAttr(node, "streamContentID");
        if (sid) streamContentId = sid;
      } else if (nTag === "usedObjects") {
        const href = getAttr(node, "href");
        const idref = getAttr(node, "xmi:idref");
        if (href) {
          const frag = href.includes("#") ? href.slice(href.indexOf("#") + 1).trim() : href.trim();
          if (frag) usedIds.push(frag);
        } else if (idref) {
          usedIds.push(idref);
        }
      } else if (nTag === "usedElements") {
        const txt = node.text.trim();
        if (txt) {
          for (const tok of txt.split(/\s+/)) {
            if (tok) usedIds.push(tok);
          }
        }
      }
      for (const ch of node.children) collectDiagramContents(ch);
    };
    collectDiagramContents(el);

    const viewBounds = parseViewBounds(el);
    const edgePoints = parseEdgePoints(el);
    const viewStyles = parseViewStyles(el);
    const frameBounds = parseDiagramFrame(el);
    const elementIds = Array.from(new Set([...usedIds, ...viewBounds.map((b) => b.elementId)]));
    const span = elementSpan(el, lineStarts);
    doc.diagrams.push({
      id: dId,
      name,
      diagramType,
      kind: classifyDiagramKind(diagramType),
      ownerId,
      elementIds,
      viewBounds,
      edgePoints: edgePoints.length > 0 ? edgePoints : undefined,
      viewStyles: viewStyles.length > 0 ? viewStyles : undefined,
      frameBounds,
      streamContentId,
      viewLoaded: !streamContentId || viewBounds.length > 0,
      span,
    });
    registerId(dId, name, name, "Diagram", span);
  };

  const parseClassifier = (el: XmlElement, ownerId: string, ownerQName: string): UmlClassifier => {
    const id = getXmiId(el) ?? `cls_${doc.classifiers.size + 1}`;
    const umlType = getXmiType(el) ?? "uml:Class";
    const name = getAttr(el, "name") ?? `Unnamed_${id}`;
    const qualifiedName = ownerQName ? `${ownerQName}::${name}` : name;
    const span = elementSpan(el, lineStarts);
    registerId(id, name, qualifiedName, umlType.replace(/^uml:/i, ""), span);

    const generalizationIds: string[] = [];
    const generalizationHrefs: string[] = [];
    const properties: UmlProperty[] = [];
    const ports: UmlPort[] = [];
    const operations: UmlOperation[] = [];
    const constraints: UmlConstraint[] = [];
    const connectors: UmlConnector[] = [];
    const literals: string[] = [];

    for (const child of el.children) {
      const cTag = localName(child.name);
      const cType = (getXmiType(child) ?? "").replace(/^uml:/i, "");

      if (cTag === "generalization") {
        const genAttr = getAttr(child, "general");
        if (genAttr) {
          generalizationIds.push(genAttr);
          doc.relationships.push({
            id: getXmiId(child) ?? `gen_${doc.relationships.length + 1}`,
            kind: "generalization",
            sourceId: id,
            targetId: genAttr,
            span: elementSpan(child, lineStarts),
          });
        } else {
          const genChild = child.children.find((c: XmlElement) => localName(c.name) === "general");
          const href = genChild ? getAttr(genChild, "href") : undefined;
          if (href) generalizationHrefs.push(href);
        }
      } else if (cTag === "ownedAttribute" && cType === "Port") {
        const pId = getXmiId(child) ?? `port_${ports.length + 1}`;
        const pName = getAttr(child, "name") ?? `port_${ports.length + 1}`;
        const pSpan = elementSpan(child, lineStarts);
        ports.push({
          id: pId,
          name: pName,
          ownerId: id,
          typeRef: parseTypeRefFromElement(child),
          isConjugated: getAttr(child, "isConjugated") === "true",
          isBehavior: getAttr(child, "isBehavior") === "true",
          isService: getAttr(child, "isService") !== "false",
          portKind: "standard",
          stereotypes: [],
          span: pSpan,
        });
        registerId(pId, pName, `${qualifiedName}::${pName}`, "Port", pSpan);
      } else if (cTag === "ownedAttribute") {
        const propId = getXmiId(child) ?? `prop_${properties.length + 1}`;
        const propName = getAttr(child, "name") ?? `attr_${properties.length + 1}`;
        const aggRaw = (getAttr(child, "aggregation") ?? "none").toLowerCase();
        const aggregation: UmlProperty["aggregation"] =
          aggRaw === "composite" ? "composite" : aggRaw === "shared" ? "shared" : "none";
        const visRaw = (getAttr(child, "visibility") ?? "public").toLowerCase();
        const visibility: UmlProperty["visibility"] =
          visRaw === "private" || visRaw === "protected" || visRaw === "package" ? visRaw : "public";
        const pSpan = elementSpan(child, lineStarts);
        properties.push({
          id: propId,
          name: propName,
          ownerId: id,
          aggregation,
          visibility,
          typeRef: parseTypeRefFromElement(child),
          defaultValue: parseDefaultValue(child),
          multiplicity: parseMultiplicity(child),
          isReadOnly: getAttr(child, "isReadOnly") === "true",
          isDerived: getAttr(child, "isDerived") === "true",
          compartment: "attributes",
          stereotypes: [],
          span: pSpan,
        });
        registerId(propId, propName, `${qualifiedName}::${propName}`, "Property", pSpan);
      } else if (cTag === "ownedOperation") {
        const opId = getXmiId(child) ?? `op_${operations.length + 1}`;
        const opName = getAttr(child, "name") ?? `op_${operations.length + 1}`;
        const params: UmlOperation["parameters"] = [];
        for (const pChild of child.children) {
          if (localName(pChild.name) === "ownedParameter") {
            const dirRaw = (getAttr(pChild, "direction") ?? "in").toLowerCase();
            const direction = dirRaw === "out" || dirRaw === "inout" || dirRaw === "return" ? dirRaw : "in";
            params.push({
              id: getXmiId(pChild) ?? `param_${params.length + 1}`,
              name: getAttr(pChild, "name") ?? (direction === "return" ? "return" : `p${params.length + 1}`),
              direction,
              typeRef: parseTypeRefFromElement(pChild),
            });
          }
        }
        operations.push({
          id: opId,
          name: opName,
          ownerId: id,
          parameters: params,
          stereotypes: [],
          span: elementSpan(child, lineStarts),
        });
      } else if (cTag === "ownedRule") {
        const cId = getXmiId(child) ?? `rule_${constraints.length + 1}`;
        const cName = getAttr(child, "name") ?? `constraint_${constraints.length + 1}`;
        const specEl = child.children.find((c: XmlElement) => localName(c.name) === "specification");
        const langEl = specEl?.children.find((c: XmlElement) => localName(c.name) === "language");
        const bodyEl = specEl?.children.find((c: XmlElement) => localName(c.name) === "body");
        const language = langEl?.text.trim() ?? getAttr(specEl ?? child, "language") ?? "English";
        const body = bodyEl?.text.trim() ?? getAttr(specEl ?? child, "body") ?? "";
        const constrainedAttr = getAttr(child, "constrainedElement");
        constraints.push({
          id: cId,
          name: cName,
          ownerId: id,
          language,
          body,
          constrainedElementIds: constrainedAttr ? constrainedAttr.split(/\s+/).filter(Boolean) : [],
          span: elementSpan(child, lineStarts),
        });
      } else if (cTag === "ownedConnector") {
        const connId = getXmiId(child) ?? `conn_${connectors.length + 1}`;
        const connName = getAttr(child, "name") ?? "";
        const ends: UmlConnectorEnd[] = [];
        for (const eChild of child.children) {
          if (localName(eChild.name) === "end") {
            ends.push({
              id: getXmiId(eChild) ?? `end_${ends.length + 1}`,
              roleId: getAttr(eChild, "role"),
              partWithPortId: getAttr(eChild, "partWithPort"),
            });
          }
        }
        connectors.push({
          id: connId,
          name: connName,
          ownerId: id,
          kind: "assembly",
          ends,
          stereotypes: [],
          span: elementSpan(child, lineStarts),
        });
        registerId(
          connId,
          connName || connId,
          `${qualifiedName}::${connName || connId}`,
          "Connector",
          elementSpan(child, lineStarts),
        );
      } else if (cTag === "ownedLiteral") {
        const litName = getAttr(child, "name");
        if (litName) literals.push(litName);
      } else if (cTag === "nestedClassifier") {
        // Nested requirements or inner blocks
        const nested = parseClassifier(child, id, qualifiedName);
        doc.relationships.push({
          id: `contain_${id}_${nested.id}`,
          kind: "containment",
          sourceId: id,
          targetId: nested.id,
          span: nested.span,
        });
      } else if (cTag === "ownedBehavior" && cType === "StateMachine") {
        parseStateMachine(child, id, qualifiedName);
      } else if (cTag === "Extension" || cTag === "ownedDiagram") {
        const walkDiagExt = (node: XmlElement) => {
          const nTag = localName(node.name);
          if (nTag === "ownedDiagram" || nTag === "diagram") {
            parseDiagramExtension(node, id);
            return;
          }
          if (nTag === "Extension" || nTag === "modelExtension") {
            for (const ch of node.children) walkDiagExt(ch);
          }
        };
        walkDiagExt(child);
      }
    }

    const cls: UmlClassifier = {
      id,
      name,
      qualifiedName,
      ownerId,
      umlType,
      kind: "Class",
      isAbstract: getAttr(el, "isAbstract") === "true",
      documentation: parseDocumentation(el),
      generalizationIds,
      generalizationHrefs,
      properties,
      ports,
      operations,
      constraints,
      connectors,
      literals,
      stereotypes: [],
      span,
    };
    doc.classifiers.set(id, cls);
    return cls;
  };

  const parsePackage = (
    el: XmlElement,
    ownerId: string | undefined,
    ownerQName: string,
    isModel: boolean,
  ): UmlPackage => {
    const id = getXmiId(el) ?? `pkg_${doc.packages.size + 1}`;
    const name = getAttr(el, "name") ?? (isModel ? "Model" : `Package_${id}`);
    const qualifiedName = ownerQName ? `${ownerQName}::${name}` : name;
    const span = elementSpan(el, lineStarts);
    registerId(id, name, qualifiedName, isModel ? "Model" : "Package", span);

    const pkg: UmlPackage = {
      id,
      name,
      qualifiedName,
      ownerId,
      isModel,
      childPackageIds: [],
      classifierIds: [],
      stateMachineIds: [],
      diagramIds: [],
      span,
    };
    doc.packages.set(id, pkg);
    if (isModel && !doc.rootPackageId) {
      doc.rootPackageId = id;
      if (!doc.metadata.projectName) doc.metadata.projectName = name;
    }

    for (const child of el.children) {
      const cTag = localName(child.name);
      const cType = (getXmiType(child) ?? "").replace(/^uml:/i, "");

      if (cTag === "packagedElement") {
        if (cType === "Package" || cType === "Model") {
          const childPkg = parsePackage(child, id, qualifiedName, cType === "Model");
          pkg.childPackageIds.push(childPkg.id);
        } else if (
          cType === "Class" ||
          cType === "Interface" ||
          cType === "DataType" ||
          cType === "PrimitiveType" ||
          cType === "Enumeration" ||
          cType === "Signal" ||
          cType === "AssociationClass"
        ) {
          const cls = parseClassifier(child, id, qualifiedName);
          pkg.classifierIds.push(cls.id);
        } else if (cType === "StateMachine") {
          const sm = parseStateMachine(child, id, qualifiedName);
          pkg.stateMachineIds.push(sm.id);
        } else if (cType === "Activity") {
          const act = parseActivity(child, id, qualifiedName);
          pkg.activityIds = [...(pkg.activityIds ?? []), act.id];
        } else if (cType === "Interaction") {
          const inter = parseInteraction(child, id, qualifiedName);
          pkg.interactionIds = [...(pkg.interactionIds ?? []), inter.id];
        } else if (cType === "Abstraction" || cType === "Dependency" || cType === "Realization" || cType === "Usage") {
          const relId = getXmiId(child) ?? `rel_${doc.relationships.length + 1}`;
          const clientEl = child.children.find((c: XmlElement) => localName(c.name) === "client");
          const supplierEl = child.children.find((c: XmlElement) => localName(c.name) === "supplier");
          const sourceId = getAttr(child, "client") ?? (clientEl ? getAttr(clientEl, "xmi:idref") : undefined) ?? "";
          const targetId =
            getAttr(child, "supplier") ?? (supplierEl ? getAttr(supplierEl, "xmi:idref") : undefined) ?? "";
          const sourceHref = clientEl ? getAttr(clientEl, "href") : undefined;
          const targetHref = supplierEl ? getAttr(supplierEl, "href") : undefined;
          const relSpan = elementSpan(child, lineStarts);
          rawAbstractions.set(relId, {
            id: relId,
            name: getAttr(child, "name"),
            sourceId,
            targetId,
            sourceHref,
            targetHref,
            span: relSpan,
          });
          registerId(relId, getAttr(child, "name") ?? relId, `${qualifiedName}::${relId}`, cType, relSpan);
        } else if (cType === "InstanceSpecification") {
          const instId = getXmiId(child);
          const instName = getAttr(child, "name");
          if (instId && instName) {
            registerId(
              instId,
              instName,
              `${qualifiedName}::${instName}`,
              "InstanceSpecification",
              elementSpan(child, lineStarts),
            );
          }
        } else if (cType === "Association") {
          // Record association if memberEnds or ownedEnds specify two distinct types
          const ownedEnds = child.children.filter((c: XmlElement) => localName(c.name) === "ownedEnd");
          if (ownedEnds.length >= 2) {
            const t0 = parseTypeRefFromElement(ownedEnds[0]!);
            const t1 = parseTypeRefFromElement(ownedEnds[1]!);
            if (t0?.rawId && t1?.rawId) {
              const agg = getAttr(ownedEnds[0]!, "aggregation") ?? getAttr(ownedEnds[1]!, "aggregation");
              const kind: UmlRelationshipKind =
                agg === "composite" ? "composition" : agg === "shared" ? "aggregation" : "association";
              doc.relationships.push({
                id: getXmiId(child) ?? `assoc_${doc.relationships.length + 1}`,
                name: getAttr(child, "name"),
                kind,
                sourceId: t0.rawId,
                targetId: t1.rawId,
                span: elementSpan(child, lineStarts),
              });
            }
          }
        }
      } else if (cTag === "ownedDiagram") {
        const beforeCount = doc.diagrams.length;
        parseDiagramExtension(child, id);
        if (doc.diagrams.length > beforeCount) {
          pkg.diagramIds.push(doc.diagrams[doc.diagrams.length - 1]!.id);
        }
      } else if (cTag === "Extension") {
        const walkPkgDiagExt = (node: XmlElement) => {
          const nTag = localName(node.name);
          if (nTag === "ownedDiagram" || nTag === "diagram") {
            const beforeCount = doc.diagrams.length;
            parseDiagramExtension(node, id);
            if (doc.diagrams.length > beforeCount) {
              pkg.diagramIds.push(doc.diagrams[doc.diagrams.length - 1]!.id);
            }
            return;
          }
          if (nTag === "Extension" || nTag === "modelExtension") {
            for (const ch of node.children) walkPkgDiagExt(ch);
          }
        };
        walkPkgDiagExt(child);
      }
    }

    return pkg;
  };

  // --- Pass 1: Walk root element ---
  const rootTag = localName(root.name);
  if (rootTag === "XMI") {
    for (const child of root.children) {
      const cTag = localName(child.name);
      if (cTag === "Model" || cTag === "Package") {
        parsePackage(child, undefined, "", cTag === "Model");
      } else if (cTag === "Documentation") {
        const exporter = getAttr(child, "exporter");
        const exporterVer = getAttr(child, "exporterVersion");
        if (exporter && exporterVer && !doc.metadata.magicDrawVersion) {
          doc.metadata.magicDrawVersion = `${exporter} ${exporterVer}`;
        }
      } else if (cTag !== "Extension") {
        parseStereotypeElement(child);
      }
    }
  } else if (rootTag === "Model" || rootTag === "Package") {
    parsePackage(root, undefined, "", rootTag === "Model");
  }

  // --- Pass 2: Attach stereotypes, resolve TypeRefs, classify compartments & relationships ---
  const resolveTypeRef = (ref: TypeReference | undefined, ownerId: string, span?: SourceSpan) => {
    if (!ref) return;
    if (ref.rawId) {
      const localEl = doc.elementsById.get(ref.rawId);
      if (localEl) {
        ref.resolvedId = localEl.id;
        ref.resolvedName = localEl.name;
        const cls = doc.classifiers.get(localEl.id);
        if (cls?.unit) ref.unit = cls.unit;
        const prim = lookupUmlPrimitive(localEl.name);
        if (prim) ref.isPrimitive = true;
        return;
      }
      const prim = lookupUmlPrimitive(ref.rawId);
      if (prim) {
        ref.resolvedName = prim.name;
        ref.isPrimitive = true;
        return;
      }
    }
    if (ref.href) {
      const std = resolveStandardHref(ref.href);
      if (std) {
        ref.resolvedName = std.name;
        ref.isPrimitive = std.isPrimitive;
        ref.unit = std.unit;
        return;
      }
      const ext = options?.externalResolver?.(ref.href);
      if (ext) {
        ref.resolvedName = ext.name;
        ref.resolvedId = ext.id;
        ref.unit = ext.unit;
        ref.isPrimitive = ext.isPrimitive;
        return;
      }
      // If MagicDraw's <referenceExtension referentPath="..."/> already gave us the name, don't flag as unresolved
      if (ref.resolvedName) {
        return;
      }
      ref.isExternalUnresolved = true;
      doc.unresolvedHrefs.push({ href: ref.href, ownerId, span });
    }
  };

  // Collect all xmi:ids present inside model/package/profile trees so stereotypes on
  // auxiliary UML elements (ownedComment, ConnectorEnd, ActivityPartition, nested Diagrams)
  // are not falsely reported as orphan stereotypes.
  const allModelXmiIds = new Set<string>(doc.elementsById.keys());
  const collectXmiIds = (node: XmlElement) => {
    const xid = getXmiId(node);
    if (xid) allModelXmiIds.add(xid);
    for (const ch of node.children) collectXmiIds(ch);
  };
  if (rootTag === "XMI") {
    for (const child of root.children) {
      const cTag = localName(child.name);
      if (cTag === "Model" || cTag === "Package" || cTag === "Profile") {
        collectXmiIds(child);
      }
    }
  } else {
    collectXmiIds(root);
  }

  // Detect orphan stereotypes
  for (const st of doc.stereotypes) {
    if (!allModelXmiIds.has(st.targetId)) {
      doc.orphanStereotypes.push(st);
    }
  }

  const getTagCI = (tags: Record<string, string>, key: string): string | undefined => {
    if (tags[key] !== undefined) return tags[key];
    const lower = key.toLowerCase();
    for (const [k, v] of Object.entries(tags)) {
      if (k.toLowerCase() === lower) return v;
    }
    return undefined;
  };

  // First attach stereotypes to classifiers so `cls.kind` is known before classifying properties
  for (const cls of doc.classifiers.values()) {
    const sts = seenStereotypesByTarget.get(cls.id) ?? [];
    cls.stereotypes = sts;
    cls.kind = classifyClassifierKind(cls.umlType, sts);

    for (const s of sts) {
      if (isStereotypeKindOf(s.name, "Requirement")) {
        const reqId = getTagCI(s.tags, "id");
        const reqText = getTagCI(s.tags, "text");
        if (reqId) cls.requirementId = reqId;
        if (reqText) cls.requirementText = stripHtmlText(reqText);
      }
      if (isStereotypeKindOf(s.name, "Block")) {
        if (getTagCI(s.tags, "isEncapsulated") === "true") cls.isEncapsulated = true;
      }
      if (isStereotypeKindOf(s.name, "ValueType")) {
        const unitVal = getTagCI(s.tags, "unit");
        if (unitVal) {
          const uRef = resolveStandardHref(unitVal);
          const instEl = doc.elementsById.get(unitVal);
          cls.unit = uRef?.unit ?? instEl?.name ?? unitVal;
        }
        const qkVal = getTagCI(s.tags, "quantityKind");
        if (qkVal) {
          const qkEl = doc.elementsById.get(qkVal);
          cls.quantityKind = qkEl?.name ?? qkVal;
        }
      }
    }
  }

  // Now resolve properties, ports, connectors, and emit composition/aggregation relationships
  for (const cls of doc.classifiers.values()) {
    for (const prop of cls.properties) {
      prop.stereotypes = seenStereotypesByTarget.get(prop.id) ?? [];
      resolveTypeRef(prop.typeRef, cls.id, prop.span);
      const targetCls = prop.typeRef?.resolvedId ? doc.classifiers.get(prop.typeRef.resolvedId) : undefined;
      prop.compartment = classifyPropertyCompartment({
        aggregation: prop.aggregation,
        stereotypes: prop.stereotypes,
        targetClassifierKind: targetCls?.kind,
        isPrimitiveType: prop.typeRef?.isPrimitive,
      });

      for (const s of prop.stereotypes) {
        if (s.tags["direction"]) {
          const d = s.tags["direction"].toLowerCase();
          if (d === "in" || d === "out" || d === "inout") prop.direction = d;
        }
      }

      // Emit structural composition/aggregation relationship for BDD edges
      if (targetCls && (prop.compartment === "parts" || prop.compartment === "references")) {
        doc.relationships.push({
          id: `prop_rel_${prop.id}`,
          name: prop.name,
          kind: prop.aggregation === "composite" ? "composition" : "aggregation",
          sourceId: cls.id,
          targetId: targetCls.id,
          span: prop.span,
        });
      }
    }

    for (const port of cls.ports) {
      port.stereotypes = seenStereotypesByTarget.get(port.id) ?? [];
      resolveTypeRef(port.typeRef, cls.id, port.span);
      for (const s of port.stereotypes) {
        const lower = s.name.toLowerCase();
        if (lower === "proxyport") port.portKind = "proxy";
        else if (lower === "fullport") port.portKind = "full";
        else if (lower === "flowport") {
          port.portKind = "flow";
          const d = (s.tags["direction"] ?? "").toLowerCase();
          if (d === "in" || d === "out" || d === "inout") port.direction = d;
        }
      }
    }

    for (const conn of cls.connectors) {
      conn.stereotypes = seenStereotypesByTarget.get(conn.id) ?? [];
      for (const s of conn.stereotypes) {
        if (s.name.toLowerCase() === "bindingconnector") {
          conn.kind = "binding";
        }
      }
      for (const end of conn.ends) {
        const endSts = seenStereotypesByTarget.get(end.id) ?? [];
        for (const es of endSts) {
          if (es.name.toLowerCase() === "nestedconnectorend") {
            const pathRaw = getTagCI(es.tags, "propertyPath");
            if (pathRaw) {
              end.nestedPropertyPath = pathRaw.split(/\s+/).filter(Boolean);
            }
          }
        }
      }
    }
  }

  // Finalize abstractions/dependencies with their stereotype kinds (satisfy, verify, deriveReqt, allocate, refine, trace)
  for (const abs of rawAbstractions.values()) {
    const sts = seenStereotypesByTarget.get(abs.id) ?? [];
    const kind = classifyRelationshipStereotype(sts) ?? "dependency";
    doc.relationships.push({
      id: abs.id,
      name: abs.name,
      kind,
      sourceId: abs.sourceId,
      targetId: abs.targetId,
      sourceHref: abs.sourceHref,
      targetHref: abs.targetHref,
      stereotypeName: sts[0]?.name,
      span: abs.span,
    });
  }

  return doc;
}
