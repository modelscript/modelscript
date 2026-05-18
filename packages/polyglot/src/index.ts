// ---------------------------------------------------------------------------
// Rule Nodes — Named generic interfaces for type-level field extraction
// ---------------------------------------------------------------------------

export * from "@modelscript/salsa";
export {
  BinOp,
  Causality,
  DAEArenaBuilder,
  EqKind,
  ExprKind,
  StmtKind,
  UnaryOp,
  VarType,
  Variability,
} from "./dae-arena.js";

export { NULL_STRING_ID, StringInterner, type StringId } from "@modelscript/language/interner";
export { LineIndex, type TokenData } from "@modelscript/language/line-index";

export * from "@modelscript/language/topology";
export { UnifiedWorkspace, type IWorkspaceIndex } from "@modelscript/language/unified-workspace";
export * from "@modelscript/language/verifier";
export { WorkspaceIndex } from "@modelscript/language/workspace-index";

export {
  AdapterRegistry,
  type AdapterDB,
  type GlobalAdapters,
  type NodeAdapter,
  type ProjectionResult,
} from "@modelscript/language/adapter-registry";
