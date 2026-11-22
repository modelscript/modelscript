// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, prec, repeat, repeat1, semanticToken, seq } from "@modelscript/dsl";

/** Builds a case-insensitive regex for a SPARQL 1.1 keyword. */
function kw(word: string): RegExp {
  return new RegExp(
    word
      .split("")
      .map((c) => `[${c.toLowerCase()}${c.toUpperCase()}]`)
      .join(""),
  );
}

/**
 * First-class W3C SPARQL 1.1 Query Language definition (`.rq`, `.sparql`),
 * compiled to a native WebAssembly GLR parser via `@modelscript/dsl`.
 */
export const sparqlLanguage = language({
  name: "sparql",
  displayName: "SPARQL 1.1",
  fileExtensions: [".rq", ".sparql"],
  maturity: "stable",
  lsp: {
    fileExtensions: [".rq", ".sparql"],
  },
  mcp: {
    serverName: "sparql-mcp",
    serverVersion: "1.0.0",
    tools: [
      {
        name: "execute_sparql_query",
        description: "Parse and execute a W3C SPARQL 1.1 query against the active ModelScript ontology/triple store.",
        category: "query",
        pure: true,
        inputSchema: {
          query: { type: "string", description: "SPARQL 1.1 query string", required: true },
        },
      },
    ],
  },

  extras: () => [/\s/, /#.*/],

  word: ($) => $["IDENT"]!,

  rules: {
    QueryUnit: ($) =>
      seq(
        $["Prologue"]!,
        choice(
          $["SelectQuery"]!,
          $["ConstructQuery"]!,
          $["DescribeQuery"]!,
          $["AskQuery"]!,
          $["InsertDataUpdate"]!,
          $["DeleteDataUpdate"]!,
          $["DeleteInsertUpdate"]!,
          $["InsertWhereUpdate"]!,
        ),
      ),

    Prologue: ($) => repeat(choice($["BaseDecl"]!, $["PrefixDecl"]!)),

    BaseDecl: ($) => seq(semanticToken("keyword", kw("BASE")), field("iri", $["IRIREF"]!)),

    PrefixDecl: ($) =>
      seq(semanticToken("keyword", kw("PREFIX")), field("prefix", $["PNAME_NS"]!), field("iri", $["IRIREF"]!)),

    // ── Query Forms ──────────────────────────────────────────────────────────

    SelectQuery: ($) =>
      seq(
        $["SelectClause"]!,
        repeat($["DatasetClause"]!),
        $["WhereClause"]!,
        $["SolutionModifier"]!,
        optional($["ValuesClause"]!),
      ),

    SelectClause: ($) =>
      seq(
        semanticToken("keyword", kw("SELECT")),
        optional(choice(semanticToken("keyword", kw("DISTINCT")), semanticToken("keyword", kw("REDUCED")))),
        choice("*", repeat1($["SelectProjection"]!)),
      ),

    SelectProjection: ($) =>
      choice(
        $["VAR"]!,
        seq("(", field("expr", $["Expression"]!), semanticToken("keyword", kw("AS")), field("alias", $["VAR"]!), ")"),
      ),

    ConstructQuery: ($) =>
      seq(
        semanticToken("keyword", kw("CONSTRUCT")),
        $["ConstructTemplate"]!,
        repeat($["DatasetClause"]!),
        $["WhereClause"]!,
        $["SolutionModifier"]!,
        optional($["ValuesClause"]!),
      ),

    ConstructTemplate: ($) => seq("{", optional($["TriplesBlock"]!), "}"),

    DescribeQuery: ($) =>
      seq(
        semanticToken("keyword", kw("DESCRIBE")),
        choice("*", repeat1(choice($["VAR"]!, $["Iri"]!))),
        repeat($["DatasetClause"]!),
        optional($["WhereClause"]!),
        $["SolutionModifier"]!,
        optional($["ValuesClause"]!),
      ),

    AskQuery: ($) =>
      seq(
        semanticToken("keyword", kw("ASK")),
        repeat($["DatasetClause"]!),
        $["WhereClause"]!,
        optional($["ValuesClause"]!),
      ),

    // ── SPARQL 1.1 Update Forms ──────────────────────────────────────────────

    InsertDataUpdate: ($) =>
      seq(
        semanticToken("keyword", kw("INSERT")),
        semanticToken("keyword", kw("DATA")),
        "{",
        optional($["TriplesBlock"]!),
        "}",
      ),

    DeleteDataUpdate: ($) =>
      seq(
        semanticToken("keyword", kw("DELETE")),
        semanticToken("keyword", kw("DATA")),
        "{",
        optional($["TriplesBlock"]!),
        "}",
      ),

    DeleteInsertUpdate: ($) =>
      seq(
        semanticToken("keyword", kw("DELETE")),
        "{",
        optional($["TriplesBlock"]!),
        "}",
        optional(seq(semanticToken("keyword", kw("INSERT")), "{", optional($["TriplesBlock"]!), "}")),
        $["WhereClause"]!,
      ),

    InsertWhereUpdate: ($) =>
      seq(semanticToken("keyword", kw("INSERT")), "{", optional($["TriplesBlock"]!), "}", $["WhereClause"]!),

    SubSelect: ($) => seq($["SelectClause"]!, $["WhereClause"]!, $["SolutionModifier"]!, optional($["ValuesClause"]!)),

    DatasetClause: ($) =>
      seq(
        semanticToken("keyword", kw("FROM")),
        optional(semanticToken("keyword", kw("NAMED"))),
        field("iri", $["Iri"]!),
      ),

    WhereClause: ($) => seq(optional(semanticToken("keyword", kw("WHERE"))), $["GroupGraphPattern"]!),

    // ── Graph Patterns ───────────────────────────────────────────────────────

    GroupGraphPattern: ($) => seq("{", choice($["SubSelect"]!, repeat($["GraphPatternItem"]!)), "}"),

    GraphPatternItem: ($) =>
      choice(
        $["TriplesSameSubject"]!,
        $["OptionalGraphPattern"]!,
        $["MinusGraphPattern"]!,
        $["GraphGraphPattern"]!,
        $["ServiceGraphPattern"]!,
        $["FilterClause"]!,
        $["BindClause"]!,
        $["ValuesClause"]!,
        $["GroupOrUnionGraphPattern"]!,
        ".",
      ),

    GroupOrUnionGraphPattern: ($) =>
      seq($["GroupGraphPattern"]!, repeat(seq(semanticToken("keyword", kw("UNION")), $["GroupGraphPattern"]!))),

    OptionalGraphPattern: ($) => seq(semanticToken("keyword", kw("OPTIONAL")), $["GroupGraphPattern"]!),

    MinusGraphPattern: ($) => seq(semanticToken("keyword", kw("MINUS")), $["GroupGraphPattern"]!),

    GraphGraphPattern: ($) =>
      seq(semanticToken("keyword", kw("GRAPH")), field("graph", choice($["VAR"]!, $["Iri"]!)), $["GroupGraphPattern"]!),

    ServiceGraphPattern: ($) =>
      seq(
        semanticToken("keyword", kw("SERVICE")),
        optional(semanticToken("keyword", kw("SILENT"))),
        field("endpoint", choice($["VAR"]!, $["Iri"]!)),
        $["GroupGraphPattern"]!,
      ),

    FilterClause: ($) => seq(semanticToken("keyword", kw("FILTER")), $["Constraint"]!),

    Constraint: ($) => choice($["BrackettedExpression"]!, $["BuiltInCall"]!),

    BindClause: ($) =>
      seq(
        semanticToken("keyword", kw("BIND")),
        "(",
        field("expr", $["Expression"]!),
        semanticToken("keyword", kw("AS")),
        field("var", $["VAR"]!),
        ")",
      ),

    ValuesClause: ($) =>
      seq(
        semanticToken("keyword", kw("VALUES")),
        choice(
          seq($["VAR"]!, "{", repeat($["DataBlockValue"]!), "}"),
          seq("(", repeat($["VAR"]!), ")", "{", repeat($["ValuesRow"]!), "}"),
        ),
      ),

    ValuesRow: ($) => seq("(", repeat($["DataBlockValue"]!), ")"),

    DataBlockValue: ($) =>
      choice(
        $["Iri"]!,
        $["RDFLiteral"]!,
        $["NumericLiteral"]!,
        $["BooleanLiteral"]!,
        semanticToken("keyword", kw("UNDEF")),
      ),

    // ── Triples & Property Paths ─────────────────────────────────────────────

    TriplesBlock: ($) => seq($["TriplesSameSubject"]!, repeat(seq(".", optional($["TriplesSameSubject"]!)))),

    TriplesSameSubject: ($) => seq(field("subject", $["VarOrTerm"]!), $["PropertyListNotEmpty"]!),

    PropertyListNotEmpty: ($) =>
      seq($["PropertyObjectPair"]!, repeat(seq(";", $["PropertyObjectPair"]!)), optional(";")),

    PropertyObjectPair: ($) => seq(field("verb", $["VerbPathOrSimple"]!), field("objects", $["ObjectList"]!)),

    VerbPathOrSimple: ($) => choice($["VAR"]!, $["PathAlternative"]!),

    PathAlternative: ($) => seq($["PathSequence"]!, repeat(seq("|", $["PathSequence"]!))),

    PathSequence: ($) => seq($["PathEltOrInverse"]!, repeat(seq("/", $["PathEltOrInverse"]!))),

    PathEltOrInverse: ($) => choice(seq("^", $["PathElt"]!), $["PathElt"]!),

    PathElt: ($) => seq($["PathPrimary"]!, optional($["PathMod"]!)),

    PathMod: () => choice("?", "*", "+"),

    PathNegatedPropertySet: ($) =>
      seq("!", choice($["Iri"]!, "a", seq("(", choice($["Iri"]!, "a"), repeat(seq("|", choice($["Iri"]!, "a"))), ")"))),

    PathPrimary: ($) => choice($["Iri"]!, "a", $["PathNegatedPropertySet"]!, seq("(", $["PathAlternative"]!, ")")),

    BlankNodePropertyList: ($) => seq("[", $["PropertyListNotEmpty"]!, "]"),

    Collection: ($) => seq("(", repeat1($["VarOrTerm"]!), ")"),

    ObjectList: ($) => seq($["VarOrTerm"]!, repeat(seq(",", $["VarOrTerm"]!))),

    // ── Solution Modifiers ───────────────────────────────────────────────────

    SolutionModifier: ($) =>
      seq(
        optional($["GroupClause"]!),
        optional($["HavingClause"]!),
        optional($["OrderClause"]!),
        optional($["LimitOffsetClauses"]!),
      ),

    GroupClause: ($) =>
      seq(semanticToken("keyword", kw("GROUP")), semanticToken("keyword", kw("BY")), repeat1($["GroupCondition"]!)),

    GroupCondition: ($) =>
      choice(
        $["BuiltInCall"]!,
        $["VAR"]!,
        seq("(", $["Expression"]!, optional(seq(semanticToken("keyword", kw("AS")), $["VAR"]!)), ")"),
      ),

    HavingClause: ($) => seq(semanticToken("keyword", kw("HAVING")), repeat1($["Constraint"]!)),

    OrderClause: ($) =>
      seq(semanticToken("keyword", kw("ORDER")), semanticToken("keyword", kw("BY")), repeat1($["OrderCondition"]!)),

    OrderCondition: ($) =>
      choice(
        seq(
          choice(semanticToken("keyword", kw("ASC")), semanticToken("keyword", kw("DESC"))),
          $["BrackettedExpression"]!,
        ),
        $["Constraint"]!,
        $["VAR"]!,
      ),

    LimitOffsetClauses: ($) =>
      choice(
        seq($["LimitClause"]!, optional($["OffsetClause"]!)),
        seq($["OffsetClause"]!, optional($["LimitClause"]!)),
      ),

    LimitClause: ($) => seq(semanticToken("keyword", kw("LIMIT")), field("count", $["INTEGER"]!)),

    OffsetClause: ($) => seq(semanticToken("keyword", kw("OFFSET")), field("count", $["INTEGER"]!)),

    // ── Expressions ──────────────────────────────────────────────────────────

    Expression: ($) => $["ConditionalOrExpression"]!,

    ConditionalOrExpression: ($) =>
      prec.left(
        1,
        choice(
          $["ConditionalAndExpression"]!,
          seq($["ConditionalOrExpression"]!, "||", $["ConditionalAndExpression"]!),
        ),
      ),

    ConditionalAndExpression: ($) =>
      prec.left(
        2,
        choice($["RelationalExpression"]!, seq($["ConditionalAndExpression"]!, "&&", $["RelationalExpression"]!)),
      ),

    RelationalExpression: ($) =>
      prec.left(
        3,
        choice(
          $["AdditiveExpression"]!,
          seq($["AdditiveExpression"]!, choice("=", "!=", "<=", ">=", "<", ">"), $["AdditiveExpression"]!),
          seq(
            $["AdditiveExpression"]!,
            optional(semanticToken("keyword", kw("NOT"))),
            semanticToken("keyword", kw("IN")),
            "(",
            optional($["ExpressionList"]!),
            ")",
          ),
        ),
      ),

    AdditiveExpression: ($) =>
      prec.left(
        4,
        choice(
          $["MultiplicativeExpression"]!,
          seq($["AdditiveExpression"]!, choice("+", "-"), $["MultiplicativeExpression"]!),
        ),
      ),

    MultiplicativeExpression: ($) =>
      prec.left(
        5,
        choice($["UnaryExpression"]!, seq($["MultiplicativeExpression"]!, choice("*", "/"), $["UnaryExpression"]!)),
      ),

    UnaryExpression: ($) =>
      choice(
        seq("!", $["PrimaryExpression"]!),
        seq("+", $["PrimaryExpression"]!),
        seq("-", $["PrimaryExpression"]!),
        $["PrimaryExpression"]!,
      ),

    PrimaryExpression: ($) =>
      choice(
        $["BrackettedExpression"]!,
        $["BuiltInCall"]!,
        $["Iri"]!,
        $["RDFLiteral"]!,
        $["NumericLiteral"]!,
        $["BooleanLiteral"]!,
        $["VAR"]!,
      ),

    BrackettedExpression: ($) => seq("(", $["Expression"]!, ")"),

    ExpressionList: ($) => seq($["Expression"]!, repeat(seq(",", $["Expression"]!))),

    BuiltInCall: ($) =>
      seq(
        field("fn", $["IDENT"]!),
        "(",
        optional(semanticToken("keyword", kw("DISTINCT"))),
        optional(choice("*", $["ExpressionList"]!)),
        ")",
      ),

    // ── Terms & Lexical Tokens ───────────────────────────────────────────────

    VarOrTerm: ($) =>
      choice(
        $["VAR"]!,
        $["Iri"]!,
        $["RDFLiteral"]!,
        $["NumericLiteral"]!,
        $["BooleanLiteral"]!,
        $["BLANK_NODE_LABEL"]!,
        $["BlankNodePropertyList"]!,
        $["Collection"]!,
      ),

    Iri: ($) => choice($["IRIREF"]!, $["PNAME_LN"]!, $["PNAME_NS"]!),

    RDFLiteral: ($) => seq($["STRING_LITERAL"]!, optional(choice($["LANGTAG"]!, seq("^^", $["Iri"]!)))),

    NumericLiteral: ($) => choice($["DECIMAL_OR_DOUBLE"]!, $["INTEGER"]!),

    BooleanLiteral: () => choice(semanticToken("keyword", kw("true")), semanticToken("keyword", kw("false"))),

    VAR: () => semanticToken("variable", /[?$][a-zA-Z_][a-zA-Z0-9_]*/),
    IRIREF: () => semanticToken("string", /<[^<>"{}|^`\\\s]*>/),
    PNAME_LN: () => semanticToken("type", /[a-zA-Z_][a-zA-Z0-9_-]*:[a-zA-Z0-9_.-]+|:[a-zA-Z0-9_.-]+/),
    PNAME_NS: () => semanticToken("namespace", /[a-zA-Z_][a-zA-Z0-9_-]*:|:/),
    BLANK_NODE_LABEL: () => /_:[a-zA-Z0-9_.-]+/,
    STRING_LITERAL: () => semanticToken("string", /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/),
    LANGTAG: () => /@[a-zA-Z]+(?:-[a-zA-Z0-9]+)*/,
    DECIMAL_OR_DOUBLE: () => semanticToken("number", /[0-9]+\.[0-9]+(?:[eE][+-]?[0-9]+)?|[0-9]+[eE][+-]?[0-9]+/),
    INTEGER: () => semanticToken("number", /[0-9]+/),
    IDENT: () => semanticToken("identifier", /[a-zA-Z_][a-zA-Z0-9_]*/),
  },

  symbols: {
    QueryUnit: { name: "$self", kind: "Package", scope: true },
    PrefixDecl: { name: "prefix", kind: "Namespace", scope: false },
  },
});

export default sparqlLanguage;
