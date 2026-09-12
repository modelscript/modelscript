// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Native OMG ReqIF 1.2 (Requirements Interchange Format) Parser & Generator.
 *
 * Implements requirements ingestion and export across the Digital Thread,
 * mapping DOORS / Polarion / Jama requirements into SysML v2 and Modelica verifier models.
 */

export interface ReqIfAttribute {
  name: string;
  type: "String" | "Real" | "Integer" | "Boolean" | "Enumeration";
  value: string | number | boolean;
}

export interface ReqIfRequirement {
  id: string;
  name: string;
  text: string;
  type?: string;
  attributes: Record<string, string | number | boolean>;
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
    };

    // Extract title from REQ-IF-HEADER or SPECIFICATION
    const titleMatch = xmlString.match(/<TITLE>(.*?)<\/TITLE>/i) || xmlString.match(/LONG-NAME="([^"]+)"/i);
    if (titleMatch) {
      spec.title = titleMatch[1];
    }

    // Extract SPEC-OBJECT blocks
    const specObjRegex = /<SPEC-OBJECT\b([^>]*)>([\s\S]*?)<\/SPEC-OBJECT>/gi;
    let match: RegExpExecArray | null;

    while ((match = specObjRegex.exec(xmlString)) !== null) {
      const attrsStr = match[1];
      const body = match[2];

      const idMatch = attrsStr.match(/IDENTIFIER="([^"]+)"/i);
      const id = idMatch ? idMatch[1] : `REQ-${spec.requirements.length + 1}`;

      const nameMatch = body.match(/<THE-VALUE>(.*?)<\/THE-VALUE>/i) || attrsStr.match(/LONG-NAME="([^"]+)"/i);
      const name = nameMatch ? nameMatch[1] : id;

      // Extract text content
      let text = name;
      const descMatch = body.match(
        /<(?:ATTRIBUTE-VALUE-XHTML|ATTRIBUTE-VALUE-STRING)[\s\S]*?<THE-VALUE>(.*?)<\/THE-VALUE>/i,
      );
      if (descMatch) {
        text = descMatch[1].replace(/<[^>]+>/g, "").trim();
      }

      // Extract custom attributes (e.g. ASIL, Limit, Comparator)
      const attributes: Record<string, string | number | boolean> = {};
      const valRegex =
        /<ATTRIBUTE-VALUE-(?:STRING|REAL|INTEGER|BOOLEAN)\s+ATTRIBUTE-DEFINITION="([^"]+)">[\s\S]*?<THE-VALUE>(.*?)<\/THE-VALUE>/gi;
      let valMatch: RegExpExecArray | null;
      while ((valMatch = valRegex.exec(body)) !== null) {
        const attrName = valMatch[1];
        const rawVal = valMatch[2];
        if (!isNaN(Number(rawVal)) && rawVal.trim() !== "") {
          attributes[attrName] = Number(rawVal);
        } else if (rawVal.toLowerCase() === "true" || rawVal.toLowerCase() === "false") {
          attributes[attrName] = rawVal.toLowerCase() === "true";
        } else {
          attributes[attrName] = rawVal;
        }
      }

      // Check for numeric limit / comparison heuristics in requirement text
      let limitValue: number | undefined;
      let comparator: ReqIfRequirement["comparator"] = undefined;
      const compMatch = text.match(/(?:>=|<=|>|<|==|!=|\bexceed\b|\bat least\b|\bmaximum\b|\bminimum\b)\s*([\d.]+)/i);
      if (compMatch) {
        limitValue = parseFloat(compMatch[1]);
        if (text.includes(">=") || text.includes("at least")) comparator = ">=";
        else if (text.includes("<=") || text.includes("maximum")) comparator = "<=";
        else if (text.includes(">") || text.includes("exceed")) comparator = ">";
        else if (text.includes("<")) comparator = "<";
        else comparator = "<=";
      }

      const asil = (attributes["ASIL"] ||
        attributes["asil"] ||
        text.match(/ASIL-[ABCD]/i)?.[0]) as ReqIfRequirement["asilLevel"];

      spec.requirements.push({
        id,
        name,
        text,
        attributes,
        asilLevel: asil,
        limitValue,
        comparator,
        status: "Approved",
      });
    }

    return spec;
  }

  /**
   * Serializes requirements into standard OMG ReqIF 1.2 XML format.
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
    lines.push("      <SPEC-OBJECTS>");

    for (const req of spec.requirements) {
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

      for (const [k, v] of Object.entries(req.attributes)) {
        if (k !== "Description" && k !== "ASIL" && k !== "LimitValue") {
          lines.push(`            <ATTRIBUTE-VALUE-STRING ATTRIBUTE-DEFINITION="${escapeXml(k)}">`);
          lines.push(`              <THE-VALUE>${escapeXml(String(v))}</THE-VALUE>`);
          lines.push("            </ATTRIBUTE-VALUE-STRING>");
        }
      }

      lines.push("          </VALUES>");
      lines.push("        </SPEC-OBJECT>");
    }

    lines.push("      </SPEC-OBJECTS>");
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
    const pkgName = spec.title.replace(/[^a-zA-Z0-9_]/g, "") || "RequirementsPackage";

    lines.push(`package ${pkgName} {`);

    for (const req of spec.requirements) {
      const sanitizedId = req.id.replace(/[^a-zA-Z0-9_]/g, "_");
      lines.push(`  requirement def ${sanitizedId} {`);
      lines.push(`    doc /* ${req.text.replace(/\*\//g, "* /")} */`);
      if (req.limitValue !== undefined && req.comparator) {
        lines.push(`    attribute limitValue : Real = ${req.limitValue};`);
        lines.push(`    attribute comparator : String = "${req.comparator}";`);
      }
      if (req.asilLevel) {
        lines.push(`    attribute asil : String = "${req.asilLevel}";`);
      }
      lines.push(`  }`);
      lines.push("");
    }

    lines.push(`}`);
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
