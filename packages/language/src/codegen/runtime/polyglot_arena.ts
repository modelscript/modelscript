/* eslint-disable */
// @ts-nocheck
/**
 * @fileoverview WASM Polyglot Multi-Language Arena
 *
 * Provides a unified symbol arena and cross-language inheritance graph
 * across different language grammars (SysML v2, Modelica, STEP, OWL2, etc.).
 */

import { ChunkedUint32Array, createChunkedUint32Array } from "./array";
import { atomicChunkAlloc } from "./arena";

export const EXTENDS_STRIDE = 3;
export const EXTENDS_CHILD = 0;
export const EXTENDS_PARENT = 1;
export const EXTENDS_LANGS = 2; // packed (u16 childLang << 16) | (u16 parentLang)

@unmanaged
export class PolyglotArena {
  // Maps languageId (u16) to AST root node pointer (u32)
  languageRoots: ChunkedUint32Array;
  languageCount: u32;

  // Cross-language inheritance table (Child extends Parent)
  extendsData: ChunkedUint32Array;
  extendsCount: u32;

  init(maxLanguages: u32 = 16, initialExtends: u32 = 512): void {
    this.languageRoots = createChunkedUint32Array(maxLanguages);
    this.languageCount = 0;
    this.extendsData = createChunkedUint32Array(initialExtends * EXTENDS_STRIDE);
    this.extendsCount = 0;
  }

  @inline
  registerLanguageRoot(languageId: u16, rootNodePtr: u32): void {
    if (languageId >= this.languageCount) {
      this.languageCount = (languageId as u32) + 1;
    }
    this.languageRoots.set(languageId as u32, rootNodePtr);
  }

  @inline
  getLanguageRoot(languageId: u16): u32 {
    if (languageId >= this.languageCount) return 0;
    return this.languageRoots.get(languageId as u32);
  }

  @inline
  addExtends(childSymbolId: u32, parentSymbolId: u32, childLangId: u16, parentLangId: u16): u32 {
    let idx = this.extendsCount++;
    let offset = idx * EXTENDS_STRIDE;
    let langs: u32 = ((childLangId as u32) << 16) | (parentLangId as u32);

    this.extendsData.set(offset + EXTENDS_CHILD, childSymbolId);
    this.extendsData.set(offset + EXTENDS_PARENT, parentSymbolId);
    this.extendsData.set(offset + EXTENDS_LANGS, langs);

    return idx;
  }

  @inline
  getExtendsCount(): u32 {
    return this.extendsCount;
  }

  @inline
  getExtendsChild(index: u32): u32 {
    if (index >= this.extendsCount) return 0;
    return this.extendsData.get(index * EXTENDS_STRIDE + EXTENDS_CHILD);
  }

  @inline
  getExtendsParent(index: u32): u32 {
    if (index >= this.extendsCount) return 0;
    return this.extendsData.get(index * EXTENDS_STRIDE + EXTENDS_PARENT);
  }

  @inline
  getExtendsChildLang(index: u32): u16 {
    if (index >= this.extendsCount) return 0;
    return (this.extendsData.get(index * EXTENDS_STRIDE + EXTENDS_LANGS) >>> 16) as u16;
  }

  @inline
  getExtendsParentLang(index: u32): u16 {
    if (index >= this.extendsCount) return 0;
    return (this.extendsData.get(index * EXTENDS_STRIDE + EXTENDS_LANGS) & 0xffff) as u16;
  }

  @inline
  reset(): void {
    this.languageCount = 0;
    this.extendsCount = 0;
  }
}

/**
 * Creates a PolyglotArena in WASM linear memory.
 */
export function createPolyglotArena(): usize {
  let ptr = atomicChunkAlloc(sizeof<PolyglotArena>());
  let arena = changetype<PolyglotArena>(ptr);
  arena.init();
  return ptr;
}
