// Shared IR Block Layout Constants
// Single source of truth for Basic Block and IR Instruction memory layouts.

// IR Instruction Layout (16 bytes)
export const IR_INSTR_SIZE = 16;
export const IR_INSTR_OPCODE = 0; // u16: opcode
export const IR_INSTR_TYPE_ID = 2; // u16: typeId
export const IR_INSTR_OPERAND1 = 4; // u32: operand1
export const IR_INSTR_OPERAND2 = 8; // u32: operand2
export const IR_INSTR_NEXT = 12; // u32: nextInstr pointer

export const IR_OPCODE_PHI = 100; // u16: Phi-node instruction opcode

// Basic Block Layout (52 bytes)
export const BLOCK_SIZE = 52;
export const BLOCK_FIRST_INSTR = 0; // u32: firstInstrPtr
export const BLOCK_LAST_INSTR = 4; // u32: lastInstrPtr
export const BLOCK_TRUE_BRANCH = 8; // u32: trueBranchBlockPtr
export const BLOCK_FALSE_BRANCH = 12; // u32: falseBranchBlockPtr
export const BLOCK_STATE_IN = 16; // u32: stateInPtr (dataflow analysis)
export const BLOCK_STATE_OUT = 20; // u32: stateOutPtr (dataflow analysis)
export const BLOCK_NEXT = 24; // u32: nextBlockPtr
export const BLOCK_PREV = 28; // u32: prevBlockPtr
export const BLOCK_SUCCESSOR_LIST = 32; // u32: successorListPtr (multi-way branch array ptr in arena)
export const BLOCK_DOMINATOR = 36; // u32: immediate dominator block ptr (SSA)
export const BLOCK_STATE_TRUE = 40; // u32: path-sensitive true-branch state ptr
export const BLOCK_STATE_FALSE = 44; // u32: path-sensitive false-branch state ptr
export const BLOCK_POST_ORDER = 48; // u32: post-order index for dominator computation

// Helper to generate AssemblyScript constant declarations from this layout
export function generateBlockLayoutConstants(): string {
  return `
// --- Shared IR Block Layout Constants ---
export const IR_INSTR_SIZE: u32 = ${IR_INSTR_SIZE};
export const BLOCK_SIZE: u32 = ${BLOCK_SIZE};
export const BLOCK_FIRST_INSTR: u32 = ${BLOCK_FIRST_INSTR};
export const BLOCK_LAST_INSTR: u32 = ${BLOCK_LAST_INSTR};
export const BLOCK_TRUE_BRANCH: u32 = ${BLOCK_TRUE_BRANCH};
export const BLOCK_FALSE_BRANCH: u32 = ${BLOCK_FALSE_BRANCH};
export const BLOCK_STATE_IN: u32 = ${BLOCK_STATE_IN};
export const BLOCK_STATE_OUT: u32 = ${BLOCK_STATE_OUT};
export const BLOCK_NEXT: u32 = ${BLOCK_NEXT};
export const BLOCK_PREV: u32 = ${BLOCK_PREV};
export const BLOCK_SUCCESSOR_LIST: u32 = ${BLOCK_SUCCESSOR_LIST};
export const BLOCK_DOMINATOR: u32 = ${BLOCK_DOMINATOR};
export const BLOCK_STATE_TRUE: u32 = ${BLOCK_STATE_TRUE};
export const BLOCK_STATE_FALSE: u32 = ${BLOCK_STATE_FALSE};
export const BLOCK_POST_ORDER: u32 = ${BLOCK_POST_ORDER};
export const IR_OPCODE_PHI: u16 = ${IR_OPCODE_PHI};
export const IR_INSTR_NEXT: u32 = ${IR_INSTR_NEXT};
`;
}
