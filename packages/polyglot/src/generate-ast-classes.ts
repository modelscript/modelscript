/* eslint-disable */
import type { ModelConfig } from "./index.js";
import { createSelfProxy, extractScopePath } from "./index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Extracted field info from a def() rule's syntax tree. */
interface FieldInfo {
  name: string;
  /** Whether the field is wrapped in rep() / rep1() (i.e. array). */
  isList: boolean;
  /** Whether the field is wrapped in opt(). */
  isOptional: boolean;
  /** If the field arg is a choice(), the symbol names of the alternatives. */
  choiceKinds: string[];
  inferredType: string;
}

/** All info extracted from a single def() rule for class generation. */
interface ClassSpec {
  ruleName: string;
  kind: string;
  className: string;
  baseClass: string;
  implementsList: string[];
  fields: FieldInfo[];
  metadataKeys: string[];
  queryNames: string[];
  model: ModelConfig;
  graphicsConfig?: any;
  diffConfig?: any;
}

// ---------------------------------------------------------------------------
// Rule AST Walking
// ---------------------------------------------------------------------------

/**
 * Recursively extract FieldInfo[] from a rule AST node.
 * Walks through seq, choice, opt, rep, etc. to find all field() nodes.
 */

/**
 * Recursively infer the TypeScript return type (model class) from a grammar rule.
 */
function inferFieldType(rule: any, langConfig: any, $: Record<string, any>, visited = new Set<string>()): string {
  if (!rule || typeof rule !== "object") return "SemanticNode";

  switch (rule.type) {
    case "sym": {
      if (visited.has(rule.name)) return "SemanticNode";
      visited.add(rule.name);
      const targetRuleFn = langConfig.rules?.[rule.name];
      if (!targetRuleFn) {
        visited.delete(rule.name);
        return "SemanticNode";
      }
      // Use the proxy to evaluate the foreign rule
      const targetAst = targetRuleFn($);
      if (!targetAst) {
        visited.delete(rule.name);
        return "SemanticNode";
      }

      if (targetAst.type === "def" && targetAst.options?.model) {
        visited.delete(rule.name);
        return targetAst.options.model.name ?? toPascalCase(rule.name);
      }

      const inferred = inferFieldType(targetAst, langConfig, $, visited);
      visited.delete(rule.name);
      return inferred;
    }
    case "choice": {
      const types = new Set<string>();
      for (const arg of rule.args ?? []) {
        types.add(inferFieldType(arg, langConfig, $, visited));
      }
      if (types.has("SemanticNode")) return "SemanticNode";
      const arr = Array.from(types).filter((t) => t !== "null" && t !== "string");
      if (arr.length === 0) return "SemanticNode";
      if (arr.length === 1) return arr[0];
      return arr.join(" | ");
    }
    case "seq": {
      const types = new Set<string>();
      for (const arg of rule.args ?? []) {
        const t = inferFieldType(arg, langConfig, $, visited);
        if (t !== "SemanticNode" && t !== "string" && !t.includes(" | ")) {
          types.add(t);
        } else if (t.includes(" | ")) {
          t.split(" | ").forEach((u) => types.add(u));
        }
      }
      if (types.size === 0) return "SemanticNode";
      if (types.size === 1) return Array.from(types)[0];
      return Array.from(types).join(" | ");
    }
    case "opt": {
      return inferFieldType(rule.arg, langConfig, $, visited);
    }
    case "rep":
    case "rep1": {
      return inferFieldType(rule.arg, langConfig, $, visited);
    }
    case "prec":
    case "prec_left":
    case "prec_right":
    case "prec_dynamic":
    case "alias":
      return inferFieldType(rule.arg, langConfig, $, visited);
    case "def":
    case "ref":
      return inferFieldType(rule.rule, langConfig, $, visited);
    case "token":
    case "token_immediate":
    case "blank":
      return "string";
  }
  return "SemanticNode";
}

function extractFields(rule: any, langConfig: any, $: Record<string, any>): FieldInfo[] {
  if (!rule || typeof rule !== "object") return [];

  const results: FieldInfo[] = [];

  switch (rule.type) {
    case "field": {
      const isList = isListRule(rule.arg);
      const isOptional = isOptionalRule(rule.arg);
      const choiceKinds = extractChoiceSymbols(rule.arg);
      const inferredType = inferFieldType(rule.arg, langConfig, $);
      results.push({
        name: rule.name,
        isList,
        isOptional,
        choiceKinds,
        inferredType,
      });
      break;
    }
    case "seq":
      for (const arg of rule.args ?? []) {
        results.push(...extractFields(arg, langConfig, $));
      }
      break;
    case "choice":
      for (const arg of rule.args ?? []) {
        results.push(...extractFields(arg, langConfig, $));
      }
      break;
    case "opt":
    case "rep":
    case "rep1":
    case "token":
    case "token_immediate":
    case "prec":
    case "prec_left":
    case "prec_right":
    case "prec_dynamic":
      results.push(...extractFields(rule.arg, langConfig, $));
      break;
    case "def":
      // Recurse into the def's inner rule
      results.push(...extractFields(rule.rule, langConfig, $));
      break;
  }

  return results;
}

/** Check if a rule is a list type (rep or rep1). */
function isListRule(rule: any): boolean {
  if (!rule) return false;
  if (rule.type === "rep" || rule.type === "rep1") return true;
  return false;
}

/** Check if a rule is optional. */
function isOptionalRule(rule: any): boolean {
  if (!rule) return false;
  if (rule.type === "opt") return true;
  return false;
}

/** If a rule is a choice of symbols, extract their names. */
function extractChoiceSymbols(rule: any): string[] {
  if (!rule) return [];
  if (rule.type === "sym") return [rule.name];
  if (rule.type === "choice") {
    const result: string[] = [];
    for (const arg of rule.args ?? []) {
      if (arg.type === "sym") result.push(arg.name);
      else result.push(...extractChoiceSymbols(arg));
    }
    return result;
  }
  // For rep/opt, look inside
  if (rule.type === "rep" || rule.type === "rep1" || rule.type === "opt") {
    return extractChoiceSymbols(rule.arg);
  }
  return [];
}

/** Convert a rule_name to PascalCase. e.g. "class_definition" → "ClassDefinition" */
function toPascalCase(s: string): string {
  return s
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extract class specs from a language config.
 * Only processes rules wrapped in def() that have a ast config.
 */
export function extractClassSpecs(langConfig: any, $: Record<string, any>): ClassSpec[] {
  const specs: ClassSpec[] = [];

  if (!langConfig.rules) return specs;

  for (const [ruleName, ruleFn] of Object.entries<any>(langConfig.rules)) {
    const ruleAST = ruleFn($);
    if (!ruleAST || ruleAST.type !== "def") continue;

    const options = ruleAST.options;
    if (!options?.model) continue;

    const model: ModelConfig = options.model;
    const rawFields = extractFields(ruleAST.rule, langConfig, $);

    // Deduplicate fields by name (commaSep1/rep can produce duplicates)
    const seenFieldNames = new Set<string>();
    const fields: FieldInfo[] = [];
    for (const f of rawFields) {
      if (!seenFieldNames.has(f.name)) {
        seenFieldNames.add(f.name);
        fields.push(f);
      }
    }

    let kind = "Unknown";
    const metadataKeys: string[] = [];

    if (typeof options.symbol === "function") {
      const self = createSelfProxy();
      const symConfig = options.symbol(self);
      if (symConfig.kind) kind = symConfig.kind;
      if (symConfig.attributes) {
        for (const key of Object.keys(symConfig.attributes)) {
          metadataKeys.push(key);
        }
      }
    }

    // Extract query names
    const queryNames = options.queries ? Object.keys(options.queries) : [];

    let graphicsConfig: any = undefined;
    if (typeof options.graphics === "function") {
      const self = createSelfProxy();
      const rawGraphics = options.graphics(self);

      // Convert SelfAccessors to strings using extractScopePath
      if (rawGraphics) {
        graphicsConfig = { ...rawGraphics };
        if (graphicsConfig.edge) {
          graphicsConfig.edge = { ...graphicsConfig.edge };
          if (graphicsConfig.edge.source) {
            graphicsConfig.edge.source = extractScopePath(graphicsConfig.edge.source);
          }
          if (graphicsConfig.edge.target) {
            graphicsConfig.edge.target = extractScopePath(graphicsConfig.edge.target);
          }
          if (graphicsConfig.edge.sourcePort) {
            graphicsConfig.edge.sourcePort = extractScopePath(graphicsConfig.edge.sourcePort);
          }
          if (graphicsConfig.edge.targetPort) {
            graphicsConfig.edge.targetPort = extractScopePath(graphicsConfig.edge.targetPort);
          }
        }
      }
    }

    let diffConfig: any = undefined;
    if (options.diff) {
      diffConfig = { ...options.diff };
      if (typeof diffConfig.identity === "function") {
        diffConfig.identity = `__FUNCTION__${diffConfig.identity.toString()}__FUNCTION__`;
      }
    }

    let baseClass = "SemanticNode";
    if (typeof model.extends === "function") {
      baseClass = model.extends(new Proxy({}, { get: (_, prop) => toPascalCase(prop as string) }));
    } else if (typeof model.extends === "string") {
      baseClass = model.extends;
    }

    specs.push({
      ruleName,
      kind,
      className: model.name ?? toPascalCase(ruleName),
      baseClass,
      implementsList: model.implements ?? [],
      fields,
      metadataKeys,
      queryNames,
      graphicsConfig,
      diffConfig,
      model: {
        ...model,
        specializable: model.specializable ?? false,
      },
    });
  }

  return specs;
}

// ---------------------------------------------------------------------------
// Code Generation
// ---------------------------------------------------------------------------

/**
 * Generate TypeScript source for all pull-up AST classes.
 *
 * @param specs - Extracted class specs from extractClassSpecs().
 * @param langName - Language name (e.g. "modelica") for naming.
 * @returns Generated TypeScript source string.
 */
export function generateAstClasses(specs: ClassSpec[], langName: string): string {
  const lines: string[] = [];

  // Header
  lines.push(`// =============================================================================`);
  lines.push(`// GENERATED by @modelscript/polyglot — do not edit manually.`);
  lines.push(`// Language: ${langName}`);
  lines.push(`// =============================================================================`);
  lines.push(``);
  lines.push(
    `import type { QueryDB, SymbolEntry, SymbolId, SpecializationArgs } from "@modelscript/polyglot/runtime";`,
  );
  lines.push(`import { SemanticNode, GenericNode } from "@modelscript/polyglot/semantic-node";`);
  lines.push(`import type { SemanticVisitor } from "@modelscript/polyglot/semantic-node";`);
  lines.push(``);

  const mergedSpecs = new Map<string, ClassSpec & { kinds: string[] }>();
  for (const spec of specs) {
    if (mergedSpecs.has(spec.className)) {
      const existing = mergedSpecs.get(spec.className)!;
      existing.kinds.push(spec.kind);

      const fieldNames = new Set(existing.fields.map((f) => f.name));
      for (const field of spec.fields) {
        if (!fieldNames.has(field.name)) {
          existing.fields.push(field);
          fieldNames.add(field.name);
        }
      }

      const metaKeys = new Set(existing.metadataKeys);
      for (const key of spec.metadataKeys) {
        if (!metaKeys.has(key)) {
          existing.metadataKeys.push(key);
          metaKeys.add(key);
        }
      }

      const queryNames = new Set(existing.queryNames);
      for (const q of spec.queryNames) {
        if (!queryNames.has(q)) {
          existing.queryNames.push(q);
          queryNames.add(q);
        }
      }

      if (spec.model.properties) {
        existing.model.properties = { ...existing.model.properties, ...spec.model.properties };
      }
      if (spec.model.queryTypes) {
        existing.model.queryTypes = { ...existing.model.queryTypes, ...spec.model.queryTypes };
      }
      if (spec.model.fieldTypes) {
        existing.model.fieldTypes = { ...existing.model.fieldTypes, ...spec.model.fieldTypes };
      }
      if (!existing.graphicsConfig && spec.graphicsConfig) {
        existing.graphicsConfig = spec.graphicsConfig;
      }
    } else {
      mergedSpecs.set(spec.className, { ...spec, kinds: [spec.kind] });
    }
  }

  const uniqueSpecsArray = Array.from(mergedSpecs.values());

  // Determine visitor name
  const visitorName = `${toPascalCase(langName)}Visitor`;
  const visitableSpecs = uniqueSpecsArray.filter((s) => s.model.visitable !== false);

  // Generate each class
  for (const spec of uniqueSpecsArray) {
    lines.push(...generateClass(spec, visitorName));
    lines.push(``);
  }

  // Generate visitor interface
  lines.push(...generateVisitor(visitableSpecs, visitorName));
  lines.push(``);

  // Generate factory function
  lines.push(...generateFactory(specs)); // Pass original specs for factory to get all kinds mapped

  return lines.join("\n") + "\n";
}

/**
 * Generate a single pull-up class.
 */
function generateClass(spec: ClassSpec, visitorName: string): string[] {
  const lines: string[] = [];
  const { className, baseClass, implementsList, model } = spec;

  // Class declaration
  const implStr = implementsList.length > 0 ? ` implements ${implementsList.join(", ")}` : "";
  lines.push(`export class ${className} extends ${baseClass}${implStr} {`);

  // Kind
  lines.push(`  get kind(): string { return ${JSON.stringify(spec.kind)}; }`);
  lines.push(``);

  // --- CST-derived fields ---
  if (spec.fields.length > 0) {
    lines.push(`  // --- CST Fields ---`);
    for (const field of spec.fields) {
      const typeOverride = model.fieldTypes?.[field.name];
      if (field.isList) {
        const itemType = typeOverride ?? (field.inferredType !== "string" ? field.inferredType : "SemanticNode");
        lines.push(`  /** List field: ${field.name} */`);
        const arraySyntax = itemType.includes(" | ") ? `(${itemType})[]` : `${itemType}[]`;
        lines.push(`  get ${field.name}(): ${arraySyntax} {`);
        lines.push(
          `    return this.db.childrenOfField(this.id, ${JSON.stringify(field.name)}).map(e => wrapEntry(e, this.db)) as ${arraySyntax};`,
        );
        lines.push(`  }`);
      } else if (field.isOptional) {
        const type = typeOverride ?? "string | null";
        lines.push(`  /** Optional field: ${field.name} */`);
        lines.push(`  get ${field.name}(): ${type} {`);
        lines.push(`    return this.field("${field.name}");`);
        lines.push(`  }`);
      } else {
        if (field.name === "name") {
          // The "name" field maps directly to the symbol entry's name
          lines.push(`  /** Field: ${field.name} */`);
          lines.push(`  get name(): string {`);
          lines.push(`    return this.entry.name;`);
          lines.push(`  }`);
        } else {
          const type = typeOverride ?? "string | null";
          lines.push(`  /** Field: ${field.name} */`);
          lines.push(`  get ${field.name}(): ${type} {`);
          lines.push(`    return this.field("${field.name}");`);
          lines.push(`  }`);
        }
      }
    }
    lines.push(``);
  }

  // Collect CST field names to avoid duplicate getters
  const fieldNames = new Set(spec.fields.map((f) => f.name));

  // --- Metadata getters ---
  if (spec.metadataKeys.length > 0) {
    lines.push(`  // --- Metadata ---`);
    for (const key of spec.metadataKeys) {
      if (fieldNames.has(key)) continue; // already emitted as a CST field getter
      const type = model.properties?.[key] ?? "string | null";
      if (model.properties?.[key]) continue; // handled below
      lines.push(`  get ${key}(): ${type} {`);
      lines.push(`    return this.attribute("${key}");`);
      lines.push(`  }`);
    }
    lines.push(``);
  }

  // --- Mutable Properties (CST default + runtime override) ---
  if (model.properties && Object.keys(model.properties).length > 0) {
    lines.push(`  // --- Mutable Properties (CST default + runtime override) ---`);
    for (const [propName, propType] of Object.entries(model.properties)) {
      if (fieldNames.has(propName)) continue; // already emitted as a CST field getter
      const isNullable = propType.includes("null");
      const defaultValue = isNullable ? "undefined" : propType === "boolean" ? "false" : "undefined";
      lines.push(`  #${propName}: ${propType} | undefined = ${defaultValue};`);
      lines.push(``);
      lines.push(`  get ${propName}(): ${propType} {`);
      lines.push(`    if (this.#${propName} !== undefined) return this.#${propName};`);
      if (propType === "boolean") {
        lines.push(`    return (this.attribute("${propName}") as unknown as boolean) ?? false;`);
      } else {
        lines.push(`    return this.attribute("${propName}") ?? (${defaultValue} as unknown as ${propType});`);
      }
      lines.push(`  }`);
      lines.push(``);
      lines.push(`  set ${propName}(value: ${propType}) {`);
      lines.push(`    this.#${propName} = value;`);
      lines.push(`  }`);
      lines.push(``);
    }
  }

  // --- Queries (query-backed properties) ---
  if (model.queryTypes && Object.keys(model.queryTypes).length > 0) {
    lines.push(`  // --- Computed Properties (query-backed) ---`);
    for (const [queryName, returnType] of Object.entries(model.queryTypes)) {
      lines.push(`  get ${queryName}(): ${returnType} {`);
      const strReturnType = typeof returnType === "string" ? returnType : String(returnType);

      // Detect primitive-like types that should NOT be wrapped with wrapEntry
      const isPrimitive = ["string", "number", "boolean", "SymbolId", "unknown"].some((t) => strReturnType.includes(t));
      // Detect function/closure return types (e.g., "((name: string) => ...)")
      const isFunction = strReturnType.includes("=>");

      if (isFunction) {
        // Function types: pass through directly from query
        lines.push(`    return this.query<${returnType}>(${JSON.stringify(queryName)});`);
      } else if (isPrimitive) {
        // Primitive types: pass through directly from query
        lines.push(`    return this.query<${returnType}>(${JSON.stringify(queryName)});`);
      } else {
        // Semantic node types: wrap SymbolEntry results
        const isArray = strReturnType.endsWith("[]");
        if (isArray) {
          lines.push(`    const entries = this.query<SymbolEntry[]>(${JSON.stringify(queryName)});`);
          lines.push(`    return entries.map(e => wrapEntry(e, this.db)) as ${returnType};`);
        } else if (strReturnType.includes("null")) {
          lines.push(`    const entry = this.query<SymbolEntry | null>(${JSON.stringify(queryName)});`);
          lines.push(
            `    return entry ? wrapEntry(entry, this.db) as ${returnType} : null as unknown as ${returnType};`,
          );
        } else {
          lines.push(`    const entry = this.query<SymbolEntry>(${JSON.stringify(queryName)});`);
          lines.push(`    return wrapEntry(entry, this.db) as ${returnType};`);
        }
      }
      lines.push(`  }`);
      lines.push(``);
    }
  }

  // --- Direct query accessors (for queries not covered by explicit property mapping) ---
  const configuredQueries = new Set(model.queryTypes ? Object.keys(model.queryTypes) : []);
  const remainingQueries = spec.queryNames.filter((q) => !configuredQueries.has(q));
  if (remainingQueries.length > 0) {
    lines.push(`  // --- Query Accessors ---`);
    for (const qName of remainingQueries) {
      lines.push(`  get ${qName}(): SemanticNode[] {`);
      lines.push(`    const entries = this.query<SymbolEntry[]>(${JSON.stringify(qName)});`);
      lines.push(`    return entries.map(e => wrapEntry(e, this.db));`);
      lines.push(`  }`);
      lines.push(``);
    }
  }

  // --- Graphics ---
  if (spec.graphicsConfig) {
    lines.push(`  // --- Graphics ---`);
    lines.push(`  get graphics() {`);
    lines.push(`    return ${JSON.stringify(spec.graphicsConfig)};`);
    lines.push(`  }`);
    lines.push(``);
  }

  // --- Clone / Specialize ---
  if (model.specializable) {
    lines.push(`  // --- Clone / Specialize ---`);
    lines.push(`  clone<T>(args: SpecializationArgs<T>): ${className} {`);
    lines.push(`    const virtualId = this.specialize(args);`);
    lines.push(`    const virtualEntry = this.db.symbol(virtualId)!;`);
    lines.push(`    return new ${className}(virtualEntry, this.db);`);
    lines.push(`  }`);
    lines.push(``);
  }

  // --- Visitor ---
  if (spec.model.visitable !== false) {
    const visitMethodName = `visit${className}`;
    lines.push(`  // --- Visitor ---`);
    lines.push(`  accept<R, A>(visitor: ${visitorName}<R, A>, arg?: A): R {`);
    lines.push(`    return visitor.${visitMethodName}(this, arg);`);
    lines.push(`  }`);
  } else {
    lines.push(`  accept<R, A>(visitor: SemanticVisitor<R, A>, arg?: A): R {`);
    lines.push(`    return visitor.visitNode(this, arg);`);
    lines.push(`  }`);
  }

  // --- Custom body ---
  if (model.customBody) {
    lines.push(``);
    lines.push(`  // --- Custom ---`);
    // Indent each line of the custom body
    for (const line of model.customBody.split("\n")) {
      lines.push(`  ${line}`);
    }
  }

  lines.push(`}`);
  return lines;
}

/**
 * Generate the visitor interface.
 */
function generateVisitor(specs: ClassSpec[], visitorName: string): string[] {
  const lines: string[] = [];

  lines.push(`/**`);
  lines.push(` * Visitor interface for all generated semantic node types.`);
  lines.push(` * Extends the base SemanticVisitor with typed visit methods.`);
  lines.push(` */`);
  lines.push(`export interface ${visitorName}<R, A = void> extends SemanticVisitor<R, A> {`);
  for (const spec of specs) {
    const methodName = `visit${spec.className}`;
    lines.push(`  ${methodName}(node: ${spec.className}, arg?: A): R;`);
  }
  lines.push(`}`);

  return lines;
}

/**
 * Generate the wrapEntry factory function.
 */
function generateFactory(specs: ClassSpec[]): string[] {
  const lines: string[] = [];

  lines.push(`/**`);
  lines.push(` * Wrap a SymbolEntry into its typed SemanticNode subclass.`);
  lines.push(` * Dispatches by entry.kind to the correct generated class.`);
  lines.push(` */`);
  lines.push(`export function wrapEntry(entry: SymbolEntry, db: QueryDB): SemanticNode {`);
  lines.push(`  switch (entry.kind) {`);
  for (const spec of specs) {
    lines.push(`    case ${JSON.stringify(spec.kind)}: return new ${spec.className}(entry, db);`);
  }
  lines.push(`    default: return new GenericNode(entry, db);`);
  lines.push(`  }`);
  lines.push(`}`);

  return lines;
}
