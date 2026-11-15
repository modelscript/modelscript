// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParserSync, type SyntaxNode } from "@modelscript/automationml/aml-dsl-wasm-parser";
import { createRequire } from "node:module";
import type {
  AmlAttribute,
  AmlAttributeType,
  AmlAttributeTypeLib,
  AmlDocument,
  AmlExternalInterface,
  AmlFrame,
  AmlInstanceHierarchy,
  AmlInterfaceCategory,
  AmlInterfaceClass,
  AmlInterfaceClassLib,
  AmlInternalElement,
  AmlInternalLink,
  AmlPortDirection,
  AmlPprCategory,
  AmlRoleClass,
  AmlRoleClassLib,
  AmlRoleRequirement,
  AmlSchemaVersion,
  AmlSourceRange,
  AmlSystemUnitClass,
  AmlSystemUnitClassLib,
} from "../types.js";

const require = createRequire(import.meta.url);
let cachedAmlDslParser: ReturnType<typeof createWasmParserSync>["parser"] | undefined;

function getAmlDslParser(): ReturnType<typeof createWasmParserSync>["parser"] {
  if (!cachedAmlDslParser) {
    const wasmPath = require.resolve("@modelscript/automationml/aml-dsl-parser.wasm");
    cachedAmlDslParser = createWasmParserSync(wasmPath).parser;
  }
  return cachedAmlDslParser;
}

export interface AmlDslParseHelpers {
  makeRange: (source: string, startOffset: number, endOffset: number) => AmlSourceRange;
  parseScalarValue: (raw: string | undefined, dataType?: string) => string | number | boolean | undefined;
  inferInterfaceCategory: (refBaseClassPath: string, explicitCategory?: string) => AmlInterfaceCategory;
  normalizeDirection: (raw?: string) => AmlPortDirection;
  inferPprCategory: (explicit?: string, rolePaths?: string[]) => AmlPprCategory | undefined;
}

function unquote(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Collects direct CST nodes of interest while transparently descending through invisible
 * GLR list chunks (`repeat`) and `ClassBody`, without crossing nested boundary rules.
 */
function collectScopedNodes(
  parent: SyntaxNode,
  targetTypes: ReadonlySet<string>,
  stopTypes: ReadonlySet<string>,
  out: SyntaxNode[] = [],
): SyntaxNode[] {
  for (const child of parent.children) {
    if (targetTypes.has(child.type)) {
      out.push(child);
      continue;
    }
    if (stopTypes.has(child.type)) {
      continue;
    }
    collectScopedNodes(child, targetTypes, stopTypes, out);
  }
  return out;
}

const ALL_DECL_STOPS = new Set([
  "AmlHeader",
  "RoleClassLibDecl",
  "RoleClassDecl",
  "InterfaceClassLibDecl",
  "InterfaceClassDecl",
  "SystemUnitClassLibDecl",
  "SystemUnitClassDecl",
  "AttributeTypeLibDecl",
  "InstanceHierarchyDecl",
  "ElementDecl",
]);

function parseCstAttribute(source: string, node: SyntaxNode, h: AmlDslParseHelpers): AmlAttribute {
  const nameNode = node.childForFieldName("name");
  const typeNode = node.childForFieldName("dataType");
  const valNode = node.childForFieldName("value");
  const unitNode = node.children.find((c) => c.type === "UnitSpec");

  const name = nameNode ? unquote(nameNode.text) : "UnnamedAttribute";
  const dataType = typeNode ? unquote(typeNode.text) : undefined;
  const rawVal = valNode ? unquote(valNode.text) : undefined;
  const value = h.parseScalarValue(rawVal, dataType);

  let unit: string | undefined;
  if (unitNode) {
    const inner = source.slice(unitNode.startIndex, unitNode.endIndex).trim();
    if (inner.startsWith("[") && inner.endsWith("]")) {
      unit = inner.slice(1, -1).trim();
    }
  }

  return {
    name,
    dataType,
    unit,
    value,
    range: h.makeRange(source, node.startIndex, node.endIndex),
  };
}

function parseCstInterface(
  source: string,
  node: SyntaxNode,
  parentId: string,
  h: AmlDslParseHelpers,
): AmlExternalInterface {
  const nameNode = node.childForFieldName("name");
  const name = nameNode ? unquote(nameNode.text) : "UnnamedInterface";

  let refBaseClassPath = "AutomationMLInterfaceClassLib/AutomationMLBaseInterface/SignalInterface";
  let direction: AmlPortDirection = "InOut";
  let explicitCat: string | undefined;
  let dataType: string | undefined;
  let refUri: string | undefined;
  let customId: string | undefined;

  const extendsNode = node.children.find((c) => c.type === "ExtendsClause");
  if (extendsNode) {
    const baseNode = extendsNode.childForFieldName("base");
    if (baseNode) refBaseClassPath = unquote(baseNode.text);
  }

  const attrClauses = collectScopedNodes(node, new Set(["InterfaceAttrClause"]), new Set(["ExtendsClause"]));
  for (const attrClause of attrClauses) {
    const k = attrClause.childForFieldName("key")?.text.trim().toLowerCase();
    const vNode = attrClause.childForFieldName("value");
    if (!k || !vNode) continue;
    const v = unquote(vNode.text);
    if (k === "uri") refUri = v;
    else if (k === "id") customId = v;
    else if (k === "category") explicitCat = v;
    else if (k === "direction") direction = h.normalizeDirection(v);
  }

  // Collect specifier tokens following `:` (direction, category, or dataType)
  const specStops = new Set(["ExtendsClause", "InterfaceAttrClause"]);
  let seenColon = false;
  const specTokens: string[] = [];
  const visitSpecs = (cur: SyntaxNode): void => {
    for (const ch of cur.children) {
      if (ch === nameNode || specStops.has(ch.type)) continue;
      if (ch.type === ":" || ch.text.trim() === ":") {
        seenColon = true;
        continue;
      }
      if (!seenColon) continue;
      if (ch.type === "StringLiteral" || ch.type === "Identifier" || ch.children.length === 0) {
        const t = unquote(ch.text);
        if (t && t !== ";" && t !== ":") specTokens.push(t);
      } else {
        visitSpecs(ch);
      }
    }
  };
  visitSpecs(node);

  for (const tok of specTokens) {
    const lower = tok.toLowerCase();
    if (lower === "in" || lower === "out" || lower === "inout") {
      direction = h.normalizeDirection(tok);
    } else if (
      lower === "signal" ||
      lower === "plcopenxml" ||
      lower === "collada" ||
      lower === "fmu" ||
      lower === "order" ||
      lower === "energy"
    ) {
      explicitCat = tok;
      if (!extendsNode) {
        if (lower === "plcopenxml") {
          refBaseClassPath = "AutomationMLInterfaceClassLib/AutomationMLBaseInterface/PLCopenXMLInterface";
        } else if (lower === "collada") {
          refBaseClassPath = "AutomationMLInterfaceClassLib/AutomationMLBaseInterface/COLLADAInterface";
        } else if (lower === "order") {
          refBaseClassPath = "AutomationMLInterfaceClassLib/AutomationMLBaseInterface/Order";
        } else if (lower === "energy") {
          refBaseClassPath = "AutomationMLInterfaceClassLib/AutomationMLBaseInterface/ExternalDataConnector";
        }
      }
    } else {
      dataType = tok;
    }
  }

  const category = h.inferInterfaceCategory(refBaseClassPath, explicitCat);
  return {
    id: customId ?? `${parentId}:${name}`,
    name,
    refBaseClassPath,
    direction,
    dataType,
    refUri,
    category,
    range: h.makeRange(source, node.startIndex, node.endIndex),
  };
}

function parseCstFrame(source: string, node: SyntaxNode, h: AmlDslParseHelpers): AmlFrame {
  const frame: AmlFrame = {
    x: 0,
    y: 0,
    z: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    range: h.makeRange(source, node.startIndex, node.endIndex),
  };
  const fields = collectScopedNodes(node, new Set(["FrameField"]), new Set());
  for (const f of fields) {
    const axis = f.childForFieldName("axis")?.text.trim().toLowerCase();
    const rawVal = f.childForFieldName("value")?.text;
    const val = rawVal ? Number.parseFloat(unquote(rawVal)) : 0;
    const safe = Number.isFinite(val) ? val : 0;
    if (axis === "x") frame.x = safe;
    else if (axis === "y") frame.y = safe;
    else if (axis === "z") frame.z = safe;
    else if (axis === "rx") frame.rx = safe;
    else if (axis === "ry") frame.ry = safe;
    else if (axis === "rz") frame.rz = safe;
  }
  return frame;
}

function extractIdentList(clauseNode: SyntaxNode): string[] {
  const out: string[] = [];
  const items = collectScopedNodes(clauseNode, new Set(["StringLiteral", "Identifier"]), new Set());
  for (const item of items) {
    const v = unquote(item.text);
    if (v) out.push(v);
  }
  return out;
}

function parseCstRoleReq(source: string, node: SyntaxNode, h: AmlDslParseHelpers): AmlRoleRequirement {
  const roleNode = node.childForFieldName("rolePath");
  const refBaseRoleClassPath = roleNode ? unquote(roleNode.text) : "";
  const requiredInterfaces: string[] = [];
  const requiredAttributes: string[] = [];

  for (const clause of collectScopedNodes(
    node,
    new Set(["RequiresInterfacesClause", "RequiresAttributesClause"]),
    new Set(),
  )) {
    const listNode = clause.children.find((c) => c.type === "IdentList");
    if (!listNode) continue;
    if (clause.type === "RequiresInterfacesClause") {
      requiredInterfaces.push(...extractIdentList(listNode));
    } else {
      requiredAttributes.push(...extractIdentList(listNode));
    }
  }

  return {
    refBaseRoleClassPath,
    requiredInterfaces,
    requiredAttributes,
    range: h.makeRange(source, node.startIndex, node.endIndex),
  };
}

function formatEndpointRef(node: SyntaxNode | null): string {
  if (!node) return "";
  const el = node.childForFieldName("element");
  const port = node.childForFieldName("port");
  const elStr = el ? unquote(el.text) : "";
  return port ? `${elStr}:${unquote(port.text)}` : elStr;
}

function parseCstLink(source: string, node: SyntaxNode, h: AmlDslParseHelpers): AmlInternalLink {
  const nameNode = node.childForFieldName("name");
  const sideANode = node.childForFieldName("sideA");
  const sideBNode = node.childForFieldName("sideB");
  const refPartnerSideA = formatEndpointRef(sideANode);
  const refPartnerSideB = formatEndpointRef(sideBNode);
  const name = nameNode
    ? unquote(nameNode.text)
    : refPartnerSideA && refPartnerSideB
      ? `${refPartnerSideA}_to_${refPartnerSideB}`
      : "Link";
  return {
    name,
    refPartnerSideA,
    refPartnerSideB,
    range: h.makeRange(source, node.startIndex, node.endIndex),
  };
}

function parseCstElement(source: string, node: SyntaxNode, h: AmlDslParseHelpers): AmlInternalElement {
  const nameNode = node.childForFieldName("name");
  const sysUnitNode = node.childForFieldName("sysUnit");
  const name = nameNode ? unquote(nameNode.text) : "InternalElement";
  const refBaseSystemUnitPath = sysUnitNode ? unquote(sysUnitNode.text) : undefined;

  let customId: string | undefined;
  let explicitPpr: string | undefined;
  const metaNode = node.children.find((c) => c.type === "ElementMeta");
  if (metaNode) {
    for (const entry of collectScopedNodes(metaNode, new Set(["MetaEntry"]), new Set())) {
      const k = entry.childForFieldName("key")?.text.trim().toLowerCase();
      const v = entry.childForFieldName("value");
      if (!k || !v) continue;
      if (k === "id") customId = unquote(v.text);
      else if (k === "ppr") explicitPpr = unquote(v.text);
    }
  }

  const finalId = customId ?? name;
  const roleRequirements: AmlRoleRequirement[] = [];
  let frame: AmlFrame | undefined;
  const attributes: AmlAttribute[] = [];
  const interfaces: AmlExternalInterface[] = [];
  const internalLinks: AmlInternalLink[] = [];
  const children: AmlInternalElement[] = [];

  const stmts = collectScopedNodes(
    node,
    new Set([
      "ElementDecl",
      "RoleReqStmt",
      "SupportedRoleStmt",
      "FrameStmt",
      "AttributeStmt",
      "InterfaceStmt",
      "LinkStmt",
    ]),
    ALL_DECL_STOPS,
  );

  for (const stmt of stmts) {
    if (stmt.type === "ElementDecl") {
      children.push(parseCstElement(source, stmt, h));
    } else if (stmt.type === "RoleReqStmt" || stmt.type === "SupportedRoleStmt") {
      roleRequirements.push(parseCstRoleReq(source, stmt, h));
    } else if (stmt.type === "FrameStmt") {
      frame = parseCstFrame(source, stmt, h);
    } else if (stmt.type === "AttributeStmt") {
      attributes.push(parseCstAttribute(source, stmt, h));
    } else if (stmt.type === "InterfaceStmt") {
      interfaces.push(parseCstInterface(source, stmt, finalId, h));
    } else if (stmt.type === "LinkStmt") {
      internalLinks.push(parseCstLink(source, stmt, h));
    }
  }

  const pprCategory = h.inferPprCategory(
    explicitPpr,
    roleRequirements.map((r) => r.refBaseRoleClassPath),
  );

  return {
    id: finalId,
    name,
    refBaseSystemUnitPath,
    roleRequirements,
    pprCategory,
    frame,
    attributes,
    interfaces,
    internalLinks,
    children,
    range: h.makeRange(source, node.startIndex, node.endIndex),
  };
}

function parseCstRoleClass(source: string, node: SyntaxNode, h: AmlDslParseHelpers): AmlRoleClass {
  const name = unquote(node.childForFieldName("name")?.text ?? "RoleClass");
  const baseNode = node.childForFieldName("base");
  const refBaseClassPath = baseNode ? unquote(baseNode.text) : undefined;

  const attributes: AmlAttribute[] = [];
  const interfaces: AmlExternalInterface[] = [];
  const children: AmlRoleClass[] = [];

  const body = node.children.find((c) => c.type === "ClassBody");
  if (body) {
    for (const stmt of collectScopedNodes(
      body,
      new Set(["RoleClassDecl", "AttributeStmt", "InterfaceStmt"]),
      ALL_DECL_STOPS,
    )) {
      if (stmt.type === "RoleClassDecl") children.push(parseCstRoleClass(source, stmt, h));
      else if (stmt.type === "AttributeStmt") attributes.push(parseCstAttribute(source, stmt, h));
      else if (stmt.type === "InterfaceStmt") interfaces.push(parseCstInterface(source, stmt, name, h));
    }
  }

  return {
    name,
    refBaseClassPath,
    pprCategory: h.inferPprCategory(undefined, refBaseClassPath ? [refBaseClassPath, name] : [name]),
    attributes,
    interfaces,
    children,
    range: h.makeRange(source, node.startIndex, node.endIndex),
  };
}

function parseCstInterfaceClass(source: string, node: SyntaxNode, h: AmlDslParseHelpers): AmlInterfaceClass {
  const name = unquote(node.childForFieldName("name")?.text ?? "InterfaceClass");
  const baseNode = node.childForFieldName("base");
  const refBaseClassPath = baseNode ? unquote(baseNode.text) : undefined;

  let explicitCat: string | undefined;
  let explicitDir: AmlPortDirection | undefined;
  const attributes: AmlAttribute[] = [];
  const children: AmlInterfaceClass[] = [];

  const body = node.children.find((c) => c.type === "ClassBody");
  if (body) {
    for (const stmt of collectScopedNodes(
      body,
      new Set(["InterfaceClassDecl", "AttributeStmt", "CategoryStmt", "DirectionStmt"]),
      ALL_DECL_STOPS,
    )) {
      if (stmt.type === "InterfaceClassDecl") {
        children.push(parseCstInterfaceClass(source, stmt, h));
      } else if (stmt.type === "AttributeStmt") {
        attributes.push(parseCstAttribute(source, stmt, h));
      } else if (stmt.type === "CategoryStmt") {
        const v = stmt.childForFieldName("value");
        if (v) explicitCat = unquote(v.text);
      } else if (stmt.type === "DirectionStmt") {
        const v = stmt.childForFieldName("value");
        if (v) explicitDir = h.normalizeDirection(unquote(v.text));
      }
    }
  }

  return {
    name,
    refBaseClassPath,
    category: h.inferInterfaceCategory(refBaseClassPath ?? name, explicitCat),
    direction: explicitDir,
    attributes,
    children,
    range: h.makeRange(source, node.startIndex, node.endIndex),
  };
}

function parseCstSystemUnitClass(source: string, node: SyntaxNode, h: AmlDslParseHelpers): AmlSystemUnitClass {
  const name = unquote(node.childForFieldName("name")?.text ?? "SystemUnitClass");
  const baseNode = node.childForFieldName("base");
  const refBaseClassPath = baseNode ? unquote(baseNode.text) : undefined;

  const supportedRoleClassPaths: string[] = [];
  const attributes: AmlAttribute[] = [];
  const interfaces: AmlExternalInterface[] = [];
  const internalElements: AmlInternalElement[] = [];
  const internalLinks: AmlInternalLink[] = [];
  const children: AmlSystemUnitClass[] = [];

  const body = node.children.find((c) => c.type === "ClassBody");
  if (body) {
    for (const stmt of collectScopedNodes(
      body,
      new Set([
        "SystemUnitClassDecl",
        "SupportedRoleStmt",
        "ElementDecl",
        "LinkStmt",
        "AttributeStmt",
        "InterfaceStmt",
      ]),
      ALL_DECL_STOPS,
    )) {
      if (stmt.type === "SystemUnitClassDecl") {
        children.push(parseCstSystemUnitClass(source, stmt, h));
      } else if (stmt.type === "SupportedRoleStmt") {
        const rp = stmt.childForFieldName("rolePath");
        if (rp) supportedRoleClassPaths.push(unquote(rp.text));
      } else if (stmt.type === "ElementDecl") {
        internalElements.push(parseCstElement(source, stmt, h));
      } else if (stmt.type === "LinkStmt") {
        internalLinks.push(parseCstLink(source, stmt, h));
      } else if (stmt.type === "AttributeStmt") {
        attributes.push(parseCstAttribute(source, stmt, h));
      } else if (stmt.type === "InterfaceStmt") {
        interfaces.push(parseCstInterface(source, stmt, name, h));
      }
    }
  }

  return {
    name,
    refBaseClassPath,
    supportedRoleClassPaths,
    attributes,
    interfaces,
    internalElements,
    internalLinks,
    children,
    range: h.makeRange(source, node.startIndex, node.endIndex),
  };
}

export function parseDslAmlWithCst(source: string, uri: string | undefined, h: AmlDslParseHelpers): AmlDocument {
  const parser = getAmlDslParser();
  const tree = parser.parse(source);

  let fileName = uri ?? "PlantTopology.aml";
  let schemaVersion: AmlSchemaVersion = "2.15";
  const instanceHierarchies: AmlInstanceHierarchy[] = [];
  const systemUnitClassLibs: AmlSystemUnitClassLib[] = [];
  const roleClassLibs: AmlRoleClassLib[] = [];
  const interfaceClassLibs: AmlInterfaceClassLib[] = [];
  const attributeTypeLibs: AmlAttributeTypeLib[] = [];

  if (tree?.rootNode) {
    const topNodes = collectScopedNodes(
      tree.rootNode,
      new Set([
        "AmlHeader",
        "RoleClassLibDecl",
        "InterfaceClassLibDecl",
        "SystemUnitClassLibDecl",
        "AttributeTypeLibDecl",
        "InstanceHierarchyDecl",
      ]),
      new Set(),
    );

    for (const node of topNodes) {
      if (node.type === "AmlHeader") {
        const fn = node.childForFieldName("fileName");
        if (fn) fileName = unquote(fn.text);
        const ver = node.childForFieldName("version");
        if (ver && unquote(ver.text).startsWith("3")) {
          schemaVersion = "3.0";
        }
      } else if (node.type === "InstanceHierarchyDecl") {
        const ihName = unquote(node.childForFieldName("name")?.text ?? "") || "InstanceHierarchy";
        const ver = node.childForFieldName("version");
        const version = ver ? unquote(ver.text) : undefined;
        const elements: AmlInternalElement[] = [];
        const topLinks: AmlInternalLink[] = [];

        for (const stmt of collectScopedNodes(node, new Set(["ElementDecl", "LinkStmt"]), ALL_DECL_STOPS)) {
          if (stmt.type === "ElementDecl") elements.push(parseCstElement(source, stmt, h));
          else if (stmt.type === "LinkStmt") topLinks.push(parseCstLink(source, stmt, h));
        }

        if (topLinks.length > 0 && elements[0]) {
          elements[0].internalLinks.push(...topLinks);
        }

        instanceHierarchies.push({
          name: ihName,
          version,
          elements,
          range: h.makeRange(source, node.startIndex, node.endIndex),
        });
      } else if (node.type === "RoleClassLibDecl") {
        const libName = unquote(node.childForFieldName("name")?.text ?? "") || "RoleClassLib";
        const ver = node.childForFieldName("version");
        const version = ver ? unquote(ver.text) : undefined;
        const classes = collectScopedNodes(node, new Set(["RoleClassDecl"]), ALL_DECL_STOPS).map((rc) =>
          parseCstRoleClass(source, rc, h),
        );
        roleClassLibs.push({
          name: libName,
          version,
          classes,
          range: h.makeRange(source, node.startIndex, node.endIndex),
        });
      } else if (node.type === "InterfaceClassLibDecl") {
        const libName = unquote(node.childForFieldName("name")?.text ?? "") || "InterfaceClassLib";
        const ver = node.childForFieldName("version");
        const version = ver ? unquote(ver.text) : undefined;
        const classes = collectScopedNodes(node, new Set(["InterfaceClassDecl"]), ALL_DECL_STOPS).map((ic) =>
          parseCstInterfaceClass(source, ic, h),
        );
        interfaceClassLibs.push({
          name: libName,
          version,
          classes,
          range: h.makeRange(source, node.startIndex, node.endIndex),
        });
      } else if (node.type === "SystemUnitClassLibDecl") {
        const libName = unquote(node.childForFieldName("name")?.text ?? "") || "SystemUnitClassLib";
        const ver = node.childForFieldName("version");
        const version = ver ? unquote(ver.text) : undefined;
        const classes = collectScopedNodes(node, new Set(["SystemUnitClassDecl"]), ALL_DECL_STOPS).map((suc) =>
          parseCstSystemUnitClass(source, suc, h),
        );
        systemUnitClassLibs.push({
          name: libName,
          version,
          classes,
          range: h.makeRange(source, node.startIndex, node.endIndex),
        });
      } else if (node.type === "AttributeTypeLibDecl") {
        const libName = unquote(node.childForFieldName("name")?.text ?? "") || "AttributeTypeLib";
        const ver = node.childForFieldName("version");
        const version = ver ? unquote(ver.text) : undefined;
        const types: AmlAttributeType[] = collectScopedNodes(node, new Set(["AttributeStmt"]), ALL_DECL_STOPS).map(
          (st) => {
            const attr = parseCstAttribute(source, st, h);
            return {
              name: attr.name,
              dataType: attr.dataType,
              unit: attr.unit,
              defaultValue: attr.defaultValue,
              children: [],
              range: attr.range,
            };
          },
        );
        attributeTypeLibs.push({
          name: libName,
          version,
          types,
          range: h.makeRange(source, node.startIndex, node.endIndex),
        });
      }
    }
  }

  return {
    fileName,
    schemaVersion,
    instanceHierarchies,
    systemUnitClassLibs,
    roleClassLibs,
    interfaceClassLibs,
    attributeTypeLibs,
    range: h.makeRange(source, 0, source.length),
  };
}
