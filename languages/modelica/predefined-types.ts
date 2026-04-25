/* eslint-disable */
/**
 * examples/modelica/predefined-types.ts
 *
 * Loads the synthetic __predefined__.mo preamble into the symbol index
 * so that predefined type names resolve naturally via db.byName().
 *
 * Usage:
 * ```typescript
 * const index = buildSymbolIndex(source);
 * injectPredefinedTypes(index);
 * const engine = new QueryEngine(index, hooks);
 * // Now db.byName("Real") returns the predefined Real type entry.
 * ```
 */

import type { SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/polyglot";

// ---------------------------------------------------------------------------
// Predefined Type Metadata
// ---------------------------------------------------------------------------

/**
 * Metadata for predefined Modelica types.
 *
 * Each predefined type has:
 * - name: The type name (e.g., "Real")
 * - classKind: Always "type" for predefined types
 * - isPredefined: Marker for queries to identify builtin types
 * - attributes: The default type attributes (start, min, max, etc.)
 */
interface PredefinedTypeInfo {
  name: string;
  description: string;
  attributes: Record<string, unknown>;
}

const PREDEFINED_TYPES: PredefinedTypeInfo[] = [
  {
    name: "Real",
    description: "Built-in Real type",
    attributes: {
      unit: "",
      displayUnit: "",
      min: -1e100,
      max: 1e100,
      start: 0.0,
      fixed: false,
      nominal: 1.0,
      stateSelect: "default",
    },
  },
  {
    name: "Integer",
    description: "Built-in Integer type",
    attributes: {
      min: -2147483648,
      max: 2147483647,
      start: 0,
      fixed: false,
    },
  },
  {
    name: "Boolean",
    description: "Built-in Boolean type",
    attributes: {
      start: false,
      fixed: false,
    },
  },
  {
    name: "String",
    description: "Built-in String type",
    attributes: {
      start: "",
    },
  },
  {
    name: "Clock",
    description: "Built-in Clock type for synchronous language elements",
    attributes: {},
  },
  {
    name: "StateSelect",
    description: "Priority for state variable selection",
    attributes: {
      isEnumeration: true,
      literals: ["never", "avoid", "default", "prefer", "always"],
    },
  },
  {
    name: "AssertionLevel",
    description: "Level for assert() and terminate()",
    attributes: {
      isEnumeration: true,
      literals: ["error", "warning"],
    },
  },
];

// Use negative IDs in a high range to avoid collisions with virtual entries
const PREDEFINED_BASE_ID = -1_000_000;

/**
 * Inject predefined Modelica types into a symbol index.
 *
 * Creates synthetic SymbolEntries for Real, Integer, Boolean, String,
 * Clock, StateSelect, and AssertionLevel. These entries:
 * - Have stable negative IDs (to distinguish from CST-derived symbols)
 * - Have `isPredefined: true` in metadata
 * - Are findable via `index.byName.get("Real")`, etc.
 *
 * @param index - The symbol index to augment.
 * @returns The augmented index (mutated in place).
 */
export function injectPredefinedTypes(index: SymbolIndex): SymbolIndex {
  for (let i = 0; i < PREDEFINED_TYPES.length; i++) {
    const typeInfo = PREDEFINED_TYPES[i]!;
    const id: SymbolId = PREDEFINED_BASE_ID - i;

    const entry: SymbolEntry = {
      id,
      kind: "Class",
      name: typeInfo.name,
      ruleName: "__predefined__",
      namePath: "name",
      startByte: 0,
      endByte: 0,
      parentId: null,
      exports: [],
      inherits: [],
      fieldName: null,
      metadata: {
        classKind: "type",
        isPredefined: true,
        description: typeInfo.description,
        ...typeInfo.attributes,
      },
    };

    index.symbols.set(id, entry);

    // Register in byName index
    const existing = index.byName.get(typeInfo.name);
    if (existing) {
      existing.push(id);
    } else {
      index.byName.set(typeInfo.name, [id]);
    }

    // Register in childrenOf (top-level, no parent)
    const topLevel = index.childrenOf.get(null);
    if (topLevel) {
      topLevel.push(id);
    } else {
      index.childrenOf.set(null, [id]);
    }

    // If this is an enumeration, add child entries for the literal values
    if (typeInfo.attributes.isEnumeration && Array.isArray(typeInfo.attributes.literals)) {
      for (let j = 0; j < typeInfo.attributes.literals.length; j++) {
        const litName = typeInfo.attributes.literals[j] as string;
        const litId: SymbolId = PREDEFINED_BASE_ID - 100 - i * 20 - j;

        const litEntry: SymbolEntry = {
          id: litId,
          kind: "EnumerationLiteral",
          name: litName,
          ruleName: "__predefined__",
          namePath: "name",
          startByte: 0,
          endByte: 0,
          parentId: id,
          exports: [],
          inherits: [],
          fieldName: null,
          metadata: {
            isPredefined: true,
            ordinal: j,
          },
        };

        index.symbols.set(litId, litEntry);

        // Register in byName with qualified name (e.g., "StateSelect.default")
        const qualifiedName = `${typeInfo.name}.${litName}`;
        const litExisting = index.byName.get(qualifiedName);
        if (litExisting) {
          litExisting.push(litId);
        } else {
          index.byName.set(qualifiedName, [litId]);
        }

        // Register as child of parent type
        const children = index.childrenOf.get(id);
        if (children) {
          children.push(litId);
        } else {
          index.childrenOf.set(id, [litId]);
        }
      }
    }
  }

  return index;
}

/**
 * Check if a symbol entry represents a predefined type.
 */
export function isPredefinedType(entry: SymbolEntry): boolean {
  return entry.metadata?.isPredefined === true;
}

/**
 * Check if a type name is a predefined scalar type (Real, Integer, Boolean, String).
 */
export function isScalarPredefined(name: string): boolean {
  return name === "Real" || name === "Integer" || name === "Boolean" || name === "String";
}

/**
 * Get the default type attribute value for a predefined type.
 *
 * E.g., `getTypeAttribute("Real", "start")` → `0.0`
 */
export function getTypeAttribute(typeName: string, attrName: string): unknown | null {
  const info = PREDEFINED_TYPES.find((t) => t.name === typeName);
  return info?.attributes[attrName] ?? null;
}
