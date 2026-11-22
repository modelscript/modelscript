// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/magicdraw — SysML 1.x (.mdzip / .mdxml / .xmi) → SysML v2 (.sysml) Projection.
 *
 * Converts MagicDraw / Cameo SysML 1.x models into clean, idiomatic OMG SysML v2 textual syntax:
 * - uml:Package → package
 * - «block» → part def
 * - «interfaceBlock» → port def
 * - «valueType» → attribute def
 * - «constraintBlock» → constraint def
 * - «requirement» → requirement def
 * - «satisfy» / «verify» / «allocate» → satisfy / verify / allocate
 * - uml:StateMachine → state def
 */

import { parseMagicDraw } from "../parser/index.js";
import { lookupUmlPrimitive } from "../profiles/index.js";
import type { MagicDrawDocument, UmlClassifier, UmlPackage, UmlStateMachine } from "../types.js";

function sanitizeIdent(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9_]/g, "_");
  if (!cleaned) return "Unnamed";
  if (/^[0-9]/.test(cleaned)) return `_${cleaned}`;
  return cleaned;
}

function escapeDocString(text: string): string {
  return text.replace(/\*\//g, "* /");
}

function mapTypeToSysml2(typeName: string | undefined): string {
  if (!typeName) return "ScalarValues::Real";
  const prim = lookupUmlPrimitive(typeName);
  if (prim) return prim.sysml2Type;
  return sanitizeIdent(typeName);
}

function emitClassifier(cls: UmlClassifier, doc: MagicDrawDocument, indent: string): string[] {
  const lines: string[] = [];
  const name = sanitizeIdent(cls.name);
  const superNames = cls.generalizationIds
    .map((gid) => doc.classifiers.get(gid)?.name)
    .filter((n): n is string => Boolean(n))
    .map(sanitizeIdent);
  const specClause = superNames.length > 0 ? ` :> ${superNames.join(", ")}` : "";
  const abstractKw = cls.isAbstract ? "abstract " : "";

  if (cls.kind === "Requirement") {
    const reqId = cls.requirementId ? `<'${cls.requirementId.replace(/'/g, "\\'")}'> ` : "";
    lines.push(`${indent}requirement def ${reqId}${name}${specClause} {`);
    if (cls.requirementText) {
      lines.push(`${indent}  doc /* ${escapeDocString(cls.requirementText)} */`);
    }
    lines.push(`${indent}}`);
    return lines;
  }

  if (cls.kind === "ValueType" || cls.kind === "DataType") {
    lines.push(`${indent}attribute def ${name}${specClause};`);
    return lines;
  }

  if (cls.kind === "Enumeration") {
    lines.push(`${indent}enum def ${name} {`);
    for (const lit of cls.literals) {
      lines.push(`${indent}  enum ${sanitizeIdent(lit)};`);
    }
    lines.push(`${indent}}`);
    return lines;
  }

  if (cls.kind === "ConstraintBlock") {
    lines.push(`${indent}constraint def ${name}${specClause} {`);
    for (const prop of cls.properties) {
      lines.push(`${indent}  in ${sanitizeIdent(prop.name)} : ${mapTypeToSysml2(prop.typeRef?.resolvedName)};`);
    }
    for (const c of cls.constraints) {
      if (c.body.trim()) {
        const sysmlExpr = c.body.trim().replace(/(?<![=!<>])=(?!=)/g, "==");
        lines.push(`${indent}  ${sysmlExpr}`);
      }
    }
    lines.push(`${indent}}`);
    return lines;
  }

  if (cls.kind === "InterfaceBlock" || cls.kind === "Interface") {
    lines.push(`${indent}port def ${name}${specClause} {`);
    for (const prop of cls.properties) {
      const dir = prop.direction ? `${prop.direction} ` : "";
      lines.push(
        `${indent}  ${dir}attribute ${sanitizeIdent(prop.name)} : ${mapTypeToSysml2(prop.typeRef?.resolvedName)};`,
      );
    }
    lines.push(`${indent}}`);
    return lines;
  }

  // Block / Class
  lines.push(`${indent}${abstractKw}part def ${name}${specClause} {`);
  if (cls.documentation) {
    lines.push(`${indent}  doc /* ${escapeDocString(cls.documentation)} */`);
  }

  for (const pt of cls.ports) {
    const conj = pt.isConjugated ? "~" : "";
    const pType = pt.typeRef?.resolvedName ? ` : ${conj}${sanitizeIdent(pt.typeRef.resolvedName)}` : "";
    lines.push(`${indent}  port ${sanitizeIdent(pt.name)}${pType};`);
  }

  for (const prop of cls.properties) {
    const pName = sanitizeIdent(prop.name);
    const tName = mapTypeToSysml2(prop.typeRef?.resolvedName);
    const defVal = prop.defaultValue !== undefined && prop.defaultValue !== "" ? ` = ${prop.defaultValue}` : "";
    if (prop.compartment === "parts") {
      lines.push(`${indent}  part ${pName} : ${tName};`);
    } else if (prop.compartment === "references") {
      lines.push(`${indent}  ref part ${pName} : ${tName};`);
    } else if (prop.compartment === "constraints") {
      lines.push(`${indent}  assert constraint ${pName} : ${tName};`);
    } else {
      lines.push(`${indent}  attribute ${pName} : ${tName}${defVal};`);
    }
  }

  for (const conn of cls.connectors) {
    if (conn.ends.length >= 2) {
      const e0 = conn.ends[0]!;
      const e1 = conn.ends[1]!;
      const formatEnd = (e: typeof e0): string => {
        const partName = e.partWithPortId ? doc.elementsById.get(e.partWithPortId)?.name : undefined;
        const roleName = e.roleId ? doc.elementsById.get(e.roleId)?.name : undefined;
        if (partName && roleName) return `${sanitizeIdent(partName)}.${sanitizeIdent(roleName)}`;
        return sanitizeIdent(roleName ?? partName ?? "end");
      };
      if (conn.kind === "binding") {
        lines.push(`${indent}  bind ${formatEnd(e0)} = ${formatEnd(e1)};`);
      } else {
        lines.push(`${indent}  connection connect ${formatEnd(e0)} to ${formatEnd(e1)};`);
      }
    }
  }

  // Emit satisfy relationships originating from this block
  for (const rel of doc.relationships) {
    if (rel.sourceId === cls.id && rel.kind === "satisfy") {
      const targetName = doc.elementsById.get(rel.targetId)?.name;
      if (targetName) {
        lines.push(`${indent}  satisfy ${sanitizeIdent(targetName)};`);
      }
    }
  }

  lines.push(`${indent}}`);
  return lines;
}

function emitStateMachine(sm: UmlStateMachine, indent: string): string[] {
  const lines: string[] = [];
  const stateNameById = new Map(sm.states.map((s) => [s.id, sanitizeIdent(s.name)]));
  lines.push(`${indent}state def ${sanitizeIdent(sm.name)} {`);
  for (const st of sm.states) {
    if (st.kind === "initial" || st.kind === "final") continue;
    lines.push(`${indent}  state ${sanitizeIdent(st.name)};`);
  }
  for (const tr of sm.transitions) {
    const src = stateNameById.get(tr.sourceId);
    const dst = stateNameById.get(tr.targetId);
    if (!src || !dst) continue;
    const srcState = sm.states.find((s) => s.id === tr.sourceId);
    if (srcState?.kind === "initial") {
      lines.push(`${indent}  entry; then ${dst};`);
    } else {
      lines.push(`${indent}  transition first ${src} then ${dst};`);
    }
  }
  lines.push(`${indent}}`);
  return lines;
}

function emitPackage(pkg: UmlPackage, doc: MagicDrawDocument, indent: string): string[] {
  const lines: string[] = [];
  lines.push(`${indent}package ${sanitizeIdent(pkg.name)} {`);

  for (const clsId of pkg.classifierIds) {
    const cls = doc.classifiers.get(clsId);
    if (cls) {
      lines.push(...emitClassifier(cls, doc, `${indent}  `));
      lines.push("");
    }
  }

  for (const smId of pkg.stateMachineIds) {
    const sm = doc.stateMachines.get(smId);
    if (sm) {
      lines.push(...emitStateMachine(sm, `${indent}  `));
      lines.push("");
    }
  }

  for (const childPkgId of pkg.childPackageIds) {
    const childPkg = doc.packages.get(childPkgId);
    if (childPkg) {
      lines.push(...emitPackage(childPkg, doc, `${indent}  `));
      lines.push("");
    }
  }

  lines.push(`${indent}}`);
  return lines;
}

/**
 * Projects a MagicDraw `.mdzip` / `.mdxml` / `.xmi` model to textual OMG SysML v2 (`.sysml`).
 */
export function magicDrawToSysml2(docOrText: MagicDrawDocument | string): string {
  const doc = typeof docOrText === "string" ? parseMagicDraw(docOrText) : docOrText;
  const header = `// Projected from MagicDraw / SysML 1.x (${doc.metadata.projectName ?? "Model"}) by @modelscript/magicdraw\n`;

  const topPackages = Array.from(doc.packages.values()).filter((p) => !p.ownerId);
  if (topPackages.length === 0) {
    return `${header}package ${sanitizeIdent(doc.metadata.projectName ?? "MagicDrawModel")} {\n}\n`;
  }

  const body = topPackages.flatMap((p) => emitPackage(p, doc, "")).join("\n");
  return `${header}${body}\n`;
}
