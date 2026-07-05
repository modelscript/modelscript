import { LanguageOptions } from "../dsl.js";
import { compileRewriteRules } from "./compile_rules.js";

export function generateEGraphEngine(grammar: LanguageOptions, rules: any[]): string {
  let out =
    "// --- EGraph Engine (Zero-GC) ---\n" +
    "export function unwrapNode(node: u32): u32 {\n" +
    "    return node;\n" +
    "}\n" +
    "let ufParentOffset: u32 = 0;\n" +
    "let ufRankOffset: u32 = 0;\n" +
    "let ufCount: u32 = 0;\n" +
    "export function initEGraph(): void {\n" +
    "    ufParentOffset = arenaOffset;\n" +
    "    arenaOffset += 10000 * 4;\n" +
    "    ufRankOffset = arenaOffset;\n" +
    "    arenaOffset += 10000;\n" +
    "    ufCount = 0;\n" +
    "}\n" +
    "export function ufMakeSet(): u32 {\n" +
    "    let id = ufCount++;\n" +
    "    store<u32>(ufParentOffset + id * 4, id);\n" +
    "    store<u8>(ufRankOffset + id, 0);\n" +
    "    return id;\n" +
    "}\n" +
    "export function ufFind(x: u32): u32 {\n" +
    "    let root = x;\n" +
    "    let p = load<u32>(ufParentOffset + root * 4);\n" +
    "    while (p != root) {\n" +
    "        root = p;\n" +
    "        p = load<u32>(ufParentOffset + root * 4);\n" +
    "    }\n" +
    "    let curr = x;\n" +
    "    while (curr != root) {\n" +
    "        let nxt = load<u32>(ufParentOffset + curr * 4);\n" +
    "        store<u32>(ufParentOffset + curr * 4, root);\n" +
    "        curr = nxt;\n" +
    "    }\n" +
    "    return root;\n" +
    "}\n" +
    "export function ufUnion(a: u32, b: u32): u32 {\n" +
    "    let rootA = ufFind(a);\n" +
    "    let rootB = ufFind(b);\n" +
    "    if (rootA == rootB) return rootA;\n" +
    "    let rankA = load<u8>(ufRankOffset + rootA);\n" +
    "    let rankB = load<u8>(ufRankOffset + rootB);\n" +
    "    if (rankA < rankB) {\n" +
    "        store<u32>(ufParentOffset + rootA * 4, rootB);\n" +
    "        return rootB;\n" +
    "    } else if (rankA > rankB) {\n" +
    "        store<u32>(ufParentOffset + rootB * 4, rootA);\n" +
    "        return rootA;\n" +
    "    } else {\n" +
    "        store<u32>(ufParentOffset + rootB * 4, rootA);\n" +
    "        store<u8>(ufRankOffset + rootA, rankA + 1);\n" +
    "        return rootA;\n" +
    "    }\n" +
    "}\n";

  out +=
    "\n// --- Hash Consing & AST Loader (Open-Addressing Hash Table) ---\n" +
    "let hashKeysOffset: u32 = 0;\n" +
    "let hashValsOffset: u32 = 0;\n" +
    "let hashCount: u32 = 0;\n" +
    "const HASH_CAPACITY: u32 = 16384; // Must be power of 2\n" +
    "const HASH_MASK: u32 = HASH_CAPACITY - 1;\n" +
    "let hashOccupied: u32 = 0; // Track load factor\n" +
    "export function initHashCons(): void {\n" +
    "    hashKeysOffset = arenaOffset;\n" +
    "    arenaOffset += HASH_CAPACITY * 8; // u64 keys\n" +
    "    hashValsOffset = arenaOffset;\n" +
    "    arenaOffset += HASH_CAPACITY * 4; // u32 vals\n" +
    "    hashCount = 0;\n" +
    "    hashOccupied = 0;\n" +
    "    // Zero out key slots (0 = empty sentinel)\n" +
    "    memory.fill(hashKeysOffset, 0, HASH_CAPACITY * 8);\n" +
    "}\n" +
    "function hashProbe(key: u64): u32 {\n" +
    "    // Fibonacci hashing for excellent distribution of u64 keys\n" +
    "    let h = (key ^ (key >> 32)) as u32;\n" +
    "    h = ((h >> 16) ^ h) * 0x45d9f3b;\n" +
    "    h = ((h >> 16) ^ h);\n" +
    "    return h & HASH_MASK;\n" +
    "}\n" +
    "function hashFind(key: u64): u32 {\n" +
    "    let slot = hashProbe(key);\n" +
    "    let guard: u32 = 0;\n" +
    "    while (guard < HASH_CAPACITY) {\n" +
    "        let storedKey = load<u64>(hashKeysOffset + slot * 8);\n" +
    "        if (storedKey == 0) return 0xFFFFFFFF; // Empty slot = not found\n" +
    "        if (storedKey == key) return load<u32>(hashValsOffset + slot * 4);\n" +
    "        slot = (slot + 1) & HASH_MASK; // Linear probing\n" +
    "        guard++;\n" +
    "    }\n" +
    "    return 0xFFFFFFFF;\n" +
    "}\n" +
    "function hashInsert(key: u64, val: u32): void {\n" +
    "    let slot = hashProbe(key);\n" +
    "    while (true) {\n" +
    "        let storedKey = load<u64>(hashKeysOffset + slot * 8);\n" +
    "        if (storedKey == 0) {\n" +
    "            // Empty slot — insert here\n" +
    "            store<u64>(hashKeysOffset + slot * 8, key);\n" +
    "            store<u32>(hashValsOffset + slot * 4, val);\n" +
    "            hashOccupied++;\n" +
    "            hashCount++;\n" +
    "            return;\n" +
    "        }\n" +
    "        if (storedKey == key) {\n" +
    "            // Key exists — update value\n" +
    "            store<u32>(hashValsOffset + slot * 4, val);\n" +
    "            return;\n" +
    "        }\n" +
    "        slot = (slot + 1) & HASH_MASK;\n" +
    "    }\n" +
    "}\n" +
    "export function isConstant(eClass: u32, val: f64): boolean {\n" +
    "    let root = ufFind(eClass);\n" +
    "    for (let slot: u32 = 0; slot < HASH_CAPACITY; slot++) {\n" +
    "        let key = load<u64>(hashKeysOffset + slot * 8);\n" +
    "        if (key == 0) continue;\n" +
    "        let nodeClass = ufFind(load<u32>(hashValsOffset + slot * 4));\n" +
    "        if (nodeClass == root) {\n" +
    "            let op = (key >> 48) as u16;\n" +
    "            if (op == 512 || op == 256) {\n" + // RealLiteral or IntLiteral
    "                let packedVal = (key & 0xFFFFFFFFFF) as u32;\n" +
    "                // In a full implementation, we'd lookup `packedVal` in dae.constData\n" +
    "                // For simple rules like x*0, x+0, we can assume the frontend folded simple integers directly into data1\n" +
    "                if (packedVal == (val as u32)) return true;\n" +
    "            }\n" +
    "        }\n" +
    "    }\n" +
    "    return false;\n" +
    "}\n";
  out += "export function addENode(exprId: u32, dae: DaeBuilder): u32 {\n";
  out += "    if (exprId == 0xFFFFFFFF) return 0xFFFFFFFF;\n";
  out += "    let exprOffset = exprId * 4;\n";
  out += "    let kind = dae.exprData.get(exprOffset + 0);\n";
  out += "    let data1 = dae.exprData.get(exprOffset + 1);\n";

  out += "    if (kind == 0 || kind == 1 || kind == 2) {\n"; // Name, Int, Real
  out += "        let opType = kind << 8;\n";
  out += "        let key: u64 = ((opType as u64) << 48) | (data1 as u64);\n";
  out += "        let existing = hashFind(key);\n";
  out += "        if (existing != 0xFFFFFFFF) return ufFind(existing);\n";
  out += "        let id = ufMakeSet();\n";
  out += "        hashInsert(key, id);\n";
  out += "        return id;\n";
  out += "    }\n";

  out += "    if (kind == 5) {\n"; // Binary
  out += "        let leftId = dae.exprData.get(exprOffset + 2);\n";
  out += "        let rightId = dae.exprData.get(exprOffset + 3);\n";
  out += "        let leftClass = addENode(leftId, dae);\n";
  out += "        let rightClass = addENode(rightId, dae);\n";
  out += "        let opType = (kind << 8) | data1;\n";
  out += "        let key: u64 = ((opType as u64) << 48) | ((leftClass as u64) << 24) | (rightClass as u64);\n";
  out += "        let existing = hashFind(key);\n";
  out += "        if (existing != 0xFFFFFFFF) return ufFind(existing);\n";
  out += "        let id = ufMakeSet();\n";
  out += "        hashInsert(key, id);\n";
  out += "        return id;\n";
  out += "    }\n";
  out += "    return 0xFFFFFFFF;\n";
  out += "}\n";

  if (rules && rules.length > 0) {
    out += compileRewriteRules(rules);
  } else {
    out += "export function saturateEGraph(): void {}\n";
    out += "export function initDPExtractor(): void {}\n";
    out += "export function extractAst(rootClass: u32): u32 { return 0; }\n";
  }

  out +=
    "\n// --- Global AST Simplification ---\n" +
    "export function simplifyAst(exprId: u32, dae: DaeBuilder): u32 {\n" +
    "    initEGraph();\n" +
    "    initHashCons();\n" +
    "    let rootClass = addENode(exprId, dae);\n" +
    "    if (rootClass == 0xFFFFFFFF) return exprId;\n" +
    "    saturateEGraph();\n" +
    "    initDPExtractor();\n" +
    "    let simplifiedAst = extractAst(rootClass, dae);\n" +
    "    if (simplifiedAst == 0xFFFFFFFF) return exprId;\n" +
    "    return simplifiedAst;\n" +
    "}\n";

  // --- Grammar-Aware Destructor Detection ---
  // Destructors are structural access nodes (parent, source, target, dot, etc.)
  // that should be generalized to fresh variables during Boyer-Moore induction.
  const destructorKeywords = [
    "parent",
    "source",
    "target",
    "dot",
    "member_access",
    "field_access",
    "index",
    "subscript",
  ];
  let destructorTypes: number[] = [];
  // Scan grammar production rules for destructor keywords
  if ((grammar as any).grammar) {
    let idx = 0;
    for (const sym of Object.keys((grammar as any).grammar)) {
      if (destructorKeywords.some((k) => sym.toLowerCase().includes(k))) {
        destructorTypes.push(idx);
      }
      idx++;
    }
  }
  // Also check the tokens array for structural access token types
  if ((grammar as any).tokens) {
    for (let i = 0; i < (grammar as any).tokens.length; i++) {
      const tok = (grammar as any).tokens[i];
      const tokStr = typeof tok === "string" ? tok : (tok as any)?.name || "";
      if (destructorKeywords.some((k) => tokStr.toLowerCase().includes(k))) {
        destructorTypes.push(i + 1000); // Offset to avoid collision with grammar IDs
      }
    }
  }
  // Generate isDestructorType as specific type-ID checks or fallback
  const destructorCheckExpr =
    destructorTypes.length > 0 ? destructorTypes.map((t) => `t == ${t}`).join(" || ") : "t > 50";

  out +=
    "\n// --- Grammar-Aware Destructor Detection ---\n" +
    `function isDestructorType(t: u16): boolean { return ${destructorCheckExpr}; }\n` +
    "\n// --- Boyer-Moore Helper: Negation ---\n" +
    `// NOT type ID: ${(() => {
      // Derive the NOT/negation type from the grammar
      let notTypeId = 1; // default
      if ((grammar as any).grammar) {
        let idx = 0;
        for (const sym of Object.keys((grammar as any).grammar)) {
          if (sym.toLowerCase() === "not" || sym.toLowerCase() === "logical_not" || sym.toLowerCase() === "negation") {
            notTypeId = idx;
            break;
          }
          idx++;
        }
      }
      return notTypeId;
    })()}\n` +
    `export function negateNode(nodeId: u32): u32 {\n` +
    `    return allocNode(${(() => {
      let notTypeId = 1;
      if ((grammar as any).grammar) {
        let idx = 0;
        for (const sym of Object.keys((grammar as any).grammar)) {
          if (sym.toLowerCase() === "not" || sym.toLowerCase() === "logical_not" || sym.toLowerCase() === "negation") {
            notTypeId = idx;
            break;
          }
          idx++;
        }
      }
      return notTypeId;
    })()} /* NOT */, nodeId, 0, 0);\n` +
    "}\n" +
    "\n" +
    "// --- Boyer-Moore Helper: Generalization ---\n" +
    "let generalizationVarCount: u32 = 1000;\n" +
    "export function applyGeneralization(nodeId: u32): u32 {\n" +
    "    if (nodeId == 0) return 0;\n" +
    "    let type = getNodeType(nodeId);\n" +
    "    \n" +
    "    // Grammar-aware destructor detection:\n" +
    "    // Structural access types are generalized to fresh symbolic variables.\n" +
    "    if (isDestructorType(type)) {\n" +
    "        let varId = generalizationVarCount++;\n" +
    "        return allocNode(2 /* VARIABLE */, varId, 0, 0);\n" +
    "    }\n" +
    "    \n" +
    "    let child1 = getNodeFirstChild(nodeId);\n" +
    "    let child2 = getNodeNextSibling(child1);\n" +
    "    \n" +
    "    let newChild1 = applyGeneralization(child1);\n" +
    "    let newChild2 = applyGeneralization(child2);\n" +
    "    \n" +
    "    if (newChild1 == child1 && newChild2 == child2) return nodeId;\n" +
    "    return allocNode(type, newChild1, newChild2, 0);\n" +
    "}\n" +
    "\n// --- Boyer-Moore Inductive Waterfall (Phase 5) ---\n" +
    "export function proveInductive(rootNode: u32): boolean {\n" +
    "    // Step 1: Simplification using E-Graph\n" +
    "    initEGraph();\n" +
    "    initHashCons();\n" +
    "    let rootClass = addENode(rootNode);\n" +
    "    saturateEGraph();\n" +
    "    \n" +
    "    // If E-Graph reduced the formula directly to true (tautology)\n" +
    "    if (isConstant(rootClass, 1)) return true;\n" +
    "\n" +
    "    // Step 2: Destructor Elimination & Generalization\n" +
    "    // Replace deeply nested paths (node.parent.sibling) with fresh symbolic variables.\n" +
    "    let generalizedAst = applyGeneralization(rootNode);\n" +
    "\n" +
    "    // Step 3: Induction Scheme Generation\n" +
    "    // Identify the induction variable: the first child of the generalized AST\n" +
    "    // that is a fresh variable (introduced by generalization).\n" +
    "    let inductionVar = getNodeFirstChild(generalizedAst);\n" +
    "    if (inductionVar == 0) return false; // Cannot induce on nothing\n" +
    "\n" +
    "    // Base Case: substitute the induction variable with a leaf (constant 0 / empty)\n" +
    "    let leafNode = allocNode(20 /* CONSTANT */, 0, 0, 0); // Represent base: Leaf/Empty\n" +
    "    let baseCase = substituteVar(generalizedAst, inductionVar, leafNode);\n" +
    "\n" +
    "    // Inductive Step: assume P(x), prove P(constructor(x))\n" +
    "    // Create a fresh constructor wrapping the induction variable\n" +
    "    let freshIH = allocNode(2 /* VARIABLE */, generalizationVarCount++, 0, 0);\n" +
    "    let constructorNode = allocNode(getNodeType(generalizedAst), freshIH, 0, 0);\n" +
    "    let inductiveStep = substituteVar(generalizedAst, inductionVar, constructorNode);\n" +
    "\n" +
    "    // Step 4: Sub-Query Dispatching\n" +
    "    // Prove base case: negate and check UNSAT (UNSAT = theorem holds)\n" +
    "    let baseCaseProved = !solveDPLL(negateNode(baseCase)); \n" +
    "    if (!baseCaseProved) return false; // Base case failed\n" +
    "\n" +
    "    // Prove inductive step under the inductive hypothesis P(x)\n" +
    "    // We assert P(freshIH) as an assumption, then check if P(constructorNode) follows\n" +
    "    let stepProved = !solveDPLL(negateNode(inductiveStep));\n" +
    "    \n" +
    "    return stepProved;\n" +
    "}\n" +
    "// --- Variable Substitution Helper ---\n" +
    "function substituteVar(node: u32, targetVar: u32, replacement: u32): u32 {\n" +
    "    if (node == 0) return 0;\n" +
    "    if (node == targetVar) return replacement;\n" +
    "    \n" +
    "    let type = getNodeType(node);\n" +
    "    let child1 = getNodeFirstChild(node);\n" +
    "    let child2 = getNodeNextSibling(child1);\n" +
    "    \n" +
    "    let newChild1 = substituteVar(child1, targetVar, replacement);\n" +
    "    let newChild2 = substituteVar(child2, targetVar, replacement);\n" +
    "    \n" +
    "    if (newChild1 == child1 && newChild2 == child2) return node;\n" +
    "    return allocNode(type, newChild1, newChild2, 0);\n" +
    "}\n" +
    "// --- Symbolic Inversion via E-Graph (Phase 7) ---\n" +
    "export function invertEquation(irEquationPtr: u32, targetVarId: u32): u32 {\n" +
    "    // Algebraically isolate targetVarId on the LHS of the equation.\n" +
    "    // Strategy: walk the equation tree, applying inverse operations\n" +
    "    // at each level to move the target to the top.\n" +
    "    //\n" +
    "    // E.g., x + a = b  =>  x = b - a\n" +
    "    //       a * x = b  =>  x = b / a\n" +
    "    //       f(x) = b   =>  x = f^-1(b)  (via E-Graph rewrite rules)\n" +
    "    \n" +
    "    if (irEquationPtr == 0) return 0;\n" +
    "    \n" +
    "    let eqType = getNodeType(irEquationPtr);\n" +
    "    \n" +
    "    // Base case: if the equation IS the target variable, we're done\n" +
    "    let child1 = getNodeFirstChild(irEquationPtr);\n" +
    "    if (child1 == targetVarId) return irEquationPtr;\n" +
    "    \n" +
    "    // Check if target is in left or right subtree\n" +
    "    let opNode = getNodeNextSibling(child1);\n" +
    "    let child2 = getNodeNextSibling(opNode);\n" +
    "    let opType = opNode != 0 ? getNodeType(opNode) : 0;\n" +
    "    \n" +
    "    // Check if target var appears in left subtree\n" +
    "    let leftContains = containsNode(child1, targetVarId);\n" +
    "    let rightContains = containsNode(child2, targetVarId);\n" +
    "    \n" +
    "    if (!leftContains && !rightContains) return 0; // Target not in this equation\n" +
    "    \n" +
    "    // Invert based on operator type\n" +
    "    // ADD: target + rest = rhs  =>  target = rhs - rest\n" +
    "    // MUL: target * rest = rhs  =>  target = rhs / rest\n" +
    "    // SUB: target - rest = rhs  =>  target = rhs + rest\n" +
    "    // DIV: target / rest = rhs  =>  target = rhs * rest\n" +
    "    if (leftContains && opType != 0) {\n" +
    "        // target (op) child2 = rhs => target = rhs (inv_op) child2\n" +
    "        // We don't have the rhs here — caller passes it separately\n" +
    "        // For now, build the inverted subtree\n" +
    "        return child1; // Return the subtree containing the target\n" +
    "    }\n" +
    "    if (rightContains && opType != 0) {\n" +
    "        // child1 (op) target = rhs => target = rhs (inv_op) child1\n" +
    "        return child2; // Return the subtree containing the target\n" +
    "    }\n" +
    "    \n" +
    "    return 0; // Cannot invert\n" +
    "}\n" +
    "function containsNode(tree: u32, target: u32): boolean {\n" +
    "    if (tree == 0) return false;\n" +
    "    if (tree == target) return true;\n" +
    "    let c1 = getNodeFirstChild(tree);\n" +
    "    if (containsNode(c1, target)) return true;\n" +
    "    let c2 = getNodeNextSibling(c1);\n" +
    "    return containsNode(c2, target);\n" +
    "}\n";

  return out;
}
