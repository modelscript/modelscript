// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Portable Executable (PE) & x86/x64 User-Space Emulation Types.
 */

export interface PeHeaderInfo {
  is64Bit: boolean;
  machine: number; // 0x014c = i386, 0x8664 = AMD64
  numberOfSections: number;
  timeDateStamp: number;
  pointerToSymbolTable: number;
  numberOfSymbols: number;
  sizeOfOptionalHeader: number;
  characteristics: number;
  entryPointRva: number;
  imageBase: bigint;
  sectionAlignment: number;
  fileAlignment: number;
  sizeOfImage: number;
  sizeOfHeaders: number;
  exportTableRva: number;
  exportTableSize: number;
  importTableRva: number;
  importTableSize: number;
  relocTableRva: number;
  relocTableSize: number;
  iatRva: number;
  iatSize: number;
}

export interface PeSectionHeader {
  name: string;
  virtualSize: number;
  virtualAddress: number;
  sizeOfRawData: number;
  pointerToRawData: number;
  characteristics: number;
}

export interface PeExportSymbol {
  name: string;
  rva: number;
  ordinal: number;
}

export interface PeImportSymbol {
  dllName: string;
  functionName: string;
  ordinal?: number | undefined;
  iatRva: number;
}

export interface PeRelocationEntry {
  pageRva: number;
  offset: number;
  type: number; // 3 = HIGHLOW (32-bit), 10 = DIR64 (64-bit)
}

export interface ElfHeaderInfo {
  is64Bit: boolean;
  isLittleEndian: boolean;
  machine: number; // 0x3E = x86_64, 0xB7 = AArch64, 0x03 = i386
  entryPoint: bigint;
  phOff: number;
  shOff: number;
  phNum: number;
  shNum: number;
  shStrNdx: number;
}

export interface ElfProgramHeader {
  type: number; // 1 = PT_LOAD, 2 = PT_DYNAMIC, 7 = PT_TLS
  flags: number; // 1 = PF_X, 2 = PF_W, 4 = PF_R
  offset: number;
  vaddr: bigint;
  paddr: bigint;
  filesz: number;
  memsz: number;
  align: number;
}

export interface ElfDynamicEntry {
  tag: number;
  val: bigint;
}

export interface ElfSymbol {
  name: string;
  value: bigint;
  size: number;
  info: number;
  shndx: number;
}

export interface ElfRelocation {
  offset: bigint;
  type: number; // 1=R_X86_64_64, 6=R_X86_64_GLOB_DAT, 7=R_X86_64_JUMP_SLOT, 8=R_X86_64_RELATIVE
  symIndex: number;
  addend: bigint;
}

export interface MachoHeaderInfo {
  is64Bit: boolean;
  isLittleEndian: boolean;
  cputype: number; // 0x01000007 = x86_64, 0x0100000C = ARM64
  cpusubtype: number;
  filetype: number; // 6 = MH_DYLIB, 8 = MH_BUNDLE
  ncmds: number;
  sizeofcmds: number;
  flags: number;
}

export interface MachoSection {
  sectname: string;
  segname: string;
  addr: bigint;
  size: bigint;
  offset: number;
  flags: number;
}

export interface MachoSegment {
  name: string;
  vmaddr: bigint;
  vmsize: bigint;
  fileoff: number;
  filesz: number;
  initprot: number;
  sections: MachoSection[];
}

export interface MachoSymbol {
  name: string;
  value: bigint;
  sect: number;
  type: number;
  desc: number;
}

export interface GuestMemorySpace {
  buffer: ArrayBuffer;
  dataView: DataView;
  uint8: Uint8Array;
  baseAddress: bigint;
  size: number;
  heapStart: number;
  heapPointer: number;
}

export interface X86RegisterState {
  // 64-bit / 32-bit general purpose registers
  rax: bigint;
  rbx: bigint;
  rcx: bigint;
  rdx: bigint;
  rsi: bigint;
  rdi: bigint;
  rbp: bigint;
  rsp: bigint;
  r8: bigint;
  r9: bigint;
  r10: bigint;
  r11: bigint;
  r12: bigint;
  r13: bigint;
  r14: bigint;
  r15: bigint;
  rip: bigint;
  // EFLAGS
  eflags: {
    cf: boolean; // Carry
    zf: boolean; // Zero
    sf: boolean; // Sign
    of: boolean; // Overflow
    pf: boolean; // Parity
    af: boolean; // Adjust
  };
  // SSE Double-precision registers (stored as Float64)
  xmm: Float64Array; // 16 registers
  // AVX2 256-bit Vector registers (16 registers x 4 Float64 lanes = 64 elements)
  ymm: Float64Array;
}

export type CRuntimeHook = (cpu: any, memory: GuestMemorySpace) => void;
