// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SymbolId } from "@modelscript/runtime";

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
  hasOldInstAnnotation?: boolean;
  isGen: boolean;
  ignoreCycles: boolean;
  scalarizeBindings: boolean;
  scalarizeMinMax: boolean;
  flowThreshold?: number | undefined;
}

export interface ComponentInstanceData {
  name: string;
  typeSpecifier: string;
  classInstance?: SymbolId | null;
  variability?: string;
  causality?: string;
  arrayDimensions?: number[];
  flowPrefix?: string;
  isFinal?: boolean;
  isRedeclare?: boolean;
  isInner?: boolean;
  isOuter?: boolean;
  isReplaceable?: boolean;
  isProtected?: boolean;
  isConnectorType?: boolean;
  modification?: {
    isEach?: boolean;
    bindingExpression?: { text: string };
    args?: {
      name: string;
      value?: { kind: string; value?: any; text?: string };
    }[];
  };
}
