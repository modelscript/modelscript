// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Universal Binary & Black-Box Introspector.
 *
 * Deeply inspects .fmu (ZIP), .dll (Windows PE), and .so (Linux ELF) binaries
 * without requiring host compilers or native tools. Extracts exported symbols,
 * architectures, FMI variables, terminals, and units.
 */

import { parseModelDescription, type FmiModelDescription, type FmiScalarVariable } from "./model-description.js";
import { ElfLoader } from "./pe-emulator/elf-loader.js";
import { CPU_TYPE_ARM64, CPU_TYPE_X86_64, MachoLoader } from "./pe-emulator/macho-loader.js";
import { PeLoader } from "./pe-emulator/pe-loader.js";
import { extractFileFromZip } from "./storage.js";

export type BinaryFormat = "fmu" | "pe_dll" | "elf_so" | "macho_dylib" | "unknown";

export interface BinaryArchitecture {
  os: "windows" | "linux" | "darwin" | "wasm" | "unknown";
  arch: "x86_64" | "aarch64" | "x86" | "wasm32" | "unknown";
  bits: 32 | 64;
}

export interface BlackboxIntrospection {
  format: BinaryFormat;
  modelName: string;
  description?: string | undefined;
  fmiVersion?: string | undefined;
  guid?: string | undefined;
  architectures: BinaryArchitecture[];
  exportedSymbols: string[];
  variables: FmiScalarVariable[];
  hasCoSimulation: boolean;
  hasModelExchange: boolean;
  hasTerminals: boolean;
  filesInside?: string[] | undefined;
}

/**
 * Introspects any raw binary buffer (.fmu, .dll, .so, .dylib) into a unified black-box descriptor.
 */
export function introspectBlackboxBinary(bytes: Uint8Array | Buffer, filenameHint?: string): BlackboxIntrospection {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // 1. Check for ZIP / FMU archive (PK\x03\x04 = 0x04034B50)
  if (buf.length > 30 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    return introspectFmuArchive(buf, filenameHint);
  }

  // 2. Check for Windows PE DLL ('MZ' = 0x5A4D)
  if (buf.length > 64 && buf[0] === 0x4d && buf[1] === 0x5a) {
    return introspectPeDll(view, buf, filenameHint);
  }

  // 3. Check for Linux ELF SO (\x7FELF)
  if (buf.length > 52 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
    return introspectElfSo(view, buf, filenameHint);
  }

  // 4. Check for macOS Mach-O (.dylib) or Universal Fat Binary
  if (
    buf.length > 32 &&
    ((buf[0] === 0xcf && buf[1] === 0xfa && buf[2] === 0xed && buf[3] === 0xfe) ||
      (buf[0] === 0xfe && buf[1] === 0xed && buf[2] === 0xfa && buf[3] === 0xcf) ||
      (buf[0] === 0xce && buf[1] === 0xfa && buf[2] === 0xed && buf[3] === 0xfe) ||
      (buf[0] === 0xfe && buf[1] === 0xed && buf[2] === 0xfa && buf[3] === 0xce) ||
      (buf[0] === 0xca && buf[1] === 0xfe && buf[2] === 0xba && buf[3] === 0xbe) ||
      (buf[0] === 0xbe && buf[1] === 0xba && buf[2] === 0xfe && buf[3] === 0xca))
  ) {
    return introspectMachoDylib(buf, filenameHint);
  }

  return {
    format: "unknown",
    modelName: filenameHint ?? "UnknownBinary",
    architectures: [{ os: "unknown", arch: "unknown", bits: 64 }],
    exportedSymbols: [],
    variables: [],
    hasCoSimulation: false,
    hasModelExchange: false,
    hasTerminals: false,
  };
}

function introspectFmuArchive(buf: Uint8Array, filenameHint?: string): BlackboxIntrospection {
  let modelDesc: FmiModelDescription | null = null;
  const xmlStr = extractFileFromZip(Buffer.isBuffer(buf) ? buf : Buffer.from(buf), "modelDescription.xml");
  if (xmlStr) {
    try {
      modelDesc = parseModelDescription(xmlStr);
    } catch {
      // Malformed XML
    }
  }

  const modelName = modelDesc?.modelName ?? filenameHint?.replace(/\.fmu$/i, "") ?? "FmuModel";
  const architectures: BinaryArchitecture[] = [];

  // Inspect filenames inside zip
  const files: string[] = [];
  let offset = 0;
  while (offset + 30 < buf.length) {
    if (buf[offset] === 0x50 && buf[offset + 1] === 0x4b && buf[offset + 2] === 0x03 && buf[offset + 3] === 0x04) {
      const nameLen = buf[offset + 26]! | (buf[offset + 27]! << 8);
      const extraLen = buf[offset + 28]! | (buf[offset + 29]! << 8);
      const name = new TextDecoder().decode(buf.subarray(offset + 30, offset + 30 + nameLen));
      files.push(name);
      offset += 30 + nameLen + extraLen;
    } else {
      offset++;
    }
  }

  for (const f of files) {
    if (f.includes("win64") || f.endsWith(".dll")) {
      architectures.push({ os: "windows", arch: "x86_64", bits: 64 });
    } else if (f.includes("linux64") || (f.endsWith(".so") && !f.includes("arm"))) {
      architectures.push({ os: "linux", arch: "x86_64", bits: 64 });
    } else if (f.includes("darwin") || f.endsWith(".dylib")) {
      architectures.push({ os: "darwin", arch: "x86_64", bits: 64 });
    } else if (f.endsWith(".wasm")) {
      architectures.push({ os: "wasm", arch: "wasm32", bits: 32 });
    }
  }

  return {
    format: "fmu",
    modelName,
    description: modelDesc?.description,
    fmiVersion: modelDesc?.fmiVersion,
    guid: modelDesc?.guid,
    architectures,
    exportedSymbols: modelDesc?.variables.map((v) => v.name) ?? [],
    variables: modelDesc?.variables ?? [],
    hasCoSimulation: modelDesc?.supportsCoSimulation ?? false,
    hasModelExchange: modelDesc?.supportsModelExchange ?? false,
    hasTerminals: (modelDesc?.terminals && modelDesc.terminals.length > 0) ?? false,
    filesInside: files,
  };
}

function introspectPeDll(view: DataView, buf: Uint8Array, filenameHint?: string): BlackboxIntrospection {
  const e_lfanew = view.getUint32(0x3c, true);
  const symbols: string[] = [];
  let arch: BinaryArchitecture["arch"] = "unknown";
  let bits: 32 | 64 = 64;

  try {
    const loader = new PeLoader(buf);
    bits = loader.header.is64Bit ? 64 : 32;
    if (loader.header.machine === 0x8664) arch = "x86_64";
    else if (loader.header.machine === 0xaa64) arch = "aarch64";
    else if (loader.header.machine === 0x014c) arch = "x86";

    for (const [name] of loader.exports) {
      if (!symbols.includes(name)) symbols.push(name);
    }
  } catch {
    // Fall back to direct header parsing
  }

  if (symbols.length === 0 && e_lfanew + 24 < buf.length) {
    const peSig = view.getUint32(e_lfanew, true);
    if (peSig === 0x00004550) {
      // 'PE\0\0'
      const machine = view.getUint16(e_lfanew + 4, true);
      if (machine === 0x8664) {
        arch = "x86_64";
        bits = 64;
      } else if (machine === 0xaa64) {
        arch = "aarch64";
        bits = 64;
      } else if (machine === 0x014c) {
        arch = "x86";
        bits = 32;
      }

      // Check for export directory in Optional Header
      const optHeaderOffset = e_lfanew + 24;
      const magic = view.getUint16(optHeaderOffset, true);
      const is64 = magic === 0x20b;
      const exportRvaOffset = optHeaderOffset + (is64 ? 112 : 96);

      if (exportRvaOffset + 8 < buf.length) {
        const exportRva = view.getUint32(exportRvaOffset, true);
        const exportSize = view.getUint32(exportRvaOffset + 4, true);

        if (exportRva > 0 && exportSize > 0) {
          // Resolve section containing exportRva
          const numSections = view.getUint16(e_lfanew + 6, true);
          const sizeOfOptHeader = view.getUint16(e_lfanew + 20, true);
          const firstSectionOffset = optHeaderOffset + sizeOfOptHeader;

          for (let s = 0; s < numSections; s++) {
            const secOffset = firstSectionOffset + s * 40;
            if (secOffset + 40 > buf.length) break;
            const virtAddr = view.getUint32(secOffset + 12, true);
            const rawSize = view.getUint32(secOffset + 16, true);
            const rawOffset = view.getUint32(secOffset + 20, true);

            if (exportRva >= virtAddr && exportRva < virtAddr + rawSize) {
              const rvaDelta = rawOffset - virtAddr;
              const exportTableOffset = exportRva + rvaDelta;

              if (exportTableOffset + 40 < buf.length) {
                const numNames = view.getUint32(exportTableOffset + 24, true);
                const namesRva = view.getUint32(exportTableOffset + 32, true);
                const namesOffset = namesRva + rvaDelta;

                for (let i = 0; i < Math.min(numNames, 4096); i++) {
                  const nameRva = view.getUint32(namesOffset + i * 4, true);
                  const strOffset = nameRva + rvaDelta;
                  if (strOffset < buf.length) {
                    let end = strOffset;
                    while (end < buf.length && buf[end] !== 0) end++;
                    const sym = new TextDecoder().decode(buf.subarray(strOffset, end));
                    if (sym.length > 0 && !symbols.includes(sym)) symbols.push(sym);
                  }
                }
              }
              break;
            }
          }
        }
      }
    }
  }

  const modelName = filenameHint?.replace(/\.dll$/i, "") ?? "WindowsDynamicLibrary";

  return {
    format: "pe_dll",
    modelName,
    architectures: [{ os: "windows", arch, bits }],
    exportedSymbols: symbols,
    variables: [],
    hasCoSimulation: symbols.some((s) => s.includes("fmi2DoStep") || s.includes("fmi3DoStep")),
    hasModelExchange: symbols.some((s) => s.includes("fmi2SetTime") || s.includes("fmi3SetTime")),
    hasTerminals: false,
  };
}

function introspectElfSo(view: DataView, buf: Uint8Array, filenameHint?: string): BlackboxIntrospection {
  const eiClass = buf[4]; // 1=32bit, 2=64bit
  const bits: 32 | 64 = eiClass === 1 ? 32 : 64;
  const isLittle = buf[5] === 1;
  const machine = view.getUint16(18, isLittle);
  let arch: BinaryArchitecture["arch"] = "unknown";

  if (machine === 0x3e) arch = "x86_64";
  else if (machine === 0xb7) arch = "aarch64";
  else if (machine === 0x03) arch = "x86";

  const symbols: string[] = [];
  const modelName = filenameHint?.replace(/\.so$/i, "") ?? "LinuxSharedObject";

  // 1. Try parsing dynamic symbol table via ElfLoader
  try {
    const loader = new ElfLoader(buf);
    for (const [name, sym] of loader.symbols) {
      if (name && (sym.shndx !== 0 || sym.value !== 0n)) {
        if (!symbols.includes(name)) symbols.push(name);
      }
    }
  } catch {
    // Fall back to regex scan for truncated/header-only slices
  }

  // 2. Scan dynamic string tables for known FMI symbols if none discovered
  if (symbols.length === 0) {
    const text = new TextDecoder().decode(buf.subarray(0, Math.min(buf.length, 65536)));
    const knownPrefixes = ["fmi2", "fmi3", "mex", "dsusr", "usrmdl"];
    for (const prefix of knownPrefixes) {
      const regex = new RegExp(`\\b(${prefix}[A-Za-z0-9_]+)\\b`, "g");
      const matches = text.match(regex);
      if (matches) {
        for (const m of matches) {
          if (!symbols.includes(m)) symbols.push(m);
        }
      }
    }
  }

  return {
    format: "elf_so",
    modelName,
    architectures: [{ os: "linux", arch, bits }],
    exportedSymbols: symbols,
    variables: [],
    hasCoSimulation: symbols.some((s) => s.includes("fmi2DoStep") || s.includes("fmi3DoStep")),
    hasModelExchange: symbols.some((s) => s.includes("fmi2SetTime") || s.includes("fmi3SetTime")),
    hasTerminals: false,
  };
}

function introspectMachoDylib(buf: Uint8Array, filenameHint?: string): BlackboxIntrospection {
  let arch: BinaryArchitecture["arch"] = "unknown";
  let bits: 32 | 64 = 64;
  const symbols: string[] = [];

  try {
    const loader = new MachoLoader(buf);
    bits = loader.header.is64Bit ? 64 : 32;
    if (loader.header.cputype === CPU_TYPE_X86_64) arch = "x86_64";
    else if (loader.header.cputype === CPU_TYPE_ARM64) arch = "aarch64";
    else if (loader.header.cputype === 0x07) arch = "x86";

    for (const [name] of loader.symbols) {
      if (!symbols.includes(name)) symbols.push(name);
    }
  } catch {
    // Ignore header parsing errors for corrupted or partial slices
  }

  if (symbols.length === 0) {
    const text = new TextDecoder().decode(buf.subarray(0, Math.min(buf.length, 65536)));
    const knownPrefixes = ["fmi2", "fmi3", "mex", "dsusr", "usrmdl"];
    for (const prefix of knownPrefixes) {
      const regex = new RegExp(`\\b(${prefix}[A-Za-z0-9_]+)\\b`, "g");
      const matches = text.match(regex);
      if (matches) {
        for (const m of matches) {
          if (!symbols.includes(m)) symbols.push(m);
        }
      }
    }
  }

  const modelName = filenameHint?.replace(/\.dylib$/i, "") ?? "MacODylib";

  return {
    format: "macho_dylib",
    modelName,
    architectures: [{ os: "darwin", arch, bits }],
    exportedSymbols: symbols,
    variables: [],
    hasCoSimulation: symbols.some((s) => s.includes("fmi2DoStep") || s.includes("fmi3DoStep")),
    hasModelExchange: symbols.some((s) => s.includes("fmi2SetTime") || s.includes("fmi3SetTime")),
    hasTerminals: false,
  };
}
