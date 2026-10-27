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
    const tokens = tokenizeCCondition(sanitized);
    const parser = new CConditionParser(tokens);
    return Boolean(parser.parse());
  } catch {
    return false;
  }
}

function tokenizeCCondition(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const two = expr.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||", "<<", ">>"].includes(two)) {
      tokens.push(two);
      i += 2;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let num = "";
      while (i < expr.length && /[0-9.]/.test(expr[i]!)) {
        num += expr[i]!;
        i++;
      }
      tokens.push(num);
      continue;
    }
    tokens.push(ch);
    i++;
  }
  return tokens;
}

class CConditionParser {
  private pos = 0;
  constructor(private tokens: string[]) {}

  parse(): number {
    return this.parseLogicalOr();
  }

  private peek(): string | undefined {
    return this.tokens[this.pos];
  }

  private consume(): string {
    return this.tokens[this.pos++] ?? "";
  }

  private parseLogicalOr(): number {
    let left = this.parseLogicalAnd();
    while (this.peek() === "||") {
      this.consume();
      const right = this.parseLogicalAnd();
      left = left !== 0 || right !== 0 ? 1 : 0;
    }
    return left;
  }

  private parseLogicalAnd(): number {
    let left = this.parseBitwiseOr();
    while (this.peek() === "&&") {
      this.consume();
      const right = this.parseBitwiseOr();
      left = left !== 0 && right !== 0 ? 1 : 0;
    }
    return left;
  }

  private parseBitwiseOr(): number {
    let left = this.parseBitwiseXor();
    while (this.peek() === "|") {
      this.consume();
      left = left | this.parseBitwiseXor();
    }
    return left;
  }

  private parseBitwiseXor(): number {
    let left = this.parseBitwiseAnd();
    while (this.peek() === "^") {
      this.consume();
      left = left ^ this.parseBitwiseAnd();
    }
    return left;
  }

  private parseBitwiseAnd(): number {
    let left = this.parseEquality();
    while (this.peek() === "&") {
      this.consume();
      left = left & this.parseEquality();
    }
    return left;
  }

  private parseEquality(): number {
    let left = this.parseRelational();
    while (this.peek() === "==" || this.peek() === "!=") {
      const op = this.consume();
      const right = this.parseRelational();
      left = (op === "==" ? left === right : left !== right) ? 1 : 0;
    }
    return left;
  }

  private parseRelational(): number {
    let left = this.parseShift();
    while (["<", "<=", ">", ">="].includes(this.peek() ?? "")) {
      const op = this.consume();
      const right = this.parseShift();
      if (op === "<") left = left < right ? 1 : 0;
      else if (op === "<=") left = left <= right ? 1 : 0;
      else if (op === ">") left = left > right ? 1 : 0;
      else if (op === ">=") left = left >= right ? 1 : 0;
    }
    return left;
  }

  private parseShift(): number {
    let left = this.parseAdditive();
    while (this.peek() === "<<" || this.peek() === ">>") {
      const op = this.consume();
      const right = this.parseAdditive();
      left = op === "<<" ? left << right : left >> right;
    }
    return left;
  }

  private parseAdditive(): number {
    let left = this.parseMultiplicative();
    while (this.peek() === "+" || this.peek() === "-") {
      const op = this.consume();
      const right = this.parseMultiplicative();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  private parseMultiplicative(): number {
    let left = this.parseUnary();
    while (this.peek() === "*" || this.peek() === "/" || this.peek() === "%") {
      const op = this.consume();
      const right = this.parseUnary();
      if (op === "*") left = left * right;
      else if (op === "/") left = right !== 0 ? left / right : 0;
      else left = right !== 0 ? left % right : 0;
    }
    return left;
  }

  private parseUnary(): number {
    const tok = this.peek();
    if (tok === "!" || tok === "-" || tok === "+" || tok === "~") {
      this.consume();
      const val = this.parseUnary();
      if (tok === "!") return val === 0 ? 1 : 0;
      if (tok === "-") return -val;
      if (tok === "~") return ~val;
      return val;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const tok = this.consume();
    if (tok === "(") {
      const val = this.parse();
      if (this.peek() === ")") this.consume();
      return val;
    }
    const n = Number(tok);
    return Number.isNaN(n) ? 0 : n;
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
