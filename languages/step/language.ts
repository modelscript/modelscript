/* eslint-disable */
/**
 * languages/step/language.ts — ISO 10303-21 STEP clear-text encoding
 *
 * Polyglot language definition for STEP Part 21 files (.step, .stp, .p21).
 * Generates:
 *   - grammar.js       — tree-sitter grammar
 *   - indexer_config.ts — symbol indexer hooks
 *   - query_hooks.ts    — query / lint functions
 *   - ref_config.ts     — reference resolution hooks
 *
 * Grammar reference: ISO 10303-21:2016 §7 (Exchange structure)
 */

import {
  choice,
  def,
  field,
  language,
  opt,
  ref,
  rep,
  rep1,
  seq,
  token,
  type QueryDB,
  type SymbolEntry,
} from "@modelscript/polyglot";

// ---------------------------------------------------------------------------
// Language Definition
// ---------------------------------------------------------------------------

export default language({
  name: "step",

  extras: ($) => [/\s/, $.BLOCK_COMMENT],

  rules: {
    // =====================================================================
    // Top-level structure
    // =====================================================================

    StepFile: ($) =>
      seq(field("header", $.HeaderSection), rep(field("dataSection", $.DataSection)), opt(field("trailer", $.Trailer))),

    Trailer: () => "END-ISO-10303-21;",

    // =====================================================================
    // Header Section
    // =====================================================================

    HeaderSection: ($) => seq("ISO-10303-21;", "HEADER;", rep(field("headerEntity", $.HeaderEntity)), "ENDSEC;"),

    HeaderEntity: ($) =>
      def({
        syntax: seq(field("keyword", $.KEYWORD), "(", field("parameters", $.ParameterList), ")", ";"),
        symbol: (self) => ({
          kind: "HeaderEntity",
          name: self.keyword,
        }),
      }),

    // =====================================================================
    // Data Section
    // =====================================================================

    DataSection: ($) =>
      def({
        syntax: seq(
          "DATA",
          opt(seq("(", field("scopeName", $.STRING), ")")),
          ";",
          rep(field("entity", $.EntityInstance)),
          "ENDSEC;",
        ),
        symbol: (self) => ({
          kind: "DataSection",
          name: self.scopeName || "DATA",
          exports: [self.scopeName],
        }),
      }),

    // =====================================================================
    // Entity Instance — the core unit of a STEP file
    //
    //   #7=PRODUCT('DroneCAD','DroneCAD','',(#2));
    //   #21=MANIFOLD_SOLID_BREP('ChassisShape',#22);
    // =====================================================================

    EntityInstance: ($) =>
      def({
        syntax: seq(field("id", $.ENTITY_INSTANCE_NAME), "=", field("record", $._Record), ";"),
        symbol: (self) => ({
          kind: "Entity",
          name: self.id,
          exports: [self.id],
          attributes: {
            entityType: self.record,
          },
        }),
        queries: {
          /**
           * Extract the entity type keyword (e.g. "PRODUCT", "CARTESIAN_POINT")
           * from the first SimpleRecord in the entity instance.
           */
          entityType: (db: QueryDB, self: SymbolEntry) => {
            return (self.metadata as any)?.entityType ?? null;
          },

          /**
           * Extract the human-readable name from the first string parameter,
           * if the entity type is a naming-convention type (PRODUCT,
           * MANIFOLD_SOLID_BREP, SHAPE_REPRESENTATION, etc.)
           */
          stepName: (db: QueryDB, self: SymbolEntry) => {
            // The first STRING parameter of naming entities is the display name
            // We search children for the first string literal
            const children = db.childrenOf(self.id);
            for (const child of children) {
              if (child.kind === "StringParam") return child.name;
            }
            return null;
          },

          /**
           * All entity instance references (#N) used in this entity's parameters.
           */
          references: (db: QueryDB, self: SymbolEntry) => {
            const refs: SymbolEntry[] = [];
            for (const child of db.childrenOf(self.id)) {
              if (child.kind === "Reference") refs.push(child);
            }
            return refs;
          },
        },
      }),

    // =====================================================================
    // Records
    // =====================================================================

    _Record: ($) => choice($.SimpleRecord, $.ComplexRecord),

    SimpleRecord: ($) => seq(field("keyword", $.KEYWORD), "(", opt(field("parameters", $.ParameterList)), ")"),

    ComplexRecord: ($) => seq("(", rep1($.SimpleRecord), ")"),

    ParameterList: ($) => seq($._Parameter, rep(seq(",", $._Parameter))),

    _Parameter: ($) =>
      choice(
        $.TypedParameter,
        $.EntityReference,
        $.REAL,
        $.INTEGER,
        $.STRING,
        $.ENUMERATION,
        $.ListValue,
        $.OMITTED_PARAMETER,
        $.DERIVED_PARAMETER,
      ),

    /**
     * Entity reference in parameters — e.g. #21
     * Creates a Reference symbol for go-to-definition support.
     */
    EntityReference: ($) =>
      ref({
        syntax: field("target", $.ENTITY_INSTANCE_NAME),
        name: (self) => self.target,
        targetKinds: ["Entity"],
        resolve: "lexical",
      }),

    TypedParameter: ($) => seq(field("keyword", $.KEYWORD), "(", opt(field("parameters", $.ParameterList)), ")"),

    ListValue: ($) => seq("(", opt($.ParameterList), ")"),

    OMITTED_PARAMETER: () => "$",

    DERIVED_PARAMETER: () => "*",

    // =====================================================================
    // Terminals (lexical rules)
    // =====================================================================

    /** Entity instance name: #1, #42, #1000 */
    ENTITY_INSTANCE_NAME: () => token(seq("#", /[0-9]+/)),

    /** STEP entity type keywords: PRODUCT, CARTESIAN_POINT, etc. */
    KEYWORD: () => /[A-Z][A-Z0-9_]*/,

    /** Integer literal (signed) */
    INTEGER: () => token(seq(opt(choice("+", "-")), /[0-9]+/)),

    /** Real literal (signed, with optional exponent) */
    REAL: () =>
      token(
        seq(
          opt(choice("+", "-")),
          /[0-9]+/,
          ".",
          opt(/[0-9]+/),
          opt(seq(choice("E", "e"), opt(choice("+", "-")), /[0-9]+/)),
        ),
      ),

    /** Single-quoted string */
    STRING: () => token(seq("'", rep(choice(/[^']/, "''")), "'")),

    /** Enumeration value: .T., .F., .MILLI., .METRE. */
    ENUMERATION: () => token(seq(".", /[A-Z][A-Z0-9_]*/, ".")),

    /** Block comment */
    BLOCK_COMMENT: () => token(seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/")),
  },

  // =========================================================================
  // Cross-language adapters: STEP → SysML2
  //
  // When SysML2 does `import DroneCAD::*`, the STEP PRODUCT named 'DroneCAD'
  // and its child shapes should be resolvable in the unified workspace.
  // =========================================================================
  adapters: {
    sysml2: {
      EntityInstance: (db, foreignNode) => ({
        target: "PackageMember",
        props: {
          name: foreignNode.name,
          entityType: (foreignNode.metadata as any)?.entityType,
        },
      }),
    },
  },
});
