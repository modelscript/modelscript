// ---------------------------------------------------------------------------
// Rule Nodes — Named generic interfaces for type-level field extraction
// ---------------------------------------------------------------------------

export * from "@modelscript/compiler";
export {
  ArenaDAEBuilder,
  BinOp,
  Causality,
  EqKind,
  ExprKind,
  StmtKind,
  UnaryOp,
  VarType,
  Variability,
} from "./dae-arena.js";

export { NULL_STRING_ID, StringInterner, type StringId } from "@modelscript/compiler/interner";
export { LineIndex, type TokenData } from "@modelscript/compiler/line-index";

export * from "@modelscript/compiler/topology";
export { UnifiedWorkspace, type IWorkspaceIndex } from "@modelscript/compiler/unified-workspace";
export * from "@modelscript/compiler/verifier";
export { WorkspaceIndex } from "@modelscript/compiler/workspace-index";

export {
  AdapterRegistry,
  type AdapterDB,
  type GlobalAdapters,
  type NodeAdapter,
  type ProjectionResult,
} from "@modelscript/compiler/adapter-registry";
