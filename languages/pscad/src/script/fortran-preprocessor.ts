// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Preprocessor for PSCAD Fortran script segments (<segment name="Fortran"> / <segment name="Dsdyn">).
 *
 * Resolves compile-time parameter macros, conditional #IF / #ELSEIF / #ELSE / #ENDIF blocks,
 * storage declarations (#STORAGE REAL:m INTEGER:n), local variable declarations (#LOCAL),
 * and parameter/port substitutions ($Name, $#DIM(port)).
 */

import { evaluateCondition } from "./script-parser.js";

export interface PreprocessedFortran {
  lines: string[];
  numRealStates: number;
  numIntStates: number;
  localReals: Set<string>;
  localInts: Set<string>;
  referencedPorts: Set<string>;
  assignedPorts: Set<string>;
}

export function preprocessFortranSegment(
  scriptText: string,
  params: Record<string, string | number> = {},
  portDims: Record<string, number> = {},
): PreprocessedFortran {
  let numRealStates = 0;
  let numIntStates = 0;
  const localReals = new Set<string>();
  const localInts = new Set<string>();
  const referencedPorts = new Set<string>();
  const assignedPorts = new Set<string>();
  const outputLines: string[] = [];

  if (!scriptText || !scriptText.trim()) {
    return {
      lines: [],
      numRealStates: 0,
      numIntStates: 0,
      localReals,
      localInts,
      referencedPorts,
      assignedPorts,
    };
  }

  const rawLines = scriptText.split(/\r?\n/);
  const guardStack: { active: boolean; anyTaken: boolean }[] = [];

  for (const rawLine of rawLines) {
    let line = rawLine.trim();
    if (!line) continue;

    // Ignore comment lines starting with ! or C or c in standard Fortran
    if (line.startsWith("!") || (/^[Cc*]\s/.test(rawLine) && !line.startsWith("CALL "))) {
      continue;
    }

    // Strip inline comments starting with !
    const exclamIdx = line.indexOf("!");
    if (exclamIdx >= 0) {
      line = line.slice(0, exclamIdx).trim();
      if (!line) continue;
    }

    // 1. Handle Preprocessor Directives starting with '#'
    if (line.startsWith("#")) {
      // Normalize e.g. #if, #IF, #else, #ELSE
      const directiveMatch = /^#\s*([A-Za-z0-9_]+)\b(.*)$/i.exec(line);
      if (directiveMatch) {
        const dir = directiveMatch[1]!.toUpperCase();
        const arg = directiveMatch[2]!.trim();

        if (dir === "IF") {
          const parentActive = guardStack.every((g) => g.active);
          const cond = parentActive && evaluateCondition(arg, params, portDims);
          guardStack.push({ active: cond, anyTaken: cond });
          continue;
        } else if (dir === "ELSEIF") {
          if (guardStack.length > 0) {
            const top = guardStack[guardStack.length - 1]!;
            const parentActive = guardStack.slice(0, -1).every((g) => g.active);
            if (top.anyTaken || !parentActive) {
              top.active = false;
            } else {
              const cond = evaluateCondition(arg, params, portDims);
              top.active = cond;
              if (cond) top.anyTaken = true;
            }
          }
          continue;
        } else if (dir === "ELSE") {
          if (guardStack.length > 0) {
            const top = guardStack[guardStack.length - 1]!;
            const parentActive = guardStack.slice(0, -1).every((g) => g.active);
            // In PSCAD, sometimes #else contains an expression comment like '#else operation==1'
            top.active = parentActive && !top.anyTaken;
            top.anyTaken = true;
          }
          continue;
        } else if (dir === "ENDIF") {
          guardStack.pop();
          continue;
        } else if (dir === "STORAGE") {
          // Syntax: #STORAGE REAL:M INTEGER:N
          const realMatch = /REAL\s*:\s*([0-9]+)/i.exec(arg);
          if (realMatch) {
            numRealStates = Math.max(numRealStates, parseInt(realMatch[1]!, 10));
          }
          const intMatch = /INTEGER\s*:\s*([0-9]+)/i.exec(arg);
          if (intMatch) {
            numIntStates = Math.max(numIntStates, parseInt(intMatch[1]!, 10));
          }
          continue;
        } else if (dir === "LOCAL") {
          // Syntax: #LOCAL REAL var1, var2 or #LOCAL INTEGER var1
          const typeMatch = /^(REAL|INTEGER)\b(.*)$/i.exec(arg);
          if (typeMatch) {
            const varType = typeMatch[1]!.toUpperCase();
            const varNames = typeMatch[2]!
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            for (const v of varNames) {
              if (varType === "REAL") localReals.add(v);
              else localInts.add(v);
            }
          }
          continue;
        }
      }
      // Other unhandled '#' directives in dead or active branches: skip
      continue;
    }

    // Skip inactive lines when any enclosing #IF guard is false
    if (guardStack.some((g) => !g.active)) {
      continue;
    }

    // 2. Filter out PSCAD animation/telemetry calls that do not affect physics
    // e.g.: IF (UPDATE_AG) CALL PSCAD_AGR2(...) or CALL PSCAD_AGR2(...)
    if (/\bCALL\s+PSCAD_/i.test(line)) {
      continue;
    }

    // 3. Substitute $#DIM(port) with integer dimensions
    let substituted = line.replace(/\$#DIM\s*\(\s*([A-Za-z0-9_]+)\s*\)/gi, (_, portName) => {
      const dim = portDims[portName] ?? portDims[portName.toUpperCase()] ?? 1;
      return String(dim);
    });

    // 4. Substitute compile-time parameter values: $ParamName
    // If the identifier corresponds to a known parameter in `params`, replace with its value.
    // Otherwise, treat it as a port variable reference.
    substituted = substituted.replace(/\$([A-Za-z0-9_]+)/g, (fullMatch, varName) => {
      // Check if this matches a parameter
      const paramVal = params[varName] ?? params[varName.toLowerCase()] ?? params[varName.toUpperCase()];
      if (paramVal !== undefined) {
        return String(paramVal);
      }
      // Otherwise, it is a port variable reference (e.g. $In, $Out, $Offset)
      return fullMatch;
    });

    // 5. Track referenced and assigned ports ($PortName) and EMTDC subroutine storage
    const callMatch = /^\s*CALL\s+([A-Za-z0-9_]+)\s*\((.*)\)/i.exec(substituted);
    const assignMatch = /^\s*\$([A-Za-z0-9_]+)\s*=/i.exec(substituted);

    if (callMatch) {
      const sub = callMatch[1]!.toUpperCase();
      const rawArgs = callMatch[2]!.split(",").map((s) => s.trim());

      // Automatic storage reservation if #STORAGE was omitted
      if (sub === "REALPOLE") numRealStates = Math.max(numRealStates, 2);
      else if (sub === "DELAY1") numRealStates = Math.max(numRealStates, 1);
      else if (sub === "INTGRL") numRealStates = Math.max(numRealStates, 2);
      else if (sub === "LEADLAG") numRealStates = Math.max(numRealStates, 2);
      else if (sub === "DIFF") numRealStates = Math.max(numRealStates, 2);

      const outputArgIndices =
        sub === "SIN_COS"
          ? [rawArgs.length - 2, rawArgs.length - 1]
          : ["REALPOLE", "DELAY1", "INTGRL", "LEADLAG", "DIFF", "LIMITER"].includes(sub)
            ? [rawArgs.length - 1]
            : [];

      for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i]!;
        const portRefRegex = /\$([A-Za-z0-9_]+)/g;
        let m: RegExpExecArray | null;
        while ((m = portRefRegex.exec(arg)) !== null) {
          if (outputArgIndices.includes(i)) assignedPorts.add(m[1]!);
          else referencedPorts.add(m[1]!);
        }
      }
    } else if (assignMatch) {
      assignedPorts.add(assignMatch[1]!);
      const rhs = substituted.slice(assignMatch[0].length);
      const portRefRegex = /\$([A-Za-z0-9_]+)/g;
      let pMatch: RegExpExecArray | null;
      while ((pMatch = portRefRegex.exec(rhs)) !== null) {
        referencedPorts.add(pMatch[1]!);
      }
    } else {
      const portRefRegex = /\$([A-Za-z0-9_]+)/g;
      let pMatch: RegExpExecArray | null;
      while ((pMatch = portRefRegex.exec(substituted)) !== null) {
        referencedPorts.add(pMatch[1]!);
      }
    }

    outputLines.push(substituted);
  }

  return {
    lines: outputLines,
    numRealStates,
    numIntStates,
    localReals,
    localInts,
    referencedPorts,
    assignedPorts,
  };
}
