/* eslint-disable */
/**
 * examples/modelica/modification-args.ts
 *
 * Immutable, hashable representation of Modelica modifications
 * for use as `SpecializationArgs.data` in the query engine.
 *
 * Replaces the mutable `ModelicaModification` class from model.ts
 * with a pure-data structure that supports deterministic hashing
 * and Salsa memoization.
 *
 * Implements Modelica §7.2 modification semantics:
 * - Nested modifications: `(R = 100, C = 1e-6)`
 * - Expression bindings: `= expr`
 * - `each` prefix for array element propagation
 * - `final` prefix for sealed modifications
 * - `break` for removing inherited elements
 * - Redeclaration modifications: `redeclare type T = NewType`
 */

import type { SpecializationArgs } from "@modelscript/polyglot";

// ---------------------------------------------------------------------------
// Modification Data Types
// ---------------------------------------------------------------------------

/**
 * The value part of a modification.
 *
 * A modification can bind:
 * - An expression (stored as CST byte range for lazy evaluation)
 * - A `break` keyword (removes the element from inherited scope)
 * - A pre-evaluated literal (for common cases like `= 100`)
 */
export type ModificationValue =
  | { readonly kind: "expression"; readonly cstBytes: readonly [number, number]; readonly text?: string }
  | { readonly kind: "break" }
  | { readonly kind: "literal"; readonly value: number | string | boolean };

/**
 * A single modification argument.
 *
 * Corresponds to a `ModelicaElementModification` or
 * `ModelicaElementRedeclaration` in the current model.ts.
 *
 * Examples:
 *   `R = 100`         → { name: "R", value: {kind:"literal", value:100} }
 *   `each x = 0`      → { name: "x", each: true, value: {kind:"literal", value:0} }
 *   `final y = 1`     → { name: "y", final: true, value: {kind:"literal", value:1} }
 *   `T(a = 1, b = 2)` → { name: "T", nestedArgs: [{name:"a",...}, {name:"b",...}] }
 *   `break x`          → { name: "x", value: {kind:"break"} }
 *   `redeclare type T = NewT` → { name: "T", isRedeclaration: true, redeclaredTypeSpecifier: "NewT" }
 */
export interface ModificationArg {
  /** The target element name. */
  readonly name: string;
  /** Whether this modification applies to each array element. */
  readonly each: boolean;
  /** Whether this modification is sealed (cannot be overridden downstream). */
  readonly final: boolean;
  /** The binding value (expression, break, or literal). Null means no binding. */
  readonly value: ModificationValue | null;
  /** Nested sub-modifications (e.g., `T(a = 1, b = 2)` → T has nested args). */
  readonly nestedArgs: readonly ModificationArg[];
  /** Whether this is a redeclaration (replaces a class/component definition). */
  readonly isRedeclaration: boolean;
  /** For redeclarations: the new class prefixes (e.g., "model", "type"). */
  readonly redeclaredClassPrefixes?: string;
  /** For redeclarations: the new type specifier. */
  readonly redeclaredTypeSpecifier?: string;
}

/**
 * Complete modification data for a specialization.
 *
 * Stores both nested argument modifications and the top-level binding.
 *
 * Examples:
 *   `(R = 100, C = 1e-6)` → { args: [...], bindingExpression: null }
 *   `= expr` → { args: [], bindingExpression: {kind:"expression",...} }
 *   `(R = 100) = expr` → { args: [...], bindingExpression: {kind:"expression",...} }
 */
export interface ModelicaModArgs {
  /** Ordered list of nested modification arguments. */
  readonly args: readonly ModificationArg[];
  /** Top-level binding expression (the `= expr` part). */
  readonly bindingExpression: ModificationValue | null;
  /** Whether this component was redeclared. */
  readonly isRedeclaration?: boolean;
  /** The new type specifier if redeclared. */
  readonly redeclaredTypeSpecifier?: string;
}

/** The empty modification (no args, no binding). */
export const EMPTY_MOD: ModelicaModArgs = Object.freeze({
  args: Object.freeze([]),
  bindingExpression: null,
});

// ---------------------------------------------------------------------------
// ModificationArg Construction Helpers
// ---------------------------------------------------------------------------

/** Create a simple value modification: `name = value`. */
export function modArg(
  name: string,
  value: ModificationValue | null,
  opts?: Partial<Pick<ModificationArg, "each" | "final" | "nestedArgs" | "isRedeclaration">>,
): ModificationArg {
  return {
    name,
    each: opts?.each ?? false,
    final: opts?.final ?? false,
    value,
    nestedArgs: opts?.nestedArgs ?? [],
    isRedeclaration: opts?.isRedeclaration ?? false,
  };
}

/** Create a literal modification: `name = literalValue`. */
export function literalMod(
  name: string,
  value: number | string | boolean,
  opts?: Partial<Pick<ModificationArg, "each" | "final">>,
): ModificationArg {
  return modArg(name, { kind: "literal", value }, opts);
}

/** Create a `break` modification: `break name`. */
export function breakMod(name: string): ModificationArg {
  return modArg(name, { kind: "break" });
}

/** Create an expression modification: `name = <CST expr at bytes start..end>`. */
export function exprMod(
  name: string,
  startByte: number,
  endByte: number,
  opts?: Partial<Pick<ModificationArg, "each" | "final" | "nestedArgs">>,
): ModificationArg {
  return modArg(name, { kind: "expression", cstBytes: [startByte, endByte] }, opts);
}

// ---------------------------------------------------------------------------
// Hashing — Deterministic hash for memoization
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic hash for a `ModelicaModArgs` value.
 *
 * The hash is constructed by:
 * 1. Sorting args by name (canonical ordering)
 * 2. Depth-first serializing each arg
 * 3. Including the binding expression
 *
 * This ensures that semantically identical modifications produce
 * the same hash regardless of source code arg ordering.
 */
export function hashModArgs(data: ModelicaModArgs): string {
  const parts: string[] = [];

  // Sort by name for canonical ordering
  const sortedArgs = [...data.args].sort((a, b) => a.name.localeCompare(b.name));

  for (const arg of sortedArgs) {
    parts.push(hashModArg(arg));
  }

  if (data.bindingExpression) {
    parts.push(`=` + hashModValue(data.bindingExpression));
  }

  return parts.join("|");
}

function hashModArg(arg: ModificationArg): string {
  const flags: string[] = [];
  if (arg.each) flags.push("E");
  if (arg.final) flags.push("F");
  if (arg.isRedeclaration) flags.push("R");

  let s = `${arg.name}`;
  if (flags.length > 0) s += `[${flags.join("")}]`;
  if (arg.value) s += `=${hashModValue(arg.value)}`;
  if (arg.nestedArgs.length > 0) {
    const nested = [...arg.nestedArgs].sort((a, b) => a.name.localeCompare(b.name)).map(hashModArg);
    s += `(${nested.join(",")})`;
  }
  if (arg.redeclaredTypeSpecifier) s += `~>${arg.redeclaredTypeSpecifier}`;

  return s;
}

function hashModValue(v: ModificationValue): string {
  switch (v.kind) {
    case "literal":
      return `L:${String(v.value)}`;
    case "break":
      return "BREAK";
    case "expression":
      return `E:${v.cstBytes[0]}-${v.cstBytes[1]}`;
  }
}

// ---------------------------------------------------------------------------
// Merge — Implements Modelica §7.2.3 modification merging
// ---------------------------------------------------------------------------

/**
 * Merge two `ModelicaModArgs`: outer (from instantiation site) overrides
 * inner (from declaration), with recursive merge for nested modifications.
 *
 * Implements the core of Modelica §7.2.3:
 * - Outer modifications override inner ones for the same target name
 * - Nested modifications are merged recursively
 * - `final` modifications cannot be overridden (produces a diagnostic)
 * - `each` propagation follows the inner/outer semantics
 * - `break` removes the element entirely
 *
 * @param outer - Modification from the instantiation/use site (higher priority)
 * @param inner - Modification from the declaration site (lower priority)
 * @returns Merged modification
 */
export function mergeModArgs(outer: ModelicaModArgs | null, inner: ModelicaModArgs | null): ModelicaModArgs {
  if (!outer && !inner) return EMPTY_MOD;
  if (!outer) return inner!;
  if (!inner) return outer;

  const merged = new Map<string, ModificationArg>();

  // Inner args first (declaration-level, lower priority)
  for (const arg of inner.args) {
    merged.set(arg.name, arg);
  }

  // Outer args override (modification-level, higher priority)
  for (const arg of outer.args) {
    const existing = merged.get(arg.name);

    if (existing) {
      // Check for `final` violation
      if (existing.final && !arg.final) {
        // §7.2.6: Attempting to modify a `final` element is an error.
        // We still merge (the diagnostic is emitted by the lint rule),
        // but we keep the final version.
        continue;
      }

      // Recursive merge of nested modifications
      if (arg.nestedArgs.length > 0 && existing.nestedArgs.length > 0) {
        const mergedNested = mergeModArgs(
          { args: arg.nestedArgs, bindingExpression: null },
          { args: existing.nestedArgs, bindingExpression: null },
        );
        merged.set(arg.name, {
          ...arg,
          nestedArgs: mergedNested.args,
          // Outer value overrides inner value
          value: arg.value ?? existing.value,
          // `each` from outer takes precedence
          each: arg.each || existing.each,
          // `final` is sticky from either side
          final: arg.final || existing.final,
        });
      } else {
        // Simple override: outer replaces inner entirely
        merged.set(arg.name, {
          ...arg,
          // Preserve `final` from inner if set
          final: arg.final || existing.final,
        });
      }
    } else {
      // New arg from outer — add it
      merged.set(arg.name, arg);
    }
  }

  return {
    args: [...merged.values()],
    bindingExpression: outer.bindingExpression ?? inner.bindingExpression,
    isRedeclaration: outer.isRedeclaration ?? inner.isRedeclaration,
    redeclaredTypeSpecifier: outer.redeclaredTypeSpecifier ?? inner.redeclaredTypeSpecifier,
  };
}

// ---------------------------------------------------------------------------
// SpecializationArgs Factory
// ---------------------------------------------------------------------------

/**
 * Create a `SpecializationArgs<ModelicaModArgs>` from modification data.
 *
 * This is the bridge between the Modelica modification model and
 * the metascript query engine's specialization infrastructure:
 *
 * ```typescript
 * const specialized = db.specialize(classId, modelicaMod({
 *   args: [literalMod("R", 100), literalMod("C", 1e-6)],
 *   bindingExpression: null,
 * }));
 * ```
 */
export function modelicaMod(data: ModelicaModArgs): SpecializationArgs<ModelicaModArgs> {
  return {
    hash: hashModArgs(data),
    data,
  };
}

// ---------------------------------------------------------------------------
// Query Helpers
// ---------------------------------------------------------------------------

/**
 * Look up a modification argument by name.
 * Returns null if the argument is not found.
 */
export function getModArg(mod: ModelicaModArgs | null, name: string): ModificationArg | null {
  if (!mod) return null;
  return mod.args.find((a) => a.name === name) ?? null;
}

/**
 * Check if a modification contains a `break` for the given element name.
 */
export function isBroken(mod: ModelicaModArgs | null, name: string): boolean {
  const arg = getModArg(mod, name);
  return arg?.value?.kind === "break";
}

/**
 * Extract the binding expression value from a modification.
 * Returns the ModificationValue or null.
 */
export function getBindingValue(mod: ModelicaModArgs | null): ModificationValue | null {
  return mod?.bindingExpression ?? null;
}

/**
 * Create a sub-modification by extracting the nested args for a specific name.
 * Used when resolving component modifications: `comp(x = 1)` → x gets `{args: [], value: literal(1)}`
 */
export function subModification(mod: ModelicaModArgs | null, name: string): ModelicaModArgs | null {
  const arg = getModArg(mod, name);
  if (!arg) return null;
  return {
    args: arg.nestedArgs,
    bindingExpression: arg.value,
    isRedeclaration: arg.isRedeclaration,
    redeclaredTypeSpecifier: arg.redeclaredTypeSpecifier,
  };
}
