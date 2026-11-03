// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/oscal — Multi-Format Parser & Serializer (JSON, YAML, XML).
 *
 * Parses and serializes all 7 NIST OSCAL 1.1.x models with accurate source line/column
 * range tracking for controls, parameters, components, implemented-requirements,
 * by-components, findings, and POA&M items.
 */

import type {
  OscalAlter,
  OscalByComponent,
  OscalComponent,
  OscalComponentType,
  OscalControl,
  OscalDocument,
  OscalDocumentKind,
  OscalFinding,
  OscalFindingSeverity,
  OscalFindingStatus,
  OscalGroup,
  OscalImplementedRequirement,
  OscalInventoryItem,
  OscalMetadata,
  OscalModify,
  OscalParameter,
  OscalPart,
  OscalPoamItem,
  OscalProfileImport,
  OscalProperty,
  OscalProtocol,
  OscalSetParameter,
  OscalSourceRange,
} from "../types.js";

const OSCAL_MODEL_KINDS: readonly OscalDocumentKind[] = [
  "catalog",
  "profile",
  "component-definition",
  "system-security-plan",
  "assessment-plan",
  "assessment-results",
  "plan-of-action-and-milestones",
];

class SourceLocator {
  private readonly lineStarts: number[] = [0];
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) {
        this.lineStarts.push(i + 1);
      }
    }
  }

  public offsetToPos(offset: number): { line: number; column: number } {
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const start = this.lineStarts[mid] ?? 0;
      if (start <= clamped) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const lineIdx = Math.max(0, low - 1);
    const lineStart = this.lineStarts[lineIdx] ?? 0;
    return {
      line: lineIdx + 1,
      column: clamped - lineStart + 1,
    };
  }

  public makeRange(startOffset: number, endOffset: number): OscalSourceRange {
    const s = this.offsetToPos(startOffset);
    const e = this.offsetToPos(Math.max(startOffset, endOffset));
    return {
      startOffset,
      endOffset: Math.max(startOffset, endOffset),
      startLine: s.line,
      startColumn: s.column,
      endLine: e.line,
      endColumn: e.column,
    };
  }

  public fullRange(): OscalSourceRange {
    return this.makeRange(0, this.text.length);
  }

  public findValueRange(value: string, fromOffset = 0): OscalSourceRange {
    if (!value) return this.makeRange(0, Math.min(1, this.text.length));
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Try quoted or XML attribute/text match first
    const quotedRe = new RegExp(`["'>:\\s]${escaped}["'<\\s,\\r\\n]`, "g");
    quotedRe.lastIndex = fromOffset;
    const match = quotedRe.exec(this.text);
    if (match && match.index !== undefined) {
      const valStart = match.index + 1;
      return this.makeRange(valStart, valStart + value.length);
    }
    const idx = this.text.indexOf(value, fromOffset);
    if (idx !== -1) {
      return this.makeRange(idx, idx + value.length);
    }
    const fallbackIdx = this.text.indexOf(value);
    if (fallbackIdx !== -1) {
      return this.makeRange(fallbackIdx, fallbackIdx + value.length);
    }
    return this.makeRange(0, Math.min(this.text.length, 1));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal YAML-subset Parser for OSCAL YAML documents
// ─────────────────────────────────────────────────────────────────────────────

interface YamlLine {
  indent: number;
  content: string;
}

function parseScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "~") return null;
  if (trimmed === "[]") return [];
  if (trimmed === "{}") return {};
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((item) => parseScalar(item));
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

function splitKeyVal(line: string): { key: string; val: string } | null {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === ":" && !inSingle && !inDouble) {
      const next = line[i + 1];
      if (next === undefined || next === " " || next === "\t") {
        const key = line
          .slice(0, i)
          .trim()
          .replace(/^['"]|['"]$/g, "");
        const val = line.slice(i + 1).trim();
        return { key, val };
      }
    }
  }
  return null;
}

function parseYamlLines(lines: YamlLine[], startIdx: number, minIndent: number): { value: unknown; nextIdx: number } {
  const first = lines[startIdx];
  if (!first || first.indent < minIndent) {
    return { value: {}, nextIdx: startIdx };
  }

  if (first.content.startsWith("- ") || first.content === "-") {
    const arr: unknown[] = [];
    let idx = startIdx;
    const listIndent = first.indent;

    while (idx < lines.length) {
      const line = lines[idx]!;
      if (line.indent < listIndent) break;
      if (line.indent > listIndent) break;
      if (!line.content.startsWith("-")) break;

      const afterDash = line.content.slice(1).trim();
      idx++;

      if (!afterDash) {
        const sub = parseYamlLines(lines, idx, listIndent + 1);
        arr.push(sub.value);
        idx = sub.nextIdx;
      } else {
        const kv = splitKeyVal(afterDash);
        if (kv) {
          const obj: Record<string, unknown> = {};
          const itemIndent = listIndent + 2;
          if (kv.val === "" || kv.val === "|" || kv.val === ">") {
            const sub = parseYamlLines(lines, idx, itemIndent);
            obj[kv.key] = sub.value;
            idx = sub.nextIdx;
          } else {
            obj[kv.key] = parseScalar(kv.val);
          }

          while (idx < lines.length && lines[idx]!.indent >= itemIndent) {
            const propLine = lines[idx]!;
            if (propLine.content.startsWith("-")) break;
            const pkv = splitKeyVal(propLine.content);
            if (!pkv) {
              idx++;
              continue;
            }
            idx++;
            if (pkv.val === "" || pkv.val === "|" || pkv.val === ">") {
              const sub = parseYamlLines(lines, idx, propLine.indent + 1);
              obj[pkv.key] = sub.value;
              idx = sub.nextIdx;
            } else {
              obj[pkv.key] = parseScalar(pkv.val);
            }
          }
          arr.push(obj);
        } else {
          arr.push(parseScalar(afterDash));
        }
      }
    }
    return { value: arr, nextIdx: idx };
  }

  const obj: Record<string, unknown> = {};
  let idx = startIdx;
  const blockIndent = first.indent;

  while (idx < lines.length) {
    const line = lines[idx]!;
    if (line.indent < blockIndent) break;
    if (line.content.startsWith("-")) break;

    const kv = splitKeyVal(line.content);
    if (!kv) {
      idx++;
      continue;
    }
    idx++;

    if (kv.val === "|" || kv.val === ">") {
      const textLines: string[] = [];
      const textIndent = idx < lines.length ? lines[idx]!.indent : blockIndent + 2;
      while (idx < lines.length && lines[idx]!.indent >= textIndent && textIndent > line.indent) {
        textLines.push(lines[idx]!.content);
        idx++;
      }
      obj[kv.key] = textLines.join(kv.val === "|" ? "\n" : " ");
    } else if (kv.val === "") {
      if (idx < lines.length && lines[idx]!.indent > line.indent) {
        const sub = parseYamlLines(lines, idx, lines[idx]!.indent);
        obj[kv.key] = sub.value;
        idx = sub.nextIdx;
      } else {
        obj[kv.key] = {};
      }
    } else {
      obj[kv.key] = parseScalar(kv.val);
    }
  }

  return { value: obj, nextIdx: idx };
}

function parseYamlToObject(text: string): Record<string, unknown> {
  const rawLines = text.split(/\r?\n/);
  const lines: YamlLine[] = [];
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed === "---" || trimmed === "...") continue;
    let indent = 0;
    while (indent < raw.length && (raw[indent] === " " || raw[indent] === "\t")) {
      indent++;
    }
    lines.push({ indent, content: trimmed });
  }
  if (lines.length === 0) {
    throw new Error("Empty YAML OSCAL document.");
  }
  const { value } = parseYamlLines(lines, 0, 0);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("YAML OSCAL root must be a mapping.");
  }
  return value as Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal XML-subset Parser for OSCAL XML documents
// ─────────────────────────────────────────────────────────────────────────────

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
  startOffset: number;
  endOffset: number;
}

function unescapeXml(str: string): string {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseXmlAttributes(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([A-Za-z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(attrStr)) !== null) {
    const key = m[1]!;
    const val = m[2] ?? m[3] ?? "";
    attrs[key] = unescapeXml(val);
  }
  return attrs;
}

function parseXmlTree(xml: string): XmlNode {
  const cleaned = xml.replace(/<\?xml[\s\S]*?\?>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const tagRe = /<\/?([A-Za-z0-9_:-]+)([^>]*?)(\/?)>/g;
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(cleaned)) !== null) {
    const fullMatch = match[0]!;
    const isClosing = fullMatch.startsWith("</");
    const rawTag = match[1]!;
    const localTag = rawTag.includes(":") ? rawTag.split(":")[1]! : rawTag;
    const attrText = match[2] ?? "";
    const isSelfClosing = match[3] === "/";
    const tagStart = match.index;
    const tagEnd = tagStart + fullMatch.length;

    if (stack.length > 0 && tagStart > lastIndex) {
      const textSegment = cleaned.slice(lastIndex, tagStart).trim();
      if (textSegment) {
        const current = stack[stack.length - 1]!;
        current.text = (current.text ? `${current.text} ` : "") + unescapeXml(textSegment);
      }
    }
    lastIndex = tagEnd;

    if (isClosing) {
      const popped = stack.pop();
      if (popped) {
        popped.endOffset = tagEnd;
      }
    } else {
      const node: XmlNode = {
        tag: localTag,
        attrs: parseXmlAttributes(attrText),
        children: [],
        text: "",
        startOffset: tagStart,
        endOffset: tagEnd,
      };
      if (stack.length > 0) {
        stack[stack.length - 1]!.children.push(node);
      } else if (!root) {
        root = node;
      }
      if (!isSelfClosing) {
        stack.push(node);
      }
    }
  }

  if (!root) {
    throw new Error("No valid XML root element found in OSCAL XML document.");
  }
  return root;
}

function findChild(node: XmlNode, tag: string): XmlNode | undefined {
  return node.children.find((c) => c.tag === tag);
}

function findChildren(node: XmlNode, tag: string): XmlNode[] {
  return node.children.filter((c) => c.tag === tag);
}

function childText(node: XmlNode, tag: string): string | undefined {
  const child = findChild(node, tag);
  return child ? child.text : undefined;
}

function parseXmlPart(node: XmlNode, locator: SourceLocator): OscalPart {
  const id = node.attrs["id"];
  const name = node.attrs["name"] ?? "statement";
  const title = childText(node, "title");
  const pNodes = findChildren(node, "p");
  const prose = pNodes.length > 0 ? pNodes.map((p) => p.text).join("\n") : node.text || undefined;
  const subParts = findChildren(node, "part").map((sp) => parseXmlPart(sp, locator));

  return {
    id,
    name,
    title,
    prose,
    parts: subParts.length > 0 ? subParts : undefined,
    range: locator.makeRange(node.startOffset, node.endOffset),
  };
}

function parseXmlParam(node: XmlNode, locator: SourceLocator): OscalParameter {
  const id = node.attrs["id"] ?? "";
  const label = childText(node, "label");
  const usage = childText(node, "usage");
  const values = findChildren(node, "value").map((v) => v.text);
  return {
    id,
    label,
    usage,
    values: values.length > 0 ? values : undefined,
    range: locator.findValueRange(id, node.startOffset),
  };
}

function parseXmlControl(node: XmlNode, locator: SourceLocator): OscalControl {
  const id = node.attrs["id"] ?? "";
  const cls = node.attrs["class"];
  const title = childText(node, "title") ?? id;
  const params = findChildren(node, "param").map((p) => parseXmlParam(p, locator));
  const parts = findChildren(node, "part").map((p) => parseXmlPart(p, locator));
  const subControls = findChildren(node, "control").map((c) => parseXmlControl(c, locator));
  return {
    id,
    class: cls,
    title,
    params: params.length > 0 ? params : undefined,
    parts: parts.length > 0 ? parts : undefined,
    controls: subControls.length > 0 ? subControls : undefined,
    range: locator.findValueRange(id, node.startOffset),
  };
}

function parseXmlGroup(node: XmlNode, locator: SourceLocator): OscalGroup {
  const id = node.attrs["id"] ?? "";
  const cls = node.attrs["class"];
  const title = childText(node, "title") ?? id;
  const controls = findChildren(node, "control").map((c) => parseXmlControl(c, locator));
  const subGroups = findChildren(node, "group").map((g) => parseXmlGroup(g, locator));
  return {
    id,
    class: cls,
    title,
    controls: controls.length > 0 ? controls : undefined,
    groups: subGroups.length > 0 ? subGroups : undefined,
    range: locator.makeRange(node.startOffset, node.endOffset),
  };
}

function parseXmlSetParameter(node: XmlNode, locator: SourceLocator): OscalSetParameter {
  const paramId = node.attrs["param-id"] ?? node.attrs["id"] ?? "";
  const values = findChildren(node, "value").map((v) => v.text);
  const label = childText(node, "label");
  return {
    paramId,
    values,
    label,
    range: locator.findValueRange(paramId, node.startOffset),
  };
}

function parseXmlComponent(node: XmlNode, locator: SourceLocator): OscalComponent {
  const uuid = node.attrs["uuid"] ?? "";
  const type = (node.attrs["type"] ?? "software") as OscalComponentType;
  const title = childText(node, "title") ?? uuid;
  const description = childText(node, "description");
  const statusNode = findChild(node, "status");
  const status = statusNode?.attrs["state"] as OscalComponent["status"];
  const props: OscalProperty[] = findChildren(node, "prop").map((p) => ({
    name: p.attrs["name"] ?? "",
    value: p.attrs["value"] ?? p.text,
    ns: p.attrs["ns"],
    class: p.attrs["class"],
  }));
  const protocols: OscalProtocol[] = findChildren(node, "protocol").map((pr) => ({
    uuid: pr.attrs["uuid"],
    name: pr.attrs["name"] ?? "",
    title: childText(pr, "title"),
  }));

  return {
    uuid,
    title,
    description,
    type,
    status,
    props: props.length > 0 ? props : undefined,
    protocols: protocols.length > 0 ? protocols : undefined,
    range: locator.findValueRange(uuid, node.startOffset),
  };
}

function parseXmlImplementedRequirement(node: XmlNode, locator: SourceLocator): OscalImplementedRequirement {
  const uuid = node.attrs["uuid"] ?? "";
  const controlId = node.attrs["control-id"] ?? "";
  const description = childText(node, "description") ?? childText(node, "remarks");
  const setParameters = findChildren(node, "set-parameter").map((sp) => parseXmlSetParameter(sp, locator));
  const byComponents: OscalByComponent[] = findChildren(node, "by-component").map((bc) => {
    const compUuid = bc.attrs["component-uuid"] ?? "";
    const bcUuid = bc.attrs["uuid"] ?? "";
    const bcDesc = childText(bc, "description") ?? "";
    const bcSetParams = findChildren(bc, "set-parameter").map((sp) => parseXmlSetParameter(sp, locator));
    return {
      componentUuid: compUuid,
      uuid: bcUuid,
      description: bcDesc,
      setParameters: bcSetParams.length > 0 ? bcSetParams : undefined,
      range: locator.findValueRange(compUuid || bcUuid, bc.startOffset),
    };
  });

  return {
    uuid,
    controlId,
    description,
    setParameters: setParameters.length > 0 ? setParameters : undefined,
    byComponents: byComponents.length > 0 ? byComponents : undefined,
    range: locator.findValueRange(controlId || uuid, node.startOffset),
  };
}

function parseXmlOscal(text: string, locator: SourceLocator): OscalDocument {
  const root = parseXmlTree(text);
  const kind = root.tag as OscalDocumentKind;
  if (!OSCAL_MODEL_KINDS.includes(kind)) {
    throw new Error(`Unsupported XML OSCAL root element '<${root.tag}>'.`);
  }

  const uuid = root.attrs["uuid"] ?? "";
  const metaNode = findChild(root, "metadata");
  const metadata: OscalMetadata = {
    title: (metaNode ? childText(metaNode, "title") : undefined) ?? "Untitled OSCAL Document",
    version: (metaNode ? childText(metaNode, "version") : undefined) ?? "1.0.0",
    oscalVersion: (metaNode ? childText(metaNode, "oscal-version") : undefined) ?? "1.1.2",
    lastModified: metaNode ? childText(metaNode, "last-modified") : undefined,
    range: metaNode ? locator.makeRange(metaNode.startOffset, metaNode.endOffset) : undefined,
  };

  const doc: OscalDocument = {
    kind,
    uuid,
    metadata,
    range: locator.fullRange(),
    uuidRange: locator.findValueRange(uuid, root.startOffset),
  };

  if (kind === "catalog") {
    const groups = findChildren(root, "group").map((g) => parseXmlGroup(g, locator));
    const controls = findChildren(root, "control").map((c) => parseXmlControl(c, locator));
    const params = findChildren(root, "param").map((p) => parseXmlParam(p, locator));
    if (groups.length > 0) doc.groups = groups;
    if (controls.length > 0) doc.controls = controls;
    if (params.length > 0) doc.params = params;
  } else if (kind === "profile") {
    const imports: OscalProfileImport[] = findChildren(root, "import").map((imp) => {
      const href = imp.attrs["href"] ?? "";
      const incNode = findChild(imp, "include-controls");
      const excNode = findChild(imp, "exclude-controls");
      const incIds = incNode ? findChildren(incNode, "with-id").map((w) => w.text) : [];
      const excIds = excNode ? findChildren(excNode, "with-id").map((w) => w.text) : [];
      const includeAll = findChild(imp, "include-all") !== undefined;
      return {
        href,
        includeAll: includeAll || undefined,
        includeControls: incIds.length > 0 ? incIds : undefined,
        excludeControls: excIds.length > 0 ? excIds : undefined,
        range: locator.findValueRange(href, imp.startOffset),
      };
    });
    if (imports.length > 0) doc.imports = imports;

    const modifyNode = findChild(root, "modify");
    if (modifyNode) {
      const setParameters = findChildren(modifyNode, "set-parameter").map((sp) => parseXmlSetParameter(sp, locator));
      const alters: OscalAlter[] = findChildren(modifyNode, "alter").map((alt) => {
        const controlId = alt.attrs["control-id"] ?? "";
        const adds = findChildren(alt, "add").map((a) => ({
          position: (a.attrs["position"] as "before" | "after" | "starting" | "ending" | undefined) ?? "ending",
          byId: a.attrs["by-id"],
          parts: findChildren(a, "part").map((p) => parseXmlPart(p, locator)),
        }));
        return {
          controlId,
          adds: adds.length > 0 ? adds : undefined,
          range: locator.findValueRange(controlId, alt.startOffset),
        };
      });
      doc.modify = {
        setParameters: setParameters.length > 0 ? setParameters : undefined,
        alters: alters.length > 0 ? alters : undefined,
      };
    }
  } else if (kind === "component-definition") {
    const comps = findChildren(root, "component").map((c) => parseXmlComponent(c, locator));
    if (comps.length > 0) doc.components = comps;
  } else if (kind === "system-security-plan") {
    const impProf = findChild(root, "import-profile");
    if (impProf) {
      const href = impProf.attrs["href"] ?? "";
      doc.importProfile = {
        href,
        range: locator.findValueRange(href, impProf.startOffset),
      };
    }
    const sysChar = findChild(root, "system-characteristics");
    if (sysChar) {
      doc.systemCharacteristics = {
        systemName: childText(sysChar, "system-name") ?? "Unnamed System",
        description: childText(sysChar, "description"),
        securitySensitivityLevel: childText(sysChar, "security-sensitivity-level") as
          | "low"
          | "moderate"
          | "high"
          | undefined,
      };
    }
    const sysImpl = findChild(root, "system-implementation");
    if (sysImpl) {
      const comps = findChildren(sysImpl, "component").map((c) => parseXmlComponent(c, locator));
      doc.systemImplementation = {
        components: comps,
      };
    }
    const ctrlImpl = findChild(root, "control-implementation");
    if (ctrlImpl) {
      const setParameters = findChildren(ctrlImpl, "set-parameter").map((sp) => parseXmlSetParameter(sp, locator));
      const reqs = findChildren(ctrlImpl, "implemented-requirement").map((r) =>
        parseXmlImplementedRequirement(r, locator),
      );
      doc.controlImplementation = {
        description: childText(ctrlImpl, "description"),
        setParameters: setParameters.length > 0 ? setParameters : undefined,
        implementedRequirements: reqs,
      };
    }
  } else if (kind === "assessment-results" || kind === "plan-of-action-and-milestones" || kind === "assessment-plan") {
    const findings: OscalFinding[] = findChildren(root, "finding").map((f) => {
      const fUuid = f.attrs["uuid"] ?? "";
      const targetNode = findChild(f, "target");
      const targetControlId =
        f.attrs["target-control-id"] ?? targetNode?.attrs["target-id"] ?? childText(f, "target-control-id") ?? "";
      const severity = (f.attrs["severity"] ?? childText(f, "severity") ?? "moderate") as OscalFindingSeverity;
      const status = (f.attrs["status"] ?? childText(f, "status") ?? "open") as OscalFindingStatus;
      return {
        uuid: fUuid,
        title: childText(f, "title") ?? fUuid,
        description: childText(f, "description"),
        targetControlId,
        severity,
        status,
        range: locator.findValueRange(fUuid, f.startOffset),
      };
    });
    if (findings.length > 0) doc.findings = findings;

    const poamItems: OscalPoamItem[] = findChildren(root, "poam-item").map((p) => {
      const pUuid = p.attrs["uuid"] ?? "";
      const relatedFindingUuid = p.attrs["related-finding-uuid"] ?? childText(p, "related-finding-uuid");
      const targetControlId = p.attrs["target-control-id"] ?? childText(p, "target-control-id");
      const status = (p.attrs["status"] ?? childText(p, "status") ?? "open") as OscalPoamItem["status"];
      return {
        uuid: pUuid,
        title: childText(p, "title") ?? pUuid,
        description: childText(p, "description"),
        relatedFindingUuid,
        targetControlId,
        status,
        range: locator.findValueRange(pUuid, p.startOffset),
      };
    });
    if (poamItems.length > 0) doc.poamItems = poamItems;
  }

  return doc;
}

// ─────────────────────────────────────────────────────────────────────────────
// Object (JSON / YAML) Normalization into OscalDocument
// ─────────────────────────────────────────────────────────────────────────────

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : fallback;
}

function asOptionalString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : [];
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((item) => asString(item)).filter(Boolean);
}

function normalizeProps(raw: unknown): OscalProperty[] | undefined {
  const arr = asArray(raw);
  if (arr.length === 0) return undefined;
  return arr.map((p) => ({
    name: asString(p["name"]),
    value: asString(p["value"]),
    ns: asOptionalString(p["ns"]),
    class: asOptionalString(p["class"]),
  }));
}

function normalizePart(raw: Record<string, unknown>, locator: SourceLocator): OscalPart {
  const id = asOptionalString(raw["id"]);
  const name = asString(raw["name"], "statement");
  const title = asOptionalString(raw["title"]);
  const prose = asOptionalString(raw["prose"]);
  const props = normalizeProps(raw["props"]);
  const subPartsRaw = asArray(raw["parts"]);
  const parts = subPartsRaw.length > 0 ? subPartsRaw.map((sp) => normalizePart(sp, locator)) : undefined;
  return {
    id,
    name,
    title,
    prose,
    props,
    parts,
    range: id ? locator.findValueRange(id) : undefined,
  };
}

function normalizeParam(raw: Record<string, unknown>, locator: SourceLocator): OscalParameter {
  const id = asString(raw["id"] ?? raw["param-id"] ?? raw["paramId"]);
  const label = asOptionalString(raw["label"]);
  const usage = asOptionalString(raw["usage"]);
  const values = asStringArray(raw["values"]);
  const guidelinesRaw = asArray(raw["guidelines"]);
  const guidelines =
    guidelinesRaw.length > 0
      ? guidelinesRaw.map((g) => asString(g["prose"] ?? g)).filter(Boolean)
      : asStringArray(raw["guidelines"]);
  const selectRaw = raw["select"] as Record<string, unknown> | undefined;
  const select =
    selectRaw && typeof selectRaw === "object"
      ? {
          howMany: asOptionalString(selectRaw["how-many"] ?? selectRaw["howMany"]) as "one" | "one-or-more" | undefined,
          choice: asStringArray(selectRaw["choice"]),
        }
      : undefined;

  return {
    id,
    label,
    usage,
    guidelines: guidelines.length > 0 ? guidelines : undefined,
    values: values.length > 0 ? values : undefined,
    select,
    props: normalizeProps(raw["props"]),
    range: locator.findValueRange(id),
  };
}

function normalizeControl(raw: Record<string, unknown>, locator: SourceLocator): OscalControl {
  const id = asString(raw["id"]);
  const cls = asOptionalString(raw["class"]);
  const title = asString(raw["title"], id);
  const paramsRaw = asArray(raw["params"]);
  const partsRaw = asArray(raw["parts"]);
  const subControlsRaw = asArray(raw["controls"]);
  const family = asOptionalString(raw["family"]);
  const isOtOverlay = typeof raw["isOtOverlay"] === "boolean" ? raw["isOtOverlay"] : undefined;

  return {
    id,
    class: cls,
    title,
    family,
    isOtOverlay,
    params: paramsRaw.length > 0 ? paramsRaw.map((p) => normalizeParam(p, locator)) : undefined,
    props: normalizeProps(raw["props"]),
    parts: partsRaw.length > 0 ? partsRaw.map((p) => normalizePart(p, locator)) : undefined,
    controls: subControlsRaw.length > 0 ? subControlsRaw.map((c) => normalizeControl(c, locator)) : undefined,
    range: locator.findValueRange(id),
  };
}

function normalizeGroup(raw: Record<string, unknown>, locator: SourceLocator): OscalGroup {
  const id = asString(raw["id"]);
  const cls = asOptionalString(raw["class"]);
  const title = asString(raw["title"], id);
  const paramsRaw = asArray(raw["params"]);
  const partsRaw = asArray(raw["parts"]);
  const controlsRaw = asArray(raw["controls"]);
  const groupsRaw = asArray(raw["groups"]);

  return {
    id,
    class: cls,
    title,
    params: paramsRaw.length > 0 ? paramsRaw.map((p) => normalizeParam(p, locator)) : undefined,
    parts: partsRaw.length > 0 ? partsRaw.map((p) => normalizePart(p, locator)) : undefined,
    controls: controlsRaw.length > 0 ? controlsRaw.map((c) => normalizeControl(c, locator)) : undefined,
    groups: groupsRaw.length > 0 ? groupsRaw.map((g) => normalizeGroup(g, locator)) : undefined,
    range: locator.findValueRange(id),
  };
}

function normalizeSetParameter(raw: Record<string, unknown>, locator: SourceLocator): OscalSetParameter {
  const paramId = asString(raw["param-id"] ?? raw["paramId"] ?? raw["id"]);
  const values = asStringArray(raw["values"]);
  const singleVal = asOptionalString(raw["value"]);
  if (values.length === 0 && singleVal !== undefined) {
    values.push(singleVal);
  }
  return {
    paramId,
    values,
    label: asOptionalString(raw["label"]),
    usage: asOptionalString(raw["usage"]),
    range: locator.findValueRange(paramId),
  };
}

function normalizeByComponent(raw: Record<string, unknown>, locator: SourceLocator): OscalByComponent {
  const componentUuid = asString(raw["component-uuid"] ?? raw["componentUuid"]);
  const uuid = asString(raw["uuid"]);
  const description = asString(raw["description"]);
  const setParamsRaw = asArray(raw["set-parameters"] ?? raw["setParameters"]);
  const statusObj = raw["implementation-status"] as Record<string, unknown> | string | undefined;
  const implementationStatus = (
    typeof statusObj === "string"
      ? statusObj
      : statusObj && typeof statusObj === "object"
        ? asOptionalString(statusObj["state"])
        : asOptionalString(raw["implementationStatus"])
  ) as OscalByComponent["implementationStatus"];

  return {
    componentUuid,
    uuid,
    description,
    setParameters: setParamsRaw.length > 0 ? setParamsRaw.map((sp) => normalizeSetParameter(sp, locator)) : undefined,
    implementationStatus,
    range: locator.findValueRange(componentUuid || uuid),
  };
}

function normalizeImplementedRequirement(
  raw: Record<string, unknown>,
  locator: SourceLocator,
): OscalImplementedRequirement {
  const uuid = asString(raw["uuid"]);
  const controlId = asString(raw["control-id"] ?? raw["controlId"]);
  const description = asOptionalString(raw["description"] ?? raw["remarks"]);
  const setParamsRaw = asArray(raw["set-parameters"] ?? raw["setParameters"]);
  const byCompsRaw = asArray(raw["by-components"] ?? raw["byComponents"]);
  const statementsRaw = asArray(raw["statements"]);

  return {
    uuid,
    controlId,
    description,
    setParameters: setParamsRaw.length > 0 ? setParamsRaw.map((sp) => normalizeSetParameter(sp, locator)) : undefined,
    byComponents: byCompsRaw.length > 0 ? byCompsRaw.map((bc) => normalizeByComponent(bc, locator)) : undefined,
    statements:
      statementsRaw.length > 0
        ? statementsRaw.map((st) => ({
            statementId: asString(st["statement-id"] ?? st["statementId"]),
            uuid: asString(st["uuid"]),
            description: asOptionalString(st["description"]),
            byComponents: asArray(st["by-components"] ?? st["byComponents"]).map((bc) =>
              normalizeByComponent(bc, locator),
            ),
            range: locator.findValueRange(asString(st["statement-id"] ?? st["statementId"] ?? st["uuid"])),
          }))
        : undefined,
    props: normalizeProps(raw["props"]),
    range: locator.findValueRange(controlId || uuid),
  };
}

function normalizeComponent(raw: Record<string, unknown>, locator: SourceLocator): OscalComponent {
  const uuid = asString(raw["uuid"]);
  const title = asString(raw["title"], uuid);
  const description = asOptionalString(raw["description"]);
  const type = asString(raw["type"], "software") as OscalComponentType;
  const statusRaw = raw["status"];
  const status = (
    typeof statusRaw === "string"
      ? statusRaw
      : statusRaw && typeof statusRaw === "object"
        ? asOptionalString((statusRaw as Record<string, unknown>)["state"])
        : undefined
  ) as OscalComponent["status"];

  const protocolsRaw = asArray(raw["protocols"]);
  const protocols: OscalProtocol[] | undefined =
    protocolsRaw.length > 0
      ? protocolsRaw.map((pr) => ({
          uuid: asOptionalString(pr["uuid"]),
          name: asString(pr["name"]),
          title: asOptionalString(pr["title"]),
        }))
      : undefined;

  const ctrlImplsRaw = asArray(raw["control-implementations"] ?? raw["controlImplementations"]);

  return {
    uuid,
    title,
    description,
    type,
    status,
    props: normalizeProps(raw["props"]),
    protocols,
    controlImplementations:
      ctrlImplsRaw.length > 0
        ? ctrlImplsRaw.map((ci) => ({
            uuid: asString(ci["uuid"]),
            source: asString(ci["source"]),
            description: asOptionalString(ci["description"]),
            setParameters: asArray(ci["set-parameters"] ?? ci["setParameters"]).map((sp) =>
              normalizeSetParameter(sp, locator),
            ),
            implementedRequirements: asArray(ci["implemented-requirements"] ?? ci["implementedRequirements"]).map(
              (ir) => normalizeImplementedRequirement(ir, locator),
            ),
          }))
        : undefined,
    range: locator.findValueRange(uuid),
  };
}

function normalizeFinding(raw: Record<string, unknown>, locator: SourceLocator): OscalFinding {
  const uuid = asString(raw["uuid"]);
  const title = asString(raw["title"], uuid);
  const description = asOptionalString(raw["description"]);
  const targetObj = raw["target"] as Record<string, unknown> | undefined;
  const targetControlId = asString(
    raw["target-control-id"] ?? raw["targetControlId"] ?? targetObj?.["target-id"] ?? targetObj?.["targetId"],
  );
  const severity = asString(raw["severity"], "moderate") as OscalFindingSeverity;
  const statusObj = targetObj?.["status"] as Record<string, unknown> | undefined;
  const status = asString(raw["status"] ?? statusObj?.["state"], "open") as OscalFindingStatus;

  return {
    uuid,
    title,
    description,
    targetControlId,
    severity,
    status,
    range: locator.findValueRange(uuid),
  };
}

function normalizePoamItem(raw: Record<string, unknown>, locator: SourceLocator): OscalPoamItem {
  const uuid = asString(raw["uuid"]);
  const title = asString(raw["title"], uuid);
  const description = asOptionalString(raw["description"]);
  const relatedFindingsRaw = asArray(raw["related-findings"] ?? raw["relatedFindings"]);
  const firstRelatedFinding = relatedFindingsRaw[0];
  const relatedFindingUuid = asOptionalString(
    raw["related-finding-uuid"] ??
      raw["relatedFindingUuid"] ??
      firstRelatedFinding?.["finding-uuid"] ??
      firstRelatedFinding?.["findingUuid"],
  );
  const targetControlId = asOptionalString(raw["target-control-id"] ?? raw["targetControlId"]);
  const status = asString(raw["status"], "open") as OscalPoamItem["status"];
  const milestonesRaw = asArray(raw["milestones"]);

  return {
    uuid,
    title,
    description,
    relatedFindingUuid,
    targetControlId,
    milestones:
      milestonesRaw.length > 0
        ? milestonesRaw.map((m) => ({
            uuid: asString(m["uuid"]),
            title: asString(m["title"]),
            description: asOptionalString(m["description"]),
            dueDate: asOptionalString(m["due-date"] ?? m["dueDate"]),
          }))
        : undefined,
    status,
    range: locator.findValueRange(uuid),
  };
}

function normalizeObjectToOscal(rootObj: Record<string, unknown>, locator: SourceLocator): OscalDocument {
  let kind: OscalDocumentKind | undefined;
  let body: Record<string, unknown> = rootObj;

  for (const candidate of OSCAL_MODEL_KINDS) {
    if (rootObj[candidate] && typeof rootObj[candidate] === "object") {
      kind = candidate;
      body = rootObj[candidate] as Record<string, unknown>;
      break;
    }
  }

  if (!kind) {
    const explicitKind = asOptionalString(rootObj["kind"]) as OscalDocumentKind | undefined;
    if (explicitKind && OSCAL_MODEL_KINDS.includes(explicitKind)) {
      kind = explicitKind;
      body = rootObj;
    }
  }

  if (!kind) {
    throw new Error(`Unrecognized OSCAL document model. Expected one of: ${OSCAL_MODEL_KINDS.join(", ")}.`);
  }

  const uuid = asString(body["uuid"]);
  const metaRaw = (body["metadata"] as Record<string, unknown> | undefined) ?? {};
  const metadata: OscalMetadata = {
    title: asString(metaRaw["title"], "Untitled OSCAL Document"),
    version: asString(metaRaw["version"], "1.0.0"),
    oscalVersion: asOptionalString(metaRaw["oscal-version"] ?? metaRaw["oscalVersion"]) ?? "1.1.2",
    lastModified: asOptionalString(metaRaw["last-modified"] ?? metaRaw["lastModified"]),
    published: asOptionalString(metaRaw["published"]),
    props: normalizeProps(metaRaw["props"]),
    range: locator.findValueRange(asString(metaRaw["title"], "metadata")),
  };

  const doc: OscalDocument = {
    kind,
    uuid,
    metadata,
    range: locator.fullRange(),
    uuidRange: locator.findValueRange(uuid),
  };

  // Catalog fields
  const groupsRaw = asArray(body["groups"]);
  if (groupsRaw.length > 0) {
    doc.groups = groupsRaw.map((g) => normalizeGroup(g, locator));
  }
  const controlsRaw = asArray(body["controls"]);
  if (controlsRaw.length > 0) {
    doc.controls = controlsRaw.map((c) => normalizeControl(c, locator));
  }
  const paramsRaw = asArray(body["params"]);
  if (paramsRaw.length > 0) {
    doc.params = paramsRaw.map((p) => normalizeParam(p, locator));
  }

  // Profile fields
  const importsRaw = asArray(body["imports"]);
  if (importsRaw.length > 0) {
    doc.imports = importsRaw.map((imp) => {
      const href = asString(imp["href"]);
      const includeAll = Boolean(imp["include-all"] ?? imp["includeAll"]);

      let includeControls = asStringArray(imp["include-controls"] ?? imp["includeControls"]);
      if (includeControls.length === 0) {
        const incObjs = asArray(imp["include-controls"]);
        for (const obj of incObjs) {
          includeControls.push(...asStringArray(obj["with-ids"] ?? obj["withIds"]));
        }
      }

      let excludeControls = asStringArray(imp["exclude-controls"] ?? imp["excludeControls"]);
      if (excludeControls.length === 0) {
        const excObjs = asArray(imp["exclude-controls"]);
        for (const obj of excObjs) {
          excludeControls.push(...asStringArray(obj["with-ids"] ?? obj["withIds"]));
        }
      }

      return {
        href,
        includeAll: includeAll || undefined,
        includeControls: includeControls.length > 0 ? includeControls : undefined,
        excludeControls: excludeControls.length > 0 ? excludeControls : undefined,
        range: locator.findValueRange(href),
      };
    });
  }

  const mergeRaw = body["merge"] as Record<string, unknown> | undefined;
  if (mergeRaw && typeof mergeRaw === "object") {
    const combineRaw = mergeRaw["combine"] as Record<string, unknown> | undefined;
    doc.merge = {
      combine:
        combineRaw && typeof combineRaw === "object"
          ? { method: asString(combineRaw["method"], "merge") as "use-first" | "merge" | "keep" }
          : undefined,
      flat: mergeRaw["flat"] !== undefined ? Boolean(mergeRaw["flat"]) : undefined,
      asIs:
        mergeRaw["as-is"] !== undefined || mergeRaw["asIs"] !== undefined
          ? Boolean(mergeRaw["as-is"] ?? mergeRaw["asIs"])
          : undefined,
    };
  }

  const modifyRaw = body["modify"] as Record<string, unknown> | undefined;
  if (modifyRaw && typeof modifyRaw === "object") {
    const setParamsRaw = asArray(modifyRaw["set-parameters"] ?? modifyRaw["setParameters"]);
    const altersRaw = asArray(modifyRaw["alters"]);
    const modify: OscalModify = {};
    if (setParamsRaw.length > 0) {
      modify.setParameters = setParamsRaw.map((sp) => normalizeSetParameter(sp, locator));
    }
    if (altersRaw.length > 0) {
      modify.alters = altersRaw.map((alt) => {
        const controlId = asString(alt["control-id"] ?? alt["controlId"]);
        const addsRaw = asArray(alt["adds"]);
        const removesRaw = asArray(alt["removes"]);
        return {
          controlId,
          adds:
            addsRaw.length > 0
              ? addsRaw.map((a) => ({
                  position: asOptionalString(a["position"]) as "before" | "after" | "starting" | "ending" | undefined,
                  byId: asOptionalString(a["by-id"] ?? a["byId"]),
                  parts: asArray(a["parts"]).map((p) => normalizePart(p, locator)),
                  props: normalizeProps(a["props"]),
                }))
              : undefined,
          removes:
            removesRaw.length > 0
              ? removesRaw.map((r) => ({
                  byName: asOptionalString(r["by-name"] ?? r["byName"]),
                  byId: asOptionalString(r["by-id"] ?? r["byId"]),
                  byClass: asOptionalString(r["by-class"] ?? r["byClass"]),
                }))
              : undefined,
          range: locator.findValueRange(controlId),
        };
      });
    }
    doc.modify = modify;
  }

  // Component Definition fields
  const componentsRaw = asArray(body["components"]);
  if (componentsRaw.length > 0) {
    doc.components = componentsRaw.map((c) => normalizeComponent(c, locator));
  }

  // SSP fields
  const importProfileRaw = (body["import-profile"] ?? body["importProfile"]) as Record<string, unknown> | undefined;
  if (importProfileRaw && typeof importProfileRaw === "object") {
    const href = asString(importProfileRaw["href"]);
    doc.importProfile = {
      href,
      range: locator.findValueRange(href),
    };
  }

  const sysCharRaw = (body["system-characteristics"] ?? body["systemCharacteristics"]) as
    | Record<string, unknown>
    | undefined;
  if (sysCharRaw && typeof sysCharRaw === "object") {
    doc.systemCharacteristics = {
      systemIds: asStringArray(sysCharRaw["system-ids"] ?? sysCharRaw["systemIds"]),
      systemName: asString(sysCharRaw["system-name"] ?? sysCharRaw["systemName"], "Unnamed System"),
      description: asOptionalString(sysCharRaw["description"]),
      securitySensitivityLevel: asOptionalString(
        sysCharRaw["security-sensitivity-level"] ?? sysCharRaw["securitySensitivityLevel"],
      ) as "low" | "moderate" | "high" | undefined,
      status: asOptionalString(sysCharRaw["status"]),
      authorizationBoundary: asOptionalString(
        sysCharRaw["authorization-boundary"] ?? sysCharRaw["authorizationBoundary"],
      ),
    };
  }

  const sysImplRaw = (body["system-implementation"] ?? body["systemImplementation"]) as
    | Record<string, unknown>
    | undefined;
  if (sysImplRaw && typeof sysImplRaw === "object") {
    const comps = asArray(sysImplRaw["components"]).map((c) => normalizeComponent(c, locator));
    const invItemsRaw = asArray(sysImplRaw["inventory-items"] ?? sysImplRaw["inventoryItems"]);
    const invItems: OscalInventoryItem[] | undefined =
      invItemsRaw.length > 0
        ? invItemsRaw.map((item) => ({
            uuid: asString(item["uuid"]),
            description: asString(item["description"]),
            props: normalizeProps(item["props"]),
            implementedComponents: asArray(item["implemented-components"] ?? item["implementedComponents"]).map(
              (ic) => ({
                componentUuid: asString(ic["component-uuid"] ?? ic["componentUuid"]),
              }),
            ),
            range: locator.findValueRange(asString(item["uuid"])),
          }))
        : undefined;
    doc.systemImplementation = {
      components: comps,
      inventoryItems: invItems,
    };
  }

  const ctrlImplRaw = (body["control-implementation"] ?? body["controlImplementation"]) as
    | Record<string, unknown>
    | undefined;
  if (ctrlImplRaw && typeof ctrlImplRaw === "object") {
    const setParams = asArray(ctrlImplRaw["set-parameters"] ?? ctrlImplRaw["setParameters"]).map((sp) =>
      normalizeSetParameter(sp, locator),
    );
    const implReqs = asArray(ctrlImplRaw["implemented-requirements"] ?? ctrlImplRaw["implementedRequirements"]).map(
      (ir) => normalizeImplementedRequirement(ir, locator),
    );
    doc.controlImplementation = {
      description: asOptionalString(ctrlImplRaw["description"]),
      setParameters: setParams.length > 0 ? setParams : undefined,
      implementedRequirements: implReqs,
    };
  }

  // Assessment Plan / Results / POA&M fields
  const importSspRaw = (body["import-ssp"] ?? body["importSsp"]) as Record<string, unknown> | undefined;
  if (importSspRaw && typeof importSspRaw === "object") {
    doc.importSsp = { href: asString(importSspRaw["href"]) };
  }

  const importApRaw = (body["import-ap"] ?? body["importAp"]) as Record<string, unknown> | undefined;
  if (importApRaw && typeof importApRaw === "object") {
    doc.importAp = { href: asString(importApRaw["href"]) };
  }

  let findingsRaw = asArray(body["findings"]);
  if (findingsRaw.length === 0) {
    const resultsArr = asArray(body["results"]);
    for (const res of resultsArr) {
      findingsRaw.push(...asArray(res["findings"]));
    }
  }
  if (findingsRaw.length > 0) {
    doc.findings = findingsRaw.map((f) => normalizeFinding(f, locator));
  }

  const poamItemsRaw = asArray(body["poam-items"] ?? body["poamItems"]);
  if (poamItemsRaw.length > 0) {
    doc.poamItems = poamItemsRaw.map((p) => normalizePoamItem(p, locator));
  }

  return doc;
}

/**
 * Parses an OSCAL 1.1.x document in JSON, YAML, or XML format.
 */
export function parseOscal(text: string, _uri?: string): OscalDocument {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Cannot parse empty OSCAL document.");
  }

  const locator = new SourceLocator(text);

  if (trimmed.startsWith("<")) {
    return parseXmlOscal(text, locator);
  }

  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return normalizeObjectToOscal(parsed, locator);
  }

  const yamlObj = parseYamlToObject(text);
  return normalizeObjectToOscal(yamlObj, locator);
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Format Serializer (JSON, YAML, XML)
// ─────────────────────────────────────────────────────────────────────────────

function stripRanges(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(stripRanges);
  }
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k === "range" || k === "uuidRange" || v === undefined) continue;
      out[k] = stripRanges(v);
    }
    return out;
  }
  return obj;
}

function toCanonicalJsonObject(doc: OscalDocument): Record<string, unknown> {
  const inner = stripRanges(doc) as Record<string, unknown>;
  const kind = doc.kind;
  delete inner["kind"];
  return { [kind]: inner };
}

function serializeYamlValue(val: unknown, indent: number): string {
  const pad = "  ".repeat(indent);
  if (val === null || val === undefined) return "null";
  if (typeof val === "boolean" || typeof val === "number") return String(val);
  if (typeof val === "string") {
    if (
      val === "" ||
      val.includes(":") ||
      val.includes("#") ||
      val.includes("{") ||
      val.includes("}") ||
      val.includes("[") ||
      val.includes("]") ||
      val.includes("\n") ||
      /^\s|\s$/.test(val)
    ) {
      return JSON.stringify(val);
    }
    return val;
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return "[]";
    if (val.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")) {
      return `[${val.map((v) => serializeYamlValue(v, 0)).join(", ")}]`;
    }
    const lines: string[] = [];
    for (const item of val) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const entries = Object.entries(item as Record<string, unknown>).filter(([, v]) => v !== undefined);
        if (entries.length === 0) {
          lines.push(`${pad}- {}`);
          continue;
        }
        const [firstKey, firstVal] = entries[0]!;
        if (firstVal && typeof firstVal === "object" && !Array.isArray(firstVal)) {
          lines.push(`${pad}- ${firstKey}:`);
          lines.push(serializeYamlValue(firstVal, indent + 2));
        } else if (Array.isArray(firstVal) && firstVal.some((x) => x && typeof x === "object")) {
          lines.push(`${pad}- ${firstKey}:`);
          lines.push(serializeYamlValue(firstVal, indent + 2));
        } else {
          lines.push(`${pad}- ${firstKey}: ${serializeYamlValue(firstVal, indent + 1)}`);
        }
        for (let i = 1; i < entries.length; i++) {
          const [k, v] = entries[i]!;
          const itemPad = "  ".repeat(indent + 1);
          if (
            (v && typeof v === "object" && !Array.isArray(v)) ||
            (Array.isArray(v) && v.some((x) => x && typeof x === "object"))
          ) {
            lines.push(`${itemPad}${k}:`);
            lines.push(serializeYamlValue(v, indent + 2));
          } else {
            lines.push(`${itemPad}${k}: ${serializeYamlValue(v, indent + 1)}`);
          }
        }
      } else {
        lines.push(`${pad}- ${serializeYamlValue(item, indent + 1)}`);
      }
    }
    return lines.join("\n");
  }
  if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    const lines: string[] = [];
    for (const [k, v] of entries) {
      if (
        (v && typeof v === "object" && !Array.isArray(v)) ||
        (Array.isArray(v) && v.some((x) => x && typeof x === "object"))
      ) {
        lines.push(`${pad}${k}:`);
        lines.push(serializeYamlValue(v, indent + 1));
      } else {
        lines.push(`${pad}${k}: ${serializeYamlValue(v, indent)}`);
      }
    }
    return lines.join("\n");
  }
  return String(val);
}

function serializeXmlControl(ctrl: OscalControl, indent: string): string {
  const lines: string[] = [];
  const clsAttr = ctrl.class ? ` class="${escapeXml(ctrl.class)}"` : "";
  lines.push(`${indent}<control id="${escapeXml(ctrl.id)}"${clsAttr}>`);
  lines.push(`${indent}  <title>${escapeXml(ctrl.title)}</title>`);
  if (ctrl.params) {
    for (const p of ctrl.params) {
      lines.push(`${indent}  <param id="${escapeXml(p.id)}">`);
      if (p.label) lines.push(`${indent}    <label>${escapeXml(p.label)}</label>`);
      if (p.values) {
        for (const v of p.values) {
          lines.push(`${indent}    <value>${escapeXml(v)}</value>`);
        }
      }
      lines.push(`${indent}  </param>`);
    }
  }
  if (ctrl.parts) {
    for (const pt of ctrl.parts) {
      const idAttr = pt.id ? ` id="${escapeXml(pt.id)}"` : "";
      lines.push(`${indent}  <part${idAttr} name="${escapeXml(pt.name)}">`);
      if (pt.prose) lines.push(`${indent}    <p>${escapeXml(pt.prose)}</p>`);
      lines.push(`${indent}  </part>`);
    }
  }
  if (ctrl.controls) {
    for (const sub of ctrl.controls) {
      lines.push(serializeXmlControl(sub, `${indent}  `));
    }
  }
  lines.push(`${indent}</control>`);
  return lines.join("\n");
}

function serializeToXml(doc: OscalDocument): string {
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<${doc.kind} xmlns="http://csrc.nist.gov/ns/oscal/1.0" uuid="${escapeXml(doc.uuid)}">`,
    `  <metadata>`,
    `    <title>${escapeXml(doc.metadata.title)}</title>`,
    `    <version>${escapeXml(doc.metadata.version)}</version>`,
    `    <oscal-version>${escapeXml(doc.metadata.oscalVersion ?? "1.1.2")}</oscal-version>`,
    `  </metadata>`,
  ];

  if (doc.groups) {
    for (const g of doc.groups) {
      const clsAttr = g.class ? ` class="${escapeXml(g.class)}"` : "";
      lines.push(`  <group id="${escapeXml(g.id)}"${clsAttr}>`);
      lines.push(`    <title>${escapeXml(g.title)}</title>`);
      if (g.controls) {
        for (const c of g.controls) {
          lines.push(serializeXmlControl(c, "    "));
        }
      }
      lines.push(`  </group>`);
    }
  }

  if (doc.controls) {
    for (const c of doc.controls) {
      lines.push(serializeXmlControl(c, "  "));
    }
  }

  if (doc.imports) {
    for (const imp of doc.imports) {
      lines.push(`  <import href="${escapeXml(imp.href)}">`);
      if (imp.includeAll) {
        lines.push(`    <include-all/>`);
      }
      if (imp.includeControls && imp.includeControls.length > 0) {
        lines.push(`    <include-controls>`);
        for (const id of imp.includeControls) {
          lines.push(`      <with-id>${escapeXml(id)}</with-id>`);
        }
        lines.push(`    </include-controls>`);
      }
      if (imp.excludeControls && imp.excludeControls.length > 0) {
        lines.push(`    <exclude-controls>`);
        for (const id of imp.excludeControls) {
          lines.push(`      <with-id>${escapeXml(id)}</with-id>`);
        }
        lines.push(`    </exclude-controls>`);
      }
      lines.push(`  </import>`);
    }
  }

  if (doc.modify) {
    lines.push(`  <modify>`);
    if (doc.modify.setParameters) {
      for (const sp of doc.modify.setParameters) {
        lines.push(`    <set-parameter param-id="${escapeXml(sp.paramId)}">`);
        for (const v of sp.values) {
          lines.push(`      <value>${escapeXml(v)}</value>`);
        }
        lines.push(`    </set-parameter>`);
      }
    }
    if (doc.modify.alters) {
      for (const alt of doc.modify.alters) {
        lines.push(`    <alter control-id="${escapeXml(alt.controlId)}">`);
        if (alt.adds) {
          for (const add of alt.adds) {
            lines.push(`      <add position="${escapeXml(add.position ?? "ending")}">`);
            if (add.parts) {
              for (const pt of add.parts) {
                lines.push(`        <part name="${escapeXml(pt.name)}">`);
                if (pt.prose) lines.push(`          <p>${escapeXml(pt.prose)}</p>`);
                lines.push(`        </part>`);
              }
            }
            lines.push(`      </add>`);
          }
        }
        lines.push(`    </alter>`);
      }
    }
    lines.push(`  </modify>`);
  }

  if (doc.components) {
    for (const c of doc.components) {
      lines.push(`  <component uuid="${escapeXml(c.uuid)}" type="${escapeXml(c.type)}">`);
      lines.push(`    <title>${escapeXml(c.title)}</title>`);
      if (c.description) lines.push(`    <description>${escapeXml(c.description)}</description>`);
      lines.push(`  </component>`);
    }
  }

  if (doc.importProfile) {
    lines.push(`  <import-profile href="${escapeXml(doc.importProfile.href)}"/>`);
  }

  if (doc.systemCharacteristics) {
    lines.push(`  <system-characteristics>`);
    lines.push(`    <system-name>${escapeXml(doc.systemCharacteristics.systemName)}</system-name>`);
    if (doc.systemCharacteristics.description) {
      lines.push(`    <description>${escapeXml(doc.systemCharacteristics.description)}</description>`);
    }
    if (doc.systemCharacteristics.securitySensitivityLevel) {
      lines.push(
        `    <security-sensitivity-level>${escapeXml(doc.systemCharacteristics.securitySensitivityLevel)}</security-sensitivity-level>`,
      );
    }
    lines.push(`  </system-characteristics>`);
  }

  if (doc.systemImplementation) {
    lines.push(`  <system-implementation>`);
    for (const c of doc.systemImplementation.components) {
      lines.push(`    <component uuid="${escapeXml(c.uuid)}" type="${escapeXml(c.type)}">`);
      lines.push(`      <title>${escapeXml(c.title)}</title>`);
      if (c.description) lines.push(`      <description>${escapeXml(c.description)}</description>`);
      lines.push(`    </component>`);
    }
    lines.push(`  </system-implementation>`);
  }

  if (doc.controlImplementation) {
    lines.push(`  <control-implementation>`);
    if (doc.controlImplementation.description) {
      lines.push(`    <description>${escapeXml(doc.controlImplementation.description)}</description>`);
    }
    if (doc.controlImplementation.setParameters) {
      for (const sp of doc.controlImplementation.setParameters) {
        lines.push(`    <set-parameter param-id="${escapeXml(sp.paramId)}">`);
        for (const v of sp.values) {
          lines.push(`      <value>${escapeXml(v)}</value>`);
        }
        lines.push(`    </set-parameter>`);
      }
    }
    for (const ir of doc.controlImplementation.implementedRequirements) {
      lines.push(`    <implemented-requirement uuid="${escapeXml(ir.uuid)}" control-id="${escapeXml(ir.controlId)}">`);
      if (ir.description) lines.push(`      <description>${escapeXml(ir.description)}</description>`);
      if (ir.setParameters) {
        for (const sp of ir.setParameters) {
          lines.push(`      <set-parameter param-id="${escapeXml(sp.paramId)}">`);
          for (const v of sp.values) {
            lines.push(`        <value>${escapeXml(v)}</value>`);
          }
          lines.push(`      </set-parameter>`);
        }
      }
      if (ir.byComponents) {
        for (const bc of ir.byComponents) {
          lines.push(
            `      <by-component component-uuid="${escapeXml(bc.componentUuid)}" uuid="${escapeXml(bc.uuid)}">`,
          );
          lines.push(`        <description>${escapeXml(bc.description)}</description>`);
          lines.push(`      </by-component>`);
        }
      }
      lines.push(`    </implemented-requirement>`);
    }
    lines.push(`  </control-implementation>`);
  }

  if (doc.findings) {
    for (const f of doc.findings) {
      lines.push(
        `  <finding uuid="${escapeXml(f.uuid)}" target-control-id="${escapeXml(f.targetControlId)}" severity="${escapeXml(f.severity)}" status="${escapeXml(f.status)}">`,
      );
      lines.push(`    <title>${escapeXml(f.title)}</title>`);
      if (f.description) lines.push(`    <description>${escapeXml(f.description)}</description>`);
      lines.push(`  </finding>`);
    }
  }

  if (doc.poamItems) {
    for (const p of doc.poamItems) {
      const rfAttr = p.relatedFindingUuid ? ` related-finding-uuid="${escapeXml(p.relatedFindingUuid)}"` : "";
      const tcAttr = p.targetControlId ? ` target-control-id="${escapeXml(p.targetControlId)}"` : "";
      lines.push(`  <poam-item uuid="${escapeXml(p.uuid)}"${rfAttr}${tcAttr} status="${escapeXml(p.status)}">`);
      lines.push(`    <title>${escapeXml(p.title)}</title>`);
      if (p.description) lines.push(`    <description>${escapeXml(p.description)}</description>`);
      lines.push(`  </poam-item>`);
    }
  }

  lines.push(`</${doc.kind}>`);
  return lines.join("\n");
}

/**
 * Serializes an `OscalDocument` into JSON, YAML, or XML format.
 */
export function serializeOscal(doc: OscalDocument, format: "json" | "yaml" | "xml"): string {
  if (format === "json") {
    return JSON.stringify(toCanonicalJsonObject(doc), null, 2);
  }
  if (format === "yaml") {
    return serializeYamlValue(toCanonicalJsonObject(doc), 0);
  }
  if (format === "xml") {
    return serializeToXml(doc);
  }
  throw new Error(`Unsupported OSCAL serialization format: '${String(format)}'.`);
}
