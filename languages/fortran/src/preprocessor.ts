// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fortran Preprocessor for Engineering Simulation Scripts.
 *
 * Resolves compile-time parameter macros, conditional #IF / #ELSEIF / #ELSE / #ENDIF blocks,
 * storage directives (#STORAGE REAL:m INTEGER:n), local variable declarations (#LOCAL),
 * and parameter/port substitutions ($Name, $#DIM(port)).
 */

export interface PreprocessedFortran {
  lines: string[];
  code: string;
  numRealStates: number;
  numIntStates: number;
  localReals: Set<string>;
  localInts: Set<string>;
  referencedPorts: Set<string>;
  assignedPorts: Set<string>;
}

/**
 * Evaluates a conditional expression string in an #IF / #ELSEIF directive.
 */
export function evaluateCondition(
  expr: string,
  params: Record<string, string | number> = {},
  portDims: Record<string, number> = {},
): boolean {
  try {
    let sanitized = expr.replace(/\$#DIM\s*\(\s*([A-Za-z0-9_]+)\s*\)/gi, (_, portName) => {
      const dim = portDims[portName] ?? portDims[portName.toUpperCase()] ?? 1;
      return String(dim);
    });

    sanitized = sanitized.replace(/\$([A-Za-z0-9_]+)/g, "$1");

    sanitized = sanitized
      .replace(/\.AND\./gi, " && ")
      .replace(/\.OR\./gi, " || ")
      .replace(/\.NOT\./gi, " ! ")
      .replace(/\.EQ\./gi, " == ")
      .replace(/\.NE\./gi, " != ")
      .replace(/\.GT\./gi, " > ")
      .replace(/\.GE\./gi, " >= ")
      .replace(/\.LT\./gi, " < ")
      .replace(/\.LE\./gi, " <= ");

    // Simple recursive-descent expression evaluator
    const tokens = tokenizeConditionExpr(sanitized);
    const parser = new ConditionParser(tokens, params);
    return Boolean(parser.parse());
  } catch {
    return true;
  }
}

function tokenizeConditionExpr(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[(),]/.test(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    if (ch === "=" && expr[i + 1] === "=") {
      tokens.push("==");
      i += 2;
      continue;
    }
    if (ch === "!" && expr[i + 1] === "=") {
      tokens.push("!=");
      i += 2;
      continue;
    }
    if (ch === "<" && expr[i + 1] === "=") {
      tokens.push("<=");
      i += 2;
      continue;
    }
    if (ch === ">" && expr[i + 1] === "=") {
      tokens.push(">=");
      i += 2;
      continue;
    }
    if (ch === "&" && expr[i + 1] === "&") {
      tokens.push("&&");
      i += 2;
      continue;
    }
    if (ch === "|" && expr[i + 1] === "|") {
      tokens.push("||");
      i += 2;
      continue;
    }
    if (/[<>]/.test(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    if (/[+\-*/^]/.test(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(expr[i + 1] || ""))) {
      let num = "";
      while (i < expr.length && /[0-9.eE+-]/.test(expr[i]!)) {
        if ((expr[i] === "+" || expr[i] === "-") && !/[eE]/.test(num.slice(-1))) break;
        num += expr[i]!;
        i++;
      }
      tokens.push(num);
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let id = "";
      while (i < expr.length && /[A-Za-z0-9_]/.test(expr[i]!)) {
        id += expr[i]!;
        i++;
      }
      tokens.push(id);
      continue;
    }
    i++;
  }
  return tokens;
}

class ConditionParser {
  private pos = 0;
  constructor(
    private tokens: string[],
    private params: Record<string, string | number>,
  ) {}

  parse(): number | boolean | string {
    return this.parseLogicalOr();
  }

  private peek(): string | undefined {
    return this.tokens[this.pos];
  }

  private consume(): string {
    return this.tokens[this.pos++] || "";
  }

  private parseLogicalOr(): number | boolean | string {
    let left = this.parseLogicalAnd();
    while (this.peek() === "||") {
      this.consume();
      const right = this.parseLogicalAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  private parseLogicalAnd(): number | boolean | string {
    let left = this.parseEquality();
    while (this.peek() === "&&") {
      this.consume();
      const right = this.parseEquality();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  private parseEquality(): number | boolean | string {
    let left = this.parseRelational();
    while (this.peek() === "==" || this.peek() === "!=") {
      const op = this.consume();
      const right = this.parseRelational();
      if (op === "==") left = left === right;
      else left = left !== right;
    }
    return left;
  }

  private parseRelational(): number | boolean | string {
    let left: number | boolean | string = this.parseAdditive();
    while (["<", "<=", ">", ">="].includes(this.peek() || "")) {
      const op = this.consume();
      const right = this.parseAdditive();
      const numLeft: number = Number(left);
      const numRight: number = Number(right);
      if (op === "<") left = numLeft < numRight;
      else if (op === "<=") left = numLeft <= numRight;
      else if (op === ">") left = numLeft > numRight;
      else if (op === ">=") left = numLeft >= numRight;
    }
    return left;
  }

  private parseAdditive(): number | boolean | string {
    let left = this.parseMultiplicative();
    while (this.peek() === "+" || this.peek() === "-") {
      const op = this.consume();
      const right = this.parseMultiplicative();
      if (op === "+") left = Number(left) + Number(right);
      else left = Number(left) - Number(right);
    }
    return left;
  }

  private parseMultiplicative(): number | boolean | string {
    let left = this.parsePrimary();
    while (this.peek() === "*" || this.peek() === "/") {
      const op = this.consume();
      const right = this.parsePrimary();
      if (op === "*") left = Number(left) * Number(right);
      else left = Number(right) !== 0 ? Number(left) / Number(right) : 0;
    }
    return left;
  }

  private parsePrimary(): number | boolean | string {
    const tok = this.consume();
    if (tok === "(") {
      const val = this.parse();
      if (this.peek() === ")") this.consume();
      return val;
    }
    if (tok === "!") {
      return !this.parsePrimary();
    }
    if (tok === "-") {
      return -Number(this.parsePrimary());
    }
    if (/^[0-9]/.test(tok)) {
      return parseFloat(tok);
    }
    if (tok.toLowerCase() === "true") return true;
    if (tok.toLowerCase() === "false") return false;

    // Lookup parameter
    if (tok in this.params) {
      const p = this.params[tok]!;
      if (typeof p === "number") return p;
      const num = parseFloat(p);
      return isNaN(num) ? p : num;
    }
    return 0;
  }
}

/**
 * Preprocesses a raw Fortran script, evaluating compile-time directives, substitutions, and state sizes.
 */
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
      code: "",
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

    // Ignore comment lines starting with ! or C or c or * in standard Fortran
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
            top.active = parentActive && !top.anyTaken;
            top.anyTaken = true;
          }
          continue;
        } else if (dir === "ENDIF") {
          guardStack.pop();
          continue;
        } else if (dir === "STORAGE") {
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
          const typeMatch = /^(REAL|INTEGER)\b(.*)$/i.exec(arg);
          if (typeMatch) {
            const varType = typeMatch[1]!.toUpperCase();
            const names = typeMatch[2]!
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            for (const name of names) {
              if (varType === "REAL") localReals.add(name);
              else localInts.add(name);
            }
          }
          continue;
        }
      }
    }

    // 2. Check if current guard stack is active
    if (guardStack.length > 0 && !guardStack.every((g) => g.active)) {
      continue;
    }

    // Filter out PSCAD animation/telemetry calls that do not affect physics
    if (/\bCALL\s+PSCAD_/i.test(line)) {
      continue;
    }

    // 3. Substitute $#DIM(port) with integer dimensions
    let substituted = line.replace(/\$#DIM\s*\(\s*([A-Za-z0-9_]+)\s*\)/gi, (_, portName) => {
      const dim = portDims[portName] ?? portDims[portName.toUpperCase()] ?? 1;
      return String(dim);
    });

    // 4. Substitute compile-time parameter values: $ParamName
    substituted = substituted.replace(/\$([A-Za-z0-9_]+)/g, (fullMatch, varName) => {
      const paramVal = params[varName] ?? params[varName.toLowerCase()] ?? params[varName.toUpperCase()];
      if (paramVal !== undefined) {
        return String(paramVal);
      }
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
    code: outputLines.join("\n"),
    numRealStates,
    numIntStates,
    localReals,
    localInts,
    referencedPorts,
    assignedPorts,
  };
}

export const preprocessFortran = preprocessFortranSegment;
