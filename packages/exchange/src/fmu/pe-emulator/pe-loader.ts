// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Portable Executable (PE32 / PE32+) Loader for In-Browser DLL Emulation.
 */

import type {
  GuestMemorySpace,
  PeExportSymbol,
  PeHeaderInfo,
  PeImportSymbol,
  PeRelocationEntry,
  PeSectionHeader,
} from "./types.js";

export class PeLoader {
  readonly rawBuffer: Uint8Array;
  readonly view: DataView;
  header!: PeHeaderInfo;
  sections: PeSectionHeader[] = [];
  exports = new Map<string, PeExportSymbol>();
  imports: PeImportSymbol[] = [];
  relocations: PeRelocationEntry[] = [];
  memory!: GuestMemorySpace;

  constructor(buffer: Uint8Array) {
    this.rawBuffer = buffer;
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.parseHeaders();
  }

  private parseHeaders(): void {
    if (this.view.byteLength < 64) {
      throw new Error("Invalid PE file: buffer too small for DOS header");
    }

    // 1. Verify DOS Header ('MZ')
    const mz = this.view.getUint16(0, true);
    if (mz !== 0x5a4d) {
      throw new Error(`Invalid PE signature: expected 0x5A4D ('MZ'), got 0x${mz.toString(16)}`);
    }

    // 2. Read e_lfanew
    const e_lfanew = this.view.getUint32(0x3c, true);
    if (e_lfanew + 24 > this.view.byteLength) {
      throw new Error("Invalid PE file: e_lfanew points outside buffer");
    }

    // 3. Verify PE signature ('PE\0\0')
    const peSig = this.view.getUint32(e_lfanew, true);
    if (peSig !== 0x00004550) {
      throw new Error(`Invalid PE signature: expected 0x00004550 ('PE\\0\\0'), got 0x${peSig.toString(16)}`);
    }

    // 4. File Header
    const fileHeaderOffset = e_lfanew + 4;
    const machine = this.view.getUint16(fileHeaderOffset, true);
    const numberOfSections = this.view.getUint16(fileHeaderOffset + 2, true);
    const timeDateStamp = this.view.getUint32(fileHeaderOffset + 4, true);
    const pointerToSymbolTable = this.view.getUint32(fileHeaderOffset + 8, true);
    const numberOfSymbols = this.view.getUint32(fileHeaderOffset + 12, true);
    const sizeOfOptionalHeader = this.view.getUint16(fileHeaderOffset + 16, true);
    const characteristics = this.view.getUint16(fileHeaderOffset + 18, true);

    // 5. Optional Header
    const optHeaderOffset = fileHeaderOffset + 20;
    const magic = this.view.getUint16(optHeaderOffset, true);
    const is64Bit = magic === 0x020b; // PE32+ (64-bit), 0x010b = PE32 (32-bit)

    const entryPointRva = this.view.getUint32(optHeaderOffset + 16, true);

    let imageBase = 0n;
    let sectionAlignment = 0;
    let fileAlignment = 0;
    let sizeOfImage = 0;
    let sizeOfHeaders = 0;
    let dataDirOffset = 0;

    if (is64Bit) {
      imageBase = this.view.getBigUint64(optHeaderOffset + 24, true);
      sectionAlignment = this.view.getUint32(optHeaderOffset + 32, true);
      fileAlignment = this.view.getUint32(optHeaderOffset + 36, true);
      sizeOfImage = this.view.getUint32(optHeaderOffset + 56, true);
      sizeOfHeaders = this.view.getUint32(optHeaderOffset + 60, true);
      dataDirOffset = optHeaderOffset + 112;
    } else {
      imageBase = BigInt(this.view.getUint32(optHeaderOffset + 28, true));
      sectionAlignment = this.view.getUint32(optHeaderOffset + 32, true);
      fileAlignment = this.view.getUint32(optHeaderOffset + 36, true);
      sizeOfImage = this.view.getUint32(optHeaderOffset + 56, true);
      sizeOfHeaders = this.view.getUint32(optHeaderOffset + 60, true);
      dataDirOffset = optHeaderOffset + 96;
    }

    // Read Data Directories
    // 0: Export Table, 1: Import Table, 5: Base Relocation Table, 12: IAT
    const exportTableRva = this.readDataDirRva(dataDirOffset, 0);
    const exportTableSize = this.readDataDirSize(dataDirOffset, 0);
    const importTableRva = this.readDataDirRva(dataDirOffset, 1);
    const importTableSize = this.readDataDirSize(dataDirOffset, 1);
    const relocTableRva = this.readDataDirRva(dataDirOffset, 5);
    const relocTableSize = this.readDataDirSize(dataDirOffset, 5);
    const iatRva = this.readDataDirRva(dataDirOffset, 12);
    const iatSize = this.readDataDirSize(dataDirOffset, 12);

    this.header = {
      is64Bit,
      machine,
      numberOfSections,
      timeDateStamp,
      pointerToSymbolTable,
      numberOfSymbols,
      sizeOfOptionalHeader,
      characteristics,
      entryPointRva,
      imageBase,
      sectionAlignment,
      fileAlignment,
      sizeOfImage,
      sizeOfHeaders,
      exportTableRva,
      exportTableSize,
      importTableRva,
      importTableSize,
      relocTableRva,
      relocTableSize,
      iatRva,
      iatSize,
    };

    // 6. Parse Section Headers
    const sectionHeadersStart = optHeaderOffset + sizeOfOptionalHeader;
    for (let i = 0; i < numberOfSections; i++) {
      const sOffset = sectionHeadersStart + i * 40;
      if (sOffset + 40 > this.view.byteLength) break;

      const nameBytes = this.rawBuffer.subarray(sOffset, sOffset + 8);
      let nullIdx = nameBytes.indexOf(0);
      if (nullIdx < 0) nullIdx = 8;
      const name = new TextDecoder().decode(nameBytes.subarray(0, nullIdx));

      const virtualSize = this.view.getUint32(sOffset + 8, true);
      const virtualAddress = this.view.getUint32(sOffset + 12, true);
      const sizeOfRawData = this.view.getUint32(sOffset + 16, true);
      const pointerToRawData = this.view.getUint32(sOffset + 20, true);
      const characteristics = this.view.getUint32(sOffset + 36, true);

      this.sections.push({
        name,
        virtualSize,
        virtualAddress,
        sizeOfRawData,
        pointerToRawData,
        characteristics,
      });
    }

    // 7. Parse Export Symbols
    this.parseExportTable();

    // 8. Parse Import Symbols
    this.parseImportTable();

    // 9. Parse Relocations
    this.parseRelocations();
  }

  private parseImportTable(): void {
    if (!this.header.importTableRva || !this.header.importTableSize) return;

    let descriptorOffset = this.rvaToOffset(this.header.importTableRva);
    if (descriptorOffset === null) return;

    const entrySize = 20; // sizeof(IMAGE_IMPORT_DESCRIPTOR)
    while (descriptorOffset + entrySize <= this.view.byteLength) {
      const origFirstThunk = this.view.getUint32(descriptorOffset, true);
      const nameRva = this.view.getUint32(descriptorOffset + 12, true);
      const firstThunkRva = this.view.getUint32(descriptorOffset + 16, true);

      // Terminating empty descriptor
      if (nameRva === 0 && firstThunkRva === 0) break;

      const nameOffset = this.rvaToOffset(nameRva);
      let dllName = "";
      if (nameOffset !== null) {
        let end = nameOffset;
        while (end < this.view.byteLength && this.view.getUint8(end) !== 0) {
          end++;
        }
        dllName = new TextDecoder().decode(this.rawBuffer.subarray(nameOffset, end));
      }

      // Thunk list (ILT or IAT)
      const thunkRva = origFirstThunk !== 0 ? origFirstThunk : firstThunkRva;
      let thunkOffset = this.rvaToOffset(thunkRva);
      const is64Bit = this.header.is64Bit;
      const thunkEntrySize = is64Bit ? 8 : 4;

      if (thunkOffset !== null && firstThunkRva !== 0) {
        let iatSlotRva = firstThunkRva;
        while (thunkOffset + thunkEntrySize <= this.view.byteLength) {
          let rawEntry = 0n;
          let isOrdinal = false;
          let ordinal = 0;
          let hintNameRva = 0;

          if (is64Bit) {
            rawEntry = this.view.getBigUint64(thunkOffset, true);
            if (rawEntry === 0n) break;
            isOrdinal = (rawEntry & 0x8000000000000000n) !== 0n;
            if (isOrdinal) {
              ordinal = Number(rawEntry & 0xffffn);
            } else {
              hintNameRva = Number(rawEntry & 0x7fffffffn);
            }
          } else {
            const raw32 = this.view.getUint32(thunkOffset, true);
            if (raw32 === 0) break;
            isOrdinal = (raw32 & 0x80000000) !== 0;
            if (isOrdinal) {
              ordinal = raw32 & 0xffff;
            } else {
              hintNameRva = raw32 & 0x7fffffff;
            }
          }

          let functionName = "";
          if (isOrdinal) {
            functionName = `ord_${ordinal}`;
          } else if (hintNameRva !== 0) {
            const hintNameOff = this.rvaToOffset(hintNameRva);
            if (hintNameOff !== null && hintNameOff + 2 < this.view.byteLength) {
              let nameStart = hintNameOff + 2;
              let nameEnd = nameStart;
              while (nameEnd < this.view.byteLength && this.view.getUint8(nameEnd) !== 0) {
                nameEnd++;
              }
              functionName = new TextDecoder().decode(this.rawBuffer.subarray(nameStart, nameEnd));
            }
          }

          if (functionName.length > 0) {
            this.imports.push({
              dllName,
              functionName,
              ordinal: isOrdinal ? ordinal : undefined,
              iatRva: iatSlotRva,
            });
          }

          thunkOffset += thunkEntrySize;
          iatSlotRva += thunkEntrySize;
        }
      }

      descriptorOffset += entrySize;
    }
  }

  private readDataDirRva(base: number, index: number): number {
    const off = base + index * 8;
    return off + 4 <= this.view.byteLength ? this.view.getUint32(off, true) : 0;
  }

  private readDataDirSize(base: number, index: number): number {
    const off = base + index * 8 + 4;
    return off + 4 <= this.view.byteLength ? this.view.getUint32(off, true) : 0;
  }

  /** Convert Relative Virtual Address (RVA) to file raw offset. */
  rvaToOffset(rva: number): number | null {
    for (const sec of this.sections) {
      if (rva >= sec.virtualAddress && rva < sec.virtualAddress + Math.max(sec.virtualSize, sec.sizeOfRawData)) {
        return sec.pointerToRawData + (rva - sec.virtualAddress);
      }
    }
    return null;
  }

  private parseExportTable(): void {
    if (!this.header.exportTableRva || !this.header.exportTableSize) return;

    const fileOffset = this.rvaToOffset(this.header.exportTableRva);
    if (fileOffset === null || fileOffset + 40 > this.view.byteLength) return;

    const numNames = this.view.getUint32(fileOffset + 24, true);
    const addrFunctionsRva = this.view.getUint32(fileOffset + 28, true);
    const addrNamesRva = this.view.getUint32(fileOffset + 32, true);
    const addrOrdinalsRva = this.view.getUint32(fileOffset + 36, true);

    const funcsOffset = this.rvaToOffset(addrFunctionsRva);
    const namesOffset = this.rvaToOffset(addrNamesRva);
    const ordsOffset = this.rvaToOffset(addrOrdinalsRva);

    if (funcsOffset === null || namesOffset === null || ordsOffset === null) return;

    for (let i = 0; i < numNames; i++) {
      if (namesOffset + i * 4 + 4 > this.view.byteLength) break;
      const nameRva = this.view.getUint32(namesOffset + i * 4, true);
      const nameFileOff = this.rvaToOffset(nameRva);
      if (nameFileOff === null) continue;

      let end = nameFileOff;
      while (end < this.view.byteLength && this.view.getUint8(end) !== 0) {
        end++;
      }
      const symName = new TextDecoder().decode(this.rawBuffer.subarray(nameFileOff, end));

      const ordinal = this.view.getUint16(ordsOffset + i * 2, true);
      if (funcsOffset + ordinal * 4 + 4 > this.view.byteLength) continue;
      const funcRva = this.view.getUint32(funcsOffset + ordinal * 4, true);

      this.exports.set(symName, {
        name: symName,
        rva: funcRva,
        ordinal,
      });
    }
  }

  private parseRelocations(): void {
    if (!this.header.relocTableRva || !this.header.relocTableSize) return;

    let off = this.rvaToOffset(this.header.relocTableRva);
    if (off === null) return;
    const end = off + this.header.relocTableSize;

    while (off + 8 < end && off + 8 <= this.view.byteLength) {
      const pageRva = this.view.getUint32(off, true);
      const blockSize = this.view.getUint32(off + 4, true);
      if (blockSize < 8) break;

      const numEntries = (blockSize - 8) / 2;
      for (let i = 0; i < numEntries; i++) {
        const entry = this.view.getUint16(off + 8 + i * 2, true);
        const type = entry >> 12;
        const pageOffset = entry & 0x0fff;

        if (type !== 0) {
          // 0 is IMAGE_REL_BASED_ABSOLUTE (padding/skip)
          this.relocations.push({
            pageRva,
            offset: pageOffset,
            type,
          });
        }
      }

      off += blockSize;
    }
  }

  /**
   * Allocates guest virtual memory and maps all PE sections into it.
   * If actualBase differs from imageBase, applies relocations.
   */
  mapImageToMemory(customBase?: bigint): GuestMemorySpace {
    const targetBase = customBase ?? (this.header.is64Bit ? 0x140000000n : 0x00400000n);

    // Reserve memory: sizeOfImage aligned up + 8MB Stack + 16MB Heap
    const stackSize = 8 * 1024 * 1024;
    const heapSize = 16 * 1024 * 1024;
    const totalMem = Math.max(this.header.sizeOfImage, 4 * 1024 * 1024) + stackSize + heapSize;

    const buffer = new ArrayBuffer(totalMem);
    const uint8 = new Uint8Array(buffer);
    const dataView = new DataView(buffer);

    // 1. Copy Headers
    const headersToCopy = Math.min(this.header.sizeOfHeaders, this.rawBuffer.byteLength);
    uint8.set(this.rawBuffer.subarray(0, headersToCopy), 0);

    // 2. Map Sections
    for (const sec of this.sections) {
      if (sec.sizeOfRawData > 0 && sec.pointerToRawData < this.rawBuffer.byteLength) {
        const copyLen = Math.min(sec.sizeOfRawData, this.rawBuffer.byteLength - sec.pointerToRawData);
        if (sec.virtualAddress + copyLen <= buffer.byteLength) {
          uint8.set(this.rawBuffer.subarray(sec.pointerToRawData, sec.pointerToRawData + copyLen), sec.virtualAddress);
        }
      }
    }

    // 3. Apply Base Relocations
    const delta = targetBase - this.header.imageBase;
    if (delta !== 0n) {
      for (const rel of this.relocations) {
        const targetRva = rel.pageRva + rel.offset;
        if (targetRva + 8 <= buffer.byteLength) {
          if (rel.type === 10) {
            // IMAGE_REL_BASED_DIR64 (64-bit pointer)
            const currentVal = dataView.getBigUint64(targetRva, true);
            dataView.setBigUint64(targetRva, currentVal + delta, true);
          } else if (rel.type === 3) {
            // IMAGE_REL_BASED_HIGHLOW (32-bit pointer)
            const currentVal = dataView.getUint32(targetRva, true);
            const newVal = Number((BigInt(currentVal) + delta) & 0xffffffffn);
            dataView.setUint32(targetRva, newVal, true);
          }
        }
      }
    }

    const heapStart = Math.max(this.header.sizeOfImage, 4 * 1024 * 1024) + stackSize;

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
