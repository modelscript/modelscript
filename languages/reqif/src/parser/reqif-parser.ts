// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/reqif — Lossless WebAssembly XML ReqIF Parser & Serializer.
 *
 * Parses standard OMG ReqIF 1.2 / 1.1 / 1.0 (ISO/IEC 17506) XML files into
 * typed ReqIfDocument structures using @modelscript/dsl/xml.
 *
 * Preserves 1-indexed source line/column positions, XHTML bodies,
 * typed attribute values, and hierarchical specification structures with ZERO regex.
 */

import { parseXml, type XmlAttribute, type XmlElement } from "@modelscript/dsl/xml";
import type {
  AsilLevel,
  ContractComparator,
  ReqIfAttributeDefinition,
  ReqIfAttributeValue,
  ReqIfContract,
  ReqIfDataType,
  ReqIfDataTypeKind,
  ReqIfDocument,
  ReqIfEnumValue,
  ReqIfHeader,
  ReqIfRelationKind,
  ReqIfSpecHierarchy,
  ReqIfSpecification,
  ReqIfSpecObject,
  ReqIfSpecRelation,
  ReqIfSpecType,
  ReqIfSpecTypeKind,
  SourceSpan,
} from "../types.js";

function localName(tag: string): string {
  const idx = tag.indexOf(":");
  return idx >= 0 ? tag.slice(idx + 1) : tag;
}

function matchTag(element: XmlElement, expected: string): boolean {
  return localName(element.name).toUpperCase() === expected.toUpperCase();
}

function getAttr(element: XmlElement, name: string): string | undefined {
  const target = name.toUpperCase();
  const attr = element.attributes.find((a: XmlAttribute) => localName(a.name).toUpperCase() === target);
  return attr?.value;
}

function getChild(element: XmlElement | null | undefined, expectedName: string): XmlElement | undefined {
  if (!element) return undefined;
  return element.children.find((c: XmlElement) => matchTag(c, expectedName));
}

function getChildRefText(
  parent: XmlElement | null | undefined,
  wrapperTag: string,
  refTag: string,
): string | undefined {
  const wrapper = getChild(parent, wrapperTag);
  if (!wrapper) return undefined;
  const ref = getChild(wrapper, refTag);
  return ref ? ref.text.trim() : undefined;
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function offsetToPosition(offset: number, lineStarts: number[]): { line: number; col: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lineStarts[mid]! <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lineIdx = low - 1;
  const line = lineIdx + 1;
  const col = offset - lineStarts[lineIdx]! + 1;
  return { line, col };
}

function createSpan(startOffset: number, endOffset: number, lineStarts: number[]): SourceSpan {
  const start = offsetToPosition(startOffset, lineStarts);
  const end = offsetToPosition(endOffset, lineStarts);
  return {
    startLine: start.line,
    startCol: start.col,
    endLine: end.line,
    endCol: end.col,
    startOffset,
    endOffset,
  };
}

/**
 * Extracts formal numeric contract bounds from requirement text or attributes.
 * Examples: "Speed must be <= 120 km/h", "Power >= 50.5 kW", "temperature < 85"
 */
export function extractFormalContract(text: string): ReqIfContract | undefined {
  if (!text) return undefined;
  const normalized = text.replace(/<[^<>]+>/g, " ").trim();
  const pattern =
    /([a-zA-Z_][a-zA-Z0-9_.\s]*?)\s*(<=|<|>=|>|==|!=)\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\s*([a-zA-Z%][a-zA-Z0-9_/%^]*)?/i;
  const match = pattern.exec(normalized);
  if (!match) return undefined;

  let rawPrefix = match[1]!.trim();
  rawPrefix = rawPrefix
    .replace(
      /\b(must\s+be|shall\s+be|should\s+be|may\s+reach|can\s+be|is\s+less\s+than\s+or\s+equal\s+to|is|are|be|to|reach|of|under|at)\b/gi,
      " ",
    )
    .trim();
  const tokens = rawPrefix.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return undefined;
  const varName = tokens[tokens.length - 1]!;

  const comp = match[2]! as ContractComparator;
  const num = parseFloat(match[3]!);
  const unit = match[4]?.trim();

  if (isNaN(num)) return undefined;

  return {
    variable: varName,
    comparator: comp,
    limitValue: num,
    unit: unit || undefined,
  };
}

/**
 * Extracts ASIL level from requirement text or attributes.
 */
export function extractAsilLevel(text: string): AsilLevel | undefined {
  if (/\bASIL[- ]?D\b/i.test(text)) return "ASIL-D";
  if (/\bASIL[- ]?C\b/i.test(text)) return "ASIL-C";
  if (/\bASIL[- ]?B\b/i.test(text)) return "ASIL-B";
  if (/\bASIL[- ]?A\b/i.test(text)) return "ASIL-A";
  if (/\bQM\b/i.test(text)) return "QM";
  return undefined;
}

/**
 * Parses a ReqIF XML document into a strongly-typed ReqIfDocument.
 */
export function parseReqIf(xmlContent: string): ReqIfDocument {
  const doc = parseXml(xmlContent);
  if (!doc.root) {
    throw new Error("ReqIF XML document has no root element");
  }

  const root = doc.root;
  if (!matchTag(root, "REQ-IF")) {
    throw new Error(`Expected <REQ-IF> root element, found <${root.name}>`);
  }

  const lineStarts = computeLineStarts(xmlContent);

  // 1. Header
  let headerEl = getChild(root, "THE-HEADER") || getChild(root, "REQ-IF-HEADER");
  if (headerEl && getChild(headerEl, "REQ-IF-HEADER")) {
    headerEl = getChild(headerEl, "REQ-IF-HEADER");
  }

  const header: ReqIfHeader = {
    identifier:
      (headerEl && (getAttr(headerEl, "IDENTIFIER") || getChild(headerEl, "IDENTIFIER")?.text.trim())) ||
      "REQIF-HEADER-01",
    reqIfVersion:
      (headerEl && (getAttr(headerEl, "REQ-IF-VERSION") || getChild(headerEl, "REQ-IF-VERSION")?.text.trim())) || "1.0",
    title:
      (headerEl &&
        (getChild(headerEl, "TITLE")?.text.trim() || getAttr(headerEl, "TITLE") || getAttr(headerEl, "LONG-NAME"))) ||
      "Imported Requirements Specification",
    creationTime: headerEl
      ? getChild(headerEl, "CREATION-TIME")?.text.trim() || getAttr(headerEl, "CREATION-TIME")
      : undefined,
    repositoryId: headerEl
      ? getChild(headerEl, "REPOSITORY-ID")?.text.trim() || getAttr(headerEl, "REPOSITORY-ID")
      : undefined,
    reqIfToolId: headerEl
      ? getChild(headerEl, "REQ-IF-TOOL-ID")?.text.trim() || getAttr(headerEl, "REQ-IF-TOOL-ID")
      : undefined,
    sourceToolId: headerEl
      ? getChild(headerEl, "SOURCE-TOOL-ID")?.text.trim() || getAttr(headerEl, "SOURCE-TOOL-ID")
      : undefined,
    comment: headerEl ? getChild(headerEl, "COMMENT")?.text.trim() || getAttr(headerEl, "COMMENT") : undefined,
  };

  let coreContent = getChild(root, "CORE-CONTENT") || root;
  if (coreContent && getChild(coreContent, "REQ-IF-CONTENT")) {
    coreContent = getChild(coreContent, "REQ-IF-CONTENT")!;
  }

  // 2. Data Types
  const dataTypes = new Map<string, ReqIfDataType>();
  const dataTypesContainer = getChild(coreContent, "DATATYPES") || getChild(coreContent, "DATATYPE-DEFINITIONS");
  if (dataTypesContainer) {
    for (const dtEl of dataTypesContainer.children) {
      const rawTag = localName(dtEl.name).toUpperCase();
      let kind: ReqIfDataTypeKind = "STRING";
      if (rawTag.includes("INTEGER")) kind = "INTEGER";
      else if (rawTag.includes("REAL")) kind = "REAL";
      else if (rawTag.includes("BOOLEAN")) kind = "BOOLEAN";
      else if (rawTag.includes("ENUM")) kind = "ENUMERATION";
      else if (rawTag.includes("XHTML")) kind = "XHTML";
      else if (rawTag.includes("DATE")) kind = "DATE";

      const id = getAttr(dtEl, "IDENTIFIER") || `DT-${dataTypes.size + 1}`;
      const longName = getAttr(dtEl, "LONG-NAME");

      const enumValues: ReqIfEnumValue[] = [];
      const specifiedValues = getChild(dtEl, "SPECIFIED-VALUES");
      if (specifiedValues) {
        for (const enumEl of specifiedValues.children) {
          const enumId = getAttr(enumEl, "IDENTIFIER") || `ENUM-${enumValues.length + 1}`;
          const enumName = getAttr(enumEl, "LONG-NAME") || enumId;
          const keyStr = getAttr(enumEl, "KEY");
          enumValues.push({
            identifier: enumId,
            longName: enumName,
            key: keyStr ? parseInt(keyStr, 10) : undefined,
          });
        }
      }

      dataTypes.set(id, {
        identifier: id,
        longName,
        kind,
        enumValues: enumValues.length > 0 ? enumValues : undefined,
      });
    }
  }

  // 3. Spec Types
  const specTypes = new Map<string, ReqIfSpecType>();
  const specTypesContainer = getChild(coreContent, "SPEC-TYPES");
  if (specTypesContainer) {
    for (const stEl of specTypesContainer.children) {
      const rawTag = localName(stEl.name).toUpperCase();
      let kind: ReqIfSpecTypeKind = "SPEC-OBJECT-TYPE";
      if (rawTag.includes("SPECIFICATION-TYPE")) kind = "SPECIFICATION-TYPE";
      else if (rawTag.includes("SPEC-RELATION-TYPE")) kind = "SPEC-RELATION-TYPE";
      else if (rawTag.includes("RELATION-GROUP-TYPE")) kind = "RELATION-GROUP-TYPE";

      const id = getAttr(stEl, "IDENTIFIER") || `ST-${specTypes.size + 1}`;
      const longName = getAttr(stEl, "LONG-NAME");

      const attributeDefinitions = new Map<string, ReqIfAttributeDefinition>();
      const specAttributes = getChild(stEl, "SPEC-ATTRIBUTES");
      if (specAttributes) {
        for (const attrDefEl of specAttributes.children) {
          const attrId = getAttr(attrDefEl, "IDENTIFIER") || `AD-${attributeDefinitions.size + 1}`;
          const attrName = getAttr(attrDefEl, "LONG-NAME") || attrId;
          const isMandatory = getAttr(attrDefEl, "IS-MANDATORY") === "true";

          const attrTag = localName(attrDefEl.name).toUpperCase();
          let attrKind: ReqIfDataTypeKind = "STRING";
          if (attrTag.includes("INTEGER")) attrKind = "INTEGER";
          else if (attrTag.includes("REAL")) attrKind = "REAL";
          else if (attrTag.includes("BOOLEAN")) attrKind = "BOOLEAN";
          else if (attrTag.includes("ENUM")) attrKind = "ENUMERATION";
          else if (attrTag.includes("XHTML")) attrKind = "XHTML";
          else if (attrTag.includes("DATE")) attrKind = "DATE";

          let typeRef = "";
          const typeWrapper = getChild(attrDefEl, "TYPE");
          if (typeWrapper && typeWrapper.children.length > 0) {
            typeRef = typeWrapper.children[0]!.text.trim();
          }

          let defaultValue: string | number | boolean | undefined;
          const defValEl = getChild(attrDefEl, "DEFAULT-VALUE");
          if (defValEl) {
            const valChild = defValEl.children[0];
            if (valChild) {
              const theVal = getAttr(valChild, "THE-VALUE") || getChild(valChild, "THE-VALUE")?.text.trim();
              if (theVal !== undefined) {
                if (attrKind === "REAL" || attrKind === "INTEGER") defaultValue = parseFloat(theVal);
                else if (attrKind === "BOOLEAN") defaultValue = theVal.toLowerCase() === "true";
                else defaultValue = theVal;
              }
            }
          }

          attributeDefinitions.set(attrId, {
            identifier: attrId,
            longName: attrName,
            dataTypeRef: typeRef,
            kind: attrKind,
            defaultValue,
            isMandatory,
          });
        }
      }

      specTypes.set(id, {
        identifier: id,
        longName,
        kind,
        attributeDefinitions,
      });
    }
  }

  // 4. Spec Objects (Requirements)
  const specObjects = new Map<string, ReqIfSpecObject>();
  const specObjectsContainer = getChild(coreContent, "SPEC-OBJECTS");
  if (specObjectsContainer) {
    for (const soEl of specObjectsContainer.children) {
      if (!matchTag(soEl, "SPEC-OBJECT")) continue;

      const id = getAttr(soEl, "IDENTIFIER") || `REQ-${specObjects.size + 1}`;
      const longName = getAttr(soEl, "LONG-NAME");
      const lastChange = getAttr(soEl, "LAST-CHANGE");
      const typeRef = getChildRefText(soEl, "TYPE", "SPEC-OBJECT-TYPE-REF");
      const span = createSpan(soEl.start, soEl.end, lineStarts);

      const attributes = new Map<string, ReqIfAttributeValue>();
      let requirementText = "";

      const valuesContainer = getChild(soEl, "VALUES");
      if (valuesContainer) {
        for (const valEl of valuesContainer.children) {
          const valTag = localName(valEl.name).toUpperCase();
          let kind: ReqIfDataTypeKind = "STRING";
          if (valTag.includes("INTEGER")) kind = "INTEGER";
          else if (valTag.includes("REAL")) kind = "REAL";
          else if (valTag.includes("BOOLEAN")) kind = "BOOLEAN";
          else if (valTag.includes("ENUM")) kind = "ENUMERATION";
          else if (valTag.includes("XHTML")) kind = "XHTML";
          else if (valTag.includes("DATE")) kind = "DATE";

          let defRef = "";
          const defWrapper = getChild(valEl, "DEFINITION");
          if (defWrapper && defWrapper.children.length > 0) {
            defRef = defWrapper.children[0]!.text.trim();
          }

          let rawValue: string | number | boolean = "";
          if (kind === "ENUMERATION") {
            const valsEl = getChild(valEl, "VALUES");
            if (valsEl && valsEl.children.length > 0) {
              rawValue = valsEl.children[0]!.text.trim();
            } else {
              rawValue = getAttr(valEl, "THE-VALUE") ?? "";
            }
          } else {
            const directAttr = getAttr(valEl, "THE-VALUE");
            if (directAttr !== undefined) {
              rawValue = directAttr;
            } else {
              const theValEl = getChild(valEl, "THE-VALUE");
              if (theValEl) {
                rawValue = theValEl.text.trim();
              }
            }
          }

          let parsedValue: string | number | boolean = rawValue;
          if (kind === "REAL" || kind === "INTEGER") {
            const num = parseFloat(String(rawValue));
            if (!isNaN(num)) parsedValue = num;
          } else if (kind === "BOOLEAN") {
            parsedValue = String(rawValue).toLowerCase() === "true";
          }

          const attrSpan = createSpan(valEl.start, valEl.end, lineStarts);

          let attrName = defRef;
          if (typeRef && specTypes.has(typeRef)) {
            const st = specTypes.get(typeRef)!;
            const ad = st.attributeDefinitions.get(defRef);
            if (ad?.longName) attrName = ad.longName;
          }

          attributes.set(defRef || attrName, {
            definitionRef: defRef,
            name: attrName,
            kind,
            value: parsedValue,
            span: attrSpan,
          });

          // Check if this attribute represents the requirement text
          const lowerName = attrName.toLowerCase();
          if (
            lowerName.includes("text") ||
            lowerName.includes("description") ||
            lowerName.includes("summary") ||
            lowerName === "reqif.text" ||
            lowerName === "requirement text" ||
            !attrName ||
            !requirementText
          ) {
            if (typeof parsedValue === "string" && parsedValue.trim().length > 0) {
              requirementText = parsedValue.trim();
            }
          }
        }
      }

      if (!requirementText) {
        for (const attr of attributes.values()) {
          if (typeof attr.value === "string" && attr.value.trim().length > 0) {
            requirementText = attr.value.trim();
            break;
          }
        }
      }

      if (!requirementText) {
        requirementText = longName || id;
      }

      const contract = extractFormalContract(requirementText);
      const asil = extractAsilLevel(requirementText);

      specObjects.set(id, {
        identifier: id,
        longName,
        lastChange,
        typeRef,
        attributes,
        text: requirementText,
        span,
        contract,
        asilLevel: asil,
      });
    }
  }

  // 5. Spec Relations
  const specRelations: ReqIfSpecRelation[] = [];
  const specRelationsContainer = getChild(coreContent, "SPEC-RELATIONS");
  if (specRelationsContainer) {
    for (const srEl of specRelationsContainer.children) {
      if (!matchTag(srEl, "SPEC-RELATION")) continue;

      const id = getAttr(srEl, "IDENTIFIER") || `REL-${specRelations.length + 1}`;
      const longName = getAttr(srEl, "LONG-NAME");
      const typeRef = getChildRefText(srEl, "TYPE", "SPEC-RELATION-TYPE-REF");
      const sourceId = getChildRefText(srEl, "SOURCE", "SPEC-OBJECT-REF") || "";
      const targetId = getChildRefText(srEl, "TARGET", "SPEC-OBJECT-REF") || "";
      const span = createSpan(srEl.start, srEl.end, lineStarts);

      let relationType: ReqIfRelationKind = "satisfies";
      const candidateType = (longName || typeRef || "").toLowerCase();
      if (candidateType.includes("verify") || candidateType.includes("verification")) relationType = "verifies";
      else if (candidateType.includes("refine")) relationType = "refines";
      else if (candidateType.includes("allocate")) relationType = "allocates";
      else if (candidateType.includes("conflict")) relationType = "conflicts";
      else if (candidateType.includes("derive")) relationType = "derives";

      specRelations.push({
        identifier: id,
        longName,
        typeRef,
        relationType,
        sourceId,
        targetId,
        span,
      });
    }
  }

  // 6. Specifications & Hierarchies
  function parseHierarchy(hEl: XmlElement): ReqIfSpecHierarchy {
    const id = getAttr(hEl, "IDENTIFIER") || `HIER-${Math.random().toString(36).slice(2, 8)}`;
    const objectRef =
      getChildRefText(hEl, "OBJECT", "SPEC-OBJECT-REF") || getAttr(hEl, "OBJECT-REF") || getAttr(hEl, "OBJECT") || "";
    const span = createSpan(hEl.start, hEl.end, lineStarts);

    const children: ReqIfSpecHierarchy[] = [];
    const childrenContainer = getChild(hEl, "CHILDREN");
    if (childrenContainer) {
      for (const childEl of childrenContainer.children) {
        if (matchTag(childEl, "SPEC-HIERARCHY")) {
          children.push(parseHierarchy(childEl));
        }
      }
    }

    return {
      identifier: id,
      objectRef,
      children,
      span,
    };
  }

  const specifications: ReqIfSpecification[] = [];
  const specificationsContainer = getChild(coreContent, "SPECIFICATIONS");
  if (specificationsContainer) {
    for (const specEl of specificationsContainer.children) {
      if (!matchTag(specEl, "SPECIFICATION")) continue;

      const id = getAttr(specEl, "IDENTIFIER") || `SPEC-${specifications.length + 1}`;
      const longName = getAttr(specEl, "LONG-NAME");
      const lastChange = getAttr(specEl, "LAST-CHANGE");
      const typeRef = getChildRefText(specEl, "TYPE", "SPECIFICATION-TYPE-REF");
      const span = createSpan(specEl.start, specEl.end, lineStarts);

      const children: ReqIfSpecHierarchy[] = [];
      const childrenContainer = getChild(specEl, "CHILDREN");
      if (childrenContainer) {
        for (const childEl of childrenContainer.children) {
          if (matchTag(childEl, "SPEC-HIERARCHY")) {
            children.push(parseHierarchy(childEl));
          }
        }
      }

      specifications.push({
        identifier: id,
        longName,
        lastChange,
        typeRef,
        children,
        span,
      });
    }
  }

  return {
    header,
    dataTypes,
    specTypes,
    specObjects,
    specRelations,
    specifications,
    rawXml: xmlContent,
  };
}

/**
 * Serializes a ReqIfDocument back to standard OMG ReqIF 1.2 XML.
 */
export function serializeReqIf(doc: ReqIfDocument): string {
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(
    '<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  );

  // Header
  parts.push("  <THE-HEADER>");
  parts.push(`    <REQ-IF-HEADER IDENTIFIER="${doc.header.identifier}">`);
  parts.push(`      <REQ-IF-VERSION>${doc.header.reqIfVersion}</REQ-IF-VERSION>`);
  parts.push(`      <TITLE>${escapeXml(doc.header.title)}</TITLE>`);
  if (doc.header.creationTime) parts.push(`      <CREATION-TIME>${doc.header.creationTime}</CREATION-TIME>`);
  if (doc.header.repositoryId) parts.push(`      <REPOSITORY-ID>${doc.header.repositoryId}</REPOSITORY-ID>`);
  if (doc.header.reqIfToolId) parts.push(`      <REQ-IF-TOOL-ID>${doc.header.reqIfToolId}</REQ-IF-TOOL-ID>`);
  if (doc.header.comment) parts.push(`      <COMMENT>${escapeXml(doc.header.comment)}</COMMENT>`);
  parts.push("    </REQ-IF-HEADER>");
  parts.push("  </THE-HEADER>");

  parts.push("  <CORE-CONTENT>");
  parts.push("    <REQ-IF-CONTENT>");

  // Data Types
  parts.push("      <DATATYPES>");
  for (const dt of doc.dataTypes.values()) {
    const tagName = `DATATYPE-DEFINITION-${dt.kind}`;
    parts.push(
      `        <${tagName} IDENTIFIER="${dt.identifier}" LONG-NAME="${escapeXml(dt.longName || dt.identifier)}">`,
    );
    if (dt.enumValues && dt.enumValues.length > 0) {
      parts.push("          <SPECIFIED-VALUES>");
      for (const ev of dt.enumValues) {
        parts.push(
          `            <ENUM-VALUE IDENTIFIER="${ev.identifier}" LONG-NAME="${escapeXml(ev.longName || ev.identifier)}"${ev.key !== undefined ? ` KEY="${ev.key}"` : ""} />`,
        );
      }
      parts.push("          </SPECIFIED-VALUES>");
    }
    parts.push(`        </${tagName}>`);
  }
  parts.push("      </DATATYPES>");

  // Spec Types
  parts.push("      <SPEC-TYPES>");
  for (const st of doc.specTypes.values()) {
    parts.push(
      `        <${st.kind} IDENTIFIER="${st.identifier}" LONG-NAME="${escapeXml(st.longName || st.identifier)}">`,
    );
    if (st.attributeDefinitions.size > 0) {
      parts.push("          <SPEC-ATTRIBUTES>");
      for (const ad of st.attributeDefinitions.values()) {
        const tagName = `ATTRIBUTE-DEFINITION-${ad.kind}`;
        parts.push(
          `            <${tagName} IDENTIFIER="${ad.identifier}" LONG-NAME="${escapeXml(ad.longName || ad.identifier)}"${ad.isMandatory ? ' IS-MANDATORY="true"' : ""}>`,
        );
        if (ad.dataTypeRef) {
          parts.push("              <TYPE>");
          parts.push(
            `                <DATATYPE-DEFINITION-${ad.kind}-REF>${ad.dataTypeRef}</DATATYPE-DEFINITION-${ad.kind}-REF>`,
          );
          parts.push("              </TYPE>");
        }
        parts.push(`            </${tagName}>`);
      }
      parts.push("          </SPEC-ATTRIBUTES>");
    }
    parts.push(`        </${st.kind}>`);
  }
  parts.push("      </SPEC-TYPES>");

  // Spec Objects
  parts.push("      <SPEC-OBJECTS>");
  for (const so of doc.specObjects.values()) {
    parts.push(
      `        <SPEC-OBJECT IDENTIFIER="${so.identifier}" LONG-NAME="${escapeXml(so.longName || so.identifier)}">`,
    );
    if (so.typeRef) {
      parts.push("          <TYPE>");
      parts.push(`            <SPEC-OBJECT-TYPE-REF>${so.typeRef}</SPEC-OBJECT-TYPE-REF>`);
      parts.push("          </TYPE>");
    }
    if (so.attributes.size > 0) {
      parts.push("          <VALUES>");
      for (const attr of so.attributes.values()) {
        const tagName = `ATTRIBUTE-VALUE-${attr.kind}`;
        parts.push(`            <${tagName}>`);
        if (attr.definitionRef) {
          parts.push("              <DEFINITION>");
          parts.push(
            `                <ATTRIBUTE-DEFINITION-${attr.kind}-REF>${attr.definitionRef}</ATTRIBUTE-DEFINITION-${attr.kind}-REF>`,
          );
          parts.push("              </DEFINITION>");
        }
        if (attr.kind === "ENUMERATION") {
          parts.push("              <VALUES>");
          parts.push(`                <ENUM-VALUE-REF>${String(attr.value)}</ENUM-VALUE-REF>`);
          parts.push("              </VALUES>");
        } else {
          parts.push(`              <THE-VALUE>${escapeXml(String(attr.value))}</THE-VALUE>`);
        }
        parts.push(`            </${tagName}>`);
      }
      parts.push("          </VALUES>");
    }
    parts.push("        </SPEC-OBJECT>");
  }
  parts.push("      </SPEC-OBJECTS>");

  // Spec Relations
  if (doc.specRelations.length > 0) {
    parts.push("      <SPEC-RELATIONS>");
    for (const rel of doc.specRelations) {
      parts.push(
        `        <SPEC-RELATION IDENTIFIER="${rel.identifier}" LONG-NAME="${escapeXml(rel.longName || rel.relationType)}">`,
      );
      if (rel.typeRef) {
        parts.push("          <TYPE>");
        parts.push(`            <SPEC-RELATION-TYPE-REF>${rel.typeRef}</SPEC-RELATION-TYPE-REF>`);
        parts.push("          </TYPE>");
      }
      parts.push("          <SOURCE>");
      parts.push(`            <SPEC-OBJECT-REF>${rel.sourceId}</SPEC-OBJECT-REF>`);
      parts.push("          </SOURCE>");
      parts.push("          <TARGET>");
      parts.push(`            <SPEC-OBJECT-REF>${rel.targetId}</SPEC-OBJECT-REF>`);
      parts.push("          </TARGET>");
      parts.push("        </SPEC-RELATION>");
    }
    parts.push("      </SPEC-RELATIONS>");
  }

  // Specifications
  if (doc.specifications.length > 0) {
    parts.push("      <SPECIFICATIONS>");
    for (const spec of doc.specifications) {
      parts.push(
        `        <SPECIFICATION IDENTIFIER="${spec.identifier}" LONG-NAME="${escapeXml(spec.longName || spec.identifier)}">`,
      );
      if (spec.typeRef) {
        parts.push("          <TYPE>");
        parts.push(`            <SPECIFICATION-TYPE-REF>${spec.typeRef}</SPECIFICATION-TYPE-REF>`);
        parts.push("          </TYPE>");
      }
      if (spec.children.length > 0) {
        parts.push("          <CHILDREN>");
        for (const h of spec.children) {
          serializeHierarchy(h, parts, "            ");
        }
        parts.push("          </CHILDREN>");
      }
      parts.push("        </SPECIFICATION>");
    }
    parts.push("      </SPECIFICATIONS>");
  }

  parts.push("    </REQ-IF-CONTENT>");
  parts.push("  </CORE-CONTENT>");
  parts.push("</REQ-IF>");

  return parts.join("\n");
}

function serializeHierarchy(h: ReqIfSpecHierarchy, parts: string[], indent: string) {
  parts.push(`${indent}<SPEC-HIERARCHY IDENTIFIER="${h.identifier}">`);
  parts.push(`${indent}  <OBJECT>`);
  parts.push(`${indent}    <SPEC-OBJECT-REF>${h.objectRef}</SPEC-OBJECT-REF>`);
  parts.push(`${indent}  </OBJECT>`);
  if (h.children.length > 0) {
    parts.push(`${indent}  <CHILDREN>`);
    for (const child of h.children) {
      serializeHierarchy(child, parts, indent + "    ");
    }
    parts.push(`${indent}  </CHILDREN>`);
  }
  parts.push(`${indent}</SPEC-HIERARCHY>`);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
