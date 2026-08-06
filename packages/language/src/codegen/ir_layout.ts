// Shared IR Block Layout Constants
// Single source of truth for Basic Block and IR Instruction memory layouts.

// IR Instruction Layout (16 bytes)
export const IR_INSTR_SIZE = 16;
export const IR_INSTR_OPCODE = 0; // u16: opcode
export const IR_INSTR_TYPE_ID = 2; // u16: typeId
export const IR_INSTR_OPERAND1 = 4; // u32: operand1
export const IR_INSTR_OPERAND2 = 8; // u32: operand2
export const IR_INSTR_NEXT = 12; // u32: nextInstr pointer

// Basic Block Layout (36 bytes)
export const BLOCK_SIZE = 36;
export const BLOCK_FIRST_INSTR = 0; // u32: firstInstrPtr
export const BLOCK_LAST_INSTR = 4; // u32: lastInstrPtr
export const BLOCK_TRUE_BRANCH = 8; // u32: trueBranchBlockPtr
export const BLOCK_FALSE_BRANCH = 12; // u32: falseBranchBlockPtr
export const BLOCK_STATE_IN = 16; // u32: stateInPtr (dataflow analysis)
export const BLOCK_STATE_OUT = 20; // u32: stateOutPtr (dataflow analysis)
export const BLOCK_NEXT = 24; // u32: nextBlockPtr
export const BLOCK_PREV = 28; // u32: prevBlockPtr
export const BLOCK_SUCCESSOR_LIST = 32; // u32: successorListPtr (multi-way branch array ptr in arena)

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
export const IR_INSTR_NEXT: u32 = ${IR_INSTR_NEXT};
`;
}
