// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/reqif — SysML v2 Bidirectional Projection.
 *
 * Translates between OMG ReqIF 1.2 specifications and KerML / SysML v2
 * requirement definitions, usages, and satisfactions.
 */

import type { ReqIfDocument, ReqIfSpecObject } from "../types.js";

function sanitizeIdent(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `REQ_${cleaned}` : cleaned;
}

/**
 * Translates a ReqIF specification document into standard SysML v2 text.
 */
export function reqifToSysml2(doc: ReqIfDocument): string {
  const lines: string[] = [];
  const pkgName = sanitizeIdent(doc.header.title || "RequirementsPackage");

  lines.push(`package ${pkgName} {`);
  lines.push(`  doc /* ${doc.header.title} (ReqIF v${doc.header.reqIfVersion}) */`);
  lines.push("");

  // 1. Requirement Definitions & Usages
  for (const obj of doc.specObjects.values()) {
    const ident = sanitizeIdent(obj.identifier);
    const defName = `${ident}_Def`;

    lines.push(`  requirement def ${defName} {`);
    lines.push(`    doc /* ${obj.text.replace(/\*\//g, "* /")} */`);
    if (obj.asilLevel) {
      lines.push(`    attribute asilLevel : String = "${obj.asilLevel}";`);
    }

    if (obj.contract) {
      const c = obj.contract;
      lines.push(`    attribute ${sanitizeIdent(c.variable)} : Scalar;`);
      lines.push(`    require constraint { ${sanitizeIdent(c.variable)} ${c.comparator} ${c.limitValue} }`);
    }
    lines.push(`  }`);
    lines.push(`  requirement ${ident} : ${defName};`);
    lines.push("");
  }

  // 2. Relations (satisfaction, verification, refinement)
  if (doc.specRelations.length > 0) {
    lines.push("  // ── Traceability & Satisfaction Links ──");
    for (const rel of doc.specRelations) {
      const src = sanitizeIdent(rel.sourceId);
      const tgt = sanitizeIdent(rel.targetId);

      if (rel.relationType === "satisfies") {
        lines.push(`  satisfy ${tgt} by ${src};`);
      } else if (rel.relationType === "verifies") {
        lines.push(`  verify ${tgt} by ${src};`);
      } else if (rel.relationType === "refines") {
        lines.push(`  // connection ${src} refines ${tgt}`);
      }
    }
    lines.push("");
  }

  lines.push(`}`);
  return lines.join("\n");
}

/**
 * Parses SysML v2 requirement definitions and creates a ReqIfDocument.
 */
export function sysml2ToReqIf(sysmlText: string, title = "Imported from SysML v2"): ReqIfDocument {
  const specObjects = new Map<string, ReqIfSpecObject>();

  const defStartPattern = /requirement\s+def\s+([a-zA-Z0-9_]+)\b[^{]*\{/g;
  let match: RegExpExecArray | null;

  while ((match = defStartPattern.exec(sysmlText)) !== null) {
    const rawId = match[1]!;
    const openBraceIdx = defStartPattern.lastIndex - 1;
    let depth = 1;
    let closeBraceIdx = openBraceIdx + 1;
    while (closeBraceIdx < sysmlText.length && depth > 0) {
      if (sysmlText[closeBraceIdx] === "{") depth++;
      else if (sysmlText[closeBraceIdx] === "}") depth--;
      closeBraceIdx++;
    }
    const body = sysmlText.slice(openBraceIdx + 1, closeBraceIdx - 1);
    defStartPattern.lastIndex = closeBraceIdx;

    let text = rawId;
    const docMatch = body.match(/doc\s*\/\*([\s\S]*?)\*\//);
    if (docMatch) {
      text = docMatch[1]!.trim();
    }

    let contract: ReqIfSpecObject["contract"] = undefined;
    const constraintMatch = body.match(
      /require\s+constraint\s*\{\s*([a-zA-Z0-9_]+)\s*(<=|<|>=|>|==|!=)\s*([-+]?[0-9]*\.?[0-9]+)\s*\}/,
    );
    if (constraintMatch) {
      contract = {
        variable: constraintMatch[1]!,
        comparator: constraintMatch[2]! as any,
        limitValue: parseFloat(constraintMatch[3]!),
      };
    }

    const id = rawId.endsWith("_Def") ? rawId.slice(0, -4) : rawId;
    specObjects.set(id, {
      identifier: id,
      longName: id,
      text,
      attributes: new Map(),
      contract,
    });
  }

  return {
    header: {
      identifier: `REQIF-${Date.now()}`,
      reqIfVersion: "1.2",
      title,
      creationTime: new Date().toISOString(),
    },
    dataTypes: new Map(),
    specTypes: new Map(),
    specObjects,
    specRelations: [],
    specifications: [
      {
        identifier: "SPEC-01",
        longName: title,
        children: Array.from(specObjects.keys()).map((id) => ({
          identifier: `HIER-${id}`,
          objectRef: id,
          children: [],
        })),
      },
    ],
  };
}
