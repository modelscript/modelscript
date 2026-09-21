// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dynamic Workspace Symbol Type Mapping Registry.
 *
 * Provides bidirectional resolution between primitive types and domain library symbols
 * across SysML v2, Modelica, STEP CAD, OWL 2, and CSV telemetry without hardcoding
 * domain concepts into metamodel (M2) transformation grammars.
 */

export type CanonicalPrimitiveType = "REAL" | "INTEGER" | "BOOLEAN" | "STRING";

/** Static canonical primitive definitions per domain */
const PRIMITIVE_TO_CANONICAL: Record<string, Record<string, CanonicalPrimitiveType>> = {
  modelica: {
    Real: "REAL",
    Integer: "INTEGER",
    Boolean: "BOOLEAN",
    String: "STRING",
  },
  sysml2: {
    "KerML::Real": "REAL",
    "ISQ::Real": "REAL",
    Real: "REAL",
    "KerML::Integer": "INTEGER",
    Integer: "INTEGER",
    "KerML::Boolean": "BOOLEAN",
    Boolean: "BOOLEAN",
    "KerML::String": "STRING",
    String: "STRING",
  },
  step: {
    REAL: "REAL",
    INTEGER: "INTEGER",
    BOOLEAN: "BOOLEAN",
    STRING: "STRING",
  },
  owl2: {
    "xsd:double": "REAL",
    "xsd:float": "REAL",
    "xsd:decimal": "REAL",
    "xsd:integer": "INTEGER",
    "xsd:int": "INTEGER",
    "xsd:boolean": "BOOLEAN",
    "xsd:string": "STRING",
  },
  csv: {
    number: "REAL",
    float: "REAL",
    int: "INTEGER",
    integer: "INTEGER",
    boolean: "BOOLEAN",
    string: "STRING",
  },
};

const CANONICAL_TO_PRIMITIVE: Record<string, Record<CanonicalPrimitiveType, string>> = {
  modelica: {
    REAL: "Real",
    INTEGER: "Integer",
    BOOLEAN: "Boolean",
    STRING: "String",
  },
  sysml2: {
    REAL: "ISQ::Real",
    INTEGER: "KerML::Integer",
    BOOLEAN: "KerML::Boolean",
    STRING: "KerML::String",
  },
  step: {
    REAL: "REAL",
    INTEGER: "INTEGER",
    BOOLEAN: "BOOLEAN",
    STRING: "STRING",
  },
  owl2: {
    REAL: "xsd:double",
    INTEGER: "xsd:integer",
    BOOLEAN: "xsd:boolean",
    STRING: "xsd:string",
  },
  csv: {
    REAL: "number",
    INTEGER: "number",
    BOOLEAN: "boolean",
    STRING: "string",
  },
};

export class WorkspaceTypeRegistry {
  /** Explicit custom mappings: `${sourceLang}:${targetLang}:${sourceType}` -> targetType */
  private customMappings = new Map<string, string>();
  /** Inferred domain synonyms: e.g. "Resistance" -> "ISQ::Resistance" */
  private domainSynonyms = new Map<string, string>();

  /**
   * Registers an explicit cross-language type mapping.
   */
  registerTypeMapping(sourceLang: string, targetLang: string, sourceType: string, targetType: string): void {
    const key = `${sourceLang.toLowerCase()}:${targetLang.toLowerCase()}:${sourceType}`;
    this.customMappings.set(key, targetType);
  }

  /**
   * Registers a domain synonym or abbreviation.
   */
  registerDomainSynonym(alias: string, canonicalFqn: string): void {
    this.domainSynonyms.set(alias, canonicalFqn);
  }

  /**
   * Resolves primitive type equivalence via the canonical intermediate representation.
   */
  resolvePrimitive(sourceLang: string, targetLang: string, sourceType: string): string | null {
    const sLang = sourceLang.toLowerCase();
    const tLang = targetLang.toLowerCase();

    const srcMap = PRIMITIVE_TO_CANONICAL[sLang];
    const tgtMap = CANONICAL_TO_PRIMITIVE[tLang];

    if (!srcMap || !tgtMap) return null;

    const canonical = srcMap[sourceType];
    if (!canonical) return null;

    return tgtMap[canonical] ?? null;
  }

  /**
   * Dynamically resolves a type name or symbol reference between domains.
   *
   * 1. Checks explicit registered custom mappings.
   * 2. Checks primitive type maps via canonical conversion.
   * 3. Queries workspace symbol index for matching target symbols or library FQNs.
   * 4. Falls back to original type if no mapping is found.
   */
  resolveTypeMapping(sourceLang: string, targetLang: string, sourceType: string, workspace?: any): string {
    const sLang = sourceLang.toLowerCase();
    const tLang = targetLang.toLowerCase();

    // 1. Explicit registered mapping
    const key = `${sLang}:${tLang}:${sourceType}`;
    if (this.customMappings.has(key)) {
      return this.customMappings.get(key)!;
    }

    // 2. Primitive mapping
    const prim = this.resolvePrimitive(sLang, tLang, sourceType);
    if (prim) {
      return prim;
    }

    // 3. Domain synonyms
    if (this.domainSynonyms.has(sourceType)) {
      const syn = this.domainSynonyms.get(sourceType)!;
      const synKey = `${sLang}:${tLang}:${syn}`;
      if (this.customMappings.has(synKey)) {
        return this.customMappings.get(synKey)!;
      }
    }

    // 4. Dynamic workspace symbol resolution
    if (workspace) {
      try {
        const symbolIdx = typeof workspace.toSymbolIndex === "function" ? workspace.toSymbolIndex() : null;
        if (symbolIdx && symbolIdx.byName) {
          // Check if target type exists under exact name or synonym in target language
          const shortName = sourceType.split(".").pop()?.split("::").pop() ?? sourceType;
          const candidates: number[] = symbolIdx.byName.get(shortName) || [];
          for (const symId of candidates) {
            const entry = symbolIdx.symbols?.get(symId);
            if (entry && (entry.language === tLang || !entry.language)) {
              return entry.name || shortName;
            }
          }
        }
      } catch {
        // Ignore symbol resolution errors and proceed to fallback
      }
    }

    return sourceType;
  }
}
