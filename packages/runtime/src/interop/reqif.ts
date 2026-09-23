// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Native OMG ReqIF 1.2 (Requirements Interchange Format) Parser & Generator.
 *
 * Implements lossless requirements ingestion and export across the Digital Thread,
 * mapping DOORS / Polarion / Teamcenter requirements into SysML v2 and Modelica verifier models
 * with full support for hierarchical specifications and traceability relations.
 */

export interface ReqIfAttribute {
  name: string;
  type: "String" | "Real" | "Integer" | "Boolean" | "Enumeration";
  value: string | number | boolean;
}

export interface ReqIfRelation {
  id: string;
  sourceId: string;
  targetId: string;
  type: "satisfies" | "verifies" | "allocates" | "refines" | string;
}

export interface ReqIfRequirement {
  id: string;
  name: string;
  text: string;
  type?: string;
  attributes: Record<string, string | number | boolean>;
  children?: ReqIfRequirement[];
  satisfiedBy?: string[];
  verifiedBy?: string[];
  status?: "Draft" | "Approved" | "Verified" | "Violated";
  asilLevel?: "QM" | "ASIL-A" | "ASIL-B" | "ASIL-C" | "ASIL-D";
  limitValue?: number;
  comparator?: "<" | "<=" | "==" | ">=" | ">" | "!=";
}

export interface ReqIfSpecification {
  id: string;
  title: string;
  description?: string;
  requirements: ReqIfRequirement[];
  relations?: ReqIfRelation[];
}

export class ReqIfParser {
  /**
   * Parses standard OMG ReqIF 1.2 XML into structured requirement specifications.
   */
  static parse(xmlString: string): ReqIfSpecification {
    const spec: ReqIfSpecification = {
      id: "SPEC-01",
      title: "Imported Requirements Document",
      requirements: [],
      relations: [],
    };

    // Extract title from REQ-IF-HEADER or SPECIFICATION
    const titleMatch = xmlString.match(/<TITLE>([^<]*)<\/TITLE>/i) || xmlString.match(/LONG-NAME="([^"]+)"/i);
    if (titleMatch) {
      spec.title = titleMatch[1];
    }

    // Map to hold flat list of requirements by ID for hierarchical reconstruction
    const reqMap = new Map<string, ReqIfRequirement>();

    // 1. Extract SPEC-OBJECT blocks
    const specObjRegex = /<SPEC-OBJECT\b([^>]*)>([\s\S]*?)<\/SPEC-OBJECT>/gi;
    let match: RegExpExecArray | null;

    while ((match = specObjRegex.exec(xmlString)) !== null) {
      const attrsStr = match[1];
      const body = match[2];

      const idMatch = attrsStr.match(/IDENTIFIER="([^"]+)"/i);
      const id = idMatch ? idMatch[1] : `REQ-${reqMap.size + 1}`;

      // Extract custom attributes first
      const attributes: Record<string, string | number | boolean> = {};
      const valRegex =
        /<ATTRIBUTE-VALUE-(?:STRING|REAL|INTEGER|BOOLEAN|ENUMERATION|XHTML)\b([^>]*)>([\s\S]*?)<\/ATTRIBUTE-VALUE-(?:STRING|REAL|INTEGER|BOOLEAN|ENUMERATION|XHTML)>/gi;
      let valMatch: RegExpExecArray | null;

      let extractedName: string | undefined;
      let extractedText: string | undefined;
      let extractedLimit: number | undefined;
      let extractedComparator: ReqIfRequirement["comparator"] = undefined;
      let extractedAsil: ReqIfRequirement["asilLevel"] = undefined;

      while ((valMatch = valRegex.exec(body)) !== null) {
        const valAttrs = valMatch[1];
        const valBody = valMatch[2];

        // Attribute name / definition reference
        const attrDefMatch =
          valAttrs.match(/(?:ATTRIBUTE-DEFINITION|DEFINITION)="([^"]+)"/i) ||
          valBody.match(/<ATTRIBUTE-DEFINITION-[A-Z0-9_-]+-REF>([^<]*)<\/ATTRIBUTE-DEFINITION-[A-Z0-9_-]+-REF>/i);
        const attrName = attrDefMatch ? attrDefMatch[1].trim() : "Attribute";

        // Raw value
        const theValAttrMatch = valAttrs.match(/THE-VALUE="([^"]*)"/i);
        let theValBody = "";
        const theValOpen = valBody.indexOf("<THE-VALUE>");
        if (theValOpen !== -1) {
          const theValClose = valBody.indexOf("</THE-VALUE>", theValOpen);
          if (theValClose !== -1) {
            theValBody = valBody.slice(theValOpen + "<THE-VALUE>".length, theValClose);
          }
        }
        const enumRefMatch = valBody.match(/<ENUM-VALUE-REF>([^<]*)<\/ENUM-VALUE-REF>/i);

        let rawStr = "";
        if (theValAttrMatch) {
          rawStr = theValAttrMatch[1];
        } else if (theValBody) {
          let stripped = theValBody;
          let prev = "";
          while (stripped !== prev) {
            prev = stripped;
            stripped = stripped.replace(/<[^>]+>/g, "");
          }
          rawStr = stripped.trim();
        } else if (enumRefMatch) {
          rawStr = enumRefMatch[1].trim();
        }
        const rawVal = unescapeXml(rawStr);

        if (!isNaN(Number(rawVal)) && rawVal !== "") {
          attributes[attrName] = Number(rawVal);
        } else if (rawVal.toLowerCase() === "true" || rawVal.toLowerCase() === "false") {
          attributes[attrName] = rawVal.toLowerCase() === "true";
        } else {
          attributes[attrName] = rawVal;
        }

        const lowerDef = attrName.toLowerCase();
        if (lowerDef.includes("name") || lowerDef === "title") {
          extractedName = rawVal;
        } else if (lowerDef.includes("text") || lowerDef.includes("desc")) {
          extractedText = rawVal;
        } else if (lowerDef.includes("limit")) {
          extractedLimit = Number(rawVal);
        } else if (lowerDef.includes("comp")) {
          extractedComparator = rawVal as any;
        } else if (lowerDef.includes("asil")) {
          extractedAsil = rawVal as any;
        }
      }

      const name = extractedName || attrsStr.match(/LONG-NAME="([^"]+)"/i)?.[1] || id;
      let text = extractedText || name;

      // Check for numeric limit / comparison heuristics in requirement text if not explicitly provided
      let limitValue = extractedLimit;
      let comparator = extractedComparator;
      if (comparator === undefined || limitValue === undefined) {
        const compMatch = text.match(/(?:>=|<=|>|<|==|!=|\bexceed\b|\bat least\b|\bmaximum\b|\bminimum\b)\s*([\d.]+)/i);
        if (compMatch) {
          if (limitValue === undefined) {
            limitValue = parseFloat(compMatch[1]);
          }
          if (comparator === undefined) {
            if (text.includes(">=") || text.includes("at least")) comparator = ">=";
            else if (text.includes("<=") || text.includes("maximum")) comparator = "<=";
            else if (text.includes(">") || text.includes("exceed")) comparator = ">";
            else if (text.includes("<")) comparator = "<";
            else comparator = "<=";
          }
        }
      }

      const asil =
        extractedAsil ||
        ((attributes["ASIL"] ||
          attributes["asil"] ||
          text.match(/ASIL-[ABCD]/i)?.[0]) as ReqIfRequirement["asilLevel"]);

      const req: ReqIfRequirement = {
        id,
        name,
        text,
        attributes,
        asilLevel: asil,
        limitValue,
        comparator,
        status: "Approved",
      };

      reqMap.set(id, req);
    }

    // 2. Extract SPEC-RELATIONS
    const relationRegex = /<SPEC-RELATION\b([^>]*)>([\s\S]*?)<\/SPEC-RELATION>/gi;
    while ((match = relationRegex.exec(xmlString)) !== null) {
      const relAttrs = match[1];
      const relBody = match[2];

      const extractInnerRef = (container: string, parentTag: string, childTag: string): string | undefined => {
        const pOpen = `<${parentTag}>`;
        const pClose = `</${parentTag}>`;
        const pStart = container.toUpperCase().indexOf(pOpen);
        if (pStart === -1) return undefined;
        const pEnd = container.toUpperCase().indexOf(pClose, pStart);
        if (pEnd === -1) return undefined;
        const inner = container.slice(pStart + pOpen.length, pEnd);
        const m = inner.match(new RegExp(`<${childTag}>([^<]*)<\\/${childTag}>`, "i"));
        return m ? m[1].trim() : undefined;
      };

      const relId = relAttrs.match(/IDENTIFIER="([^"]+)"/i)?.[1] || `REL-${spec.relations!.length + 1}`;
      const sourceId = extractInnerRef(relBody, "SOURCE", "SPEC-OBJECT-REF");
      const targetId = extractInnerRef(relBody, "TARGET", "SPEC-OBJECT-REF");
      const typeRef = extractInnerRef(relBody, "TYPE", "SPEC-RELATION-TYPE-REF");
      const typeMatch = typeRef || relAttrs.match(/LONG-NAME="([^"]+)"/i)?.[1] || "satisfies";

      if (sourceId && targetId) {
        spec.relations!.push({
          id: relId,
          sourceId,
          targetId,
          type: typeMatch.toLowerCase(),
        });

        // Link directly onto requirement objects if present
        const srcReq = reqMap.get(sourceId);
        const tgtReq = reqMap.get(targetId);
        if (typeMatch.toLowerCase().includes("satisf")) {
          if (tgtReq) tgtReq.satisfiedBy = (tgtReq.satisfiedBy || []).concat([sourceId]);
        } else if (typeMatch.toLowerCase().includes("verif")) {
          if (tgtReq) tgtReq.verifiedBy = (tgtReq.verifiedBy || []).concat([sourceId]);
        }
      }
    }

    // 3. Extract SPEC-HIERARCHY recursively (reconstruct parent-child tree)
    const parentMap = new Map<string, string>(); // childReqId -> parentReqId
    const childIds = new Set<string>();

    const parseHierarchyBlock = (blockXml: string, parentReqId?: string) => {
      let depth = 0;
      let tagStart = -1;

      for (let i = 0; i < blockXml.length; i++) {
        if (blockXml.startsWith("<SPEC-HIERARCHY", i)) {
          if (depth === 0) {
            tagStart = i;
          }
          depth++;
        } else if (blockXml.startsWith("</SPEC-HIERARCHY>", i)) {
          depth--;
          if (depth === 0 && tagStart !== -1) {
            const fullTag = blockXml.substring(tagStart, i + 17);
            const objRefMatch = fullTag.match(/<OBJECT>[\s\S]*?<SPEC-OBJECT-REF>(.*?)<\/SPEC-OBJECT-REF>/i);
            const currentReqId = objRefMatch ? objRefMatch[1].trim() : undefined;

            if (currentReqId) {
              if (parentReqId) {
                parentMap.set(currentReqId, parentReqId);
                childIds.add(currentReqId);
              }
              const childrenBlock = fullTag.match(/<CHILDREN>([\s\S]*?)<\/CHILDREN>/i);
              if (childrenBlock) {
                parseHierarchyBlock(childrenBlock[1], currentReqId);
              }
            }
            tagStart = -1;
          }
        }
      }
    };

    parseHierarchyBlock(xmlString);

    // Build hierarchical tree
    for (const [id, req] of reqMap.entries()) {
      const parentId = parentMap.get(id);
      if (parentId && reqMap.has(parentId)) {
        const parent = reqMap.get(parentId)!;
        parent.children = parent.children || [];
        parent.children.push(req);
      } else if (!childIds.has(id)) {
        spec.requirements.push(req);
      }
    }

    // Fallback: if no hierarchy was defined, all parsed requirements are top-level
    if (spec.requirements.length === 0 && reqMap.size > 0) {
      spec.requirements = Array.from(reqMap.values());
    }

    return spec;
  }

  /**
   * Serializes requirements and relations into standard OMG ReqIF 1.2 XML format.
   */
  static emit(spec: ReqIfSpecification): string {
    const timestamp = new Date().toISOString();
    const lines: string[] = [];

    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push(
      '<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    );
    lines.push("  <THE-HEADER>");
    lines.push('    <REQ-IF-HEADER IDENTIFIER="header_01">');
    lines.push(`      <CREATION-TIME>${timestamp}</CREATION-TIME>`);
    lines.push("      <REQ-IF-TOOL-ID>ModelScript Digital Thread ReqIF Engine</REQ-IF-TOOL-ID>");
    lines.push(`      <TITLE>${escapeXml(spec.title)}</TITLE>`);
    lines.push("    </REQ-IF-HEADER>");
    lines.push("  </THE-HEADER>");
    lines.push("  <CORE-CONTENT>");
    lines.push("    <REQ-IF-CONTENT>");

    // Flatten all requirements (including nested children) for SPEC-OBJECTS table
    const allReqs: ReqIfRequirement[] = [];
    const collectReqs = (list: ReqIfRequirement[]) => {
      for (const r of list) {
        allReqs.push(r);
        if (r.children && r.children.length > 0) {
          collectReqs(r.children);
        }
      }
    };
    collectReqs(spec.requirements);

    // 1. SPEC-OBJECTS
    lines.push("      <SPEC-OBJECTS>");
    for (const req of allReqs) {
      lines.push(`        <SPEC-OBJECT IDENTIFIER="${escapeXml(req.id)}" LONG-NAME="${escapeXml(req.name)}">`);
      lines.push("          <VALUES>");
      lines.push('            <ATTRIBUTE-VALUE-STRING ATTRIBUTE-DEFINITION="Description">');
      lines.push(`              <THE-VALUE>${escapeXml(req.text)}</THE-VALUE>`);
      lines.push("            </ATTRIBUTE-VALUE-STRING>");

      if (req.asilLevel) {
        lines.push('            <ATTRIBUTE-VALUE-STRING ATTRIBUTE-DEFINITION="ASIL">');
        lines.push(`              <THE-VALUE>${escapeXml(req.asilLevel)}</THE-VALUE>`);
        lines.push("            </ATTRIBUTE-VALUE-STRING>");
      }
      if (req.limitValue !== undefined) {
        lines.push('            <ATTRIBUTE-VALUE-REAL ATTRIBUTE-DEFINITION="LimitValue">');
        lines.push(`              <THE-VALUE>${req.limitValue}</THE-VALUE>`);
        lines.push("            </ATTRIBUTE-VALUE-REAL>");
      }
      if (req.comparator) {
        lines.push('            <ATTRIBUTE-VALUE-STRING ATTRIBUTE-DEFINITION="Comparator">');
        lines.push(`              <THE-VALUE>${escapeXml(req.comparator)}</THE-VALUE>`);
        lines.push("            </ATTRIBUTE-VALUE-STRING>");
      }

      for (const [k, v] of Object.entries(req.attributes)) {
        if (k !== "Description" && k !== "ASIL" && k !== "LimitValue" && k !== "Comparator") {
          lines.push(`            <ATTRIBUTE-VALUE-STRING ATTRIBUTE-DEFINITION="${escapeXml(k)}">`);
          lines.push(`              <THE-VALUE>${escapeXml(String(v))}</THE-VALUE>`);
          lines.push("            </ATTRIBUTE-VALUE-STRING>");
        }
      }

      lines.push("          </VALUES>");
      lines.push("        </SPEC-OBJECT>");
    }
    lines.push("      </SPEC-OBJECTS>");

    // 2. SPEC-RELATIONS
    if (spec.relations && spec.relations.length > 0) {
      lines.push("      <SPEC-RELATIONS>");
      for (const rel of spec.relations) {
        lines.push(`        <SPEC-RELATION IDENTIFIER="${escapeXml(rel.id)}" LONG-NAME="${escapeXml(rel.type)}">`);
        lines.push("          <SOURCE>");
        lines.push(`            <SPEC-OBJECT-REF>${escapeXml(rel.sourceId)}</SPEC-OBJECT-REF>`);
        lines.push("          </SOURCE>");
        lines.push("          <TARGET>");
        lines.push(`            <SPEC-OBJECT-REF>${escapeXml(rel.targetId)}</SPEC-OBJECT-REF>`);
        lines.push("          </TARGET>");
        lines.push("          <TYPE>");
        lines.push(`            <SPEC-RELATION-TYPE-REF>${escapeXml(rel.type)}</SPEC-RELATION-TYPE-REF>`);
        lines.push("          </TYPE>");
        lines.push("        </SPEC-RELATION>");
      }
      lines.push("      </SPEC-RELATIONS>");
    }

    // 3. SPECIFICATIONS & SPEC-HIERARCHY
    lines.push("      <SPECIFICATIONS>");
    lines.push(`        <SPECIFICATION IDENTIFIER="${escapeXml(spec.id)}" LONG-NAME="${escapeXml(spec.title)}">`);
    lines.push("          <CHILDREN>");

    const emitHierarchy = (req: ReqIfRequirement, indent: string) => {
      lines.push(`${indent}<SPEC-HIERARCHY IDENTIFIER="hier_${escapeXml(req.id)}">`);
      lines.push(`${indent}  <OBJECT>`);
      lines.push(`${indent}    <SPEC-OBJECT-REF>${escapeXml(req.id)}</SPEC-OBJECT-REF>`);
      lines.push(`${indent}  </OBJECT>`);
      if (req.children && req.children.length > 0) {
        lines.push(`${indent}  <CHILDREN>`);
        for (const child of req.children) {
          emitHierarchy(child, `${indent}    `);
        }
        lines.push(`${indent}  </CHILDREN>`);
      }
      lines.push(`${indent}</SPEC-HIERARCHY>`);
    };

    for (const req of spec.requirements) {
      emitHierarchy(req, "            ");
    }

    lines.push("          </CHILDREN>");
    lines.push("        </SPECIFICATION>");
    lines.push("      </SPECIFICATIONS>");

    lines.push("    </REQ-IF-CONTENT>");
    lines.push("  </CORE-CONTENT>");
    lines.push("</REQ-IF>");

    return lines.join("\n");
  }

  /**
   * Generates SysML v2 requirement package code from ReqIF specification.
   */
  static toSysML2(spec: ReqIfSpecification): string {
    const lines: string[] = [];
    const pkgName = spec.title.includes(" ")
      ? `'${spec.title}'`
      : spec.title.replace(/[^a-zA-Z0-9_]/g, "") || "RequirementsPackage";

    lines.push(`package ${pkgName} {`);

    const renderReq = (req: ReqIfRequirement, indent: string) => {
      const sanitizedId = req.id.replace(/[^a-zA-Z0-9_]/g, "_");
      lines.push(`${indent}requirement def ${sanitizedId} {`);
      lines.push(`${indent}  doc /* ${req.text.replace(/\*\//g, "* /")} */`);
      if (req.limitValue !== undefined && req.comparator) {
        lines.push(`${indent}  attribute limitValue : Real = ${req.limitValue};`);
        lines.push(`${indent}  attribute comparator : String = "${req.comparator}";`);
      }
      if (req.asilLevel) {
        lines.push(`${indent}  attribute asil : String = "${req.asilLevel}";`);
      }
      if (req.children && req.children.length > 0) {
        for (const child of req.children) {
          renderReq(child, `${indent}  `);
        }
      }
      lines.push(`${indent}}`);
      lines.push("");
    };

    for (const req of spec.requirements) {
      renderReq(req, "  ");
    }

    // Render relations (satisfies, verifies)
    if (spec.relations && spec.relations.length > 0) {
      lines.push("  // ── Traceability Relations ──");
      for (const rel of spec.relations) {
        const src = rel.sourceId.replace(/[^a-zA-Z0-9_]/g, "_");
        const tgt = rel.targetId.replace(/[^a-zA-Z0-9_]/g, "_");
        if (rel.type.toLowerCase().includes("satisf")) {
          lines.push(`  satisfy ${tgt} by ${src};`);
        } else if (rel.type.toLowerCase().includes("verif")) {
          lines.push(`  verify ${tgt} by ${src};`);
        }
      }
      lines.push("");
    }

    lines.push(`}`);
    return lines.join("\n");
  }

  /**
   * Reconstructs a ReqIfSpecification from SysML v2 requirements source text.
   */
  static fromSysML2(sysmlSource: string, specTitle = "Exported SysML v2 Requirements"): ReqIfSpecification {
    const spec: ReqIfSpecification = {
      id: "SPEC_SYSML_01",
      title: specTitle,
      requirements: [],
      relations: [],
    };

    // 1. Match requirement defs
    const defHeaderRegex = /\brequirement\s+def\s+([a-zA-Z0-9_]+)\s*\{/g;
    let headerMatch: RegExpExecArray | null;

    while ((headerMatch = defHeaderRegex.exec(sysmlSource)) !== null) {
      const id = headerMatch[1];
      const bodyStart = headerMatch.index + headerMatch[0].length;
      let depth = 1;
      let pos = bodyStart;
      while (pos < sysmlSource.length && depth > 0) {
        if (sysmlSource[pos] === "{") depth++;
        else if (sysmlSource[pos] === "}") depth--;
        pos++;
      }
      const body = sysmlSource.slice(bodyStart, depth === 0 ? pos - 1 : pos);
      defHeaderRegex.lastIndex = pos;

      let text = id;
      const docIdx = body.indexOf("/*");
      if (docIdx !== -1) {
        const docEnd = body.indexOf("*/", docIdx + 2);
        if (docEnd !== -1) {
          text = body.slice(docIdx + 2, docEnd).trim();
        }
      }

      const limitMatch = body.match(/attribute\s+limitValue\s*:\s*Real\s*=\s*([0-9.]+)/);
      const compMatch = body.match(/attribute\s+comparator\s*:\s*String\s*=\s*"([^"]+)"/);
      const asilMatch = body.match(/attribute\s+asil\s*:\s*String\s*=\s*"([^"]+)"/);

      spec.requirements.push({
        id,
        name: id,
        text,
        attributes: {},
        limitValue: limitMatch ? parseFloat(limitMatch[1]) : undefined,
        comparator: compMatch ? (compMatch[1] as any) : undefined,
        asilLevel: asilMatch ? (asilMatch[1] as any) : undefined,
        status: "Approved",
      });
    }

    // 2. Match satisfy and verify statements
    const satisfyRegex = /satisfy\s+([a-zA-Z0-9_]+)\s+by\s+([a-zA-Z0-9_]+)\s*;/g;
    let satMatch: RegExpExecArray | null;
    let relCount = 1;
    while ((satMatch = satisfyRegex.exec(sysmlSource)) !== null) {
      spec.relations!.push({
        id: `REL_SAT_${relCount++}`,
        sourceId: satMatch[2],
        targetId: satMatch[1],
        type: "satisfies",
      });
    }

    const verifyRegex = /verify\s+([a-zA-Z0-9_]+)\s+by\s+([a-zA-Z0-9_]+)\s*;/g;
    let verMatch: RegExpExecArray | null;
    while ((verMatch = verifyRegex.exec(sysmlSource)) !== null) {
      spec.relations!.push({
        id: `REL_VER_${relCount++}`,
        sourceId: verMatch[2],
        targetId: verMatch[1],
        type: "verifies",
      });
    }

    return spec;
  }

  /**
   * Alias for emit(spec) to serialize requirements into ReqIF XML.
   */
  static generate(spec: ReqIfSpecification): string {
    return this.emit(spec);
  }

  /**
   * Generates a Modelica verification block with assertion checks for requirement limits.
   */
  static toModelicaVerifier(spec: ReqIfSpecification, modelName = "RequirementsVerifier"): string {
    const lines: string[] = [];
    lines.push(`model ${modelName}`);
    lines.push(`  // Auto-generated verification model from ReqIF specification: ${spec.title}`);
    lines.push(`  extends Modelica.Icons.Example;`);
    lines.push("");

    const reqsWithLimits: ReqIfRequirement[] = [];
    const collect = (list: ReqIfRequirement[]) => {
      for (const r of list) {
        if (r.limitValue !== undefined && r.comparator) {
          reqsWithLimits.push(r);
        }
        if (r.children) collect(r.children);
      }
    };
    collect(spec.requirements);

    for (const r of reqsWithLimits) {
      const sanitized = r.id.replace(/[^a-zA-Z0-9_]/g, "_");
      lines.push(`  Modelica.Blocks.Interfaces.RealInput val_${sanitized} "Monitored signal for ${r.name || r.id}";`);
      lines.push(`  parameter Real limit_${sanitized} = ${r.limitValue} "Limit value";`);
      lines.push(`  Boolean pass_${sanitized};`);
    }

    lines.push("");
    lines.push("equation");
    for (const r of reqsWithLimits) {
      const sanitized = r.id.replace(/[^a-zA-Z0-9_]/g, "_");
      const comp = r.comparator || "<=";
      lines.push(`  pass_${sanitized} = val_${sanitized} ${comp} limit_${sanitized};`);
      lines.push(
        `  assert(pass_${sanitized}, "Requirement ${r.id} violated: " + String(val_${sanitized}) + " ${comp} " + String(limit_${sanitized}));`,
      );
    }

    lines.push(`end ${modelName};`);
    return lines.join("\n");
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(str: string): string {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
