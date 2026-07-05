import { LanguageOptions as GrammarOptions } from "../dsl.js";
import { NormalizedGrammar } from "../grammar.js";

import { getDJB2Hash } from "./utils.js";

// ---- Parsed rule representation ----
interface ParsedAtom {
  pred: number;
  predName: string;
  args: string[];
  negated: boolean;
}

interface ParsedRule {
  headPred: string;
  headHash: number;
  headArgs: string[];
  body: ParsedAtom[];
  source: string;
}

export function generateReasoner(grammar: GrammarOptions, normalized: NormalizedGrammar): string {
  let code = `// Semantic Reasoning Engine (OWL 2 RL / SysML v2) \n`;

  // Determine arity from config (default 2, min 3 to support CAD templates)
  const maxArity = Math.max(grammar.semantics?.maxArity || 2, 3);
  const FACT_STRIDE = 1 + maxArity;

  let rules: string[] = [...(grammar.semantics?.rules || [])];
  // Vocabularies and extensions are now fully driven by the DSL configuration.

  // ---- Extraction Code ----
  let extractionCode = "";
  let predHashes = new Set<number>();

  // Helper: compute a field's sibling index from the grammar's field() annotations
  function getFieldSiblingIndex(ruleName: string, fieldName: string): number {
    const rule = normalized.evaluatedRules[ruleName];
    if (!rule) return -1;
    let seqRule = rule.type === "DEF" ? rule.children![0] : rule;
    if (seqRule.type !== "SEQ") return -1;
    let idx = 0;
    for (const child of seqRule.children || []) {
      if (child.type === "FIELD" && child.value === fieldName) return idx;
      idx++;
    }
    return -1;
  }

  // Helper: emit inline field access code (walks sibling chain)
  function emitInlineFieldAccess(ruleName: string, fieldName: string): string {
    const sibIdx = getFieldSiblingIndex(ruleName, fieldName);
    if (sibIdx < 0) {
      // Field not found in grammar — use nodeId as fallback.
      // This handles cases like @element meaning "this node" or @namespace
      // meaning "the parent scope" (which requires runtime scope resolution).
      return `nodeId`;
    }
    if (sibIdx === 0) {
      return `getNodeFirstChild(nodeId)`;
    }
    // For indices > 0, use getNthChild
    return `getNthChild(nodeId, ${sibIdx})`;
  }

  if (grammar.semantics && grammar.semantics.extraction) {
    extractionCode += `switch (sym) {\n`;
    for (const [nodeName, factStr] of Object.entries(grammar.semantics.extraction)) {
      let mappedInt = normalized.symToInt.get(nodeName);
      if (mappedInt !== undefined) {
        let match = (factStr as string).match(/^(\w+)\(([^)]+)\)$/);
        if (match) {
          let pred = match[1].trim();
          let argsStr = match[2];
          let args = argsStr.split(",").map((s: string) => s.trim());
          let predHash = getDJB2Hash(pred);
          predHashes.add(predHash);

          let argCodes: string[] = [];
          for (const arg of args) {
            if (arg.startsWith("@")) {
              let fieldName = arg.substring(1);
              let accessCode = emitInlineFieldAccess(nodeName, fieldName);
              argCodes.push(accessCode);
            } else if (arg.startsWith("'") && arg.endsWith("'")) {
              argCodes.push(`${getDJB2Hash(arg.substring(1, arg.length - 1))}`);
            } else {
              argCodes.push("0");
            }
          }
          while (argCodes.length < maxArity) argCodes.push("0");

          extractionCode += `
         case ${mappedInt}: {
             addFact(${predHash}, ${argCodes.join(", ")});
         } break;
         `;
        }
      }
    }
    extractionCode += `}\n`;
  }

  let typeExtractionCode = "";
  let deepTypeFactsCode = "";

  if (grammar.semantics && grammar.semantics.typeExtraction) {
    for (const [key, factStr] of Object.entries(grammar.semantics.typeExtraction)) {
      let match = (factStr as string).match(/^(\w+)\(([^)]+)\)$/);
      if (match) {
        let pred = match[1].trim();
        let argsStr = match[2];
        let args = argsStr.split(",").map((s: string) => s.trim());
        let predHash = getDJB2Hash(pred);
        predHashes.add(predHash);

        if (key === "inferredType") {
          let argCodes: string[] = [];
          for (const arg of args) {
            if (arg === "@element") argCodes.push("nodeId");
            else if (arg === "@inferredType") argCodes.push("resolvedType");
            else argCodes.push("0");
          }
          while (argCodes.length < maxArity) argCodes.push("0");
          typeExtractionCode += `
    let rawType = getTypeOfNode(nodeId);
    if (rawType != 0) {
        let resolvedType = typeFind(rawType);
        addFact(${predHash}, ${argCodes.join(", ")});
    }
`;
        } else if (key === "pointerType") {
          let argCodes: string[] = [];
          for (const arg of args) {
            if (arg === "@type") argCodes.push("resolvedPtr");
            else if (arg === "@baseType") argCodes.push("typeFind(getTypeBase(ptr))");
            else argCodes.push("0");
          }
          while (argCodes.length < maxArity) argCodes.push("0");
          deepTypeFactsCode += `
  for (let ptr = typeArenaOffset - 24; ptr >= 0; ptr -= 24) {
      if (ptr == 0) break;
      let kind = getTypeKind(ptr);
      let resolvedPtr = typeFind(ptr);
      if (kind == 1 /* TYPE_POINTER */ || getTypeCtorTag(ptr) == 3 /* CTOR_POINTER */) {
          addFact(${predHash}, ${argCodes.join(", ")});
      }
  }
`;
        } else if (key === "functionType") {
          let argCodes: string[] = [];
          for (const arg of args) {
            if (arg === "@type") argCodes.push("resolvedPtr");
            else if (arg === "@argType") argCodes.push("typeFind(getTypeBase(ptr))");
            else if (arg === "@returnType") argCodes.push("typeFind(getTypeCtorArg2(ptr))");
            else argCodes.push("0");
          }
          while (argCodes.length < maxArity) argCodes.push("0");
          deepTypeFactsCode += `
  for (let i = typeCount - 1; i >= 1; i--) {
      let kind = getTypeKind(i);
      let resolvedPtr = typeFind(i);
      if (kind == 4 /* TYPE_FUNCTION */ || getTypeCtorTag(i) == 1 /* CTOR_FUNCTION */) {
          addFact(${predHash}, ${argCodes.join(", ")});
      }
  }
`;
        } else if (key === "recordField") {
          let argCodes: string[] = [];
          for (const arg of args) {
            if (arg === "@type") argCodes.push("resolvedPtr");
            else if (arg === "@fieldNameHash") argCodes.push("getTypeExtra(ptr)");
            else if (arg === "@fieldType") argCodes.push("typeFind(getTypeBase(ptr))");
            else argCodes.push("0");
          }
          while (argCodes.length < maxArity) argCodes.push("0");
          deepTypeFactsCode += `
  for (let i = typeCount - 1; i >= 1; i--) {
      let kind = getTypeKind(i);
      let resolvedPtr = typeFind(i);
      if (kind == 15 /* TYPE_RECORD_FIELD */) {
          addFact(${predHash}, ${argCodes.join(", ")});
      }
  }
`;
        }
      }
    }
  }

  // ---- Axiom Code ----
  let axiomCode = "";
  let axioms = grammar.semantics?.axioms || [];
  for (let axiom of axioms) {
    let headBodyMatch = axiom.match(/^(\w+)\(([^)]+)\)\s*:-\s*(.+)\.$/);
    if (headBodyMatch) {
      let headPred = headBodyMatch[1];
      let headArgs = headBodyMatch[2].split(",").map((s: string) => s.trim());
      let bodyStr = headBodyMatch[3];
      let conditions = bodyStr.split("),").map((s: string) => s.trim() + (s.endsWith(")") ? "" : ")"));

      axiomCode += `\n    // Axiom: ${axiom}\n`;
      axiomCode += `    for (let i: u32 = 0; i < factCount; i++) {\n`;

      let firstCondMatch = conditions[0].match(/^(\w+)\(\?A,\s*(\w+)\)$/);
      if (firstCondMatch) {
        let predHash = getDJB2Hash(firstCondMatch[1]);
        let targetHash = getDJB2Hash(firstCondMatch[2]);
        axiomCode += `        let idx = i * ${FACT_STRIDE};\n`;
        axiomCode += `        let p = factTable[idx];\n`;
        axiomCode += `        let arg1 = factTable[idx + 1];\n`;
        axiomCode += `        let arg2 = factTable[idx + 2];\n`;
        axiomCode += `        if (p == ${predHash} && arg2 == ${targetHash}) {\n`;

        let padArgs = Array(maxArity - 2).fill("0");
        if (headPred === "Error" && headArgs[1] && headArgs[1].startsWith("'")) {
          let errorMsg = headArgs[1].substring(1, headArgs[1].length - 1);
          let msgHash = getDJB2Hash(errorMsg);
          let argsStr = ["arg1", String(msgHash), ...padArgs].join(", ");
          axiomCode += `            addFact(${getDJB2Hash("Error")}, ${argsStr});\n`;
        } else {
          // General fallback for other predicates
          let headPredHash = getDJB2Hash(headPred);
          let argsStr = ["arg1", "0", ...padArgs].join(", ");
          axiomCode += `            addFact(${headPredHash}, ${argsStr});\n`;
        }

        axiomCode += `        }\n`;
      }
      axiomCode += `    }\n`;
    }
  }

  // ==================================================================
  // Phase 4A: Parse rules with negation support, then stratify
  // ==================================================================

  const parsedRules: ParsedRule[] = [];

  for (const ruleStr of rules) {
    let ruleMatch = (ruleStr as string).match(/^(\w+)\(([^)]+)\)\s*:-\s*(.+)\.$/);
    if (!ruleMatch) continue;

    let headPred = ruleMatch[1];
    let headArgs = ruleMatch[2].split(",").map((s) => s.trim());
    let bodyStr = ruleMatch[3];

    // Split body atoms, handling commas inside parentheses
    let bodyAtoms = bodyStr.split("),").map((s: string) => s.trim().replace(/\)$/, "") + ")");
    let body: ParsedAtom[] = [];

    for (const atom of bodyAtoms) {
      let trimmed = atom.trim();
      let negated = false;

      // Task 4.1: Recognize NOT prefix
      if (trimmed.startsWith("NOT ") || trimmed.startsWith("not ")) {
        negated = true;
        trimmed = trimmed.substring(4).trim();
      }

      let m = trimmed.match(/^(\w+)\(([^)]+)\)$/);
      if (m) {
        let args = m[2].split(",").map((s) => s.trim());
        body.push({
          pred: getDJB2Hash(m[1]),
          predName: m[1],
          args,
          negated,
        });
      }
    }

    if (body.filter((a) => !a.negated).length < 1) continue; // Need at least 1 positive atom

    parsedRules.push({
      headPred,
      headHash: getDJB2Hash(headPred),
      headArgs,
      body,
      source: ruleStr as string,
    });
  }

  // ---- Task 4.2-4.3: Stratification ----
  // Build dependency graph: head depends on body predicates
  // Negation edges mark stratum boundaries

  const allPreds = new Set<string>();
  for (const r of parsedRules) {
    allPreds.add(r.headPred);
    for (const a of r.body) allPreds.add(a.predName);
  }

  // Dependency: headPred -> bodyPred (positive edge = 0, negation edge = 1)
  const depEdges: { from: string; to: string; isNeg: boolean }[] = [];
  for (const r of parsedRules) {
    for (const a of r.body) {
      depEdges.push({ from: r.headPred, to: a.predName, isNeg: a.negated });
    }
  }

  // Compute strata: topological sort where negation edges increment stratum
  const predStratum = new Map<string, number>();
  for (const p of allPreds) predStratum.set(p, 0);

  // Iterative fixpoint: stratum(head) >= stratum(body) for positive,
  //                     stratum(head) > stratum(body) for negation
  let stratChanged = true;
  let stratIter = 0;
  const maxStrata = allPreds.size + 1;

  while (stratChanged && stratIter < maxStrata) {
    stratChanged = false;
    stratIter++;
    for (const edge of depEdges) {
      const fromStratum = predStratum.get(edge.from)!;
      const toStratum = predStratum.get(edge.to)!;

      if (edge.isNeg) {
        // Negation: head must be strictly higher than negated body
        if (fromStratum <= toStratum) {
          predStratum.set(edge.from, toStratum + 1);
          stratChanged = true;
        }
      } else {
        // Positive: head must be at least as high as body
        if (fromStratum < toStratum) {
          predStratum.set(edge.from, toStratum);
          stratChanged = true;
        }
      }
    }
  }

  // Check for negation cycles (unstratifiable)
  if (stratChanged) {
    console.error("⚠️  Negation cycle detected in Datalog rules — stratification failed.");
    console.error("   Rules with NOT must not form cycles through negated predicates.");
    console.error("   Falling back to single-stratum evaluation (negation may be unsound).");
    // Fallback: collapse all predicates into stratum 0.
    // This means negated atoms are evaluated in the same fixpoint as positive atoms,
    // which is semantically equivalent to "well-founded" semantics without stratification.
    for (const p of allPreds) predStratum.set(p, 0);
  }

  // Group rules by stratum
  const numStrata = Math.max(0, ...Array.from(predStratum.values())) + 1;
  const rulesByStratum: ParsedRule[][] = Array.from({ length: numStrata }, () => []);
  for (const r of parsedRules) {
    const s = predStratum.get(r.headPred) || 0;
    rulesByStratum[s].push(r);
  }

  // ---- Task 4.4-4.5: Generate per-stratum evaluation code ----

  function generateRuleCode(rule: ParsedRule, prefix: string): string {
    let out = "";

    // Separate positive and negative body atoms
    const positiveAtoms = rule.body.filter((a) => !a.negated);
    const negativeAtoms = rule.body.filter((a) => a.negated);

    if (positiveAtoms.length < 1) return ""; // Shouldn't happen

    const b0 = positiveAtoms[0];

    // Build variable-to-position map
    const varMap: Record<string, string[]> = {};
    for (let ai = 0; ai < b0.args.length; ai++) {
      const v = b0.args[ai];
      if (!varMap[v]) varMap[v] = [];
      varMap[v].push(`${prefix}_d_arg${ai + 1}`);
    }

    // If we have a second positive atom, generate a join
    const hasJoin = positiveAtoms.length >= 2;
    const b1 = hasJoin ? positiveAtoms[1] : null;

    if (b1) {
      for (let ai = 0; ai < b1.args.length; ai++) {
        const v = b1.args[ai];
        if (!varMap[v]) varMap[v] = [];
        varMap[v].push(`${prefix}_f_arg${ai + 1}`);
      }
    }

    // Join conditions
    let joinChecks: string[] = [];
    for (const [, positions] of Object.entries(varMap)) {
      if (positions.length >= 2) {
        for (let pi = 1; pi < positions.length; pi++) {
          joinChecks.push(`${positions[0]} == ${positions[pi]}`);
        }
      }
    }
    let joinCheck = joinChecks.length > 0 ? joinChecks.join(" && ") : "true";

    // Head arg expressions
    let headArgExprs: string[] = [];
    for (const ha of rule.headArgs) {
      headArgExprs.push(varMap[ha]?.[0] || "0");
    }
    while (headArgExprs.length < maxArity) headArgExprs.push("0");

    // Outer loop: iterate delta for first positive atom
    out += `
        // Rule: ${rule.source}
        for (let ${prefix}_di: u32 = deltaStart; ${prefix}_di < deltaEnd; ${prefix}_di++) {
            let ${prefix}_didx = ${prefix}_di * ${FACT_STRIDE};
            if (factTable[${prefix}_didx] != ${b0.pred}) continue;
`;
    for (let ai = 0; ai < b0.args.length; ai++) {
      out += `            let ${prefix}_d_arg${ai + 1} = factTable[${prefix}_didx + ${ai + 1}];\n`;
    }

    if (hasJoin && b1) {
      // Inner loop: hash-indexed scan via predicate index chain
      // Only visits facts with predicate == b1.pred, O(k) instead of O(n)
      out += `            let ${prefix}_fchain = predIndexHead[(${b1.pred} >>> 0) & PRED_INDEX_MASK];
            while (${prefix}_fchain != 0) {
                let ${prefix}_fi = ${prefix}_fchain - 1;
                ${prefix}_fchain = predIndexNext[${prefix}_fi];
                let ${prefix}_fidx = ${prefix}_fi * ${FACT_STRIDE};
                if (factTable[${prefix}_fidx] != ${b1.pred}) continue;
`;
      for (let ai = 0; ai < b1.args.length; ai++) {
        out += `                let ${prefix}_f_arg${ai + 1} = factTable[${prefix}_fidx + ${ai + 1}];\n`;
      }
      out += `                if (${joinCheck}) {\n`;
    } else {
      // Single positive atom — no join needed
      out += `            if (true) {\n`;
    }

    // Task 4.5: Negation checks — scan fact table to verify absence
    for (let ni = 0; ni < negativeAtoms.length; ni++) {
      const neg = negativeAtoms[ni];
      const negLabel = `${prefix}_neg${ni}`;

      // Build negation arg expressions by binding from the varMap
      let negArgChecks: string[] = [`factTable[${negLabel}_idx] == ${neg.pred}`];
      for (let ai = 0; ai < neg.args.length; ai++) {
        const argVar = neg.args[ai];
        const boundExpr = varMap[argVar]?.[0];
        if (boundExpr) {
          negArgChecks.push(`factTable[${negLabel}_idx + ${ai + 1}] == ${boundExpr}`);
        }
        // Unbound variables in negation are existentially checked (any match blocks)
      }

      out += `                    // Negation check: NOT ${neg.predName}(${neg.args.join(", ")})\n`;
      out += `                    let ${negLabel}_found = false;\n`;
      out += `                    for (let ${negLabel}_i: u32 = 0; ${negLabel}_i < factCount; ${negLabel}_i++) {\n`;
      out += `                        let ${negLabel}_idx = ${negLabel}_i * ${FACT_STRIDE};\n`;
      out += `                        if (${negArgChecks.join(" && ")}) {\n`;
      out += `                            ${negLabel}_found = true; break;\n`;
      out += `                        }\n`;
      out += `                    }\n`;
      out += `                    if (${negLabel}_found) {} else {\n`;
    }

    // Emit head fact
    out += `                    if (!factExists(${rule.headHash}, ${headArgExprs.join(", ")})) {\n`;
    out += `                        addFact(${rule.headHash}, ${headArgExprs.join(", ")});\n`;
    out += `                        newFactsDerived = true;\n`;
    out += `                    }\n`;

    // Close negation blocks
    for (const _neg of negativeAtoms) {
      out += `                    }\n`;
    }

    // Close join/condition
    if (hasJoin) {
      out += `                }\n`;
      out += `            }\n`; // Close while (fchain)
    } else {
      out += `            }\n`;
    }

    out += `        }\n`;
    return out;
  }

  // Generate stratified materialization function
  let stratifiedCode = "";
  for (let si = 0; si < numStrata; si++) {
    const stratumRules = rulesByStratum[si];
    if (stratumRules.length === 0) continue;

    let rulesInStratum = "";
    for (let ri = 0; ri < stratumRules.length; ri++) {
      rulesInStratum += generateRuleCode(stratumRules[ri], `s${si}r${ri}`);
    }

    stratifiedCode += `
    // ---- Stratum ${si} (${stratumRules.length} rule(s)) ----
    deltaStart = 0;
    deltaEnd = factCount;
    iteration = 0;
    while (iteration < maxIterations) {
        iteration++;
        let newFactsDerived = false;
        let preCount = factCount;
        ${rulesInStratum}
        deltaStart = preCount;
        deltaEnd = factCount;
        if (!newFactsDerived || deltaStart == deltaEnd) break;
    }
`;
  }

  // ==================================================================
  // Phase 4B: Path Resolution via fact graph
  // ==================================================================
  let pathResolutionCode = "";
  const pathCfg = grammar.semantics?.pathResolution;

  if (pathCfg) {
    // Parse ownership and naming predicate hashes
    const pathObj = pathCfg as any;
    const ownsMatch = pathObj.ownership ? pathObj.ownership.match(/^(\w+)\(/) : null;
    const nameMatch = pathObj.naming ? pathObj.naming.match(/^(\w+)\(/) : null;

    if (ownsMatch && nameMatch) {
      const ownsHash = getDJB2Hash(ownsMatch[1]);
      const nameHash = getDJB2Hash(nameMatch[1]);
      const subsetsHash = pathObj.subsetting ? getDJB2Hash(pathObj.subsetting.match(/^(\w+)\(/)?.[1] || "") : 0;

      pathResolutionCode = `
// --- Fact-Graph Path Resolution (Phase 4B) ---
// Resolves dotted qualified names (a.b.c) through ownership facts.
// Walks: Owns(current, ?child) where NameOf(?child) == segmentHash

const PATH_RESOLVE_MAX_DEPTH: u32 = 32;
let pathSegments = new Uint32Array(PATH_RESOLVE_MAX_DEPTH);

export function resolveQualifiedName(rootElement: u32, segmentHashes: u32, numSegments: u32): u32 {
    // segmentHashes is a pointer to an array of u32 name hashes
    // Walk the ownership chain segment by segment
    let current = rootElement;
    
    for (let seg: u32 = 0; seg < numSegments; seg++) {
        let targetNameHash = load<u32>(segmentHashes + seg * 4);
        let found: u32 = 0;
        
        // Scan facts for Owns(current, ?child)
        for (let i: u32 = 0; i < factCount; i++) {
            let idx = i * FACT_STRIDE;
            if (factTable[idx] == ${ownsHash} && factTable[idx + 1] == current) {
                let child = factTable[idx + 2];
                // Check NameOf(child, targetNameHash)
                for (let j: u32 = 0; j < factCount; j++) {
                    let jdx = j * FACT_STRIDE;
                    if (factTable[jdx] == ${nameHash} && factTable[jdx + 1] == child && factTable[jdx + 2] == targetNameHash) {
                        found = child;
                        break;
                    }
                }
                if (found != 0) break;
            }
        }
        ${
          subsetsHash
            ? `
        // Fallback: check subsetting chain if direct ownership failed
        if (found == 0) {
            for (let i: u32 = 0; i < factCount; i++) {
                let idx = i * FACT_STRIDE;
                if (factTable[idx] == ${subsetsHash} && factTable[idx + 1] == current) {
                    let superElem = factTable[idx + 2];
                    // Recursively try to resolve from the super element
                    let subResult = resolveQualifiedName(superElem, segmentHashes + seg * 4, numSegments - seg);
                    if (subResult != 0) return subResult;
                }
            }
        }`
            : ""
        }
        
        if (found == 0) return 0; // Resolution failed
        current = found;
    }
    
    return current;
}

// Convenience: resolve a single dotted name by splitting on '.'
export function resolveDottedName(rootElement: u32, dottedNamePtr: u32): u32 {
    // Read the dotted name string and split into segment hashes
    let numSegs: u32 = 0;
    let segStart: u32 = 0;
    let len = getNodeByteLength(dottedNamePtr);
    let strDataPtr = getInputBuffer() + getNodePadding(dottedNamePtr);
    
    for (let i: u32 = 0; i <= len; i++) {
        let ch: u8 = i < len ? load<u8>(strDataPtr + i) : 46; // '.'
        if (ch == 46 || i == len) { // '.'
            if (i > segStart) {
                // Hash the segment
                let segHash: u32 = 5381;
                for (let j: u32 = segStart; j < i; j++) {
                    segHash = ((segHash << 5) + segHash + load<u8>(strDataPtr + j)) >>> 0;
                }
                pathSegments[numSegs++] = segHash;
                if (numSegs >= PATH_RESOLVE_MAX_DEPTH) break;
            }
            segStart = i + 1;
        }
    }
    
    if (numSegs == 0) return 0;
    return resolveQualifiedName(rootElement, changetype<u32>(pathSegments), numSegs);
}
`;
    }
  }

  // ==================================================================
  // Emit fact table, runtime functions, and materialization
  // ==================================================================
  let addFactParams = ["pred: u32"];
  let factExistsParams = ["pred: u32"];
  let addFactStores = [`    factTable[idx] = pred;\n`];
  let factExistsChecks = [`factTable[idx] == pred`];

  for (let ai = 1; ai <= maxArity; ai++) {
    addFactParams.push(`arg${ai}: u32 = 0`);
    factExistsParams.push(`arg${ai}: u32 = 0`);
    addFactStores.push(`    factTable[idx + ${ai}] = arg${ai};\n`);
    factExistsChecks.push(`factTable[idx+${ai}] == arg${ai}`);
  }

  const maxFactsOverride = grammar.semantics?.reasoner?.maxFacts;
  const MAX_FACTS = maxFactsOverride || Math.floor(100000 / FACT_STRIDE);

  code += `
const FACT_STRIDE: u32 = ${FACT_STRIDE};
export let factTable = new ChunkedUint32Array(${MAX_FACTS * FACT_STRIDE});
export let factCount: u32 = 0;
const MAX_FACTS: u32 = ${MAX_FACTS};

// --- Predicate Index for O(k) Join Acceleration ---
// Maps predicate hash → head of a linked list of fact indices with that predicate.
// Each fact has a 'next' pointer forming a singly-linked list per predicate.
const PRED_INDEX_CAPACITY: u32 = 4096; // Must be power of 2
const PRED_INDEX_MASK: u32 = PRED_INDEX_CAPACITY - 1;
let predIndexHead = new ChunkedUint32Array(PRED_INDEX_CAPACITY); // Head fact index (1-based, 0 = empty)
let predIndexNext = new ChunkedUint32Array(${MAX_FACTS});         // Next fact in predicate chain (1-based, 0 = end)

// --- Hash Index for O(1) Fact Existence Checks ---
// Open-addressing hash table: each slot stores the fact index (1-based) or 0 for empty.
// Key = (pred XOR arg1 * 2654435761) to distribute across buckets.
const FACT_HASH_CAPACITY: u32 = ${Math.max(MAX_FACTS * 4, 16384)};
let factHashTable = new ChunkedUint32Array(FACT_HASH_CAPACITY);

function factHashKey(${addFactParams.join(", ")}): u32 {
    // Fibonacci hashing on (pred, arg1) for good distribution
    return ((pred ^ (${maxArity >= 1 ? "arg1" : "0"} * 2654435761)) >>> 0) % FACT_HASH_CAPACITY;
}

export function addFact(${addFactParams.join(", ")}): void {
   if (factCount >= MAX_FACTS) return;
   // Check if already exists via hash index
   if (factExists(${addFactParams.map((p) => p.split(":")[0].trim()).join(", ")})) return;
   let idx = factCount * FACT_STRIDE;
${addFactStores.join("")}   let factIdx = factCount;
   factCount++;
   // Insert into hash index (1-based index to distinguish from empty=0)
   let hk = factHashKey(${addFactParams.map((p) => p.split(":")[0].trim()).join(", ")});
   let guard: u32 = 0;
   while (factHashTable[hk] != 0 && guard < FACT_HASH_CAPACITY) {
       hk = (hk + 1) % FACT_HASH_CAPACITY;
       guard++;
   }
   if (guard < FACT_HASH_CAPACITY) factHashTable[hk] = factCount; // 1-based
   // Insert into predicate index chain
   let predSlot = (pred >>> 0) & PRED_INDEX_MASK;
   predIndexNext[factIdx] = predIndexHead[predSlot];
   predIndexHead[predSlot] = factIdx + 1; // 1-based
}

export function factExists(${factExistsParams.join(", ")}): boolean {
   // O(1) amortized lookup via hash index
   let hk = factHashKey(${factExistsParams.map((p) => p.split(":")[0].trim()).join(", ")});
   let guard: u32 = 0;
   while (guard < FACT_HASH_CAPACITY) {
       let slot = factHashTable[hk];
       if (slot == 0) return false; // Empty slot = not found
       let idx = (slot - 1) * FACT_STRIDE;
       if (${factExistsChecks.join(" && ")}) return true;
       hk = (hk + 1) % FACT_HASH_CAPACITY;
       guard++;
   }
   return false;
}

export function initFactArena(): void {
   factCount = 0;
   // Clear hash index
   for (let i: u32 = 0; i < FACT_HASH_CAPACITY; i++) factHashTable[i] = 0;
   // Clear predicate index
   for (let i: u32 = 0; i < PRED_INDEX_CAPACITY; i++) predIndexHead[i] = 0;
}

let globalTraverseStack = new ChunkedUint32Array(100000);

export function traverseAndExtract(newRoot: u32): void {
  if (newRoot == 0) return;
  let traverseStack = globalTraverseStack;
  let stackTop = 0;
  traverseStack[stackTop++] = newRoot;
  
  while (stackTop > 0) {
    let nodeId = traverseStack[--stackTop];
    if (nodeId == 0) continue;
    
    let sym = load<u16>(nodeId, 0);
    ${extractionCode}
    
    let childPtr = getNodeFirstChild(nodeId);
    let childCount = 0;
    let tempPtr = childPtr;
    while (tempPtr != 0) {
      childCount++;
      tempPtr = getNodeNextSibling(tempPtr);
    }
    if (childCount > 0) {
      let cPtr = childPtr;
      let p = stackTop + childCount - 1;
      while (cPtr != 0) {
        traverseStack[p--] = cPtr;
        cPtr = getNodeNextSibling(cPtr);
      }
      stackTop += childCount;
    }
  }
}

export function extractTypeFacts(newRoot: u32): void {
  if (newRoot == 0) return;
  let traverseStack = globalTraverseStack;
  let stackTop = 0;
  traverseStack[stackTop++] = newRoot;
  
  while (stackTop > 0) {
    let nodeId = traverseStack[--stackTop];
    if (nodeId == 0) continue;
    
    ${typeExtractionCode}
    
    let childPtr = getNodeFirstChild(nodeId);
    let childCount = 0;
    let tempPtr = childPtr;
    while (tempPtr != 0) {
      childCount++;
      tempPtr = getNodeNextSibling(tempPtr);
    }
    if (childCount > 0) {
      let cPtr = childPtr;
      let p = stackTop + childCount - 1;
      while (cPtr != 0) {
        traverseStack[p--] = cPtr;
        cPtr = getNodeNextSibling(cPtr);
      }
      stackTop += childCount;
    }
  }

  ${deepTypeFactsCode}
}

export function tombstoneFact(factIdx: u32): void {
    // Mark a fact as deleted by zeroing its predicate slot
    if (factIdx < factCount) {
        factTable[factIdx * FACT_STRIDE] = 0; // pred = 0 means tombstoned
    }
}

export function garbageCollectFacts(): void {
    // Compact: skip tombstoned facts (pred == 0), write live facts contiguously
    let writeIdx: u32 = 0;
    for (let i: u32 = 0; i < factCount; i++) {
        let idx = i * FACT_STRIDE;
        if (factTable[idx] == 0) continue; // Skip tombstoned facts
        
        if (writeIdx != i) {
            let wIdx = writeIdx * FACT_STRIDE;
            for (let k: u32 = 0; k < FACT_STRIDE; k++) {
                factTable[wIdx + k] = factTable[idx + k];
            }
        }
        writeIdx++;
    }
    factCount = writeIdx;
    
    // Rebuild hash index after compaction (old slot values are now stale)
    for (let i: u32 = 0; i < FACT_HASH_CAPACITY; i++) factHashTable[i] = 0;
    // Rebuild predicate index
    for (let i: u32 = 0; i < PRED_INDEX_CAPACITY; i++) predIndexHead[i] = 0;
    
    for (let i: u32 = 0; i < factCount; i++) {
        let idx = i * FACT_STRIDE;
        // Rebuild hash index
        let hk = factHashKey(${Array.from({ length: maxArity + 1 }, (_, k) => (k === 0 ? "factTable[idx]" : `factTable[idx + ${k}]`)).join(", ")});
        let guard: u32 = 0;
        while (factHashTable[hk] != 0 && guard < FACT_HASH_CAPACITY) {
            hk = (hk + 1) % FACT_HASH_CAPACITY;
            guard++;
        }
        if (guard < FACT_HASH_CAPACITY) factHashTable[hk] = i + 1; // 1-based
        
        // Rebuild predicate index chain
        let predSlot = (factTable[idx] >>> 0) & PRED_INDEX_MASK;
        predIndexNext[i] = predIndexHead[predSlot];
        predIndexHead[predSlot] = i + 1; // 1-based
    }
}

// --- Stratified Datalog Materialization (Phase 4A) ---
// ${numStrata} stratum/strata computed from negation dependencies.
export function runDatalogMaterialization(): void {
    let deltaStart: u32 = 0;
    let deltaEnd: u32 = factCount;
    let maxIterations: u32 = 100;
    let iteration: u32 = 0;
    ${stratifiedCode}
}

export function runAxiomValidation(): void {
${axiomCode}
}

export function datalog_ask_string(q: string): boolean {
    // Parse the query string: "predicate(arg1, arg2, ...)" or just "predicate"
    // Hash each component using the same DJB2 algorithm used by getDJB2Hash
    
    // Find the opening parenthesis
    let parenIdx: i32 = -1;
    for (let i = 0; i < q.length; i++) {
        if (q.charCodeAt(i) == 40) { parenIdx = i; break; } // '('
    }
    
    // Hash the predicate name
    let predEnd = parenIdx >= 0 ? parenIdx : q.length;
    let predHash: u32 = 5381;
    for (let i = 0; i < predEnd; i++) {
        predHash = ((predHash << 5) + predHash + q.charCodeAt(i)) >>> 0;
    }
    
    // Parse and hash arguments (if any)
    let argHashes = new StaticArray<u32>(${maxArity});
    let argCount: u32 = 0;
    
    if (parenIdx >= 0) {
        // Find closing paren
        let closeIdx = q.length - 1;
        for (let i = q.length - 1; i >= parenIdx; i--) {
            if (q.charCodeAt(i) == 41) { closeIdx = i; break; } // ')'
        }
        
        // Split on commas and hash each argument
        let argStart = parenIdx + 1;
        for (let i = parenIdx + 1; i <= closeIdx; i++) {
            let ch = i < closeIdx ? q.charCodeAt(i) : 44; // Treat closing paren as comma
            if (ch == 44 || i == closeIdx) { // ',' or end
                // Hash this argument (trimming whitespace)
                let h: u32 = 5381;
                let hasContent = false;
                for (let j = argStart; j < i; j++) {
                    let c = q.charCodeAt(j);
                    if (c != 32 && c != 9) { // Skip whitespace
                        h = ((h << 5) + h + c) >>> 0;
                        hasContent = true;
                    }
                }
                if (hasContent && argCount < ${maxArity}) {
                    argHashes[argCount] = h;
                    argCount++;
                }
                argStart = i + 1;
            }
        }
    }
    
    // Build the full argument list for factExists
    return factExists(predHash${Array.from({ length: maxArity }, (_, i) => `, argCount > ${i} ? argHashes[${i}] : 0`).join("")});
}

${pathResolutionCode}
`;

  return code;
}
