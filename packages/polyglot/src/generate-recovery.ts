/* eslint-disable */
/**
 * generate-recovery.ts — Infer error recovery synchronization tokens from rule ASTs.
 *
 * Walks the language config's rules to find repeating list fields inside seq() nodes.
 * For each, it extracts the first literal string token that appears after the list
 * (the "sync token"). Also collects additional sync tokens from sibling choice alternatives
 * and keyword prefixes.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RecoverySpec {
  /** Parent rule name (e.g., "class_definition") */
  ruleName: string;
  /** Field name containing the list (e.g., "body") */
  fieldName: string;
  /** The primary sync token (e.g., "end") */
  syncToken: string;
  /** Additional sync tokens for the same scope */
  additionalSyncTokens: string[];
  /** Generated external token name (e.g., "_recovery_class_definition_body") */
  externalTokenName: string;
}

// ---------------------------------------------------------------------------
// Inference engine
// ---------------------------------------------------------------------------

/**
 * Extract recovery specs from a language config by analyzing rule structure.
 *
 * For each rule that is a `seq(...)` (or `def(seq(...))`) containing a
 * `field(name, rep(...))` or `field(name, rep1(...))`, we look at the
 * tokens immediately following that field in the seq to find the sync token.
 */
export function extractRecoverySpecs(langConfig: any, $: Record<string, any>): RecoverySpec[] {
  const specs: RecoverySpec[] = [];

  if (!langConfig.rules) return specs;

  for (const [ruleName, ruleFn] of Object.entries<any>(langConfig.rules)) {
    const ruleAST = ruleFn($);
    const innerRule = unwrapDef(ruleAST);

    // We only handle seq(...) at the top level of a rule
    if (!innerRule || innerRule.type !== "seq") continue;

    const args: any[] = innerRule.args;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      // Look for field(name, rep(...)) or field(name, rep1(...))
      if (arg?.type !== "field") continue;
      const fieldContent = arg.arg;
      if (!fieldContent) continue;
      if (fieldContent.type !== "rep" && fieldContent.type !== "rep1") continue;

      const fieldName: string = arg.name;

      // Check for manual recoverUntil override on the field
      if (arg.recoverUntil && Array.isArray(arg.recoverUntil)) {
        const primary = arg.recoverUntil[0];
        const additional = arg.recoverUntil.slice(1);
        specs.push({
          ruleName,
          fieldName,
          syncToken: primary,
          additionalSyncTokens: additional,
          externalTokenName: `recovery_${ruleName}_${fieldName}`,
        });
        continue;
      }

      // Auto-infer: find the first literal string after this field in the seq
      const syncToken = findSyncTokenAfter(args, i + 1);
      if (!syncToken) continue; // Can't infer → skip

      // Collect additional sync tokens from:
      // 1. The choice alternatives in the NEXT repeating sibling field
      //    (e.g., "sections" field after "body" has "equation", "algorithm")
      // 2. Keyword prefixes of sibling choice alternatives at the same level
      const additionalSyncTokens = collectAdditionalSyncTokens(args, i, syncToken, langConfig, $);

      specs.push({
        ruleName,
        fieldName,
        syncToken,
        additionalSyncTokens,
        externalTokenName: `recovery_${ruleName}_${fieldName}`,
      });
      // Only one recovery site per rule to avoid ambiguity at the end token
      break;
    }
  }

  return specs;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Unwrap def() / ref() to get the inner syntax rule */
function unwrapDef(ast: any): any {
  if (!ast) return null;
  if (ast.type === "def") return ast.rule;
  if (ast.type === "ref") return ast.rule;
  return ast;
}

/**
 * Starting from index `start` in a seq's args array,
 * find the first literal string token (the sync token).
 */
function findSyncTokenAfter(args: any[], start: number): string | null {
  for (let j = start; j < args.length; j++) {
    const literal = extractFirstLiteral(args[j]);
    if (literal) return literal;
  }
  return null;
}

/**
 * Recursively extract the first string literal from a rule AST node.
 * Handles: string, seq(first...), opt(inner), field(name, inner), sym
 */
function extractFirstLiteral(node: any): string | null {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return null;

  switch (node.type) {
    case "seq":
      for (const a of node.args) {
        const lit = extractFirstLiteral(a);
        if (lit) return lit;
      }
      return null;
    case "opt":
    case "rep":
    case "rep1":
    case "token":
    case "token_immediate":
      return extractFirstLiteral(node.arg);
    case "field":
      return extractFirstLiteral(node.arg);
    case "choice":
      // For choice nodes, collect literals from alternatives that are keywords
      // But return the first one found as the primary
      for (const a of node.args) {
        const lit = extractFirstLiteral(a);
        if (lit) return lit;
      }
      return null;
    case "prec":
    case "prec_left":
    case "prec_right":
    case "prec_dynamic":
      return extractFirstLiteral(node.arg);
    default:
      return null;
  }
}

/**
 * Collect additional sync tokens beyond the primary one.
 * These come from:
 * 1. Keyword literals in sibling seq elements after the list field
 * 2. Keyword prefixes of choice alternatives in subsequent rep fields
 *    (e.g., "equation" and "algorithm" from the "sections" field)
 */
function collectAdditionalSyncTokens(
  args: any[],
  listFieldIndex: number,
  primarySync: string,
  langConfig: any,
  $: Record<string, any>,
): string[] {
  const tokens = new Set<string>();

  // Look at all elements after the list field
  for (let j = listFieldIndex + 1; j < args.length; j++) {
    const arg = args[j];

    // If it's another field with a rep/rep1 containing choices,
    // extract keyword prefixes from each choice alternative
    if (arg?.type === "field" && arg.arg) {
      const inner = arg.arg;
      if (inner.type === "rep" || inner.type === "rep1") {
        const repContent = inner.arg;
        if (repContent?.type === "choice") {
          for (const alt of repContent.args) {
            const kw = extractLeadingKeyword(alt, langConfig, $);
            if (kw && kw !== primarySync) tokens.add(kw);
          }
        } else {
          const kw = extractLeadingKeyword(repContent, langConfig, $);
          if (kw && kw !== primarySync) tokens.add(kw);
        }
      }
    }

    // If it's a literal string, add it as additional sync
    if (typeof arg === "string" && arg !== primarySync) {
      tokens.add(arg);
    }
  }

  return Array.from(tokens);
}

/**
 * Extract the leading keyword from a rule alternative.
 * For sym references, resolve to the underlying rule to find its leading literal.
 */
function extractLeadingKeyword(node: any, langConfig: any, $: Record<string, any>): string | null {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return null;

  if (node.type === "sym" && langConfig.rules) {
    // Resolve the symbol reference to its rule
    const referencedFn = langConfig.rules[node.name];
    if (referencedFn) {
      const resolved = unwrapDef(referencedFn($));
      return extractFirstLiteral(resolved);
    }
  }

  if (node.type === "seq" && node.args?.length > 0) {
    return extractLeadingKeyword(node.args[0], langConfig, $);
  }

  return extractFirstLiteral(node);
}
