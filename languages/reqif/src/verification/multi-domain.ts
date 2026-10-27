// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/reqif — Multi-Domain Formal Verification Bridge.
 *
 * Couples parsed ReqIF requirement hierarchies and contracts with
 * @modelscript/runtime's MultiDomainVerificationCoordinator and Nelson-Oppen
 * SemanticTheoryCoordinator to prove multi-domain compliance against:
 *   - PSS/E and PSCAD high-voltage electrical power grids
 *   - SIMA offshore marine mooring and DNV-OS-E301 regulatory standards
 *   - FEA structural mechanics and material yield constraints
 *   - CFD aerodynamics, drag, and acoustic flow limits
 */

import {
  MultiDomainVerificationCoordinator,
  type MultiDomainDecks,
  type MultiDomainVerificationReport,
  type RequirementContractSpec,
} from "@modelscript/runtime";
import type { ReqIfDocument } from "../types.js";

/**
 * Regex patterns to extract contract constraints from natural language text when not explicitly tagged.
 */
const INLINE_CONTRACT_PATTERNS = [
  /(\b(?:voltage|bus_voltage|grid_voltage|voltage_pu)\b)\s*(<=|>=|<|>|==|=)\s*([0-9]+(?:\.[0-9]+)?)\s*(p\.u\.|pu|V|kV)?/i,
  /(\b(?:safety_factor|mooring_sf|mooring_safety_factor|sf)\b)\s*(<=|>=|<|>|==|=)\s*([0-9]+(?:\.[0-9]+)?)/i,
  /(\b(?:von_mises_stress|stress|yield_strength|stress_pa)\b)\s*(<=|>=|<|>|==|=)\s*([0-9]+(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?)\s*(MPa|GPa|Pa)?/i,
  /(\b(?:drag_coeff|drag_coefficient|cd|aero_drag)\b)\s*(<=|>=|<|>|==|=)\s*([0-9]+(?:\.[0-9]+)?)/i,
  /(\b(?:line_tension|tension|max_tension)\b)\s*(<=|>=|<|>|==|=)\s*([0-9]+(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?)\s*(kN|MN|N)?/i,
  /(\b(?:offset|floater_offset|platform_offset)\b)\s*(<=|>=|<|>|==|=)\s*([0-9]+(?:\.[0-9]+)?)\s*(m|meters)?/i,
];

function normalizeContractValue(value: number, unit?: string): number {
  if (!unit) return value;
  const u = unit.trim().toLowerCase();
  if (u === "mpa") return value * 1e6;
  if (u === "gpa") return value * 1e9;
  if (u === "kpa") return value * 1e3;
  if (u === "kn") return value * 1e3;
  if (u === "mn") return value * 1e6;
  if (u === "kw") return value * 1e3;
  if (u === "mw") return value * 1e6;
  if (u === "kv") return value * 1e3;
  return value;
}

export function verifyReqIfMultiDomain(doc: ReqIfDocument, decks: MultiDomainDecks): MultiDomainVerificationReport {
  const coordinator = new MultiDomainVerificationCoordinator();
  const requirements: RequirementContractSpec[] = [];

  for (const obj of doc.specObjects.values()) {
    if (obj.contract) {
      const normalizedLimit = normalizeContractValue(obj.contract.limitValue, obj.contract.unit);
      requirements.push({
        id: obj.identifier,
        variable: obj.contract.variable,
        operator: obj.contract.comparator === "!=" ? "<=" : obj.contract.comparator,
        limitValue: normalizedLimit,
        unit: obj.contract.unit,
        description: obj.longName || obj.text,
      });
    } else if (obj.text) {
      // Attempt heuristic contract extraction from text
      for (const pattern of INLINE_CONTRACT_PATTERNS) {
        const match = obj.text.match(pattern);
        if (match) {
          const rawVar = (match[1] ?? "").toLowerCase();
          const rawOp: RequirementContractSpec["operator"] =
            match[2] === "=" ? "==" : (match[2] as RequirementContractSpec["operator"]);
          const unit = match[4] || "";
          const val = normalizeContractValue(parseFloat(match[3] ?? "0"), unit);

          requirements.push({
            id: obj.identifier,
            variable: rawVar,
            operator: rawOp,
            limitValue: val,
            unit,
            description: obj.longName || obj.text,
          });
          break;
        }
      }
    }
  }

  return coordinator.verify(requirements, decks);
}
