// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Mach-O 64-bit (Mach-O 64 / Fat Universal) Dynamic Library Loader
 * for In-Browser macOS .dylib FMU Emulation ("Wasm-Machina").
 */

import type { GuestMemorySpace, MachoHeaderInfo, MachoSection, MachoSegment, MachoSymbol } from "./types.js";

// Mach-O Magic Numbers
export const MH_MAGIC_64 = 0xfeedfacf;
export const MH_CIGAM_64 = 0xcffaedfe;
export const MH_MAGIC = 0xfeedface;
export const MH_CIGAM = 0xcefaedfe;
export const FAT_MAGIC = 0xcafebabe;
export const FAT_CIGAM = 0xbebafeca;

// CPU Types
export const CPU_TYPE_X86_64 = 0x01000007; // 16777223
export const CPU_TYPE_ARM64 = 0x0100000c; // 16777228
export const CPU_TYPE_I386 = 0x00000007;
export const CPU_TYPE_ARM = 0x0000000c;

// Load Commands
export const LC_SEGMENT = 0x1;
export const LC_SYMTAB = 0x2;
export const LC_DYSYMTAB = 0xb;
export const LC_LOAD_DYLIB = 0xc;
export const LC_SEGMENT_64 = 0x19;
export const LC_ROUTINES_64 = 0x1a;
export const LC_DYLD_INFO = 0x22;
export const LC_DYLD_INFO_ONLY = 0x80000022;
export const LC_DYLD_EXPORTS_TRIE = 0x80000033;

// Section Flags
export const S_MOD_INIT_FUNC_POINTERS = 0x9;
export const S_MOD_TERM_FUNC_POINTERS = 0xa;

export class MachoLoader {
  readonly rawBuffer: Uint8Array;
  readonly view: DataView;
  header!: MachoHeaderInfo;
  segments: MachoSegment[] = [];
  symbols = new Map<string, MachoSymbol>();
  symbolList: MachoSymbol[] = [];
  initFuncAddresses: bigint[] = [];
  memory!: GuestMemorySpace;
  lowestVmaddr: bigint = 0n;
  slide: bigint = 0n;

  /** Resolves guest virtual address for a symbol taking slide into account */
  resolveSymbolAddress(sym: MachoSymbol): bigint {
    if (sym.value >= this.lowestVmaddr && this.lowestVmaddr > 0n) {
      return sym.value + this.slide;
    }
    return this.memory.baseAddress + sym.value;
  }

  constructor(buffer: Uint8Array) {
    // Check for Universal Fat binary first
    let activeBuffer = buffer;
    if (buffer.length >= 8) {
      const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const magic = dv.getUint32(0, false); // Big-endian fat header
      if (magic === FAT_MAGIC || magic === FAT_CIGAM) {
        activeBuffer = MachoLoader.extractSliceFromFat(buffer);
      }
    }

    this.rawBuffer = activeBuffer;
    this.view = new DataView(activeBuffer.buffer, activeBuffer.byteOffset, activeBuffer.byteLength);
    this.parseHeaders();
  }

  /**
   * Extracts the preferred 64-bit architecture slice (ARM64 or x86_64) from a FAT Mach-O binary.
   */
  static extractSliceFromFat(buffer: Uint8Array): Uint8Array {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const nfatArch = view.getUint32(4, false); // Big-endian

    // Search for 64-bit slices: prefer x86_64 or ARM64
    let arm64Slice: { offset: number; size: number } | null = null;
    let x86_64Slice: { offset: number; size: number } | null = null;

    let off = 8;
    for (let i = 0; i < nfatArch && off + 20 <= buffer.byteLength; i++) {
      const cpuType = view.getInt32(off, false);
      const offset = view.getUint32(off + 8, false);
      const size = view.getUint32(off + 12, false);

      if (cpuType === CPU_TYPE_X86_64) {
        x86_64Slice = { offset, size };
      } else if (cpuType === CPU_TYPE_ARM64) {
        arm64Slice = { offset, size };
      }

      off += 20;
    }

    const chosen = x86_64Slice ?? arm64Slice;
    if (chosen && chosen.offset + chosen.size <= buffer.byteLength) {
      return buffer.subarray(chosen.offset, chosen.offset + chosen.size);
    }

    return buffer;
  }

  private parseHeaders(): void {
    if (this.view.byteLength < 32) {
      throw new Error("Invalid Mach-O file: buffer too small for Mach-O header");
    }

    const magic = this.view.getUint32(0, true);
    const isLittleEndian = magic === MH_MAGIC_64 || magic === MH_MAGIC;
    const is64Bit = magic === MH_MAGIC_64 || magic === MH_CIGAM_64;

    if (magic !== MH_MAGIC_64 && magic !== MH_CIGAM_64 && magic !== MH_MAGIC && magic !== MH_CIGAM) {
      throw new Error(
        `Invalid Mach-O signature: 0x${magic.toString(16)}. Expected MH_MAGIC_64 (0xfeedfacf) or MH_MAGIC.`,
      );
    }

    const cputype = this.view.getInt32(4, isLittleEndian);
    const cpusubtype = this.view.getInt32(8, isLittleEndian);
    const filetype = this.view.getUint32(12, isLittleEndian);
    const ncmds = this.view.getUint32(16, isLittleEndian);
    const sizeofcmds = this.view.getUint32(20, isLittleEndian);
    const flags = this.view.getUint32(24, isLittleEndian);

    this.header = {
      is64Bit,
      isLittleEndian,
      cputype,
      cpusubtype,
      filetype,
      ncmds,
      sizeofcmds,
      flags,
    };

    const headerSize = is64Bit ? 32 : 28;
    this.parseLoadCommands(headerSize, ncmds, isLittleEndian, is64Bit);
  }

  private parseLoadCommands(headerSize: number, ncmds: number, le: boolean, is64: boolean): void {
    let off = headerSize;
    let symtabCmd: { symoff: number; nsyms: number; stroff: number; strsize: number } | null = null;

    for (let i = 0; i < ncmds && off + 8 <= this.view.byteLength; i++) {
      const cmd = this.view.getUint32(off, le);
      const cmdsize = this.view.getUint32(off + 4, le);

      if (cmd === LC_SEGMENT_64 && is64) {
        this.parseSegment64(off, le);
      } else if (cmd === LC_SYMTAB) {
        symtabCmd = {
          symoff: this.view.getUint32(off + 8, le),
          nsyms: this.view.getUint32(off + 12, le),
          stroff: this.view.getUint32(off + 16, le),
          strsize: this.view.getUint32(off + 20, le),
        };
      }

      off += cmdsize;
    }

    // Parse Symbol Table
    if (symtabCmd) {
      this.parseSymbols(symtabCmd.symoff, symtabCmd.nsyms, symtabCmd.stroff, symtabCmd.strsize, le, is64);
    }
  }

  private parseSegment64(off: number, le: boolean): void {
    // LC_SEGMENT_64 layout (72 bytes header + nsects * 80 bytes)
    const segnameBytes = this.rawBuffer.subarray(off + 8, off + 24);
    let nullIdx = segnameBytes.indexOf(0);
    if (nullIdx === -1) nullIdx = 16;
    const name = new TextDecoder().decode(segnameBytes.subarray(0, nullIdx));

    const vmaddr = this.view.getBigUint64(off + 24, le);
    const vmsize = this.view.getBigUint64(off + 32, le);
    const fileoff = Number(this.view.getBigUint64(off + 40, le));
    const filesz = Number(this.view.getBigUint64(off + 48, le));
    const initprot = this.view.getInt32(off + 60, le);
    const nsects = this.view.getUint32(off + 64, le);

    const sections: MachoSection[] = [];
    let secOff = off + 72;

    for (let s = 0; s < nsects && secOff + 80 <= this.view.byteLength; s++) {
      const sNameBytes = this.rawBuffer.subarray(secOff, secOff + 16);
      let sNull = sNameBytes.indexOf(0);
      if (sNull === -1) sNull = 16;
      const sectname = new TextDecoder().decode(sNameBytes.subarray(0, sNull));

      const addr = this.view.getBigUint64(secOff + 32, le);
      const size = this.view.getBigUint64(secOff + 40, le);
      const offset = this.view.getUint32(secOff + 48, le);
      const flags = this.view.getUint32(secOff + 64, le);

      sections.push({
        sectname,
        segname: name,
        addr,
        size,
        offset,
        flags,
      });

      secOff += 80;
    }

    this.segments.push({
      name,
      vmaddr,
      vmsize,
      fileoff,
      filesz,
      initprot,
      sections,
    });
  }

  private parseSymbols(
    symoff: number,
    nsyms: number,
    stroff: number,
    strsize: number,
    le: boolean,
    is64: boolean,
  ): void {
    const entrySize = is64 ? 16 : 12;
    let curOff = symoff;

    for (let i = 0; i < nsyms && curOff + entrySize <= this.view.byteLength; i++) {
      const nStrx = this.view.getUint32(curOff, le);
      const nType = this.view.getUint8(curOff + 4);
      const nSect = this.view.getUint8(curOff + 5);
      const nDesc = this.view.getUint16(curOff + 6, le);
      const nValue = is64 ? this.view.getBigUint64(curOff + 8, le) : BigInt(this.view.getUint32(curOff + 8, le));

      if (nStrx < strsize && nStrx > 0) {
        let nameEnd = stroff + nStrx;
        while (nameEnd < this.rawBuffer.byteLength && this.rawBuffer[nameEnd] !== 0) {
          nameEnd++;
        }
        const rawName = new TextDecoder().decode(this.rawBuffer.subarray(stroff + nStrx, nameEnd));

        const symbol: MachoSymbol = {
          name: rawName,
          value: nValue,
          sect: nSect,
          type: nType,
          desc: nDesc,
        };

        this.symbolList.push(symbol);

        // Store both raw name (e.g. "_fmi2Instantiate") and stripped name ("fmi2Instantiate")
        this.symbols.set(rawName, symbol);
        if (rawName.startsWith("_")) {
          this.symbols.set(rawName.substring(1), symbol);
        }
      }

      curOff += entrySize;
    }
  }

  /**
   * Maps loadable Mach-O segments (__TEXT, __DATA, __DATA_CONST) into linear guest memory space
   * and extracts static initializers.
   */
  mapImageToMemory(customBase?: bigint): GuestMemorySpace {
    // Exclude __PAGEZERO segment (macOS zero-page with vmaddr = 0, filesz = 0)
    const loadableSegments = this.segments.filter((s) => s.name !== "__PAGEZERO" && s.vmsize > 0n);

    if (loadableSegments.length === 0) {
      throw new Error("No loadable segments found in Mach-O binary");
    }

    let lowestVmaddr = loadableSegments[0]!.vmaddr;
    let highestVmaddr = lowestVmaddr + loadableSegments[0]!.vmsize;

    for (const seg of loadableSegments) {
      if (seg.vmaddr < lowestVmaddr) lowestVmaddr = seg.vmaddr;
      const end = seg.vmaddr + seg.vmsize;
      if (end > highestVmaddr) highestVmaddr = end;
    }

    const targetBase = customBase ?? (this.header.is64Bit ? 0x140000000n : 0x00400000n);
    const slide = targetBase - lowestVmaddr;
    this.lowestVmaddr = lowestVmaddr;
    this.slide = slide;

    const imageSize = Number(highestVmaddr - lowestVmaddr);
    const stackSize = 8 * 1024 * 1024; // 8MB
    const heapSize = 16 * 1024 * 1024; // 16MB
    const totalMem = imageSize + stackSize + heapSize;

    const buffer = new ArrayBuffer(totalMem);
    const uint8 = new Uint8Array(buffer);
    const dataView = new DataView(buffer);

    // 1. Copy Segments into Memory
    for (const seg of loadableSegments) {
      if (seg.filesz > 0 && seg.fileoff < this.rawBuffer.byteLength) {
        const memOffset = Number(seg.vmaddr - lowestVmaddr);
        const copyLen = Math.min(seg.filesz, this.rawBuffer.byteLength - seg.fileoff);
        uint8.set(this.rawBuffer.subarray(seg.fileoff, seg.fileoff + copyLen), memOffset);
      }
    }

    // 2. Discover Static Initializers (__mod_init_func)
    for (const seg of loadableSegments) {
      for (const sec of seg.sections) {
        const isInitSec =
          (sec.flags & 0xff) === S_MOD_INIT_FUNC_POINTERS ||
          sec.sectname === "__mod_init_func" ||
          sec.sectname === "__init_offsets";

        if (isInitSec && sec.size > 0n) {
          const secMemOffset = Number(sec.addr - lowestVmaddr);
          const ptrSize = this.header.is64Bit ? 8 : 4;
          const count = Number(sec.size) / ptrSize;

          for (let p = 0; p < count; p++) {
            const ptrOffset = secMemOffset + p * ptrSize;
            if (ptrOffset + ptrSize <= buffer.byteLength) {
              const funcAddr = this.header.is64Bit
                ? dataView.getBigUint64(ptrOffset, this.header.isLittleEndian)
                : BigInt(dataView.getUint32(ptrOffset, this.header.isLittleEndian));

              if (funcAddr !== 0n) {
                this.initFuncAddresses.push(funcAddr + slide);
              }
            }
          }
        }
      }
    }

    const heapStart = imageSize + stackSize;

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
