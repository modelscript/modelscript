// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Flattener - Shared CST and constant evaluation type definitions.
 */

import { DAEBuilder, type QueryDB, type SymbolEntry, type SymbolId } from "@modelscript/runtime";
import type { ComponentModArgData, FlattenerHostLike } from "../../types.js";

export interface CstNodeLike {
  type?: string;
  typeId?: number;
  text?: string;
  isNamed?: boolean;
  isMissing?: boolean;
  hasError?: boolean;
  children?: CstNodeLike[];
  namedChildren?: CstNodeLike[];
  childCount?: number;
  namedChildCount?: number;
  parent?: CstNodeLike | null;
  startIndex?: number;
  endIndex?: number;
  startOffset?: number;
  endOffset?: number;
  startPosition?: { row: number; column: number };
  endPosition?: { row: number; column: number };
  tree?: { rootNode?: CstNodeLike | null } | null;
  child?: (index: number) => CstNodeLike | null;
  namedChild?: (index: number) => CstNodeLike | null;
  childForFieldName?: (name: string) => CstNodeLike | null;
}

export type ParsedRawLiteral = number | boolean | string | ParsedRawLiteral[];

export type DbConstantValue = number | string | (number | string)[];

export interface DbConstantResult {
  value: DbConstantValue;
  isInteger: boolean;
  isBoolean?: boolean;
}

export type SimpleNameResolver = (name: string) => SymbolEntry | null | undefined;

export type EnumMetaLike = { literals?: unknown };

export type SymbolWithEnumCache = SymbolEntry & {
  _cachedEnumLiterals?: string[] | null | undefined;
  _cachedDeclSubEnumInfo?: ({ sym: SymbolEntry; literals: string[]; qual: string } | null)[] | undefined;
};

export type QueryDBWithConstCache = QueryDB & {
  _inExtractDbConst?: Set<SymbolId> | undefined;
  _dbConstantCache?: Map<string, DbConstantResult | null> | undefined;
};

export type ModArgLike = ComponentModArgData & {
  isRedeclaration?: boolean | undefined;
  bindingExpression?: { text?: string | undefined; value?: unknown } | string | undefined;
};

export interface EffectiveModLike {
  bindingExpression?: { text?: string | undefined } | undefined;
  args?: readonly ModArgLike[] | undefined;
}

export type ExtendsModResult = ModArgLike[] | EffectiveModLike | null | undefined;

export type RawDimEntry = number | { kind?: string | undefined; value?: unknown } | null | undefined;

export type CstDaeExt = DAEBuilder & {
  pendingModValues?: Map<string, number | boolean> | undefined;
  pendingModExprs?: Map<string, string> | undefined;
  flattener?: FlattenerHostLike | undefined;
};
