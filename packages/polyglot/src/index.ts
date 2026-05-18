// ---------------------------------------------------------------------------
// Rule Nodes — Named generic interfaces for type-level field extraction
// ---------------------------------------------------------------------------

import type {
  CSTTree,
  CycleInfo,
  ExpressionEvaluator,
  QueryCacheStore,
  QueryDB,
  SpecializationArgs,
  SymbolEntry,
  SymbolId,
  SymbolIndex,
} from "./runtime.js";
export * from "@modelscript/salsa";
export { Arena, StructArena } from "./arena.js";
export * from "./constraint-extractor.js";
export {
  BinOp,
  Causality,
  DAEArenaBuilder,
  EqKind,
  ExprKind,
  StmtKind,
  UnaryOp,
  Variability,
  VarType,
} from "./dae-arena.js";

export { NULL_STRING_ID, StringInterner, type StringId } from "./interner.js";
export { LineIndex, type TokenData } from "./line-index.js";

export * from "./simulation.js";
export * from "./step-multibody-mapper.js";
export { SymbolArena, SymbolEntryView } from "./symbol-arena.js";
export * from "./topology.js";
export { UnifiedWorkspace, type IWorkspaceIndex } from "./unified-workspace.js";
export * from "./verifier.js";
export { WorkspaceIndex } from "./workspace-index.js";
export type {
  CSTTree,
  CycleInfo,
  ExpressionEvaluator,
  QueryCacheStore,
  QueryDB,
  SpecializationArgs,
  SymbolEntry,
  SymbolId,
  SymbolIndex,
};

export {
  AdapterRegistry,
  type AdapterDB,
  type GlobalAdapters,
  type NodeAdapter,
  type ProjectionResult,
} from "./adapter-registry.js";
export type {
  GraphicsConfig,
  X6Attrs,
  X6Markup,
  X6PortGroup,
  X6PortItem,
  X6Ports,
} from "./polyglot-diagram-builder.js";
