// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — SysML v2 Requirement Binding & Digital-Thread Synchronization.
 *
 * Implements Phase 2.6:
 *   - Parses formal requirements from SysML v2 syntax (requirement def, require constraint).
 *   - Extracts digital thread `twin` annotations from Modelica declarations.
 *   - Binds SysML requirement constraints dynamically to Modelica state and algebraic variables
 *     without relying on hardcoded name regexes.
 *   - Translates bound constraints into LinearSafetyRequirement objects for validated reachability solvers.
 */

import type { LinearSafetyRequirement } from "../analysis/wasm_zonotope_reach.js";
import type { SemanticTheoryCoordinator } from "./theory_coordinator.js";

export interface SysmlRequirement {
  id: string;
  qualifiedName?: string;
  targetAttribute: string;
  operator: "<=" | ">=" | "<" | ">";
  limitValue: number;
  rawConstraint?: string;
  subjectName?: string;
}

/**
 * Parses formal requirements from SysML v2 source text.
 *
 * Supports patterns such as:
 * ```sysml
 * requirement def FlightCeilingRequirement {
 *   attribute v_climb : Real;
 *   attribute v_climb_max : Real = 12.0;
 *   require constraint { v_climb <= v_climb_max }
 * }
 * ```
 */
export function parseSysmlRequirements(sysmlText: string): SysmlRequirement[] {
  const requirements: SysmlRequirement[] = [];

  // Match requirement def / requirement blocks using brace counting for nested blocks
  const headerRegex = /(?:abstract\s+)?requirement(?:\s+def)?\s+([A-Za-z0-9_]+)\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = headerRegex.exec(sysmlText)) !== null) {
    const reqId = match[1]!;
    const startIndex = headerRegex.lastIndex;
    let depth = 1;
    let endIndex = startIndex;
    while (endIndex < sysmlText.length && depth > 0) {
      const ch = sysmlText[endIndex]!;
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      endIndex++;
    }
    const body = sysmlText.slice(startIndex, endIndex - 1);

    // 1. Extract attributes and their values: attribute <name> : <Type> = <val>;
    const attrMap = new Map<string, number>();
    const attrRegex = /attribute\s+([A-Za-z0-9_]+)\s*:\s*[A-Za-z0-9_]+\s*=\s*([0-9.eE+-]+)/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(body)) !== null) {
      const aName = attrMatch[1]!;
      const aVal = parseFloat(attrMatch[2]!);
      if (Number.isFinite(aVal)) {
        attrMap.set(aName, aVal);
      }
    }

    // 2. Extract subject if specified: subject <name> : <Type>;
    let subjectName: string | undefined;
    const subjectMatch = /subject\s+([A-Za-z0-9_]+)/.exec(body);
    if (subjectMatch) subjectName = subjectMatch[1];

    // 3. Extract require constraints: require constraint { <var> <op> <limit> }
    const constraintRegex = /require\s+constraint\s*\{([^}]+)\}/g;
    let cMatch: RegExpExecArray | null;
    while ((cMatch = constraintRegex.exec(body)) !== null) {
      const rawExpr = cMatch[1]!.trim();
      // Match binary comparisons: <lhs> (<=|>=|<|>) <rhs>
      const compMatch = /^\s*([A-Za-z0-9_.]+)\s*(<=|>=|<|>)\s*([A-Za-z0-9_.-]+)/.exec(rawExpr);
      if (compMatch) {
        const lhsVar = compMatch[1]!;
        const op = compMatch[2]! as "<=" | ">=" | "<" | ">";
        const rhsToken = compMatch[3]!;

        // Resolve limit: either literal number or attribute name
        let limitVal = parseFloat(rhsToken);
        if (!Number.isFinite(limitVal)) {
          const attrVal = attrMap.get(rhsToken);
          if (attrVal !== undefined) {
            limitVal = attrVal;
          }
        }

        if (Number.isFinite(limitVal)) {
          requirements.push({
            id: reqId,
            targetAttribute: lhsVar,
            operator: op,
            limitValue: limitVal,
            rawConstraint: rawExpr,
            subjectName,
          });
        }
      }
    }
  }

  return requirements;
}

/**
 * Extracts digital thread `twin` annotations from Modelica source text.
 *
 * Example:
 *   Real v(start = 0.0) annotation(twin = "SysML2::DroneReachabilitySystem::FlightCeilingRequirement.v_climb");
 * Maps "v" -> "SysML2::DroneReachabilitySystem::FlightCeilingRequirement.v_climb".
 */
export function extractModelicaTwinAnnotations(moText: string): Map<string, string> {
  const twinMap = new Map<string, string>();
  const lines = moText.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Find variable name in declaration: (Real|Integer|Boolean|parameter ...) <name>
    const varDeclMatch = /(?:parameter\s+)?(?:Real|Integer|Boolean|[A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\b/.exec(line);
    if (!varDeclMatch) continue;

    const varName = varDeclMatch[1]!;
    if (varName === "der" || varName === "model" || varName === "block" || varName === "equation") continue;

    // Check for twin annotation on this line or upcoming continuation lines
    let scanWindow = line;
    for (let j = 1; j <= 3 && i + j < lines.length; j++) {
      if (scanWindow.includes(";")) break;
      scanWindow += " " + lines[i + j]!;
    }

    const twinMatch = /(?:twin|counterpart|implements)\s*=\s*"([^"]+)"/i.exec(scanWindow);
    if (twinMatch) {
      twinMap.set(varName, twinMatch[1]!);
    }
  }

  return twinMap;
}

/**
 * Binds SysML requirements to Modelica state and algebraic variables.
 *
 * Matching priority:
 *   1. Explicit `twin` annotation: e.g. twin="...::FlightCeilingRequirement.v_climb"
 *   2. Qualified name target: e.g. twin="...v_climb" matching req.targetAttribute
 *   3. Direct attribute name parity: e.g. state variable is named "v_climb" or "v" matches target "v"
 */
export function bindRequirementsToModelica(
  requirements: SysmlRequirement[],
  stateNames: string[],
  twinMap: Map<string, string> = new Map(),
): LinearSafetyRequirement[] {
  const boundReqs: LinearSafetyRequirement[] = [];

  for (let s = 0; s < stateNames.length; s++) {
    const varName = stateNames[s]!;
    const twinTarget = twinMap.get(varName);

    for (const req of requirements) {
      let isMatch = false;

      if (twinTarget) {
        // Direct match with requirement ID and attribute
        if (
          twinTarget.includes(`${req.id}.${req.targetAttribute}`) ||
          twinTarget.endsWith(`.${req.targetAttribute}`) ||
          twinTarget === req.targetAttribute
        ) {
          isMatch = true;
        }
      }

      // Name parity fallback if no explicit twin or twin target matches requirement
      if (!isMatch) {
        if (
          varName === req.targetAttribute ||
          (req.targetAttribute.startsWith(`${varName}_`) && req.targetAttribute.length > varName.length)
        ) {
          isMatch = true;
        }
      }

      if (isMatch) {
        boundReqs.push({
          name: `${req.id}.${req.targetAttribute}`,
          stateIndex: s,
          operator: req.operator,
          limitValue: req.limitValue,
        });
      }
    }
  }

  return boundReqs;
}

/**
 * Asserts SysML requirements into the Formal Semantic Theory Coordinator as literals.
 */
export function assertRequirementsToTheoryCoordinator(
  coordinator: SemanticTheoryCoordinator,
  requirements: SysmlRequirement[],
): void {
  for (const req of requirements) {
    coordinator.assertLiteral({
      predicate: "requirement",
      args: [req.id, req.targetAttribute, req.operator, req.limitValue],
      domain: "continuous_safety",
    });
  }
}
