export * from "@modelscript/salsa";

/**
 * Configuration for one indexable rule, extracted from a `def()` call.
 * Generated at build time by evaluating name/scope lambdas against
 * SelfAccessor proxies to capture dot-path strings.
 */
export interface IndexerHook {
  /** The grammar rule name (e.g. "class_definition") */
  ruleName: string;
  /** Symbol kind to assign (e.g. "Class") */
  kind: string;
  /** Dot-path to the field that provides the symbol name */
  namePath: string;
  /** Dot-paths of exported scope fields */
  exportPaths: string[];
  /** Dot-paths of inherited scope references */
  inheritPaths: string[];
  /**
   * Metadata field paths: key → dot-path.
   * Each path is resolved to CST node text and stored in SymbolEntry.metadata.
   */
  metadataFieldPaths: Record<string, string>;
}

/**
 * Configuration for one reference rule, extracted from a `ref()` call.
 * Generated at build time. The resolver uses this to find and resolve references.
 */
export interface RefHook {
  /** The grammar rule name (e.g. "type_specifier") */
  ruleName: string;
  /** Dot-path to the field that provides the reference name */
  namePath: string;
  /** Which symbol kinds this reference can resolve to */
  targetKinds: string[];
  /** Resolution strategy */
  resolve: "lexical" | "qualified";
}
