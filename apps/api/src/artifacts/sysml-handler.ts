// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ArtifactHandler, ArtifactMetadata, ArtifactViewDescriptor } from "./registry.js";

export interface ExtractedSysmlPart {
  name: string;
  type: string;
  multiplicity?: string | undefined;
  ports?: string[] | undefined;
  description?: string | undefined;
}

export interface ExtractedSysmlRequirement {
  id: string;
  name: string;
  text: string;
  status: "satisfied" | "verified" | "unverified" | "violated";
}

export interface ExtractedSysmlConnection {
  source: string;
  target: string;
  flowType?: string | undefined;
}

export function parseSysmlSourceMetadata(
  code: string,
  filePath = "model.sysml",
): {
  format: "SysML2" | "KerML";
  systemName: string;
  code: string;
  parts: ExtractedSysmlPart[];
  requirements: ExtractedSysmlRequirement[];
  connections: ExtractedSysmlConnection[];
} {
  const format: "SysML2" | "KerML" = filePath.toLowerCase().endsWith(".kerml") ? "KerML" : "SysML2";
  const pkgMatch = code.match(/\b(?:package|part\s+def|system)\s+([A-Za-z_][A-Za-z0-9_]*)/);
  const fallbackName =
    filePath
      .split("/")
      .pop()
      ?.replace(/\.(sysml|kerml)$/i, "") || "SystemArchitecture";
  const systemName = pkgMatch?.[1] ?? fallbackName;

  const parts: ExtractedSysmlPart[] = [];
  const requirements: ExtractedSysmlRequirement[] = [];
  const connections: ExtractedSysmlConnection[] = [];

  // Map part def names to their declared ports and doc comments
  const partDefPorts = new Map<string, string[]>();
  const partDefDocs = new Map<string, string>();
  const partDefRegex = /\bpart\s+def\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:>\s*[A-Za-z0-9_.:,\s]+)?\s*\{([\s\S]*?)\}/g;
  let m: RegExpExecArray | null;
  while ((m = partDefRegex.exec(code)) !== null) {
    const defName = m[1]!;
    const body = m[2] ?? "";
    const ports: string[] = [];
    const portRegex = /\bport\s+(?:in\s+|out\s+|inout\s+)?([A-Za-z_][A-Za-z0-9_]*)/g;
    let pm: RegExpExecArray | null;
    while ((pm = portRegex.exec(body)) !== null) {
      if (pm[1]) ports.push(pm[1]);
    }
    partDefPorts.set(defName, ports);
    const docMatch = body.match(/doc\s*\/\*\s*([\s\S]*?)\s*\*\//);
    if (docMatch?.[1]) {
      partDefDocs.set(defName, docMatch[1].trim());
    }
  }

  // Extract part usages: part <name> : <Type>[mult]
  const partUsageRegex =
    /\bpart\s+(?!def\b)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_.:]*)(?:\s*\[([^\]]+)\])?/g;
  const seenParts = new Set<string>();
  while ((m = partUsageRegex.exec(code)) !== null) {
    const name = m[1]!;
    const type = m[2]!;
    const multiplicity = m[3]?.trim() || "1";
    if (!seenParts.has(name)) {
      seenParts.add(name);
      const shortType = type.split("::").pop()?.split(".").pop() ?? type;
      parts.push({
        name,
        type,
        multiplicity,
        ports: partDefPorts.get(shortType) ?? [],
        description: partDefDocs.get(shortType),
      });
    }
  }

  // If no part usages were found, surface part definitions as parts
  if (parts.length === 0) {
    for (const [defName, ports] of partDefPorts.entries()) {
      parts.push({
        name: defName,
        type: "PartDefinition",
        multiplicity: "1",
        ports,
        description: partDefDocs.get(defName),
      });
    }
  }

  // Extract requirement definitions and usages
  const satisfiedReqs = new Set<string>();
  const verifiedReqs = new Set<string>();
  const satisfyRegex = /\bsatisfy\s+(?:requirement\s+)?([A-Za-z_][A-Za-z0-9_.:]*)/g;
  while ((m = satisfyRegex.exec(code)) !== null) {
    if (m[1]) satisfiedReqs.add(m[1].split("::").pop()?.split(".").pop() ?? m[1]);
  }
  const verifyRegex = /\bverify\s+(?:requirement\s+)?([A-Za-z_][A-Za-z0-9_.:]*)/g;
  while ((m = verifyRegex.exec(code)) !== null) {
    if (m[1]) verifiedReqs.add(m[1].split("::").pop()?.split(".").pop() ?? m[1]);
  }

  const reqRegex = /\brequirement\s+(?:def\s+)?(?:\s*<([^>]+)>\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\}/g;
  let reqIdx = 1;
  while ((m = reqRegex.exec(code)) !== null) {
    const explicitId = m[1]?.trim().replace(/^['"]|['"]$/g, "");
    const reqName = m[2]!;
    const body = m[3] ?? "";
    const docMatch = body.match(/doc\s*\/\*\s*([\s\S]*?)\s*\*\//);
    const text = docMatch?.[1]?.trim() || `Requirement ${reqName}`;
    const id = explicitId || `REQ-${String(reqIdx).padStart(2, "0")}`;
    reqIdx++;
    const status = verifiedReqs.has(reqName) ? "verified" : satisfiedReqs.has(reqName) ? "satisfied" : "unverified";
    requirements.push({ id, name: reqName, text, status });
  }

  // Extract connections: connect <source> to <target>
  const connRegex = /\bconnect\s+([A-Za-z0-9_.]+)\s+to\s+([A-Za-z0-9_.]+)/g;
  while ((m = connRegex.exec(code)) !== null) {
    connections.push({
      source: m[1]!,
      target: m[2]!,
    });
  }

  // Extract flow connections: flow of <FlowType> from <source> to <target>
  const flowRegex = /\bflow\s+(?:of\s+([A-Za-z0-9_.:]+)\s+)?from\s+([A-Za-z0-9_.]+)\s+to\s+([A-Za-z0-9_.]+)/g;
  while ((m = flowRegex.exec(code)) !== null) {
    connections.push({
      source: m[2]!,
      target: m[3]!,
      flowType: m[1],
    });
  }

  return {
    format,
    systemName,
    code,
    parts,
    requirements,
    connections,
  };
}

export class SysmlArtifactHandler implements ArtifactHandler {
  readonly type = "sysml";
  readonly displayName = "SysML v2 Architecture";
  readonly extensions = [".sysml", ".kerml"];

  async extractMetadata(fileBuffer: Buffer, filePath: string): Promise<ArtifactMetadata | null> {
    const code = fileBuffer.toString("utf-8");
    const parsed = parseSysmlSourceMetadata(code, filePath);
    return {
      type: this.type,
      path: filePath,
      description: `SysML v2 System Definition (${parsed.systemName})`,
      details: parsed as unknown as Record<string, unknown>,
    };
  }

  validate(_artifact: Record<string, unknown>): string[] {
    return [];
  }

  getViewDescriptor(metadata: ArtifactMetadata): ArtifactViewDescriptor | null {
    return {
      viewer: "sysml-architecture-viewer",
      label: "System Architecture",
      icon: "schema",
      config: { ...metadata.details },
    };
  }
}
