import { LanguageOptions } from "../dsl.js";
import {
  BLOCK_FALSE_BRANCH,
  BLOCK_FIRST_INSTR,
  BLOCK_NEXT,
  BLOCK_STATE_IN,
  BLOCK_STATE_OUT,
  BLOCK_TRUE_BRANCH,
  IR_INSTR_NEXT,
} from "./ir_layout.js";
import { transpileQuery } from "./transpiler.js";

/**
 * Transpiles a DSL callback function body into AssemblyScript source code using the TypeScript Compiler API.
 */
function transpileCallback(fn: (...args: any[]) => any, paramNames: string[], fallbackExpr: string): string {
  try {
    const res = transpileQuery(fn, "dataflow");
    if (res && res.body) {
      let body = res.body.trim();
      if (body.startsWith("return ") && body.endsWith(";")) {
        body = body.slice(7, -1).trim();
      }
      if (res.params && res.params.length > 0) {
        for (let i = 0; i < Math.min(res.params.length, paramNames.length); i++) {
          const original = res.params[i];
          const target = paramNames[i];
          if (original && original !== target) {
            const regex = new RegExp(`\\b${original}\\b`, "g");
            body = body.replace(regex, target);
          }
        }
      }
      return body;
    }
    return fallbackExpr;
  } catch {
    return fallbackExpr;
  }
}

export function generateDataflow(grammarDef: LanguageOptions<any>): string {
  if (!grammarDef.analysis) return "// Dataflow Analysis Disabled\n";

  let out = `
import { S, getNodePadding, getNodeByteLength, allocGen0, getNodeFlags, FLAG_IS_SYNTHETIC } from "./arena";
import { allocDiagnostic } from "./graph";
import { firstBlock } from "./cfg";
import {
  BLOCK_STATE_IN,
  BLOCK_STATE_OUT,
  BLOCK_TRUE_BRANCH,
  BLOCK_FALSE_BRANCH,
  BLOCK_NEXT,
  BLOCK_FIRST_INSTR,
  IR_INSTR_NEXT,
} from "./ir_layout";

// --- Auto-Generated Dataflow Analysis Engine ---

const DATAFLOW_MAX_ITERATIONS: u32 = 1000;

export function dataflowError(nodeId: u32, code: u32): void {
    if (nodeId == 0 || (getNodeFlags(nodeId) & FLAG_IS_SYNTHETIC) != 0) return;
    let startByte = getNodePadding(nodeId);
    let endByte = startByte + getNodeByteLength(nodeId);
    allocDiagnostic(startByte, endByte, code, 0);
}
`;

  let latticeMap: Record<string, number> = { Bottom: 0, Top: 100 };
  let latticeCounter = 1;

  for (const [analysisName, config] of Object.entries(grammarDef.analysis)) {
    if (config.lattice) {
      for (const val of config.lattice) {
        if (!(val in latticeMap)) latticeMap[val] = latticeCounter++;
        out += `export const LATTICE_${analysisName.toUpperCase()}_${val.toUpperCase()}: u32 = ${latticeMap[val]};\n`;
      }
    }

    let isBackward = (config as any).direction === "backward";

    const joinFn = (config as any).join;
    let joinBody: string;
    if (joinFn && typeof joinFn === "function") {
      joinBody = transpileCallback(joinFn, ["state1", "state2"], "state1 > state2 ? state1 : state2");
    } else {
      joinBody = "state1 > state2 ? state1 : state2";
    }

    out += `
export function dataflowJoin_${analysisName}(state1: u32, state2: u32): u32 {
    if (state1 == state2) return state1;
    return ${joinBody};
}
`;

    const transferFn = (config as any).transfer;
    if (transferFn && typeof transferFn === "function") {
      const transferBody = transpileCallback(transferFn, ["nodeId", "stateIn"], "stateIn");
      out += `
export function dataflowTransfer_${analysisName}(blockPtr: u32, stateIn: u32): u32 {
    let stateOut = stateIn;
    let currInstr = load<u32>(blockPtr + ${BLOCK_FIRST_INSTR}, 0);
    while (currInstr != 0) {
        let nodeId = load<u32>(currInstr + 4, 0);
        stateOut = ${transferBody};
        currInstr = load<u32>(currInstr + ${IR_INSTR_NEXT}, 0);
    }
    return stateOut;
}
`;
    } else {
      const topLattice = latticeCounter > 0 ? latticeCounter - 1 : 1;
      out += `
export function dataflowTransfer_${analysisName}(blockPtr: u32, stateIn: u32): u32 {
    let stateOut = stateIn;
    let currInstr = load<u32>(blockPtr + ${BLOCK_FIRST_INSTR}, 0);
    while (currInstr != 0) {
        let opcode = load<u16>(currInstr, 0);
        if (opcode >= 16) {
            stateOut = ${topLattice};
        }
        currInstr = load<u32>(currInstr + ${IR_INSTR_NEXT}, 0);
    }
    return stateOut;
}
`;
    }

    out += `
let rpo_${analysisName}_buf: u32 = 0;
let rpo_${analysisName}_count: u32 = 0;

function computeRPO_${analysisName}(): void {
    let numBlocks: u32 = 0;
    for (let ptr = firstBlock; ptr != 0; ptr = load<u32>(ptr + ${BLOCK_NEXT}, 0)) {
        numBlocks++;
    }
    if (numBlocks == 0) return;

    let visitedOffset = allocGen0(numBlocks * 4);
    let postOrderOffset = allocGen0(numBlocks * 4);
    let blockIndexMap = allocGen0(numBlocks * 8);

    let idx: u32 = 0;
    for (let ptr = firstBlock; ptr != 0; ptr = load<u32>(ptr + ${BLOCK_NEXT}, 0)) {
        store<u32>(blockIndexMap + idx * 8, ptr);
        store<u32>(blockIndexMap + idx * 8 + 4, idx);
        store<u32>(visitedOffset + idx * 4, 0);
        idx++;
    }

    let postIdx: u32 = 0;
    let stackOffset = allocGen0(numBlocks * 8);

    let stackTop: u32 = 0;
    store<u32>(stackOffset, firstBlock);
    store<u32>(stackOffset + 4, 0);
    stackTop = 1;

    while (stackTop > 0) {
        stackTop--;
        let blk = load<u32>(stackOffset + stackTop * 8);
        let phase = load<u32>(stackOffset + stackTop * 8 + 4);

        let blkIdx: u32 = 0xFFFFFFFF;
        for (let i: u32 = 0; i < numBlocks; i++) {
            if (load<u32>(blockIndexMap + i * 8) == blk) {
                blkIdx = i;
                break;
            }
        }
        if (blkIdx == 0xFFFFFFFF) continue;

        if (phase == 1) {
            store<u32>(postOrderOffset + postIdx * 4, blk);
            postIdx++;
            continue;
        }

        if (load<u32>(visitedOffset + blkIdx * 4) != 0) continue;
        store<u32>(visitedOffset + blkIdx * 4, 1);

        store<u32>(stackOffset + stackTop * 8, blk);
        store<u32>(stackOffset + stackTop * 8 + 4, 1);
        stackTop++;

        let fBranch = load<u32>(blk + ${BLOCK_FALSE_BRANCH}, 0);
        if (fBranch != 0) {
            let fIdx: u32 = 0xFFFFFFFF;
            for (let i: u32 = 0; i < numBlocks; i++) {
                if (load<u32>(blockIndexMap + i * 8) == fBranch) { fIdx = i; break; }
            }
            if (fIdx != 0xFFFFFFFF && load<u32>(visitedOffset + fIdx * 4) == 0) {
                store<u32>(stackOffset + stackTop * 8, fBranch);
                store<u32>(stackOffset + stackTop * 8 + 4, 0);
                stackTop++;
            }
        }
        let tBranch = load<u32>(blk + ${BLOCK_TRUE_BRANCH}, 0);
        if (tBranch != 0) {
            let tIdx: u32 = 0xFFFFFFFF;
            for (let i: u32 = 0; i < numBlocks; i++) {
                if (load<u32>(blockIndexMap + i * 8) == tBranch) { tIdx = i; break; }
            }
            if (tIdx != 0xFFFFFFFF && load<u32>(visitedOffset + tIdx * 4) == 0) {
                store<u32>(stackOffset + stackTop * 8, tBranch);
                store<u32>(stackOffset + stackTop * 8 + 4, 0);
                stackTop++;
            }
        }
    }

    rpo_${analysisName}_count = postIdx;
    rpo_${analysisName}_buf = allocGen0(postIdx * 4);
    for (let i: u32 = 0; i < postIdx; i++) {
        store<u32>(rpo_${analysisName}_buf + i * 4, load<u32>(postOrderOffset + (postIdx - 1 - i) * 4));
    }
}
`;

    if (isBackward) {
      out += `
export function solveDataflow_${analysisName}(): void {
    if (firstBlock == 0) return;
    computeRPO_${analysisName}();
    if (rpo_${analysisName}_count == 0) return;

    let changed = true;
    let iter: u32 = 0;
    while (changed && iter < DATAFLOW_MAX_ITERATIONS) {
        iter++;
        changed = false;
        
        for (let ri: u32 = 0; ri < rpo_${analysisName}_count; ri++) {
            let rIdx = rpo_${analysisName}_count - 1 - ri;
            let ptr = load<u32>(rpo_${analysisName}_buf + rIdx * 4);

            let sIn = load<u32>(ptr + ${BLOCK_STATE_IN}, 0);
            let sOut = load<u32>(ptr + ${BLOCK_STATE_OUT}, 0); 
            
            let tBranch = load<u32>(ptr + ${BLOCK_TRUE_BRANCH}, 0);
            let fBranch = load<u32>(ptr + ${BLOCK_FALSE_BRANCH}, 0);
            
            let joinedOut = sOut;
            if (tBranch != 0) joinedOut = dataflowJoin_${analysisName}(joinedOut, load<u32>(tBranch + ${BLOCK_STATE_IN}, 0));
            if (fBranch != 0) joinedOut = dataflowJoin_${analysisName}(joinedOut, load<u32>(fBranch + ${BLOCK_STATE_IN}, 0));
            
            store<u32>(ptr + ${BLOCK_STATE_OUT}, joinedOut, 0);

            let newIn = dataflowTransfer_${analysisName}(ptr, joinedOut);
            
            if (newIn != sIn) {
                store<u32>(ptr + ${BLOCK_STATE_IN}, newIn, 0);
                changed = true;
            }
        }
    }
}
`;
    } else {
      out += `
export function solveDataflow_${analysisName}(): void {
    if (firstBlock == 0) return;
    computeRPO_${analysisName}();
    if (rpo_${analysisName}_count == 0) return;

    let changed = true;
    let iter: u32 = 0;
    while (changed && iter < DATAFLOW_MAX_ITERATIONS) {
        iter++;
        changed = false;
        
        for (let ri: u32 = 0; ri < rpo_${analysisName}_count; ri++) {
            let ptr = load<u32>(rpo_${analysisName}_buf + ri * 4);

            let sIn = load<u32>(ptr + ${BLOCK_STATE_IN}, 0);
            let sOut = load<u32>(ptr + ${BLOCK_STATE_OUT}, 0); 
            
            let newOut = dataflowTransfer_${analysisName}(ptr, sIn);
            
            if (newOut != sOut) {
                store<u32>(ptr + ${BLOCK_STATE_OUT}, newOut, 0);
                changed = true;
                
                let tBranch = load<u32>(ptr + ${BLOCK_TRUE_BRANCH}, 0);
                let fBranch = load<u32>(ptr + ${BLOCK_FALSE_BRANCH}, 0);
                
                if (tBranch != 0) {
                    let oldIn = load<u32>(tBranch + ${BLOCK_STATE_IN}, 0);
                    let nextIn = dataflowJoin_${analysisName}(oldIn, newOut);
                    store<u32>(tBranch + ${BLOCK_STATE_IN}, nextIn, 0);
                }
                if (fBranch != 0) {
                    let oldIn = load<u32>(fBranch + ${BLOCK_STATE_IN}, 0);
                    let nextIn = dataflowJoin_${analysisName}(oldIn, newOut);
                    store<u32>(fBranch + ${BLOCK_STATE_IN}, nextIn, 0);
                }
            }
        }
    }
}
`;
    }
  }

  return out;
}
