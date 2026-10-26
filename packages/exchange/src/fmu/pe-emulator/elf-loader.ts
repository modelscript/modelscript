// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Executable and Linkable Format (ELF64 / ELF32) Loader
 * for In-Browser Linux .so Shared Object Emulation.
 */

import type {
  ElfDynamicEntry,
  ElfHeaderInfo,
  ElfProgramHeader,
  ElfRelocation,
  ElfSymbol,
  GuestMemorySpace,
} from "./types.js";

// ELF Dynamic Tags
export const DT_NULL = 0;
export const DT_NEEDED = 1;
export const DT_PLTRELSZ = 2;
export const DT_PLTGOT = 3;
export const DT_HASH = 4;
export const DT_STRTAB = 5;
export const DT_SYMTAB = 6;
export const DT_RELA = 7;
export const DT_RELASZ = 8;
export const DT_RELAENT = 9;
export const DT_STRSZ = 10;
export const DT_SYMENT = 11;
export const DT_INIT = 12;
export const DT_FINI = 13;
export const DT_SONAME = 14;
export const DT_JMPREL = 23;
export const DT_INIT_ARRAY = 25;
export const DT_FINI_ARRAY = 26;
export const DT_INIT_ARRAYSZ = 27;
export const DT_FINI_ARRAYSZ = 28;
export const DT_GNU_HASH = 0x6ffffef5;

// x86_64 Relocation Types
export const R_X86_64_NONE = 0;
export const R_X86_64_64 = 1;
export const R_X86_64_COPY = 5;
export const R_X86_64_GLOB_DAT = 6;
export const R_X86_64_JUMP_SLOT = 7;
export const R_X86_64_RELATIVE = 8;

export class ElfLoader {
  readonly rawBuffer: Uint8Array;
  readonly view: DataView;
  header!: ElfHeaderInfo;
  programHeaders: ElfProgramHeader[] = [];
  dynamicEntries: ElfDynamicEntry[] = [];
  symbols = new Map<string, ElfSymbol>();
  symbolList: ElfSymbol[] = [];
  relocations: ElfRelocation[] = [];
  initArrayRvas: bigint[] = [];
  finiArrayRvas: bigint[] = [];
  memory!: GuestMemorySpace;

  constructor(buffer: Uint8Array) {
    this.rawBuffer = buffer;
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.parseHeaders();
  }

  private parseHeaders(): void {
    if (this.view.byteLength < 52) {
      throw new Error("Invalid ELF file: buffer too small for ELF header");
    }

    // 1. Verify Magic Number (0x7F 'E' 'L' 'F')
    const magic0 = this.view.getUint8(0);
    const magic1 = this.view.getUint8(1);
    const magic2 = this.view.getUint8(2);
    const magic3 = this.view.getUint8(3);
    if (magic0 !== 0x7f || magic1 !== 0x45 || magic2 !== 0x4c || magic3 !== 0x46) {
      throw new Error("Invalid ELF signature: expected 0x7F 'E' 'L' 'F'");
    }

    const eiClass = this.view.getUint8(4);
    const is64Bit = eiClass === 2; // 1 = 32-bit, 2 = 64-bit
    const isLittleEndian = this.view.getUint8(5) === 1;

    if (!isLittleEndian) {
      throw new Error("Big-endian ELF binaries are not currently supported");
    }

    const machine = this.view.getUint16(18, true);

    let entryPoint = 0n;
    let phOff = 0;
    let shOff = 0;
    let phNum = 0;
    let shNum = 0;
    let shStrNdx = 0;

    if (is64Bit) {
      entryPoint = this.view.getBigUint64(24, true);
      phOff = Number(this.view.getBigUint64(32, true));
      shOff = Number(this.view.getBigUint64(40, true));
      phNum = this.view.getUint16(56, true);
      shNum = this.view.getUint16(60, true);
      shStrNdx = this.view.getUint16(62, true);
    } else {
      entryPoint = BigInt(this.view.getUint32(24, true));
      phOff = this.view.getUint32(28, true);
      shOff = this.view.getUint32(32, true);
      phNum = this.view.getUint16(44, true);
      shNum = this.view.getUint16(48, true);
      shStrNdx = this.view.getUint16(50, true);
    }

    this.header = {
      is64Bit,
      isLittleEndian,
      machine,
      entryPoint,
      phOff,
      shOff,
      phNum,
      shNum,
      shStrNdx,
    };

    // 2. Parse Program Headers
    this.parseProgramHeaders();

    // 3. Parse Dynamic Linking Section
    this.parseDynamicSection();
  }

  private parseProgramHeaders(): void {
    const { phOff, phNum, is64Bit } = this.header;
    const headerSize = is64Bit ? 56 : 32;

    for (let i = 0; i < phNum; i++) {
      const offset = phOff + i * headerSize;
      if (offset + headerSize > this.view.byteLength) break;

      if (is64Bit) {
        const type = this.view.getUint32(offset, true);
        const flags = this.view.getUint32(offset + 4, true);
        const pOffset = Number(this.view.getBigUint64(offset + 8, true));
        const vaddr = this.view.getBigUint64(offset + 16, true);
        const paddr = this.view.getBigUint64(offset + 24, true);
        const filesz = Number(this.view.getBigUint64(offset + 32, true));
        const memsz = Number(this.view.getBigUint64(offset + 40, true));
        const align = Number(this.view.getBigUint64(offset + 48, true));

        this.programHeaders.push({
          type,
          flags,
          offset: pOffset,
          vaddr,
          paddr,
          filesz,
          memsz,
          align,
        });
      } else {
        const type = this.view.getUint32(offset, true);
        const pOffset = this.view.getUint32(offset + 4, true);
        const vaddr = BigInt(this.view.getUint32(offset + 8, true));
        const paddr = BigInt(this.view.getUint32(offset + 12, true));
        const filesz = this.view.getUint32(offset + 16, true);
        const memsz = this.view.getUint32(offset + 20, true);
        const flags = this.view.getUint32(offset + 24, true);
        const align = this.view.getUint32(offset + 28, true);

        this.programHeaders.push({
          type,
          flags,
          offset: pOffset,
          vaddr,
          paddr,
          filesz,
          memsz,
          align,
        });
      }
    }
  }

  /** Convert virtual address to file raw offset based on PT_LOAD headers. */
  vaddrToOffset(vaddr: bigint | number): number | null {
    const v = typeof vaddr === "bigint" ? vaddr : BigInt(vaddr);
    for (const ph of this.programHeaders) {
      if (ph.type === 1 /* PT_LOAD */) {
        if (v >= ph.vaddr && v < ph.vaddr + BigInt(ph.memsz)) {
          return ph.offset + Number(v - ph.vaddr);
        }
      }
    }
    return null;
  }

  private parseDynamicSection(): void {
    const dynHeader = this.programHeaders.find((p) => p.type === 2 /* PT_DYNAMIC */);
    if (!dynHeader) return;

    let off = dynHeader.offset;
    const end = off + dynHeader.filesz;
    const entrySize = this.header.is64Bit ? 16 : 8;

    let strTabVaddr = 0n;
    let strTabSize = 0;
    let symTabVaddr = 0n;
    let relaVaddr = 0n;
    let relaSize = 0;
    let relaEnt = 24;
    let jmpRelVaddr = 0n;
    let jmpRelSize = 0;
    let initArrayVaddr = 0n;
    let initArraySize = 0;
    let finiArrayVaddr = 0n;
    let finiArraySize = 0;

    while (off + entrySize <= end && off + entrySize <= this.view.byteLength) {
      let tag = 0;
      let val = 0n;

      if (this.header.is64Bit) {
        tag = Number(this.view.getBigInt64(off, true));
        val = this.view.getBigUint64(off + 8, true);
      } else {
        tag = this.view.getInt32(off, true);
        val = BigInt(this.view.getUint32(off + 4, true));
      }

      if (tag === DT_NULL) break;

      this.dynamicEntries.push({ tag, val });

      if (tag === DT_STRTAB) strTabVaddr = val;
      if (tag === DT_STRSZ) strTabSize = Number(val);
      if (tag === DT_SYMTAB) symTabVaddr = val;
      if (tag === DT_RELA) relaVaddr = val;
      if (tag === DT_RELASZ) relaSize = Number(val);
      if (tag === DT_RELAENT) relaEnt = Number(val);
      if (tag === DT_JMPREL) jmpRelVaddr = val;
      if (tag === DT_PLTRELSZ) jmpRelSize = Number(val);
      if (tag === DT_INIT_ARRAY) initArrayVaddr = val;
      if (tag === DT_INIT_ARRAYSZ) initArraySize = Number(val);
      if (tag === DT_FINI_ARRAY) finiArrayVaddr = val;
      if (tag === DT_FINI_ARRAYSZ) finiArraySize = Number(val);

      off += entrySize;
    }

    // Parse String Table and Symbol Table
    if (strTabVaddr !== 0n && symTabVaddr !== 0n) {
      this.parseSymbols(strTabVaddr, strTabSize, symTabVaddr);
    }

    // Parse Relocations
    if (relaVaddr !== 0n && relaSize > 0) {
      this.parseRela(relaVaddr, relaSize, relaEnt);
    }
    if (jmpRelVaddr !== 0n && jmpRelSize > 0) {
      this.parseRela(jmpRelVaddr, jmpRelSize, relaEnt);
    }

    // Parse Static Initializers (DT_INIT_ARRAY)
    if (initArrayVaddr !== 0n && initArraySize > 0) {
      const initOff = this.vaddrToOffset(initArrayVaddr);
      if (initOff !== null) {
        const count = initArraySize / (this.header.is64Bit ? 8 : 4);
        for (let i = 0; i < count; i++) {
          if (this.header.is64Bit) {
            const funcVaddr = this.view.getBigUint64(initOff + i * 8, true);
            if (funcVaddr !== 0n) this.initArrayRvas.push(funcVaddr);
          } else {
            const funcVaddr = BigInt(this.view.getUint32(initOff + i * 4, true));
            if (funcVaddr !== 0n) this.initArrayRvas.push(funcVaddr);
          }
        }
      }
    }

    // Parse Static Destructors (DT_FINI_ARRAY)
    if (finiArrayVaddr !== 0n && finiArraySize > 0) {
      const finiOff = this.vaddrToOffset(finiArrayVaddr);
      if (finiOff !== null) {
        const count = finiArraySize / (this.header.is64Bit ? 8 : 4);
        for (let i = 0; i < count; i++) {
          if (this.header.is64Bit) {
            const funcVaddr = this.view.getBigUint64(finiOff + i * 8, true);
            if (funcVaddr !== 0n) this.finiArrayRvas.push(funcVaddr);
          } else {
            const funcVaddr = BigInt(this.view.getUint32(finiOff + i * 4, true));
            if (funcVaddr !== 0n) this.finiArrayRvas.push(funcVaddr);
          }
        }
      }
    }
  }

  private parseSymbols(strTabVaddr: bigint, strTabSize: number, symTabVaddr: bigint): void {
    const strOff = this.vaddrToOffset(strTabVaddr);
    const symOff = this.vaddrToOffset(symTabVaddr);
    if (strOff === null || symOff === null) return;

    const symEntrySize = this.header.is64Bit ? 24 : 16;
    // Walk symbols until string offset is invalid or end of table
    let curOff = symOff;
    while (curOff + symEntrySize <= this.view.byteLength) {
      let stName = 0;
      let stValue = 0n;
      let stSize = 0;
      let stInfo = 0;
      let stShndx = 0;

      if (this.header.is64Bit) {
        stName = this.view.getUint32(curOff, true);
        stInfo = this.view.getUint8(curOff + 4);
        stShndx = this.view.getUint16(curOff + 6, true);
        stValue = this.view.getBigUint64(curOff + 8, true);
        stSize = Number(this.view.getBigUint64(curOff + 16, true));
      } else {
        stName = this.view.getUint32(curOff, true);
        stValue = BigInt(this.view.getUint32(curOff + 4, true));
        stSize = this.view.getUint32(curOff + 8, true);
        stInfo = this.view.getUint8(curOff + 12);
        stShndx = this.view.getUint16(curOff + 14, true);
      }

      if (stName >= strTabSize) break;

      // Read symbol name string
      let nameEnd = strOff + stName;
      while (nameEnd < this.rawBuffer.byteLength && this.rawBuffer[nameEnd] !== 0) {
        nameEnd++;
      }
      const symName = new TextDecoder().decode(this.rawBuffer.subarray(strOff + stName, nameEnd));

      const sym: ElfSymbol = {
        name: symName,
        value: stValue,
        size: stSize,
        info: stInfo,
        shndx: stShndx,
      };

      this.symbolList.push(sym);
      if (symName.length > 0) {
        this.symbols.set(symName, sym);
      }

      curOff += symEntrySize;
    }
  }

  private parseRela(relaVaddr: bigint, size: number, entSize: number): void {
    const off = this.vaddrToOffset(relaVaddr);
    if (off === null) return;

    const count = size / entSize;
    for (let i = 0; i < count; i++) {
      const entryOff = off + i * entSize;
      if (entryOff + entSize > this.view.byteLength) break;

      if (this.header.is64Bit) {
        const offset = this.view.getBigUint64(entryOff, true);
        const info = this.view.getBigUint64(entryOff + 8, true);
        const addend = this.view.getBigInt64(entryOff + 16, true);

        const type = Number(info & 0xffffffffn);
        const symIndex = Number(info >> 32n);

        this.relocations.push({
          offset,
          type,
          symIndex,
          addend,
        });
      }
    }
  }

  /**
   * Maps all loadable PT_LOAD segments into linear guest memory space
   * and applies base relocations.
   */
  mapImageToMemory(customBase?: bigint): GuestMemorySpace {
    const targetBase = customBase ?? (this.header.is64Bit ? 0x140000000n : 0x00400000n);

    // Compute virtual size required across all PT_LOAD segments
    let maxVaddr = 0n;
    for (const ph of this.programHeaders) {
      if (ph.type === 1 /* PT_LOAD */) {
        const end = ph.vaddr + BigInt(ph.memsz);
        if (end > maxVaddr) maxVaddr = end;
      }
    }

    const stackSize = 8 * 1024 * 1024;
    const heapSize = 16 * 1024 * 1024;
    const totalMem = Number(maxVaddr) + stackSize + heapSize;

    const buffer = new ArrayBuffer(totalMem);
    const uint8 = new Uint8Array(buffer);
    const dataView = new DataView(buffer);

    // 1. Copy PT_LOAD Segments into memory
    for (const ph of this.programHeaders) {
      if (ph.type === 1 /* PT_LOAD */ && ph.filesz > 0) {
        const vOff = Number(ph.vaddr);
        if (ph.offset < this.rawBuffer.byteLength) {
          const copyLen = Math.min(ph.filesz, this.rawBuffer.byteLength - ph.offset);
          uint8.set(this.rawBuffer.subarray(ph.offset, ph.offset + copyLen), vOff);
        }
      }
    }

    // 2. Apply Relocations (R_X86_64_RELATIVE, R_X86_64_64, R_X86_64_GLOB_DAT, etc.)
    for (const rel of this.relocations) {
      const targetOff = Number(rel.offset);
      if (targetOff + 8 <= buffer.byteLength) {
        if (rel.type === R_X86_64_RELATIVE) {
          // B + A (Base + Addend)
          dataView.setBigUint64(targetOff, targetBase + BigInt(rel.addend), true);
        } else if (rel.type === R_X86_64_64) {
          const sym = this.symbolList[rel.symIndex];
          const symVal = sym ? targetBase + sym.value : 0n;
          dataView.setBigUint64(targetOff, symVal + BigInt(rel.addend), true);
        }
      }
    }

    const heapStart = Number(maxVaddr) + stackSize;

    this.memory = {
      buffer,
      dataView,
      uint8,
      baseAddress: targetBase,
      size: totalMem,
      heapStart,
      heapPointer: heapStart,
    };

    return this.memory;
  }
}
