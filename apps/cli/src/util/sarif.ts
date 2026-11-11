// SPDX-License-Identifier: AGPL-3.0-or-later

import path from "node:path";

export interface SarifArtifactLocation {
  uri: string;
  uriBaseId?: string;
}

export interface SarifRegion {
  startLine: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
  byteOffset?: number;
  byteLength?: number;
}

export interface SarifPhysicalLocation {
  artifactLocation: SarifArtifactLocation;
  region?: SarifRegion;
}

export interface SarifLocation {
  physicalLocation: SarifPhysicalLocation;
}

export interface SarifRuleDescriptor {
  id: string;
  name: string;
  shortDescription?: { text: string };
  fullDescription?: { text: string };
  defaultConfiguration?: {
    level?: "error" | "warning" | "note" | "none";
  };
  helpUri?: string;
}

export interface SarifResult {
  ruleId: string;
  ruleIndex?: number;
  level: "error" | "warning" | "note" | "none";
  message: { text: string };
  locations: SarifLocation[];
}

export interface SarifRun {
  tool: {
    driver: {
      name: string;
      version?: string;
      semanticVersion?: string;
      informationUri?: string;
      rules: SarifRuleDescriptor[];
    };
  };
  results: SarifResult[];
}

export interface SarifLog {
  $schema: string;
  version: "2.1.0";
  runs: SarifRun[];
}

export interface DiagItemForSarif {
  resource: string;
  line: number;
  col: number;
  startOffset?: number;
  endOffset?: number;
  severity: "error" | "warning" | "info" | "hint" | "notification";
  code?: string | undefined;
  lintName: string;
  message: string;
}

export function toSarifLevel(severity: DiagItemForSarif["severity"]): "error" | "warning" | "note" | "none" {
  switch (severity) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "info":
    case "hint":
      return "note";
    case "notification":
      return "none";
    default:
      return "warning";
  }
}

/**
 * Builds an OASIS SARIF v2.1.0 log document from ModelScript lint diagnostics.
 */
export function buildSarifLog(
  diagnostics: DiagItemForSarif[],
  sarifBaseDir: string = process.cwd(),
  toolVersion: string = "1.0.0",
): SarifLog {
  const rulesMap = new Map<string, { descriptor: SarifRuleDescriptor; index: number }>();
  const results: SarifResult[] = [];

  for (const d of diagnostics) {
    const ruleId = d.code && d.code.length > 0 ? d.code : d.lintName;
    const sarifLevel = toSarifLevel(d.severity);

    let ruleEntry = rulesMap.get(ruleId);
    if (!ruleEntry) {
      const index = rulesMap.size;
      const descriptor: SarifRuleDescriptor = {
        id: ruleId,
        name: d.lintName,
        shortDescription: { text: d.lintName },
        defaultConfiguration: { level: sarifLevel },
      };
      ruleEntry = { descriptor, index };
      rulesMap.set(ruleId, ruleEntry);
    }

    // Compute relative URI from sarifBaseDir
    const absPath = path.isAbsolute(d.resource) ? d.resource : path.resolve(process.cwd(), d.resource);
    const relUri = path.relative(sarifBaseDir, absPath).replace(/\\/g, "/");

    const byteLengthVal =
      d.startOffset !== undefined && d.endOffset !== undefined && d.endOffset >= d.startOffset
        ? d.endOffset - d.startOffset
        : undefined;

    const region: SarifRegion = {
      startLine: Math.max(1, d.line),
      startColumn: Math.max(1, d.col),
      endLine: Math.max(1, d.line),
      endColumn: Math.max(1, d.col + (byteLengthVal ?? 1)),
    };
    if (d.startOffset !== undefined && d.startOffset >= 0) {
      region.byteOffset = d.startOffset;
    }
    if (byteLengthVal !== undefined) {
      region.byteLength = byteLengthVal;
    }

    results.push({
      ruleId,
      ruleIndex: ruleEntry.index,
      level: sarifLevel,
      message: { text: d.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: relUri,
            },
            region,
          },
        },
      ],
    });
  }

  const rules = Array.from(rulesMap.values())
    .sort((a, b) => a.index - b.index)
    .map((r) => r.descriptor);

  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "ModelScript",
            semanticVersion: toolVersion,
            informationUri: "https://modelscript.org",
            rules,
          },
        },
        results,
      },
    ],
  };
}
