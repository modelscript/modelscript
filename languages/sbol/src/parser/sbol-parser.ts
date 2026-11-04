// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sbol — Zero-Regex SBOL3 RDF/XML & Turtle Parser and Serializer.
 *
 * Implements a pure character-by-character scanner and AST builder for:
 * 1. SBOL3 RDF/XML (.sbol, .rdf, .xml) supporting <sbol:Component>, <sbol:Sequence>,
 *    <sbol:SubComponent>, <sbol:SequenceFeature>, <sbol:Range>, <sbol:Constraint>,
 *    <sbol:Interaction>, and <sbol:Participation>.
 * 2. SBOL3 RDF Turtle (.ttl) supporting @prefix, subject-predicate-object triples,
 *    semicolon predicate lists, comma object lists, and [...] blank nodes.
 */

import {
  SEQUENCE_ONTOLOGY,
  type SbolComponent,
  type SbolConstraint,
  type SbolDocument,
  type SbolFeature,
  type SbolInteraction,
  type SbolInteractionType,
  type SbolParticipation,
  type SbolParticipationRole,
  type SbolRange,
  type SbolRole,
  type SbolSequence,
  type SbolSubComponent,
} from "../types.js";

// ============================================================================
// Character Classification Helpers (Zero-Regex)
// ============================================================================

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isNameChar(ch: string): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    (code >= 48 && code <= 57) || // 0-9
    ch === "_" ||
    ch === "-" ||
    ch === ":" ||
    ch === "."
  );
}

function computeLineColRange(source: string, startOffset: number, endOffset: number): SbolRange {
  let line = 1;
  let col = 1;
  let startLine = 1;
  let startCol = 1;
  let endLine = 1;
  let endCol = 1;

  const clampedStart = Math.max(0, Math.min(startOffset, source.length));
  const clampedEnd = Math.max(clampedStart, Math.min(endOffset, source.length));

  for (let i = 0; i <= clampedEnd && i < source.length; i++) {
    if (i === clampedStart) {
      startLine = line;
      startCol = col;
    }
    if (i === clampedEnd) {
      endLine = line;
      endCol = col;
      break;
    }
    if (source[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  if (clampedEnd === source.length) {
    endLine = line;
    endCol = col;
  }

  return {
    startLine,
    startColumn: startCol,
    endLine: endLine >= startLine ? endLine : startLine,
    endColumn: endCol,
    startOffset: clampedStart,
    endOffset: clampedEnd,
  };
}

// ============================================================================
// Ontology Normalization Helpers (Zero-Regex)
// ============================================================================

function stripLocalName(tagOrUri: string): string {
  const trimmed = tagOrUri.trim();
  const hashIdx = trimmed.lastIndexOf("#");
  const slashIdx = trimmed.lastIndexOf("/");
  const sepIdx = Math.max(hashIdx, slashIdx);
  if (sepIdx >= 0 && sepIdx + 1 < trimmed.length) {
    return trimmed.slice(sepIdx + 1);
  }
  const colonIdx = trimmed.indexOf(":");
  if (
    colonIdx >= 0 &&
    !trimmed.startsWith("SO:") &&
    !trimmed.startsWith("SBO:") &&
    !trimmed.startsWith("http:") &&
    !trimmed.startsWith("https:")
  ) {
    return trimmed.slice(colonIdx + 1);
  }
  return trimmed;
}

export function normalizeSbolRole(raw: string): SbolRole {
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  if (upper.includes("SO:0000167") || upper.includes("SO_0000167") || trimmed.toLowerCase() === "promoter") {
    return SEQUENCE_ONTOLOGY.PROMOTER;
  }
  if (
    upper.includes("SO:0000139") ||
    upper.includes("SO_0000139") ||
    trimmed.toLowerCase() === "rbs" ||
    trimmed.toLowerCase() === "ribosome_entry_site"
  ) {
    return SEQUENCE_ONTOLOGY.RBS;
  }
  if (upper.includes("SO:0000316") || upper.includes("SO_0000316") || trimmed.toLowerCase() === "cds") {
    return SEQUENCE_ONTOLOGY.CDS;
  }
  if (upper.includes("SO:0000141") || upper.includes("SO_0000141") || trimmed.toLowerCase() === "terminator") {
    return SEQUENCE_ONTOLOGY.TERMINATOR;
  }
  if (
    upper.includes("SO:0000804") ||
    upper.includes("SO_0000804") ||
    trimmed.toLowerCase() === "engineered_region" ||
    trimmed.toLowerCase() === "engineeredregion"
  ) {
    return SEQUENCE_ONTOLOGY.ENGINEERED_REGION;
  }
  if (upper.includes("SO:0000057") || upper.includes("SO_0000057") || trimmed.toLowerCase() === "operator") {
    return SEQUENCE_ONTOLOGY.OPERATOR;
  }
  const soIdx = upper.indexOf("SO:");
  if (soIdx >= 0) {
    return upper.slice(soIdx, soIdx + 10);
  }
  return stripLocalName(trimmed);
}

export function normalizeInteractionType(raw: string): SbolInteractionType {
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  const lower = stripLocalName(trimmed).toLowerCase();
  if (
    upper.includes("SBO:0000169") ||
    upper.includes("SBO_0000169") ||
    lower === "inhibition" ||
    lower === "repression"
  ) {
    return "inhibition";
  }
  if (
    upper.includes("SBO:0000170") ||
    upper.includes("SBO_0000170") ||
    lower === "stimulation" ||
    lower === "activation"
  ) {
    return "stimulation";
  }
  if (
    upper.includes("SBO:0000589") ||
    upper.includes("SBO_0000589") ||
    lower === "genetic_production" ||
    lower === "geneticproduction" ||
    lower === "production"
  ) {
    return "genetic_production";
  }
  if (upper.includes("SBO:0000179") || upper.includes("SBO_0000179") || lower === "degradation") {
    return "degradation";
  }
  if (upper.includes("SBO:0000168") || upper.includes("SBO_0000168") || lower === "control") {
    return "control";
  }
  return "biochemical_reaction";
}

export function normalizeParticipationRole(raw: string): SbolParticipationRole {
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  const lower = stripLocalName(trimmed).toLowerCase();
  if (
    upper.includes("SBO:0000020") ||
    upper.includes("SBO_0000020") ||
    lower === "inhibitor" ||
    lower === "repressor"
  ) {
    return "inhibitor";
  }
  if (
    upper.includes("SBO:0000642") ||
    upper.includes("SBO_0000642") ||
    lower === "inhibited" ||
    lower === "repressed"
  ) {
    return "inhibited";
  }
  if (
    upper.includes("SBO:0000459") ||
    upper.includes("SBO_0000459") ||
    lower === "stimulator" ||
    lower === "activator"
  ) {
    return "stimulator";
  }
  if (
    upper.includes("SBO:0000643") ||
    upper.includes("SBO_0000643") ||
    lower === "stimulated" ||
    lower === "activated"
  ) {
    return "stimulated";
  }
  if (upper.includes("SBO:0000598") || upper.includes("SBO_0000598") || lower === "promoter") {
    return "promoter";
  }
  if (upper.includes("SBO:0000645") || upper.includes("SBO_0000645") || lower === "template") {
    return "template";
  }
  if (upper.includes("SBO:0000011") || upper.includes("SBO_0000011") || lower === "product") {
    return "product";
  }
  if (upper.includes("SBO:0000010") || upper.includes("SBO_0000010") || lower === "reactant" || lower === "degraded") {
    return lower === "degraded" ? "degraded" : "reactant";
  }
  if (lower === "modifier") {
    return "modifier";
  }
  return lower;
}

// ============================================================================
// Zero-Regex XML Scanner for SBOL3 RDF/XML
// ============================================================================

interface XmlNode {
  tagName: string;
  localName: string;
  attributes: Map<string, string>;
  children: XmlNode[];
  text: string;
  startOffset: number;
  endOffset: number;
}

function scanXmlNodes(source: string): XmlNode[] {
  const roots: XmlNode[] = [];
  const stack: XmlNode[] = [];
  const n = source.length;
  let i = 0;

  while (i < n) {
    const lt = source.indexOf("<", i);
    if (lt < 0) {
      const top = stack[stack.length - 1];
      if (top) {
        top.text += source.slice(i);
      }
      break;
    }

    if (lt > i) {
      const top = stack[stack.length - 1];
      if (top) {
        top.text += source.slice(i, lt);
      }
    }

    i = lt;
    // Check XML comment <!-- ... -->
    if (source.startsWith("<!--", i)) {
      const endComment = source.indexOf("-->", i + 4);
      i = endComment >= 0 ? endComment + 3 : n;
      continue;
    }

    // Check processing instruction <? ... ?> or <!DOCTYPE ... >
    if (source.startsWith("<?", i)) {
      const endPi = source.indexOf("?>", i + 2);
      i = endPi >= 0 ? endPi + 2 : n;
      continue;
    }
    if (source.startsWith("<!", i)) {
      const endDecl = source.indexOf(">", i + 2);
      i = endDecl >= 0 ? endDecl + 1 : n;
      continue;
    }

    // Check closing tag </tag>
    if (source.startsWith("</", i)) {
      const gt = source.indexOf(">", i + 2);
      const endPos = gt >= 0 ? gt + 1 : n;
      const top = stack.pop();
      if (top) {
        top.endOffset = endPos;
      }
      i = endPos;
      continue;
    }

    // Opening tag <tag attr="val" ...> or <tag ... />
    const tagStart = i;
    i++; // skip '<'
    while (i < n && isWhitespace(source[i] ?? "")) i++;

    let tagName = "";
    while (i < n && isNameChar(source[i] ?? "")) {
      tagName += source[i] ?? "";
      i++;
    }

    const attributes = new Map<string, string>();
    let selfClosing = false;

    while (i < n) {
      while (i < n && isWhitespace(source[i] ?? "")) i++;
      const ch = source[i];
      if (!ch || ch === ">") {
        if (ch === ">") i++;
        break;
      }
      if (ch === "/" && source[i + 1] === ">") {
        selfClosing = true;
        i += 2;
        break;
      }

      let attrName = "";
      while (i < n && isNameChar(source[i] ?? "")) {
        attrName += source[i] ?? "";
        i++;
      }
      while (i < n && isWhitespace(source[i] ?? "")) i++;
      let attrVal = "";
      if (source[i] === "=") {
        i++;
        while (i < n && isWhitespace(source[i] ?? "")) i++;
        const quote = source[i];
        if (quote === '"' || quote === "'") {
          i++;
          const valStart = i;
          while (i < n && source[i] !== quote) i++;
          attrVal = source.slice(valStart, i);
          if (source[i] === quote) i++;
        } else {
          const valStart = i;
          while (i < n && !isWhitespace(source[i] ?? "") && source[i] !== ">" && source[i] !== "/") {
            i++;
          }
          attrVal = source.slice(valStart, i);
        }
      }
      if (attrName) {
        attributes.set(attrName, attrVal);
        const colonIdx = attrName.indexOf(":");
        if (colonIdx >= 0) {
          attributes.set(attrName.slice(colonIdx + 1), attrVal);
        }
      }
    }

    const node: XmlNode = {
      tagName,
      localName: stripLocalName(tagName),
      attributes,
      children: [],
      text: "",
      startOffset: tagStart,
      endOffset: i,
    };

    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }

    if (!selfClosing) {
      stack.push(node);
    }
  }

  return roots;
}

function getXmlField(node: XmlNode, fieldName: string): string | undefined {
  const target = fieldName.toLowerCase();
  for (const [k, v] of node.attributes) {
    if (k.toLowerCase() === target) return v;
  }
  for (const child of node.children) {
    if (child.localName.toLowerCase() === target) {
      const res = child.attributes.get("resource") ?? child.attributes.get("rdf:resource");
      if (res !== undefined) return res;
      return child.text.trim();
    }
  }
  return undefined;
}

function getXmlFields(node: XmlNode, fieldName: string): string[] {
  const target = fieldName.toLowerCase();
  const results: string[] = [];
  for (const [k, v] of node.attributes) {
    if (k.toLowerCase() === target || k.toLowerCase() === `${target}s`) {
      for (const part of v.split(",")) {
        const trimmed = part.trim();
        if (trimmed) results.push(trimmed);
      }
    }
  }
  for (const child of node.children) {
    if (child.localName.toLowerCase() === target) {
      const res = child.attributes.get("resource") ?? child.attributes.get("rdf:resource");
      if (res !== undefined && res.trim()) {
        results.push(res.trim());
      } else if (child.text.trim()) {
        results.push(child.text.trim());
      }
    }
  }
  return results;
}

function extractDisplayIdFromNode(node: XmlNode): string {
  const explicit = getXmlField(node, "displayId") ?? getXmlField(node, "id");
  if (explicit) return stripLocalName(explicit);
  const about = node.attributes.get("about") ?? node.attributes.get("rdf:about");
  if (about) return stripLocalName(about);
  return "";
}

function parseXmlInteraction(node: XmlNode, source: string): SbolInteraction {
  const displayId = extractDisplayIdFromNode(node) || "interaction";
  const name = getXmlField(node, "name");
  const rawType = getXmlField(node, "type") ?? "genetic_production";
  const type = normalizeInteractionType(rawType);
  const parameters: Record<string, number> = {};

  for (const paramKey of ["K", "n", "alpha", "alpha0", "basal", "gamma", "kd"]) {
    const valStr = getXmlField(node, paramKey);
    if (valStr !== undefined) {
      const num = Number(valStr);
      if (!Number.isNaN(num)) {
        parameters[paramKey] = num;
      }
    }
  }

  // Also check <sbol:Parameter> or <Parameter> children
  for (const child of node.children) {
    const ln = child.localName.toLowerCase();
    if (ln === "parameter" || ln === "hasparameter") {
      const pNode = ln === "hasparameter" && child.children[0] ? child.children[0] : child;
      const pName = getXmlField(pNode, "name") ?? getXmlField(pNode, "id") ?? extractDisplayIdFromNode(pNode);
      const pVal = getXmlField(pNode, "value");
      if (pName && pVal !== undefined) {
        const num = Number(pVal);
        if (!Number.isNaN(num)) {
          parameters[pName] = num;
        }
      }
    }
  }

  const participants: SbolParticipation[] = [];
  const collectParticipation = (pNode: XmlNode): void => {
    const partIdRaw = getXmlField(pNode, "participant") ?? getXmlField(pNode, "species") ?? "";
    const participant = stripLocalName(partIdRaw);
    const rawRoles = getXmlFields(pNode, "role");
    const roles = rawRoles.map(normalizeParticipationRole);
    participants.push({
      displayId: extractDisplayIdFromNode(pNode) || undefined,
      participant,
      roles,
      range: computeLineColRange(source, pNode.startOffset, pNode.endOffset),
    });
  };

  for (const child of node.children) {
    const ln = child.localName.toLowerCase();
    if (ln === "participation") {
      collectParticipation(child);
    } else if (ln === "hasparticipation" || ln === "participations") {
      for (const grand of child.children) {
        if (grand.localName.toLowerCase() === "participation") {
          collectParticipation(grand);
        }
      }
    }
  }

  return {
    displayId,
    name,
    type,
    participants,
    parameters,
    range: computeLineColRange(source, node.startOffset, node.endOffset),
  };
}

function parseXmlSbol(source: string, sourceFile?: string): SbolDocument {
  const roots = scanXmlNodes(source);
  const root = roots[0];
  if (!root) {
    return {
      namespace: "http://sbols.org/v3#",
      components: [],
      sequences: [],
      interactions: [],
      sourceFile,
    };
  }

  const namespace =
    root.attributes.get("namespace") ??
    root.attributes.get("xml:base") ??
    root.attributes.get("base") ??
    "http://sbols.org/v3#";

  const components: SbolComponent[] = [];
  const sequences: SbolSequence[] = [];
  const interactions: SbolInteraction[] = [];

  const parseRangeChild = (
    parent: XmlNode,
  ): {
    start?: number | undefined;
    end?: number | undefined;
    sequenceId?: string | undefined;
    orientation?: "inline" | "reverseComplement" | undefined;
  } => {
    const directStart = getXmlField(parent, "start");
    const directEnd = getXmlField(parent, "end");
    const directSeq = getXmlField(parent, "sequence") ?? getXmlField(parent, "hasSequence");
    const directOrient = getXmlField(parent, "orientation");

    if (directStart !== undefined || directEnd !== undefined) {
      return {
        start: directStart !== undefined ? Number(directStart) : undefined,
        end: directEnd !== undefined ? Number(directEnd) : undefined,
        sequenceId: directSeq ? stripLocalName(directSeq) : undefined,
        orientation: directOrient === "reverseComplement" ? "reverseComplement" : directOrient ? "inline" : undefined,
      };
    }

    for (const child of parent.children) {
      const ln = child.localName.toLowerCase();
      if (ln === "range" || ln === "location") {
        const s = getXmlField(child, "start");
        const e = getXmlField(child, "end");
        const seq = getXmlField(child, "sequence") ?? getXmlField(child, "hasSequence");
        const orient = getXmlField(child, "orientation");
        return {
          start: s !== undefined ? Number(s) : undefined,
          end: e !== undefined ? Number(e) : undefined,
          sequenceId: seq ? stripLocalName(seq) : undefined,
          orientation: orient === "reverseComplement" ? "reverseComplement" : orient ? "inline" : undefined,
        };
      }
      if (ln === "haslocation") {
        for (const grand of child.children) {
          if (grand.localName.toLowerCase() === "range") {
            const s = getXmlField(grand, "start");
            const e = getXmlField(grand, "end");
            const seq = getXmlField(grand, "sequence") ?? getXmlField(grand, "hasSequence");
            const orient = getXmlField(grand, "orientation");
            return {
              start: s !== undefined ? Number(s) : undefined,
              end: e !== undefined ? Number(e) : undefined,
              sequenceId: seq ? stripLocalName(seq) : undefined,
              orientation: orient === "reverseComplement" ? "reverseComplement" : orient ? "inline" : undefined,
            };
          }
        }
      }
    }
    return {};
  };

  const visitTopNode = (node: XmlNode): void => {
    const ln = node.localName.toLowerCase();

    if (ln === "sequence") {
      const displayId = extractDisplayIdFromNode(node);
      const elements = (getXmlField(node, "elements") ?? node.text ?? "").trim();
      const encoding = getXmlField(node, "encoding") ?? "IUPAC_DNA";
      sequences.push({
        displayId,
        name: getXmlField(node, "name"),
        namespace: getXmlField(node, "namespace") ?? namespace,
        elements,
        encoding: stripLocalName(encoding),
        range: computeLineColRange(source, node.startOffset, node.endOffset),
      });
      return;
    }

    if (ln === "interaction") {
      interactions.push(parseXmlInteraction(node, source));
      return;
    }

    if (ln === "component") {
      const displayId = extractDisplayIdFromNode(node);
      const name = getXmlField(node, "name");
      const description = getXmlField(node, "description");
      const compNamespace = getXmlField(node, "namespace") ?? namespace;
      const types = getXmlFields(node, "type").map(stripLocalName);
      const roles = getXmlFields(node, "role").map(normalizeSbolRole);
      const seqRefs = [...getXmlFields(node, "hasSequence"), ...getXmlFields(node, "sequence")].map(stripLocalName);

      const features: SbolFeature[] = [];
      const subComponents: SbolSubComponent[] = [];
      const constraints: SbolConstraint[] = [];
      const compInteractions: SbolInteraction[] = [];

      const handleFeatureOrSub = (fNode: XmlNode): void => {
        const fln = fNode.localName.toLowerCase();
        if (fln === "sequencefeature" || fln === "feature") {
          const fId = extractDisplayIdFromNode(fNode);
          const fRoles = getXmlFields(fNode, "role").map(normalizeSbolRole);
          const loc = parseRangeChild(fNode);
          features.push({
            displayId: fId,
            name: getXmlField(fNode, "name"),
            roles: fRoles,
            start: loc.start,
            end: loc.end,
            orientation: loc.orientation,
            sequenceId: loc.sequenceId,
            range: computeLineColRange(source, fNode.startOffset, fNode.endOffset),
          });
        } else if (fln === "subcomponent") {
          const subId = extractDisplayIdFromNode(fNode);
          const instRaw = getXmlField(fNode, "instanceOf") ?? "";
          const fRoles = getXmlFields(fNode, "role").map(normalizeSbolRole);
          const loc = parseRangeChild(fNode);
          subComponents.push({
            displayId: subId,
            name: getXmlField(fNode, "name"),
            instanceOf: stripLocalName(instRaw),
            roles: fRoles.length > 0 ? fRoles : undefined,
            start: loc.start,
            end: loc.end,
            orientation: loc.orientation,
            sequenceId: loc.sequenceId,
            range: computeLineColRange(source, fNode.startOffset, fNode.endOffset),
          });
        } else if (fln === "constraint") {
          const subject = stripLocalName(getXmlField(fNode, "subject") ?? "");
          const object = stripLocalName(getXmlField(fNode, "object") ?? "");
          const restriction = stripLocalName(getXmlField(fNode, "restriction") ?? "precedes");
          constraints.push({
            displayId: extractDisplayIdFromNode(fNode) || undefined,
            subject,
            object,
            restriction,
            range: computeLineColRange(source, fNode.startOffset, fNode.endOffset),
          });
        } else if (fln === "interaction") {
          const parsedInt = parseXmlInteraction(fNode, source);
          compInteractions.push(parsedInt);
          interactions.push(parsedInt);
        }
      };

      for (const child of node.children) {
        const cln = child.localName.toLowerCase();
        if (
          cln === "hasfeature" ||
          cln === "features" ||
          cln === "subcomponents" ||
          cln === "hasconstraint" ||
          cln === "constraints" ||
          cln === "hasinteraction" ||
          cln === "interactions"
        ) {
          for (const grand of child.children) {
            handleFeatureOrSub(grand);
          }
        } else {
          handleFeatureOrSub(child);
        }
      }

      const initConcStr = getXmlField(node, "initialConcentration") ?? getXmlField(node, "initialAmount");
      const basalStr = getXmlField(node, "basalRate") ?? getXmlField(node, "alpha0");
      const maxRateStr = getXmlField(node, "maxExpressionRate") ?? getXmlField(node, "alpha");
      const degRateStr = getXmlField(node, "degradationRate") ?? getXmlField(node, "gamma");

      components.push({
        displayId,
        name,
        description,
        namespace: compNamespace,
        types,
        roles,
        sequences: seqRefs,
        features,
        subComponents,
        constraints,
        interactions: compInteractions,
        initialConcentration: initConcStr !== undefined ? Number(initConcStr) : undefined,
        basalRate: basalStr !== undefined ? Number(basalStr) : undefined,
        maxExpressionRate: maxRateStr !== undefined ? Number(maxRateStr) : undefined,
        degradationRate: degRateStr !== undefined ? Number(degRateStr) : undefined,
        range: computeLineColRange(source, node.startOffset, node.endOffset),
      });
      return;
    }

    for (const child of node.children) {
      visitTopNode(child);
    }
  };

  for (const r of roots) {
    visitTopNode(r);
  }

  return {
    namespace,
    components,
    sequences,
    interactions,
    sourceFile,
  };
}

// ============================================================================
// Zero-Regex Turtle (.ttl) Scanner for SBOL3
// ============================================================================

interface TurtleToken {
  kind: "word" | "string" | "symbol";
  value: string;
  offset: number;
}

function tokenizeTurtle(source: string): TurtleToken[] {
  const tokens: TurtleToken[] = [];
  const n = source.length;
  let i = 0;

  while (i < n) {
    const ch = source[i] ?? "";
    if (isWhitespace(ch)) {
      i++;
      continue;
    }
    // Comment '#' outside <...> or "..."
    if (ch === "#") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (ch === ";" || ch === "," || ch === "[" || ch === "]") {
      tokens.push({ kind: "symbol", value: ch, offset: i });
      i++;
      continue;
    }
    if (ch === ".") {
      const next = source[i + 1] ?? "";
      // Distinguish statement terminator '.' from decimal point inside number
      if (!next || isWhitespace(next) || next === "#" || next === ";" || next === "]") {
        tokens.push({ kind: "symbol", value: ".", offset: i });
        i++;
        continue;
      }
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i++;
      let strVal = "";
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < n) {
          i++;
        }
        strVal += source[i] ?? "";
        i++;
      }
      if (source[i] === quote) i++;
      tokens.push({ kind: "string", value: strVal, offset: start });
      continue;
    }
    if (ch === "<") {
      const start = i;
      i++;
      let uriVal = "";
      while (i < n && source[i] !== ">") {
        uriVal += source[i] ?? "";
        i++;
      }
      if (source[i] === ">") i++;
      tokens.push({ kind: "word", value: uriVal, offset: start });
      continue;
    }

    // Word / QName / number
    const start = i;
    let word = "";
    while (i < n) {
      const c = source[i] ?? "";
      if (isWhitespace(c) || c === ";" || c === "," || c === "[" || c === "]" || c === '"' || c === "#") {
        break;
      }
      if (c === ".") {
        const after = source[i + 1] ?? "";
        if (!after || isWhitespace(after) || after === ";" || after === "]") {
          break;
        }
      }
      word += c;
      i++;
    }
    if (word) {
      tokens.push({ kind: "word", value: word, offset: start });
    } else {
      i++;
    }
  }

  return tokens;
}

interface TurtleBlankOrResource {
  id: string;
  predicates: Map<string, Array<string | TurtleBlankOrResource>>;
  startOffset: number;
  endOffset: number;
}

function parseTurtleSbol(source: string, sourceFile?: string): SbolDocument {
  const tokens = tokenizeTurtle(source);
  let pos = 0;
  let namespace = "http://sbols.org/v3#";
  const subjects: TurtleBlankOrResource[] = [];

  const peek = (): TurtleToken | undefined => tokens[pos];
  const consume = (): TurtleToken | undefined => tokens[pos++];

  const parsePredicateObjectList = (target: TurtleBlankOrResource, stopSymbol: string): void => {
    while (pos < tokens.length) {
      const tok = peek();
      if (!tok) break;
      if (tok.kind === "symbol" && tok.value === stopSymbol) {
        target.endOffset = tok.offset + 1;
        consume();
        break;
      }
      if (tok.kind === "symbol" && tok.value === ";") {
        consume();
        continue;
      }

      const predTok = consume();
      if (!predTok) break;
      const predName = predTok.value === "a" ? "rdf:type" : stripLocalName(predTok.value);

      const objList = target.predicates.get(predName) ?? [];
      target.predicates.set(predName, objList);

      // Parse comma-separated object list
      while (pos < tokens.length) {
        const objTok = peek();
        if (!objTok) break;
        if (objTok.kind === "symbol" && objTok.value === "[") {
          const bStart = objTok.offset;
          consume(); // '['
          const blank: TurtleBlankOrResource = {
            id: `blank_${bStart}`,
            predicates: new Map(),
            startOffset: bStart,
            endOffset: bStart + 1,
          };
          parsePredicateObjectList(blank, "]");
          objList.push(blank);
        } else if (objTok.kind === "symbol" && (objTok.value === ";" || objTok.value === stopSymbol)) {
          break;
        } else {
          consume();
          objList.push(objTok.value);
        }

        const commaCheck = peek();
        if (commaCheck && commaCheck.kind === "symbol" && commaCheck.value === ",") {
          consume();
        } else {
          break;
        }
      }
    }
  };

  while (pos < tokens.length) {
    const tok = peek();
    if (!tok) break;

    if (tok.kind === "word" && (tok.value === "@prefix" || tok.value.toLowerCase() === "prefix")) {
      consume();
      const prefixLabel = consume();
      const uriTok = consume();
      if (prefixLabel && uriTok && (prefixLabel.value === ":" || prefixLabel.value === "ex:")) {
        namespace = uriTok.value;
      }
      const dotCheck = peek();
      if (dotCheck && dotCheck.kind === "symbol" && dotCheck.value === ".") {
        consume();
      }
      continue;
    }

    if (tok.kind === "word" && (tok.value === "@base" || tok.value.toLowerCase() === "base")) {
      consume();
      const uriTok = consume();
      if (uriTok) namespace = uriTok.value;
      const dotCheck = peek();
      if (dotCheck && dotCheck.kind === "symbol" && dotCheck.value === ".") {
        consume();
      }
      continue;
    }

    const subjTok = consume();
    if (!subjTok) break;
    const subj: TurtleBlankOrResource = {
      id: stripLocalName(subjTok.value),
      predicates: new Map(),
      startOffset: subjTok.offset,
      endOffset: subjTok.offset + subjTok.value.length,
    };
    parsePredicateObjectList(subj, ".");
    subjects.push(subj);
  }

  const subjectById = new Map<string, TurtleBlankOrResource>();
  for (const s of subjects) {
    subjectById.set(s.id, s);
  }

  const getFirstString = (res: TurtleBlankOrResource, key: string): string | undefined => {
    for (const [k, vals] of res.predicates) {
      if (k.toLowerCase() === key.toLowerCase()) {
        const first = vals[0];
        if (typeof first === "string") return first;
      }
    }
    return undefined;
  };

  const getAllStrings = (res: TurtleBlankOrResource, key: string): string[] => {
    const out: string[] = [];
    for (const [k, vals] of res.predicates) {
      if (k.toLowerCase() === key.toLowerCase()) {
        for (const v of vals) {
          if (typeof v === "string") out.push(v);
        }
      }
    }
    return out;
  };

  const getAllResources = (res: TurtleBlankOrResource, key: string): TurtleBlankOrResource[] => {
    const out: TurtleBlankOrResource[] = [];
    for (const [k, vals] of res.predicates) {
      if (k.toLowerCase() === key.toLowerCase()) {
        for (const v of vals) {
          if (typeof v === "object") {
            out.push(v);
          } else {
            const ref = subjectById.get(stripLocalName(v));
            if (ref) out.push(ref);
          }
        }
      }
    }
    return out;
  };

  const components: SbolComponent[] = [];
  const sequences: SbolSequence[] = [];
  const interactions: SbolInteraction[] = [];
  const handledInteractions = new Set<string>();

  const buildTurtleInteraction = (res: TurtleBlankOrResource): SbolInteraction => {
    const displayId = getFirstString(res, "displayId") ?? res.id;
    const name = getFirstString(res, "name");
    const types = getAllStrings(res, "type").filter((t) => stripLocalName(t).toLowerCase() !== "interaction");
    const type = normalizeInteractionType(types[0] ?? "genetic_production");
    const parameters: Record<string, number> = {};

    for (const paramKey of ["K", "n", "alpha", "alpha0", "basal", "gamma", "kd"]) {
      const valStr = getFirstString(res, paramKey);
      if (valStr !== undefined) {
        const num = Number(valStr);
        if (!Number.isNaN(num)) parameters[paramKey] = num;
      }
    }

    const partResources = [...getAllResources(res, "hasParticipation"), ...getAllResources(res, "participation")];
    const participants: SbolParticipation[] = partResources.map((pRes) => {
      const participantRaw = getFirstString(pRes, "participant") ?? "";
      const roles = getAllStrings(pRes, "role").map(normalizeParticipationRole);
      return {
        displayId: getFirstString(pRes, "displayId") ?? undefined,
        participant: stripLocalName(participantRaw),
        roles,
        range: computeLineColRange(source, pRes.startOffset, pRes.endOffset),
      };
    });

    return {
      displayId: stripLocalName(displayId),
      name,
      type,
      participants,
      parameters,
      range: computeLineColRange(source, res.startOffset, res.endOffset),
    };
  };

  for (const subj of subjects) {
    const rdfTypes = [...getAllStrings(subj, "rdf:type"), ...getAllStrings(subj, "type")].map((t) =>
      stripLocalName(t).toLowerCase(),
    );

    if (rdfTypes.includes("sequence")) {
      const displayId = stripLocalName(getFirstString(subj, "displayId") ?? subj.id);
      const elements = getFirstString(subj, "elements") ?? "";
      const encoding = getFirstString(subj, "encoding") ?? "IUPAC_DNA";
      sequences.push({
        displayId,
        name: getFirstString(subj, "name"),
        namespace,
        elements,
        encoding: stripLocalName(encoding),
        range: computeLineColRange(source, subj.startOffset, subj.endOffset),
      });
    } else if (rdfTypes.includes("interaction")) {
      const built = buildTurtleInteraction(subj);
      handledInteractions.add(subj.id);
      interactions.push(built);
    } else if (rdfTypes.includes("component")) {
      const displayId = stripLocalName(getFirstString(subj, "displayId") ?? subj.id);
      const name = getFirstString(subj, "name");
      const description = getFirstString(subj, "description");
      const types = getAllStrings(subj, "type")
        .map(stripLocalName)
        .filter((t) => t.toLowerCase() !== "component");
      const roles = getAllStrings(subj, "role").map(normalizeSbolRole);
      const seqRefs = getAllStrings(subj, "hasSequence").map(stripLocalName);

      const features: SbolFeature[] = [];
      const subComponents: SbolSubComponent[] = [];
      const constraints: SbolConstraint[] = [];
      const compInteractions: SbolInteraction[] = [];

      for (const fRes of getAllResources(subj, "hasFeature")) {
        const fTypes = [...getAllStrings(fRes, "rdf:type"), ...getAllStrings(fRes, "type")].map((t) =>
          stripLocalName(t).toLowerCase(),
        );
        const fDisplayId = stripLocalName(getFirstString(fRes, "displayId") ?? fRes.id);
        const startStr = getFirstString(fRes, "start");
        const endStr = getFirstString(fRes, "end");
        const seqIdRaw = getFirstString(fRes, "hasSequence") ?? getFirstString(fRes, "sequence");
        const fRoles = getAllStrings(fRes, "role").map(normalizeSbolRole);

        if (fTypes.includes("subcomponent") || getFirstString(fRes, "instanceOf") !== undefined) {
          subComponents.push({
            displayId: fDisplayId,
            name: getFirstString(fRes, "name"),
            instanceOf: stripLocalName(getFirstString(fRes, "instanceOf") ?? ""),
            roles: fRoles.length > 0 ? fRoles : undefined,
            start: startStr !== undefined ? Number(startStr) : undefined,
            end: endStr !== undefined ? Number(endStr) : undefined,
            sequenceId: seqIdRaw ? stripLocalName(seqIdRaw) : undefined,
            range: computeLineColRange(source, fRes.startOffset, fRes.endOffset),
          });
        } else {
          features.push({
            displayId: fDisplayId,
            name: getFirstString(fRes, "name"),
            roles: fRoles,
            start: startStr !== undefined ? Number(startStr) : undefined,
            end: endStr !== undefined ? Number(endStr) : undefined,
            sequenceId: seqIdRaw ? stripLocalName(seqIdRaw) : undefined,
            range: computeLineColRange(source, fRes.startOffset, fRes.endOffset),
          });
        }
      }

      for (const cRes of getAllResources(subj, "hasConstraint")) {
        constraints.push({
          displayId: getFirstString(cRes, "displayId") ?? undefined,
          subject: stripLocalName(getFirstString(cRes, "subject") ?? ""),
          object: stripLocalName(getFirstString(cRes, "object") ?? ""),
          restriction: stripLocalName(getFirstString(cRes, "restriction") ?? "precedes"),
          range: computeLineColRange(source, cRes.startOffset, cRes.endOffset),
        });
      }

      for (const iRes of getAllResources(subj, "hasInteraction")) {
        const built = buildTurtleInteraction(iRes);
        compInteractions.push(built);
        if (!handledInteractions.has(iRes.id)) {
          handledInteractions.add(iRes.id);
          interactions.push(built);
        }
      }

      const initConcStr = getFirstString(subj, "initialConcentration");
      const basalStr = getFirstString(subj, "basalRate") ?? getFirstString(subj, "alpha0");
      const maxRateStr = getFirstString(subj, "maxExpressionRate") ?? getFirstString(subj, "alpha");
      const degRateStr = getFirstString(subj, "degradationRate") ?? getFirstString(subj, "gamma");

      components.push({
        displayId,
        name,
        description,
        namespace,
        types,
        roles,
        sequences: seqRefs,
        features,
        subComponents,
        constraints,
        interactions: compInteractions,
        initialConcentration: initConcStr !== undefined ? Number(initConcStr) : undefined,
        basalRate: basalStr !== undefined ? Number(basalStr) : undefined,
        maxExpressionRate: maxRateStr !== undefined ? Number(maxRateStr) : undefined,
        degradationRate: degRateStr !== undefined ? Number(degRateStr) : undefined,
        range: computeLineColRange(source, subj.startOffset, subj.endOffset),
      });
    }
  }

  return {
    namespace,
    components,
    sequences,
    interactions,
    sourceFile,
  };
}

// ============================================================================
// Public Entry Points: parseSbol & serializeSbol
// ============================================================================

/**
 * Parses an SBOL3 document in either RDF/XML (`.sbol`, `.rdf`, `.xml`) or Turtle (`.ttl`) format.
 */
export function parseSbol(text: string, sourceFile?: string): SbolDocument {
  let firstNonSpace = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (!isWhitespace(ch)) {
      firstNonSpace = ch;
      break;
    }
  }

  if (firstNonSpace === "<") {
    return parseXmlSbol(text, sourceFile);
  }
  return parseTurtleSbol(text, sourceFile);
}

/**
 * Serializes an `SbolDocument` back to SBOL3 RDF/XML or Turtle format.
 */
export function serializeSbol(doc: SbolDocument, format: "xml" | "turtle" = "xml"): string {
  if (format === "turtle") {
    const lines: string[] = [
      `@prefix sbol: <http://sbols.org/v3#> .`,
      `@prefix SO: <https://identifiers.org/SO:> .`,
      `@prefix SBO: <https://identifiers.org/SBO:> .`,
      `@prefix : <${doc.namespace}> .`,
      ``,
    ];

    for (const seq of doc.sequences) {
      lines.push(`:${seq.displayId} a sbol:Sequence ;`);
      lines.push(`  sbol:displayId "${seq.displayId}" ;`);
      if (seq.encoding) lines.push(`  sbol:encoding "${seq.encoding}" ;`);
      lines.push(`  sbol:elements "${seq.elements}" .`);
      lines.push(``);
    }

    for (const comp of doc.components) {
      lines.push(`:${comp.displayId} a sbol:Component ;`);
      lines.push(`  sbol:displayId "${comp.displayId}" ;`);
      if (comp.name) lines.push(`  sbol:name "${comp.name}" ;`);
      for (const role of comp.roles) {
        lines.push(`  sbol:role "${role}" ;`);
      }
      for (const seqId of comp.sequences) {
        lines.push(`  sbol:hasSequence :${seqId} ;`);
      }
      for (const sub of comp.subComponents) {
        lines.push(
          `  sbol:hasFeature [ a sbol:SubComponent ; sbol:displayId "${sub.displayId}" ; sbol:instanceOf :${sub.instanceOf} ] ;`,
        );
      }
      for (const feat of comp.features) {
        const startPart = feat.start !== undefined ? ` ; sbol:start ${feat.start}` : "";
        const endPart = feat.end !== undefined ? ` ; sbol:end ${feat.end}` : "";
        const rolePart = feat.roles[0] ? ` ; sbol:role "${feat.roles[0]}"` : "";
        lines.push(
          `  sbol:hasFeature [ a sbol:SequenceFeature ; sbol:displayId "${feat.displayId}"${rolePart}${startPart}${endPart} ] ;`,
        );
      }
      // Replace trailing semicolon on last line of component block with '.'
      const lastIdx = lines.length - 1;
      const lastLine = lines[lastIdx] ?? "";
      if (lastLine.endsWith(";")) {
        lines[lastIdx] = `${lastLine.slice(0, -1)}.`;
      }
      lines.push(``);
    }

    for (const inter of doc.interactions) {
      lines.push(`:${inter.displayId} a sbol:Interaction ;`);
      lines.push(`  sbol:displayId "${inter.displayId}" ;`);
      lines.push(`  sbol:type "${inter.type}" ;`);
      for (const [k, v] of Object.entries(inter.parameters)) {
        lines.push(`  sbol:${k} ${v} ;`);
      }
      for (const part of inter.participants) {
        const roleStr = part.roles[0] ? ` ; sbol:role "${part.roles[0]}"` : "";
        lines.push(`  sbol:hasParticipation [ sbol:participant :${part.participant}${roleStr} ] ;`);
      }
      const lastIdx = lines.length - 1;
      const lastLine = lines[lastIdx] ?? "";
      if (lastLine.endsWith(";")) {
        lines[lastIdx] = `${lastLine.slice(0, -1)}.`;
      }
      lines.push(``);
    }

    return lines.join("\n");
  }

  // Default: SBOL3 RDF/XML
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:sbol="http://sbols.org/v3#" xml:base="${doc.namespace}">`,
  ];

  for (const seq of doc.sequences) {
    lines.push(`  <sbol:Sequence displayId="${seq.displayId}" encoding="${seq.encoding ?? "IUPAC_DNA"}">`);
    lines.push(`    <sbol:elements>${seq.elements}</sbol:elements>`);
    lines.push(`  </sbol:Sequence>`);
  }

  for (const comp of doc.components) {
    const roleAttr = comp.roles.length > 0 ? ` role="${comp.roles.join(",")}"` : "";
    const nameAttr = comp.name ? ` name="${comp.name}"` : "";
    const seqAttr = comp.sequences.length > 0 ? ` hasSequence="${comp.sequences.join(",")}"` : "";
    lines.push(`  <sbol:Component displayId="${comp.displayId}"${nameAttr}${roleAttr}${seqAttr}>`);

    for (const sub of comp.subComponents) {
      const subRole = sub.roles && sub.roles.length > 0 ? ` role="${sub.roles.join(",")}"` : "";
      const startAttr = sub.start !== undefined ? ` start="${sub.start}"` : "";
      const endAttr = sub.end !== undefined ? ` end="${sub.end}"` : "";
      lines.push(
        `    <sbol:SubComponent displayId="${sub.displayId}" instanceOf="${sub.instanceOf}"${subRole}${startAttr}${endAttr}/>`,
      );
    }

    for (const feat of comp.features) {
      const fRole = feat.roles.length > 0 ? ` role="${feat.roles.join(",")}"` : "";
      const startAttr = feat.start !== undefined ? ` start="${feat.start}"` : "";
      const endAttr = feat.end !== undefined ? ` end="${feat.end}"` : "";
      const seqIdAttr = feat.sequenceId ? ` sequence="${feat.sequenceId}"` : "";
      lines.push(`    <sbol:SequenceFeature displayId="${feat.displayId}"${fRole}${startAttr}${endAttr}${seqIdAttr}/>`);
    }

    for (const c of comp.constraints) {
      lines.push(`    <sbol:Constraint subject="${c.subject}" object="${c.object}" restriction="${c.restriction}"/>`);
    }

    lines.push(`  </sbol:Component>`);
  }

  for (const inter of doc.interactions) {
    const paramAttrs = Object.entries(inter.parameters)
      .map(([k, v]) => ` ${k}="${v}"`)
      .join("");
    lines.push(`  <sbol:Interaction displayId="${inter.displayId}" type="${inter.type}"${paramAttrs}>`);
    for (const part of inter.participants) {
      const roleAttr = part.roles.length > 0 ? ` role="${part.roles.join(",")}"` : "";
      lines.push(`    <sbol:Participation participant="${part.participant}"${roleAttr}/>`);
    }
    lines.push(`  </sbol:Interaction>`);
  }

  lines.push(`</rdf:RDF>`);
  return lines.join("\n");
}
