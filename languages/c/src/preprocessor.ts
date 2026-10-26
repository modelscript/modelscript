// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * C Macro Preprocessor & Simulation Directive Evaluator.
 *
 * Handles:
 *  - Conditional compilation: #if, #elif, #else, #endif, #ifdef, #ifndef
 *  - State allocations: #pragma state real:M int:N or #STORAGE REAL:M INT:N
 *  - Port substitutions: $Port -> inputs/setOutput bindings
 *  - Include tracking: #include "..." / #include <...>
 */

export interface PreprocessedC {
  lines: string[];
  numRealStates: number;
  numIntStates: number;
  referencedPorts: Set<string>;
  assignedPorts: Set<string>;
  includes: string[];
  defines: Map<string, string>;
}

export function preprocessCSegment(source: string, params: Record<string, string | number> = {}): PreprocessedC {
  const rawLines = source.split(/\r?\n/);
  const outputLines: string[] = [];
  const referencedPorts = new Set<string>();
  const assignedPorts = new Set<string>();
  const includes: string[] = [];
  const defines = new Map<string, string>();

  // Initialize defines from params
  for (const [k, v] of Object.entries(params)) {
    defines.set(k, String(v));
  }

  let numRealStates = 0;
  let numIntStates = 0;

  // Conditional compilation stack: { active: boolean, matched: boolean }
  const condStack: { active: boolean; matched: boolean }[] = [];

  function isCurrentBranchActive(): boolean {
    return condStack.every((c) => c.active);
  }

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();

    // 1. Directives starting with #
    if (trimmed.startsWith("#")) {
      const parts = trimmed.slice(1).trim().split(/\s+/);
      const directive = parts[0]?.toLowerCase();
      const rest = parts.slice(1).join(" ");

      if (directive === "include") {
        const incMatch = /^(?:"([^"]+)"|<([^>]+)>)/.exec(rest.trim());
        if (incMatch) includes.push((incMatch[1] ?? incMatch[2])!);
        continue;
      }

      if (directive === "define") {
        const trimmedRest = rest.trim();
        const spaceIdx = trimmedRest.search(/\s/);
        if (spaceIdx === -1) {
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmedRest)) {
            defines.set(trimmedRest, "1");
          }
        } else {
          const name = trimmedRest.slice(0, spaceIdx);
          const val = trimmedRest.slice(spaceIdx).trim();
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            defines.set(name, val);
          }
        }
        continue;
      }

      if (directive === "undef") {
        defines.delete(rest.trim());
        continue;
      }

      if (directive === "ifdef") {
        const name = rest.trim();
        const active = isCurrentBranchActive() && defines.has(name);
        condStack.push({ active, matched: active });
        continue;
      }

      if (directive === "ifndef") {
        const name = rest.trim();
        const active = isCurrentBranchActive() && !defines.has(name);
        condStack.push({ active, matched: active });
        continue;
      }

      if (directive === "if") {
        const condVal = evaluateCondition(rest, defines);
        const active = isCurrentBranchActive() && condVal;
        condStack.push({ active, matched: active });
        continue;
      }

      if (directive === "elif") {
        if (condStack.length > 0) {
          const top = condStack[condStack.length - 1]!;
          if (top.matched) {
            top.active = false;
          } else {
            const parentActive = condStack.slice(0, -1).every((c) => c.active);
            const condVal = evaluateCondition(rest, defines);
            top.active = parentActive && condVal;
            if (top.active) top.matched = true;
          }
        }
        continue;
      }

      if (directive === "else") {
        if (condStack.length > 0) {
          const top = condStack[condStack.length - 1]!;
          const parentActive = condStack.slice(0, -1).every((c) => c.active);
          top.active = parentActive && !top.matched;
          top.matched = true;
        }
        continue;
      }

      if (directive === "endif") {
        condStack.pop();
        continue;
      }

      // State allocation directives: #pragma state real:N int:M or #STORAGE REAL:N INTEGER:M
      if (directive === "pragma" && rest.toLowerCase().startsWith("state")) {
        parseStateAllocation(rest, (r, i) => {
          numRealStates = Math.max(numRealStates, r);
          numIntStates = Math.max(numIntStates, i);
        });
        continue;
      }
      if (directive === "storage") {
        parseStateAllocation(rest, (r, i) => {
          numRealStates = Math.max(numRealStates, r);
          numIntStates = Math.max(numIntStates, i);
        });
        continue;
      }

      continue;
    }

    if (!isCurrentBranchActive()) continue;

    // Scan for port references ($Port)
    const portMatches = trimmed.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g);
    for (const match of portMatches) {
      const portName = match[1]!;
      // Check if it appears on the LHS of assignment
      const assignIdx = trimmed.indexOf("=");
      if (assignIdx > 0 && trimmed.indexOf(match[0]) < assignIdx) {
        assignedPorts.add(portName);
      } else {
        referencedPorts.add(portName);
      }
    }

    outputLines.push(rawLine);
  }

  return {
    lines: outputLines,
    numRealStates: Math.max(numRealStates, 1),
    numIntStates: Math.max(numIntStates, 1),
    referencedPorts,
    assignedPorts,
    includes,
    defines,
  };
}

export function evaluateCondition(condExpr: string, defines: Map<string, string>): boolean {
  try {
    let replaced = condExpr;
    // Replace defined identifiers
    for (const [k, v] of defines.entries()) {
      const re = new RegExp(`\\b${k}\\b`, "g");
      replaced = replaced.replace(re, v);
    }
    // Replace remaining identifiers with 0
    replaced = replaced.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, "0");

    // Safe mathematical expression evaluation
    const sanitized = replaced.replace(/[^0-9+\-*/%<>=!&|^() ]/g, "");
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function(`return !!(${sanitized});`);
    return Boolean(fn());
  } catch {
    return false;
  }
}

function parseStateAllocation(str: string, cb: (real: number, int: number) => void): void {
  let r = 0;
  let i = 0;
  const realMatch = /(?:REAL|real)\s*:\s*([0-9]+)/i.exec(str);
  if (realMatch) r = parseInt(realMatch[1]!, 10);
  const intMatch = /(?:INTEGER|INT|int)\s*:\s*([0-9]+)/i.exec(str);
  if (intMatch) i = parseInt(intMatch[1]!, 10);
  cb(r, i);
}
