// --- Shared IR Block Layout Constants ---
// Single source of truth for Basic Block and IR Instruction memory layouts in AssemblyScript.

// IR Instruction Layout (16 bytes)
export const IR_INSTR_SIZE: u32 = 16;
export const IR_INSTR_OPCODE: u32 = 0; // u16: opcode
export const IR_INSTR_TYPE_ID: u32 = 2; // u16: typeId
export const IR_INSTR_OPERAND1: u32 = 4; // u32: operand1
export const IR_INSTR_OPERAND2: u32 = 8; // u32: operand2
export const IR_INSTR_NEXT: u32 = 12; // u32: nextInstr pointer

export const IR_OPCODE_PHI: u16 = 100; // u16: Phi-node instruction opcode

// Basic Block Layout (52 bytes)
export const BLOCK_SIZE: u32 = 52;
export const BLOCK_FIRST_INSTR: u32 = 0; // u32: firstInstrPtr
export const BLOCK_LAST_INSTR: u32 = 4; // u32: lastInstrPtr
export const BLOCK_TRUE_BRANCH: u32 = 8; // u32: trueBranchBlockPtr
export const BLOCK_FALSE_BRANCH: u32 = 12; // u32: falseBranchBlockPtr
export const BLOCK_STATE_IN: u32 = 16; // u32: stateInPtr (dataflow analysis)
export const BLOCK_STATE_OUT: u32 = 20; // u32: stateOutPtr (dataflow analysis)
export const BLOCK_NEXT: u32 = 24; // u32: nextBlockPtr
export const BLOCK_PREV: u32 = 28; // u32: prevBlockPtr
export const BLOCK_SUCCESSOR_LIST: u32 = 32; // u32: successorListPtr (multi-way branch array ptr in arena)
export const BLOCK_DOMINATOR: u32 = 36; // u32: immediate dominator block ptr (SSA)
export const BLOCK_STATE_TRUE: u32 = 40; // u32: path-sensitive true-branch state ptr
export const BLOCK_STATE_FALSE: u32 = 44; // u32: path-sensitive false-branch state ptr
export const BLOCK_POST_ORDER: u32 = 48; // u32: post-order index for dominator computation

/**
 * Unmanaged view over a 16-byte IR instruction in linear memory.
 */
@unmanaged
export class IRInstruction {
  opcode: u16;     // offset 0
  typeId: u16;     // offset 2
  operand1: u32;   // offset 4
  operand2: u32;   // offset 8
  nextInstr: u32;  // offset 12

  @inline static at(ptr: usize): IRInstruction {
    return changetype<IRInstruction>(ptr);
  }
}

/**
 * Unmanaged view over a 52-byte Basic Block in linear memory.
 */
@unmanaged
export class BasicBlock {
  firstInstr: u32;     // offset 0
  lastInstr: u32;      // offset 4
  trueBranch: u32;     // offset 8
  falseBranch: u32;    // offset 12
  stateIn: u32;        // offset 16
  stateOut: u32;       // offset 20
  nextBlock: u32;      // offset 24
  prevBlock: u32;      // offset 28
  successorList: u32;  // offset 32
  dominator: u32;      // offset 36
  stateTrue: u32;      // offset 40
  stateFalse: u32;     // offset 44
  postOrder: u32;      // offset 48

  @inline static at(ptr: usize): BasicBlock {
    return changetype<BasicBlock>(ptr);
  }

  @inline get hasTrueBranch(): bool { return this.trueBranch != 0; }
  @inline get hasFalseBranch(): bool { return this.falseBranch != 0; }
}

/**
 * Unmanaged view over an 8-byte DFS traversal stack frame (block ptr, phase).
 */
@unmanaged
export class DfsStackFrame {
  blk: u32;
  phase: u32;

  @inline static at(ptr: usize, index: u32): DfsStackFrame {
    return changetype<DfsStackFrame>(ptr + (((index as usize) << 3)));
  }
}

/**
 * Unmanaged view over a count-prefixed list of u32 values [count, cap, item0, item1, ...]
 * used for dominance frontiers and successor lists.
 */
@unmanaged
export class UnmanagedUint32List {
  count: u32;
  cap: u32;

  @inline static at(ptr: usize): UnmanagedUint32List {
    return changetype<UnmanagedUint32List>(ptr);
  }

  @inline get(index: u32): u32 {
    return load<u32>(changetype<usize>(this) + 8 + (((index as usize) << 2)));
  }

  @inline set(index: u32, value: u32): void {
    store<u32>(changetype<usize>(this) + 8 + (((index as usize) << 2)), value);
  }

  @inline push(value: u32): bool {
    if (this.count >= this.cap) return false;
    this.set(this.count, value);
    this.count++;
    return true;
  }

  @inline contains(value: u32): bool {
    for (let i: u32 = 0; i < this.count; i++) {
      if (this.get(i) == value) return true;
    }
    return false;
  }
}
