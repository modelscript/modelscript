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

  private static readonly EXTRA_PRIMITIVE_TO_CANONICAL: Record<string, Record<string, CanonicalPrimitiveType>> = {
    modelica: {
      "Modelica.Blocks.Interfaces.RealInput": "REAL",
      "Modelica.Blocks.Interfaces.RealOutput": "REAL",
      "Modelica.Blocks.Interfaces.IntegerInput": "INTEGER",
      "Modelica.Blocks.Interfaces.IntegerOutput": "INTEGER",
      "Modelica.Blocks.Interfaces.BooleanInput": "BOOLEAN",
      "Modelica.Blocks.Interfaces.BooleanOutput": "BOOLEAN",
      "Modelica.SIunits.Voltage": "REAL",
      "Modelica.SIunits.Current": "REAL",
      "Modelica.SIunits.Power": "REAL",
      "Modelica.SIunits.ActivePower": "REAL",
      "Modelica.SIunits.ReactivePower": "REAL",
      "Modelica.SIunits.Frequency": "REAL",
      "Modelica.SIunits.Angle": "REAL",
      "Modelica.SIunits.Mass": "REAL",
      "Modelica.SIunits.Length": "REAL",
      "Modelica.SIunits.Time": "REAL",
      "Modelica.Units.SI.Voltage": "REAL",
      "Modelica.Units.SI.Current": "REAL",
      "Modelica.Units.SI.Mass": "REAL",
      "Modelica.Units.SI.Length": "REAL",
    },
    sysml2: {
      "ScalarValues::Real": "REAL",
      "ScalarValues::Integer": "INTEGER",
      "ScalarValues::Natural": "INTEGER",
      "ScalarValues::Positive": "INTEGER",
      "ScalarValues::Boolean": "BOOLEAN",
      "ScalarValues::String": "STRING",
      Real: "REAL",
      Integer: "INTEGER",
      Natural: "INTEGER",
      Positive: "INTEGER",
      Boolean: "BOOLEAN",
      String: "STRING",
    },
    psse: {
      REAL: "REAL",
      real: "REAL",
      float: "REAL",
      DOUBLE: "REAL",
      INTEGER: "INTEGER",
      int: "INTEGER",
      STRING: "STRING",
      boolean: "BOOLEAN",
      LOGICAL: "BOOLEAN",
    },
    pscad: {
      REAL: "REAL",
      real: "REAL",
      INTEGER: "INTEGER",
      int: "INTEGER",
      LOGICAL: "BOOLEAN",
      boolean: "BOOLEAN",
      STRING: "STRING",
      text: "STRING",
      ELECTRICAL: "REAL",
    },
    spice: {
      real: "REAL",
      double: "REAL",
      voltage: "REAL",
      current: "REAL",
      int: "INTEGER",
      bool: "BOOLEAN",
      string: "STRING",
    },
    veriloga: {
      real: "REAL",
      electrical: "REAL",
      voltage: "REAL",
      current: "REAL",
      integer: "INTEGER",
      string: "STRING",
    },
    "verilog-a": {
      real: "REAL",
      electrical: "REAL",
      voltage: "REAL",
      current: "REAL",
      integer: "INTEGER",
      string: "STRING",
    },
    simulink: {
      double: "REAL",
      single: "REAL",
      int8: "INTEGER",
      int16: "INTEGER",
      int32: "INTEGER",
      uint32: "INTEGER",
      boolean: "BOOLEAN",
      string: "STRING",
    },
    c: {
      double: "REAL",
      float: "REAL",
      int: "INTEGER",
      long: "INTEGER",
      bool: "BOOLEAN",
      _Bool: "BOOLEAN",
      "char*": "STRING",
    },
    fortran: {
      real: "REAL",
      "real(8)": "REAL",
      "double precision": "REAL",
      integer: "INTEGER",
      logical: "BOOLEAN",
      character: "STRING",
    },
    cellml: { dimensionless: "REAL", real: "REAL" },
    sbml: { real: "REAL", dimensionless: "REAL", boolean: "BOOLEAN", integer: "INTEGER", string: "STRING" },
    modelscript: { Real: "REAL", Integer: "INTEGER", Boolean: "BOOLEAN", String: "STRING" },
  };

  private static readonly EXTRA_CANONICAL_TO_PRIMITIVE: Record<string, Record<CanonicalPrimitiveType, string>> = {
    psse: { REAL: "REAL", INTEGER: "INTEGER", BOOLEAN: "LOGICAL", STRING: "STRING" },
    pscad: { REAL: "REAL", INTEGER: "INTEGER", BOOLEAN: "LOGICAL", STRING: "STRING" },
    spice: { REAL: "real", INTEGER: "int", BOOLEAN: "bool", STRING: "string" },
    veriloga: { REAL: "real", INTEGER: "integer", BOOLEAN: "integer", STRING: "string" },
    "verilog-a": { REAL: "real", INTEGER: "integer", BOOLEAN: "integer", STRING: "string" },
    simulink: { REAL: "double", INTEGER: "int32", BOOLEAN: "boolean", STRING: "string" },
    c: { REAL: "double", INTEGER: "int", BOOLEAN: "bool", STRING: "char*" },
    fortran: { REAL: "double precision", INTEGER: "integer", BOOLEAN: "logical", STRING: "character" },
    cellml: { REAL: "dimensionless", INTEGER: "dimensionless", BOOLEAN: "dimensionless", STRING: "string" },
    sbml: { REAL: "real", INTEGER: "integer", BOOLEAN: "boolean", STRING: "string" },
    modelscript: { REAL: "Real", INTEGER: "Integer", BOOLEAN: "Boolean", STRING: "String" },
  };

  /**
   * Resolves a type name in `lang` to a canonical primitive category if recognized.
   */
  toCanonicalPrimitive(lang: string, typeName: string): CanonicalPrimitiveType | null {
    const nLang = lang.toLowerCase();
    const clean = typeName.trim();
    if (!clean) return null;

    const base = PRIMITIVE_TO_CANONICAL[nLang]?.[clean];
    if (base) return base;

    const extra = WorkspaceTypeRegistry.EXTRA_PRIMITIVE_TO_CANONICAL[nLang]?.[clean];
    if (extra) return extra;

    const leaf = clean.split("::").pop()?.split(".").pop()?.trim();
    if (leaf && leaf !== clean) {
      return (
        PRIMITIVE_TO_CANONICAL[nLang]?.[leaf] ??
        WorkspaceTypeRegistry.EXTRA_PRIMITIVE_TO_CANONICAL[nLang]?.[leaf] ??
        null
      );
    }

    // SysML v2 / Modelica scalar quantities (e.g. ISQ::*Value, Real) fallback
    if (nLang === "sysml2" || nLang === "sysml") {
      return (
        PRIMITIVE_TO_CANONICAL["sysml2"]?.[clean] ??
        WorkspaceTypeRegistry.EXTRA_PRIMITIVE_TO_CANONICAL["sysml2"]?.[clean] ??
        null
      );
    }
    return null;
  }

  /**
   * Checks whether `sourceType` in `sourceLang` is compatible with `targetType` in `targetLang`
   * across canonical primitives, numeric widening (`INTEGER -> REAL`), custom mappings, and units.
   */
  areTypesCompatible(
    sourceLang: string,
    sourceType: string,
    targetLang: string,
    targetType: string,
    opts?: { sourceUnit?: string | undefined; targetUnit?: string | undefined },
  ): { compatible: boolean; reason?: string | undefined } {
    const sLang = sourceLang.toLowerCase();
    const tLang = targetLang.toLowerCase();
    const sClean = sourceType.trim();
    const tClean = targetType.trim();

    if (!sClean || !tClean) return { compatible: true };

    if (opts?.sourceUnit && opts?.targetUnit) {
      const su = opts.sourceUnit.trim();
      const tu = opts.targetUnit.trim();
      if (su && tu && su !== tu && su !== "1" && tu !== "1") {
        return { compatible: false, reason: `Unit mismatch: '${su}' is not compatible with '${tu}'.` };
      }
    }

    const mappedDirect = this.customMappings.get(`${sLang}:${tLang}:${sClean}`);
    if (mappedDirect && mappedDirect === tClean) return { compatible: true };
    const mappedReverse = this.customMappings.get(`${tLang}:${sLang}:${tClean}`);
    if (mappedReverse && mappedReverse === sClean) return { compatible: true };

    const sLeaf = sClean.split("::").pop()?.split(".").pop()?.trim() ?? sClean;
    const tLeaf = tClean.split("::").pop()?.split(".").pop()?.trim() ?? tClean;
    if (sClean === tClean || sLeaf === tLeaf) return { compatible: true };

    const sCanon = this.toCanonicalPrimitive(sLang, sClean);
    const tCanon = this.toCanonicalPrimitive(tLang, tClean);
    if (sCanon && tCanon) {
      if (sCanon === tCanon) return { compatible: true };
      if (sCanon === "INTEGER" && tCanon === "REAL") return { compatible: true };
      return {
        compatible: false,
        reason: `Cross-language type mismatch: '${sClean}' (${sLang}/${sCanon}) is not compatible with '${tClean}' (${tLang}/${tCanon}).`,
      };
    }

    return { compatible: false, reason: `Incompatible types '${sClean}' (${sLang}) and '${tClean}' (${tLang}).` };
  }

  /**
   * Resolves primitive type equivalence via the canonical intermediate representation.
   */
  resolvePrimitive(sourceLang: string, targetLang: string, sourceType: string): string | null {
    const sLang = sourceLang.toLowerCase();
    const tLang = targetLang.toLowerCase();

    const canonical =
      PRIMITIVE_TO_CANONICAL[sLang]?.[sourceType] ??
      WorkspaceTypeRegistry.EXTRA_PRIMITIVE_TO_CANONICAL[sLang]?.[sourceType] ??
      this.toCanonicalPrimitive(sLang, sourceType);
    if (!canonical) return null;

    return (
      CANONICAL_TO_PRIMITIVE[tLang]?.[canonical] ??
      WorkspaceTypeRegistry.EXTRA_CANONICAL_TO_PRIMITIVE[tLang]?.[canonical] ??
      null
    );
  }

  /**
   * Dynamically resolves a type name or symbol reference between domains.
   *
   * 1. Checks explicit registered custom mappings.
   * 2. Checks primitive type maps via canonical conversion.
   * 3. Queries workspace symbol index for matching target symbols or library FQNs.
   * 4. Falls back to original type if no mapping is found.
   */
  resolveTypeMapping(
    sourceLang: string,
    targetLang: string,
    sourceType: string,
    workspace?: {
      getIndex?: (opts?: {
        eager?: boolean;
      }) => { byName?: Map<string, number[]>; symbols?: Map<number, { name?: string; language?: string }> } | null;
    },
  ): string {
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
        const symbolIdx = typeof workspace.getIndex === "function" ? workspace.getIndex({ eager: true }) : null;
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
