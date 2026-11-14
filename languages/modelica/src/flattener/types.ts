// SPDX-License-Identifier: AGPL-3.0-or-later
import type { QueryDB, SymbolId } from "@modelscript/runtime";

export interface LoweringContext {
  prefix?: string | undefined;
  substitutions?: Map<string, number | string> | undefined;
  imports?: Map<string, string> | undefined;
  db?: QueryDB | undefined;
  flattener?: any;
  tupleContext?: boolean | undefined;
  noArrayExpand?: boolean | undefined;
  isAssignmentLhs?: boolean | undefined;
}

export type FlattenerBackend = "ts" | "wasm" | "hybrid" | "diff";

export interface FlattenOptions {
  backend?: FlattenerBackend | undefined;
  arrayMode?: ("scalarize" | "preserve") | undefined;
  functionInlining?: boolean | undefined;
  omcCompatibility?: boolean | undefined;
  eliminateAliases?: boolean | undefined;
  useWasmKernel?: boolean | undefined;
  scalarizeBindings?: boolean | undefined;
  scalarizeMinMax?: boolean | undefined;
  flowThreshold?: number | undefined;
  intEnumConversion?: boolean | undefined;
  isOldFrontend?: boolean | undefined;
}

export interface ExtractedCompilerOptions {
  isOldFrontend: boolean;
  hasOldInstAnnotation?: boolean | undefined;
  isGen: boolean;
  ignoreCycles: boolean;
  ignoreReplaceable?: boolean | undefined;
  scalarizeBindings: boolean;
  scalarizeMinMax: boolean;
  flowThreshold?: number | undefined;
}

export interface ComponentModArgValueData {
  kind: string;
  value?: unknown;
  text?: string | undefined;
  cstBytes?: readonly [number, number] | undefined;
}

export interface ComponentModArgData {
  name: string;
  isBreak?: boolean | undefined;
  originPrefix?: string | undefined;
  evaluationScopeId?: SymbolId | undefined;
  ownerClassId?: SymbolId | undefined;
  value?: ComponentModArgValueData | null | undefined;
  nestedArgs?: readonly ComponentModArgData[] | undefined;
  args?: readonly ComponentModArgData[] | undefined;
}

export interface ComponentInstanceData {
  name: string;
  typeSpecifier: string;
  classInstance?: SymbolId | null | undefined;
  variability?: string | undefined;
  causality?: string | undefined;
  arrayDimensions?: number[] | undefined;
  flowPrefix?: string | undefined;
  isFinal?: boolean | undefined;
  isRedeclare?: boolean | undefined;
  isInner?: boolean | undefined;
  isOuter?: boolean | undefined;
  isReplaceable?: boolean | undefined;
  isProtected?: boolean | undefined;
  isConnectorType?: boolean | undefined;
  modification?:
    | {
        isEach?: boolean | undefined;
        bindingExpression?: { text: string } | undefined;
        args?: ComponentModArgData[] | undefined;
      }
    | undefined;
}
