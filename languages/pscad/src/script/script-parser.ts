// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSCAD Legacy Script & Fortran Segment Parser and Evaluator.
 *
 * PSCAD definitions contain macro templates in `<script>` tags divided into
 * 14 distinct segment kinds:
 *   - FlyBy: Rich component & per-pin hover documentation
 *   - Checks: Parameter & topology validation assertions (#IF, ERROR, WARNING)
 *   - Branch: MNA electrical branch declarations ($N1 $N2 [R L C] / BREAKER / AMMETER / SOURCE)
 *   - Transformers: Mutual coupling & multi-winding matrices (#TRANSFORMERS, #WINDINGS)
 *   - Fortran / Dsdyn / Dsout / Computations: Procedural equations & state updates
 *   - Matrix-Fill / Model-Data / C / Help / Comments
 */

import type { XmlElement } from "@modelscript/dsl/xml";
import type { PscadBranchDescriptor, PscadCheckRule, PscadFlyByDoc, PscadScriptSegment } from "../types.js";

/**
 * Extracts all `<segment>` elements within a `<script>` tag.
 */
export function parseScriptElement(scriptEl: XmlElement, xmlContent: string): Map<string, PscadScriptSegment> {
  const segments = new Map<string, PscadScriptSegment>();

  for (const seg of scriptEl.children) {
    if (seg.name.toLowerCase() !== "segment") continue;
    const name = seg.attributes.find((a) => a.name.toLowerCase() === "name")?.value ?? "Unknown";
    const id = seg.attributes.find((a) => a.name.toLowerCase() === "id")?.value;
    const classid = seg.attributes.find((a) => a.name.toLowerCase() === "classid")?.value;

    let content = "";
    if (seg.start !== undefined && seg.end !== undefined) {
      // Extract inner content inside the <segment>...</segment> tags
      const raw = xmlContent.slice(seg.start, seg.end);
      const closeTagIdx = raw.lastIndexOf("</");
      const openTagIdx = raw.indexOf(">");
      if (openTagIdx >= 0 && closeTagIdx > openTagIdx) {
        content = raw.slice(openTagIdx + 1, closeTagIdx);
      } else {
        content = seg.text;
      }
    } else {
      content = seg.text;
    }

    // Strip CDATA wrapper if present: <![CDATA[ ... ]]>
    const cdataMatch = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/i.exec(content);
    if (cdataMatch) {
      content = cdataMatch[1]!;
    }

    segments.set(name.toLowerCase(), {
      name,
      id,
      classid,
      content,
    });
  }

  return segments;
}

/**
 * Parses a PSCAD FlyBy documentation segment.
 *
 * Format:
 * Lines before the first `:portName` are the overall component summary.
 * Each subsequent section starting with `:portName` contains hover documentation
 * for that specific port/pin.
 */
export function parseFlyBySegment(flyByText: string): PscadFlyByDoc {
  if (!flyByText || !flyByText.trim()) {
    return { summary: "", ports: {} };
  }

  const lines = flyByText.split(/\r?\n/);
  const summaryLines: string[] = [];
  const ports: Record<string, string> = {};

  let currentPort: string | null = null;
  let currentPortLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    // Comments starting with '!' at the beginning of a line are ignored
    if (line.startsWith("!")) continue;

    // Detect port header: ':portName' or ': portName' or ':portName(idx)'
    const portMatch = /^:\s*([A-Za-z0-9_#()]+)\s*$/.exec(line);
    if (portMatch) {
      if (currentPort) {
        ports[currentPort] = currentPortLines.join("\n").trim();
      }
      currentPort = portMatch[1]!;
      currentPortLines = [];
    } else {
      if (currentPort !== null) {
        currentPortLines.push(line);
      } else {
        summaryLines.push(line);
      }
    }
  }

  if (currentPort) {
    ports[currentPort] = currentPortLines.join("\n").trim();
  }

  return {
    summary: summaryLines.join("\n").trim(),
    ports,
  };
}

/**
 * Parses PSCAD `<segment name="Checks">` into structured diagnostic assertion rules.
 *
 * Supports:
 * - `#IF <guard>` ... `#ELSEIF <guard>` ... `#ELSE` ... `#ENDIF`
 * - `ERROR <message> : <condition>`
 * - `WARNING <message> : <condition>`
 * - `ERROR <message>` (unconditional under the current `#IF` guard)
 */
export function parseChecksSegment(checksText: string): PscadCheckRule[] {
  if (!checksText || !checksText.trim()) {
    return [];
  }

  const rules: PscadCheckRule[] = [];
  const lines = checksText.split(/\r?\n/);
  const guardStack: string[] = [];

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line || line.startsWith("!")) continue;

    // Handle preprocessor #IF / #ELSEIF / #ELSE / #ENDIF
    if (line.startsWith("#")) {
      const directiveMatch = /^#\s*(IF|ELSEIF|ELSE|ENDIF)\b(.*)$/i.exec(line);
      if (directiveMatch) {
        const dir = directiveMatch[1]!.toUpperCase();
        const arg = directiveMatch[2]!.trim();

        if (dir === "IF") {
          guardStack.push(arg);
        } else if (dir === "ELSEIF") {
          if (guardStack.length > 0) {
            guardStack[guardStack.length - 1] = arg;
          } else {
            guardStack.push(arg);
          }
        } else if (dir === "ELSE") {
          if (guardStack.length > 0) {
            const prev = guardStack[guardStack.length - 1]!;
            guardStack[guardStack.length - 1] = `!(${prev})`;
          }
        } else if (dir === "ENDIF") {
          guardStack.pop();
        }
      }
      continue;
    }

    // Check for ERROR or WARNING statements
    const errMatch = /^(ERROR|WARNING)\s+([^:]+?)(?:\s*:\s*(.+))?$/i.exec(line);
    if (errMatch) {
      const sev = errMatch[1]!.toUpperCase() === "WARNING" ? ("warning" as const) : ("error" as const);
      const msg = errMatch[2]!.trim();
      const condition = errMatch[3] ? errMatch[3].trim() : undefined;
      const guard = guardStack.length > 0 ? guardStack.join(" && ") : undefined;

      rules.push({
        severity: sev,
        message: msg,
        condition,
        guard,
      });
    }
  }

  return rules;
}

/**
 * Lightweight, safe mathematical and boolean expression evaluator for PSCAD Checks.
 * Evaluates conditions containing arithmetic, comparisons, logical operations, and $#DIM(...).
 */
export function evaluateCondition(
  expr: string,
  params: Record<string, string | number>,
  portDims: Record<string, number> = {},
): boolean {
  try {
    // 1. Substitute $#DIM(name) with integer dimension
    let sanitized = expr.replace(/\$#DIM\s*\(\s*([A-Za-z0-9_]+)\s*\)/gi, (_, portName) => {
      const dim = portDims[portName] ?? portDims[portName.toUpperCase()] ?? 1;
      return String(dim);
    });

    // 2. Normalize parameter references: remove leading '$'
    sanitized = sanitized.replace(/\$([A-Za-z0-9_]+)/g, "$1");

    // 3. Normalize Fortran logical operators if present (.AND., .OR., .NOT., .EQ., .NE., .GT., .GE., .LT., .LE.)
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

    // 4. Tokenize
    const tokens = tokenizeExpr(sanitized);
    const parser = new ExprParser(tokens, params);
    return Boolean(parser.parse());
  } catch {
    // On unexpected expression syntax, default to true (do not flag false-positive errors)
    return true;
  }
}

/**
 * Evaluates all Checks rules for a component against its parameters and port dimensions.
 * Returns a list of failed checks to report as diagnostics.
 */
export function evaluateCheckRules(
  rules: PscadCheckRule[],
  params: Record<string, string | number>,
  portDims: Record<string, number> = {},
): { severity: "error" | "warning"; message: string }[] {
  const failures: { severity: "error" | "warning"; message: string }[] = [];

  for (const rule of rules) {
    // If rule has an #IF guard, test if the guard is satisfied
    if (rule.guard) {
      const guardActive = evaluateCondition(rule.guard, params, portDims);
      if (!guardActive) {
        continue; // Guard not satisfied, skip this check
      }
    }

    if (rule.condition) {
      // In PSCAD Checks syntax: 'ERROR Message : Condition'
      // The Condition is an assertion that MUST hold true.
      // If Condition is false, the assertion has failed!
      const ok = evaluateCondition(rule.condition, params, portDims);
      if (!ok) {
        failures.push({
          severity: rule.severity,
          message: rule.message,
        });
      }
    } else {
      // Unconditional check inside a satisfied guard (e.g. #IF CoreType<1 ERROR ...)
      // If we reached here, the guard condition is met, so trigger the error!
      failures.push({
        severity: rule.severity,
        message: rule.message,
      });
    }
  }

  return failures;
}

/**
 * Parses a PSCAD `<segment name="Branch">` into structured electrical branch descriptors.
 */
export function parseBranchSegment(
  branchText: string,
  params: Record<string, string | number> = {},
): PscadBranchDescriptor[] {
  if (!branchText || !branchText.trim()) return [];

  const branches: PscadBranchDescriptor[] = [];
  const lines = branchText.split(/\r?\n/);
  const guardStack: { active: boolean; anyTaken: boolean }[] = [];

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line || line.startsWith("!")) continue;

    // Handle preprocessor #IF / #ELSEIF / #ELSE / #ENDIF
    if (line.startsWith("#")) {
      const directiveMatch = /^#\s*(IF|ELSEIF|ELSE|ENDIF)\b(.*)$/i.exec(line);
      if (directiveMatch) {
        const dir = directiveMatch[1]!.toUpperCase();
        const arg = directiveMatch[2]!.trim();

        if (dir === "IF") {
          const parentActive = guardStack.every((g) => g.active);
          const cond = parentActive && evaluateCondition(arg, params);
          guardStack.push({ active: cond, anyTaken: cond });
        } else if (dir === "ELSEIF") {
          if (guardStack.length > 0) {
            const top = guardStack[guardStack.length - 1]!;
            const parentActive = guardStack.slice(0, -1).every((g) => g.active);
            if (top.anyTaken || !parentActive) {
              top.active = false;
            } else {
              const cond = evaluateCondition(arg, params);
              top.active = cond;
              if (cond) top.anyTaken = true;
            }
          }
        } else if (dir === "ELSE") {
          if (guardStack.length > 0) {
            const top = guardStack[guardStack.length - 1]!;
            const parentActive = guardStack.slice(0, -1).every((g) => g.active);
            top.active = parentActive && !top.anyTaken;
            top.anyTaken = true;
          }
        } else if (dir === "ENDIF") {
          guardStack.pop();
        }
      }
      continue;
    }

    // Skip inactive branches under false guards
    if (guardStack.some((g) => !g.active)) continue;

    // Strip trailing comments (e.g. / or !)
    line = line.replace(new RegExp("[/!].*$"), "").trim();
    if (!line) continue;

    // Syntax 1: Name = $Node1 $Node2 TYPE [params]
    // e.g.: BN = $N1 $N2 AMMETER
    //       NBR = $NT $NF BREAKER 1.0E6
    //       BRbat = $B $A SOURCE 1.0
    const namedMatch =
      /^([A-Za-z0-9_]+)\s*=\s*\$([A-Za-z0-9_()]+)\s+\$([A-Za-z0-9_()]+)\s+([A-Za-z0-9_]+)(?:\s+(.*))?$/i.exec(line);
    if (namedMatch) {
      const name = namedMatch[1]!;
      const fromNode = namedMatch[2]!;
      const toNode = namedMatch[3]!;
      const typeStr = namedMatch[4]!.toUpperCase();
      const extra = namedMatch[5] ?? "";

      let kind: PscadBranchDescriptor["kind"] = "other";
      if (typeStr === "AMMETER") kind = "ammeter";
      else if (typeStr === "BREAKER" || typeStr === "SWITCH") kind = "breaker";
      else if (typeStr === "SOURCE") kind = "source";

      branches.push({
        name,
        fromNode,
        toNode,
        kind,
        extra: extra.trim() || undefined,
        raw: line,
      });
      continue;
    }

    // Syntax 2: $Node1 $Node2 R L C
    // e.g. $A $B $R 0 0
    //      $A $B 0 $L 0
    //      $A $B 0 0 $C
    const rlcMatch = /^\$([A-Za-z0-9_()]+)\s+\$([A-Za-z0-9_()]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/.exec(line);
    if (rlcMatch) {
      branches.push({
        fromNode: rlcMatch[1]!,
        toNode: rlcMatch[2]!,
        kind: "passive",
        r: rlcMatch[3],
        l: rlcMatch[4],
        c: rlcMatch[5],
        raw: line,
      });
      continue;
    }
  }

  return branches;
}

// ============================================================================
// Expression Tokenizer & Recursive Descent Evaluator
// ============================================================================

type TokenType = "NUMBER" | "IDENT" | "OP" | "LPAREN" | "RPAREN";

interface Token {
  type: TokenType;
  value: string;
}

function tokenizeExpr(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = expr.length;

  while (i < n) {
    const ch = expr[i]!;

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "LPAREN", value: "(" });
      i++;
      continue;
    }

    if (ch === ")") {
      tokens.push({ type: "RPAREN", value: ")" });
      i++;
      continue;
    }

    // Two-character operators: <=, >=, ==, !=, &&, ||
    const two = expr.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "==" || two === "!=" || two === "&&" || two === "||") {
      tokens.push({ type: "OP", value: two });
      i += 2;
      continue;
    }

    // Single-character operators: +, -, *, /, <, >, !, &
    if ("+-*/<>!&|".includes(ch)) {
      tokens.push({ type: "OP", value: ch === "&" ? "&&" : ch === "|" ? "||" : ch });
      i++;
      continue;
    }

    // Numbers: integer or float (including scientific notation 1e-3, 1.0E6)
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(expr[i + 1] ?? ""))) {
      let numStr = "";
      while (i < n && /[0-9.eE+-]/.test(expr[i]!)) {
        // Prevent swallowing next operator if +- is not after e/E
        if ((expr[i] === "+" || expr[i] === "-") && !/[eE]/.test(numStr.slice(-1))) {
          break;
        }
        numStr += expr[i]!;
        i++;
      }
      tokens.push({ type: "NUMBER", value: numStr });
      continue;
    }

    // Identifiers (parameter names, true/false)
    if (/[A-Za-z_]/.test(ch)) {
      let ident = "";
      while (i < n && /[A-Za-z0-9_]/.test(expr[i]!)) {
        ident += expr[i]!;
        i++;
      }
      tokens.push({ type: "IDENT", value: ident });
      continue;
    }

    i++;
  }

  return tokens;
}

class ExprParser {
  private pos = 0;

  constructor(
    private tokens: Token[],
    private params: Record<string, string | number>,
  ) {}

  public parse(): number | boolean {
    const val = this.parseLogicalOr();
    return val;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    return this.tokens[this.pos++]!;
  }

  private parseLogicalOr(): number | boolean {
    let left = this.parseLogicalAnd();
    while (this.peek()?.type === "OP" && this.peek()?.value === "||") {
      this.consume();
      const right = this.parseLogicalAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  private parseLogicalAnd(): number | boolean {
    let left = this.parseEquality();
    while (this.peek()?.type === "OP" && this.peek()?.value === "&&") {
      this.consume();
      const right = this.parseEquality();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  private parseEquality(): number | boolean {
    let left = this.parseRelational();
    while (this.peek()?.type === "OP" && (this.peek()?.value === "==" || this.peek()?.value === "!=")) {
      const op = this.consume().value;
      const right = this.parseRelational();
      if (op === "==") left = left === right;
      else left = left !== right;
    }
    return left;
  }

  private parseRelational(): number | boolean {
    let left = this.parseAdditive();
    while (
      this.peek()?.type === "OP" &&
      (this.peek()?.value === "<" ||
        this.peek()?.value === "<=" ||
        this.peek()?.value === ">" ||
        this.peek()?.value === ">=")
    ) {
      const op = this.consume().value;
      const right = this.parseAdditive();
      const l = Number(left);
      const r = Number(right);
      if (op === "<") left = l < r;
      else if (op === "<=") left = l <= r;
      else if (op === ">") left = l > r;
      else if (op === ">=") left = l >= r;
    }
    return left;
  }

  private parseAdditive(): number | boolean {
    let left = this.parseMultiplicative();
    while (this.peek()?.type === "OP" && (this.peek()?.value === "+" || this.peek()?.value === "-")) {
      const op = this.consume().value;
      const right = this.parseMultiplicative();
      if (op === "+") left = Number(left) + Number(right);
      else left = Number(left) - Number(right);
    }
    return left;
  }

  private parseMultiplicative(): number | boolean {
    let left = this.parseUnary();
    while (this.peek()?.type === "OP" && (this.peek()?.value === "*" || this.peek()?.value === "/")) {
      const op = this.consume().value;
      const right = this.parseUnary();
      if (op === "*") left = Number(left) * Number(right);
      else left = Number(left) / (Number(right) || 1e-12);
    }
    return left;
  }

  private parseUnary(): number | boolean {
    const tok = this.peek();
    if (tok?.type === "OP" && tok.value === "!") {
      this.consume();
      return !this.parseUnary();
    }
    if (tok?.type === "OP" && tok.value === "-") {
      this.consume();
      return -Number(this.parseUnary());
    }
    if (tok?.type === "OP" && tok.value === "+") {
      this.consume();
      return Number(this.parseUnary());
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number | boolean {
    const tok = this.consume();
    if (!tok) return 0;

    if (tok.type === "LPAREN") {
      const inner = this.parseLogicalOr();
      if (this.peek()?.type === "RPAREN") {
        this.consume();
      }
      return inner;
    }

    if (tok.type === "NUMBER") {
      const val = parseFloat(tok.value);
      return isNaN(val) ? 0 : val;
    }

    if (tok.type === "IDENT") {
      const id = tok.value;
      if (id.toLowerCase() === "true") return true;
      if (id.toLowerCase() === "false") return false;

      // Look up in parameter map (case-insensitive fallback)
      let rawVal = this.params[id];
      if (rawVal === undefined) {
        const lower = id.toLowerCase();
        for (const [k, v] of Object.entries(this.params)) {
          if (k.toLowerCase() === lower) {
            rawVal = v;
            break;
          }
        }
      }

      if (rawVal === undefined) return 0;
      if (typeof rawVal === "number") return rawVal;
      const parsedNum = parseFloat(rawVal);
      return isNaN(parsedNum)
        ? rawVal.toLowerCase() === "true"
          ? true
          : rawVal.toLowerCase() === "false"
            ? false
            : 0
        : parsedNum;
    }

    return 0;
  }
}
