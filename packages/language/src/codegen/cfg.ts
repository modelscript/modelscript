import { LanguageOptions } from "../dsl.js";

/**
 * Generates a generic AST → CFG lowering pass in AssemblyScript.
 *
 * DSL authors declare which node types produce branches/loops via `cfgNodes`:
 *
 *   cfgNodes: {
 *     IfStmt:    { condition: 'condition', trueBranch: 'thenBody', falseBranch: 'elseBody' },
 *     WhileStmt: { condition: 'condition', trueBranch: 'body', isLoop: true },
 *     SwitchStmt: { branchList: 'cases' } // Multi-way branch
 *   }
 */
export function generateCFG(grammar: LanguageOptions<any>, normalized?: any): string {
  const cfgNodes = (grammar as any).cfgNodes;
  if (!cfgNodes || Object.keys(cfgNodes).length === 0) {
    return "// CFG Construction Disabled (no cfgNodes configured)\n";
  }

  function getFieldSiblingIndex(ruleName: string, fieldName: string): number {
    if (!normalized || !normalized.evaluatedRules) return -1;
    const rule = normalized.evaluatedRules[ruleName];
    if (!rule) return -1;
    let seqRule = rule.type === "DEF" ? rule.children![0] : rule;
    if (!seqRule || seqRule.type !== "SEQ") return -1;
    let idx = 0;
    for (const child of seqRule.children || []) {
      if (child.type === "FIELD" && child.value === fieldName) return idx;
      idx++;
    }
    return -1;
  }

  function emitFieldAccess(varName: string, nodeName: string, fieldName: string): string {
    const sibIdx = getFieldSiblingIndex(nodeName, fieldName);
    if (sibIdx < 0) {
      return (
        `            // Field '${fieldName}' fallback search in '${nodeName}'\n` +
        `            let ${varName} = getNodeFirstChild(nodeId);\n`
      );
    }
    let code = "";
    if (sibIdx === 0) {
      code += `            let ${varName} = getNodeFirstChild(nodeId);\n`;
    } else {
      code += `            let ${varName} = getNodeFirstChild(nodeId);\n`;
      for (let i = 0; i < sibIdx; i++) {
        code += `            ${varName} = getNodeNextSibling(${varName});\n`;
      }
    }
    return code;
  }

  let code = `
import { allocGen0, getNodeType, getNodeFirstChild, getNodeNextSibling, getNodeFlags, FLAG_IS_SYNTHETIC } from "./arena";
import { SyntaxType } from "./parser";
import { BLOCK_SIZE, BLOCK_TRUE_BRANCH, BLOCK_FALSE_BRANCH } from "./ir_layout";

export let firstBlock: u32 = 0;
export let currentBlock: u32 = 0;
export let currentLoopHeader: u32 = 0;
export let currentLoopExit: u32 = 0;
export let fnExitBlock: u32 = 0;

export function allocBlock(): u32 {
    let blk = allocGen0(BLOCK_SIZE);
    if (blk != 0) {
        memory.fill(blk as usize, 0, BLOCK_SIZE);
        if (firstBlock == 0) firstBlock = blk;
    }
    return blk;
}

// --- Generic CFG Construction Pass ---
// Generated from cfgNodes configuration.
// Creates basic blocks and wires control flow edges.

export function buildCFG(rootNodeId: u32): u32 {
    // Reset IR state
    firstBlock = 0;
    currentBlock = 0;
    currentLoopHeader = 0;
    currentLoopExit = 0;
    
    // Create the entry block and exit block
    let entryBlock = allocBlock();
    if (entryBlock == 0) return 0; // OOM
    fnExitBlock = allocBlock();
    
    // Traverse the AST and build CFG
    let finalBlk = buildCFGNode(rootNodeId, entryBlock);
    if (finalBlk != 0 && fnExitBlock != 0) {
        store<u32>(finalBlk + BLOCK_TRUE_BRANCH, fnExitBlock);
    }
    
    return entryBlock;
  }

function buildCFGNode(nodeId: u32, currentBlk: u32): u32 {
    if (nodeId == 0 || currentBlk == 0) return currentBlk;
    if ((getNodeFlags(nodeId) & FLAG_IS_SYNTHETIC) != 0) return currentBlk;
    
    let nodeType = getNodeType(nodeId);
    
    switch (nodeType) {
`;

  for (const [nodeName, config] of Object.entries(cfgNodes) as [string, any][]) {
    const safeName = `SyntaxType.${nodeName.toUpperCase()}`;

    code += `        case <u16>${safeName}: {\n`;

    if (config.type === "LOOP") {
      const payload = config.payload;
      code += `            // ${nodeName}: LOOP node\n`;
      if (payload.cond) code += emitFieldAccess("condNode", nodeName, payload.cond.payload.name);
      if (payload.body) code += emitFieldAccess("trueBodyNode", nodeName, payload.body.payload.name);
      code += `            let trueBlock = allocBlock();\n`;
      code += `            let exitBlock = allocBlock();\n`;
      code += `            if (trueBlock == 0 || exitBlock == 0) return 0;\n\n`;
      code += `            store<u32>(currentBlk + BLOCK_TRUE_BRANCH, trueBlock);\n`;
      code += `            store<u32>(currentBlk + BLOCK_FALSE_BRANCH, exitBlock);\n`;
      code += `            let saveHeader = currentLoopHeader;\n`;
      code += `            let saveExit = currentLoopExit;\n`;
      code += `            currentLoopHeader = currentBlk;\n`;
      code += `            currentLoopExit = exitBlock;\n`;
      code += `            let bodyEnd = buildCFGNode(trueBodyNode, trueBlock);\n`;
      code += `            currentLoopHeader = saveHeader;\n`;
      code += `            currentLoopExit = saveExit;\n`;
      code += `            if (bodyEnd != 0) store<u32>(bodyEnd + BLOCK_TRUE_BRANCH, currentBlk);\n`;
      code += `            return exitBlock;\n`;
    } else if (config.type === "SEQ") {
      const payload = config.payload;
      code += `            // ${nodeName}: SEQ node\n`;
      code += `            let blk = currentBlk;\n`;
      for (let i = 0; i < payload.steps.length; i++) {
        code += emitFieldAccess(`step${i}`, nodeName, payload.steps[i].payload.name);
        code += `            if (step${i} != 0) blk = buildCFGNode(step${i}, blk);\n`;
      }
      code += `            return blk;\n`;
    } else if (config.type === "CALL") {
      const payload = config.payload;
      code += `            // ${nodeName}: CALL inter-procedural node\n`;
      if (payload.target) code += emitFieldAccess("targetNode", nodeName, payload.target.payload.name);
      if (payload.arguments) code += emitFieldAccess("argsNode", nodeName, payload.arguments.payload.name);
      code += `            let joinBlock = allocBlock();\n`;
      code += `            if (joinBlock == 0) return 0;\n`;
      code += `            // (1) Resolve function definition\n`;
      code += `            // NOTE: In a real environment, you must provide resolveFunctionTarget and bindCallArguments\n`;
      code += `            // let targetFunc = resolveFunctionTarget(targetNode);\n`;
      code += `            let targetFunc = 0;\n`;
      code += `            if (targetFunc != 0) {\n`;
      code += `                // (2) Build call edge\n`;
      code += `                let funcEntry = buildCFGNode(targetFunc, currentBlk);\n`;
      code += `                if (funcEntry != 0) {\n`;
      code += `                    store<u32>(funcEntry + BLOCK_TRUE_BRANCH, joinBlock);\n`;
      code += `                }\n`;
      code += `                // (3) Argument Binding & Defaults Logic (Edge Case Handling)\n`;
      code += `                // When a call site specifies a subset of optional parameters, \n`;
      code += `                // bindCallArguments iterates through the target function's parameters,\n`;
      code += `                // mapping positional arguments first, then looking up keyword arguments,\n`;
      code += `                // and critically: if neither exists, it fetches the parameter's AST default node.\n`;
      code += `                // bindCallArguments(nodeId, targetFunc, currentBlk);\n`;
      code += `                return joinBlock;\n`;
      code += `            }\n`;
      code += `            store<u32>(currentBlk + BLOCK_TRUE_BRANCH, joinBlock);\n`;
      code += `            return joinBlock;\n`;
    } else if (config.isBreak) {
      code += `            // ${nodeName}: break jump\n`;
      code += `            if (currentLoopExit != 0) {\n`;
      code += `                store<u32>(currentBlk + BLOCK_TRUE_BRANCH, currentLoopExit);\n`;
      code += `                return 0;\n`;
      code += `            }\n`;
      code += `            return currentBlk;\n`;
    } else if (config.isContinue) {
      code += `            // ${nodeName}: continue jump\n`;
      code += `            if (currentLoopHeader != 0) {\n`;
      code += `                store<u32>(currentBlk + BLOCK_TRUE_BRANCH, currentLoopHeader);\n`;
      code += `                return 0;\n`;
      code += `            }\n`;
      code += `            return currentBlk;\n`;
    } else if (config.isReturn) {
      code += `            // ${nodeName}: return statement\n`;
      code += `            if (fnExitBlock != 0) {\n`;
      code += `                store<u32>(currentBlk + BLOCK_TRUE_BRANCH, fnExitBlock);\n`;
      code += `                return 0;\n`;
      code += `            }\n`;
      code += `            return currentBlk;\n`;
    } else if (config.tryBody) {
      code += `            // ${nodeName}: try / catch / finally exception block\n`;
      code += emitFieldAccess("tryNode", nodeName, config.tryBody);
      if (config.catchBody) code += emitFieldAccess("catchNode", nodeName, config.catchBody);
      if (config.finallyBody) code += emitFieldAccess("finallyNode", nodeName, config.finallyBody);
      code += `            let tryBlock = allocBlock();\n`;
      code += `            let catchBlock = allocBlock();\n`;
      code += `            let joinBlock = allocBlock();\n`;
      code += `            if (tryBlock == 0 || catchBlock == 0 || joinBlock == 0) return 0;\n\n`;
      code += `            store<u32>(currentBlk + BLOCK_TRUE_BRANCH, tryBlock);\n`;
      code += `            store<u32>(currentBlk + BLOCK_FALSE_BRANCH, catchBlock);\n`;
      code += `            let tryEnd = buildCFGNode(tryNode, tryBlock);\n`;
      if (config.catchBody) {
        code += `            let catchEnd = buildCFGNode(catchNode, catchBlock);\n`;
      } else {
        code += `            let catchEnd = catchBlock;\n`;
      }
      if (config.finallyBody) {
        code += `            let finallyBlock = allocBlock();\n`;
        code += `            if (tryEnd != 0) store<u32>(tryEnd + BLOCK_TRUE_BRANCH, finallyBlock);\n`;
        code += `            if (catchEnd != 0) store<u32>(catchEnd + BLOCK_TRUE_BRANCH, finallyBlock);\n`;
        code += `            let finallyEnd = buildCFGNode(finallyNode, finallyBlock);\n`;
        code += `            if (finallyEnd != 0) store<u32>(finallyEnd + BLOCK_TRUE_BRANCH, joinBlock);\n`;
      } else {
        code += `            if (tryEnd != 0) store<u32>(tryEnd + BLOCK_TRUE_BRANCH, joinBlock);\n`;
        code += `            if (catchEnd != 0) store<u32>(catchEnd + BLOCK_TRUE_BRANCH, joinBlock);\n`;
      }
      code += `            return joinBlock;\n`;
    } else if (config.condition && config.trueBranch) {
      // Branch / Loop node
      code += `            // ${nodeName}: branch node\n`;
      code += emitFieldAccess("condNode", nodeName, config.condition);
      code += emitFieldAccess("trueBodyNode", nodeName, config.trueBranch);
      code += `            let trueBlock = allocBlock();\n`;
      code += `            if (trueBlock == 0) return 0; // OOM\n`;

      if (config.falseBranch) {
        code += emitFieldAccess("falseBodyNode", nodeName, config.falseBranch);
        code += `            let falseBlock = allocBlock();\n`;
        code += `            if (falseBlock == 0) return 0;\n`;
        code += `            let joinBlock = allocBlock();\n`;
        code += `            if (joinBlock == 0) return 0;\n\n`;
        code += `            store<u32>(currentBlk + BLOCK_TRUE_BRANCH, trueBlock);\n`;
        code += `            store<u32>(currentBlk + BLOCK_FALSE_BRANCH, falseBlock);\n`;
        code += `            let trueEnd = buildCFGNode(trueBodyNode, trueBlock);\n`;
        code += `            let falseEnd = buildCFGNode(falseBodyNode, falseBlock);\n`;
        code += `            if (trueEnd != 0) store<u32>(trueEnd + BLOCK_TRUE_BRANCH, joinBlock);\n`;
        code += `            if (falseEnd != 0) store<u32>(falseEnd + BLOCK_TRUE_BRANCH, joinBlock);\n`;
        code += `            return joinBlock;\n`;
      } else if (config.isLoop) {
        code += `            let exitBlock = allocBlock();\n`;
        code += `            if (exitBlock == 0) return 0;\n\n`;
        code += `            store<u32>(currentBlk + BLOCK_TRUE_BRANCH, trueBlock);\n`;
        code += `            store<u32>(currentBlk + BLOCK_FALSE_BRANCH, exitBlock);\n`;
        code += `            let saveHeader = currentLoopHeader;\n`;
        code += `            let saveExit = currentLoopExit;\n`;
        code += `            currentLoopHeader = currentBlk;\n`;
        code += `            currentLoopExit = exitBlock;\n`;
        code += `            let bodyEnd = buildCFGNode(trueBodyNode, trueBlock);\n`;
        code += `            currentLoopHeader = saveHeader;\n`;
        code += `            currentLoopExit = saveExit;\n`;
        code += `            if (bodyEnd != 0) store<u32>(bodyEnd + BLOCK_TRUE_BRANCH, currentBlk);\n`;
        code += `            return exitBlock;\n`;
      } else {
        code += `            let joinBlock = allocBlock();\n`;
        code += `            if (joinBlock == 0) return 0;\n`;
        code += `            store<u32>(currentBlk + BLOCK_TRUE_BRANCH, trueBlock);\n`;
        code += `            store<u32>(currentBlk + BLOCK_FALSE_BRANCH, joinBlock);\n`;
        code += `            let trueEnd = buildCFGNode(trueBodyNode, trueBlock);\n`;
        code += `            if (trueEnd != 0) store<u32>(trueEnd + BLOCK_TRUE_BRANCH, joinBlock);\n`;
        code += `            return joinBlock;\n`;
      }
    } else if (config.branchList) {
      // Multi-way branch (switch/case or fork)
      code += `            // ${nodeName}: multi-way branch list\n`;
      code += emitFieldAccess("listNode", nodeName, config.branchList);
      code += `            let joinBlock = allocBlock();\n`;
      code += `            if (joinBlock == 0) return 0;\n`;
      code += `            let childArm = getNodeFirstChild(listNode);\n`;
      code += `            while (childArm != 0) {\n`;
      code += `                let armBlock = allocBlock();\n`;
      code += `                if (armBlock != 0) {\n`;
      code += `                    let armEnd = buildCFGNode(childArm, armBlock);\n`;
      code += `                    if (armEnd != 0) store<u32>(armEnd + BLOCK_TRUE_BRANCH, joinBlock);\n`;
      code += `                }\n`;
      code += `                childArm = getNodeNextSibling(childArm);\n`;
      code += `            }\n`;
      code += `            return joinBlock;\n`;
    } else {
      code += `            return buildCFGChildren(nodeId, currentBlk);\n`;
    }

    code += `        }\n`;
  }

  code += `        default: {
            return buildCFGChildren(nodeId, currentBlk);
        }
    }
}

function buildCFGChildren(nodeId: u32, currentBlk: u32): u32 {
    let child = getNodeFirstChild(nodeId);
    let blk = currentBlk;
    while (child != 0) {
        blk = buildCFGNode(child, blk);
        if (blk == 0) return 0;
        child = getNodeNextSibling(child);
    }
    return blk;
}
`;

  return code;
}
