// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic Linter for IEC 61850 Substation Configuration Language (SCL).
 */

import { validateGooseStreams } from "../analysis/goose-validator.js";
import type { SclDocument } from "../types.js";

export interface SclDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  iedName?: string | undefined;
  bayName?: string | undefined;
}

export const SclErrorCode = {
  INVALID_HEADER: "SCL1001",
  MISSING_REQUIRED_LN: "SCL2001",
  UNBOUND_DATASET: "SCL2002",
  MISSING_SUBNET_ADDRESS: "SCL3001",
  TRIP_LATENCY_VIOLATION: "SCL3002",
  EQUIPMENT_MISSING_TERMINAL: "SCL4001",
} as const;

export const SCL_ERROR_CODES = SclErrorCode;

/**
 * Lints an SCL document for schema, logical node completeness, and GOOSE communications.
 */
export function lintSclDocument(doc: SclDocument): SclDiagnostic[] {
  const diagnostics: SclDiagnostic[] = [];

  // 1. SCL1001: Header validation
  if (!doc.header.id || doc.header.id.trim().length === 0) {
    diagnostics.push({
      code: SclErrorCode.INVALID_HEADER,
      severity: "error",
      message: "SCL document is missing a valid <Header id> attribute.",
    });
  }

  // 2. SCL2001: Check IEDs for LLN0
  for (const [iedName, ied] of doc.ieds) {
    let hasLln0 = false;

    for (const [, ap] of ied.accessPoints) {
      if (!ap.server) continue;
      for (const [, ld] of ap.server.logicalDevices) {
        for (const [, ln] of ld.logicalNodes) {
          if (ln.lnClass === "LLN0") {
            hasLln0 = true;
            break;
          }
        }
      }
    }

    if (!hasLln0 && ied.accessPoints.size > 0) {
      diagnostics.push({
        code: SclErrorCode.MISSING_REQUIRED_LN,
        severity: "error",
        message: `IED '${iedName}' lacks mandatory logical node zero (LLN0).`,
        iedName,
      });
    }
  }

  // 3. SCL4001: Conducting equipment validation
  if (doc.substation) {
    for (const vl of doc.substation.voltageLevels) {
      for (const bay of vl.bays) {
        for (const ce of bay.conductingEquipment) {
          if (ce.terminals.length === 0) {
            diagnostics.push({
              code: SclErrorCode.EQUIPMENT_MISSING_TERMINAL,
              severity: "warning",
              message: `ConductingEquipment '${ce.name}' in bay '${bay.name}' has no defined <Terminal> connections.`,
              bayName: bay.name,
            });
          }
        }
      }
    }
  }

  // 4. GOOSE stream diagnostics (SCL2002, SCL3001, SCL3002)
  const gooseReport = validateGooseStreams(doc);
  for (const gd of gooseReport.diagnostics) {
    diagnostics.push({
      code: gd.code,
      severity: gd.severity,
      message: gd.message,
      iedName: gd.iedName,
    });
  }

  return diagnostics;
}
