// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Option-A WebAssembly GLR grammar for AutomationML concise DSL decks (`aml "..." { ... }`).
 *
 * Kept separate from `automationMLLanguage` (`xmlRules`) so XML's greedy `Text` token
 * never collides with AML DSL keywords, keeping large CAEX XML on Option B (`parseXml`)
 * and compact `.aml` DSL decks on a typed WASM GLR CST.
 */

import { choice, field, language, optional, repeat, repeat1, semanticToken, seq } from "@modelscript/dsl";

export const automationMLDslGrammar = language({
  name: "automationml_dsl",
  word: ($) => $["Identifier"]!,
  fileExtensions: [".aml"],
  maturity: "experimental",
  lsp: {
    folding: [
      "RoleClassLibDecl",
      "RoleClassDecl",
      "InterfaceClassLibDecl",
      "InterfaceClassDecl",
      "SystemUnitClassLibDecl",
      "SystemUnitClassDecl",
      "AttributeTypeLibDecl",
      "InstanceHierarchyDecl",
      "ElementDecl",
    ],
    outline: [
      "RoleClassLibDecl",
      "RoleClassDecl",
      "InterfaceClassLibDecl",
      "InterfaceClassDecl",
      "SystemUnitClassLibDecl",
      "SystemUnitClassDecl",
      "AttributeTypeLibDecl",
      "InstanceHierarchyDecl",
      "ElementDecl",
    ],
  },
  extras: ($) => [/[ \t\r\n]+/, $["Comment"]!],
  rules: {
    Document: ($) =>
      seq(
        optional($["AmlHeader"]!),
        repeat(
          choice(
            $["RoleClassLibDecl"]!,
            $["InterfaceClassLibDecl"]!,
            $["SystemUnitClassLibDecl"]!,
            $["AttributeTypeLibDecl"]!,
            $["InstanceHierarchyDecl"]!,
          ),
        ),
      ),

    AmlHeader: ($) =>
      seq(
        semanticToken("keyword", "aml"),
        field("fileName", choice($["StringLiteral"]!, $["Identifier"]!)),
        optional(
          seq(
            semanticToken("keyword", "version"),
            field("version", choice($["StringLiteral"]!, $["NumberLiteral"]!, $["Identifier"]!)),
          ),
        ),
        optional(";"),
      ),

    RoleClassLibDecl: ($) =>
      seq(
        semanticToken("keyword", "roleClassLib"),
        field("name", choice($["StringLiteral"]!, $["Identifier"]!)),
        optional(
          seq(
            semanticToken("keyword", "version"),
            field("version", choice($["StringLiteral"]!, $["NumberLiteral"]!, $["Identifier"]!)),
          ),
        ),
        "{",
        repeat($["RoleClassDecl"]!),
        "}",
      ),

    RoleClassDecl: ($) =>
      seq(
        semanticToken("keyword", "roleClass"),
        field("name", choice($["StringLiteral"]!, $["Identifier"]!)),
        optional(
          seq(
            choice(semanticToken("keyword", "extends"), ":"),
            field("base", choice($["StringLiteral"]!, $["Identifier"]!)),
          ),
        ),
        optional($["ClassBody"]!),
      ),

    InterfaceClassLibDecl: ($) =>
      seq(
        semanticToken("keyword", "interfaceClassLib"),
        field("name", choice($["StringLiteral"]!, $["Identifier"]!)),
        optional(
          seq(
            semanticToken("keyword", "version"),
            field("version", choice($["StringLiteral"]!, $["NumberLiteral"]!, $["Identifier"]!)),
          ),
        ),
        "{",
        repeat($["InterfaceClassDecl"]!),
        "}",
      ),

    InterfaceClassDecl: ($) =>
      seq(
        semanticToken("keyword", "interfaceClass"),
        field("name", choice($["StringLiteral"]!, $["Identifier"]!)),
        optional(
          seq(
            choice(semanticToken("keyword", "extends"), ":"),
            field("base", choice($["StringLiteral"]!, $["Identifier"]!)),
          ),
        ),
        optional($["ClassBody"]!),
      ),

    SystemUnitClassLibDecl: ($) =>
      seq(
        semanticToken("keyword", "systemUnitClassLib"),
        field("name", choice($["StringLiteral"]!, $["Identifier"]!)),
        optional(
          seq(
            semanticToken("keyword", "version"),
            field("version", choice($["StringLiteral"]!, $["NumberLiteral"]!, $["Identifier"]!)),
          ),
        ),
        "{",
        repeat($["SystemUnitClassDecl"]!),
        "}",
      ),

    SystemUnitClassDecl: ($) =>
      seq(
        semanticToken("keyword", "systemUnitClass"),
        field("name", choice($["StringLiteral"]!, $["Identifier"]!)),
        optional(
          seq(
            choice(semanticToken("keyword", "extends"), ":"),
            field("base", choice($["StringLiteral"]!, $["Identifier"]!)),
          ),
        ),
        optional($["ClassBody"]!),
      ),

    AttributeTypeLibDecl: ($) =>
      seq(
        semanticToken("keyword", "attributeTypeLib"),
        field("name", choice($["StringLiteral"]!, $["Identifier"]!)),
        optional(
          seq(
            semanticToken("keyword", "version"),
            field("version", choice($["StringLiteral"]!, $["NumberLiteral"]!, $["Identifier"]!)),
          ),
        ),
        "{",
        repeat($["AttributeStmt"]!),
        "}",
      ),

    ClassBody: ($) =>
      seq(
        "{",
        repeat(
          choice(
            $["RoleClassDecl"]!,
            $["InterfaceClassDecl"]!,
            $["SystemUnitClassDecl"]!,
            $["SupportedRoleStmt"]!,
            $["ElementDecl"]!,
            $["LinkStmt"]!,
            $["AttributeStmt"]!,
            $["InterfaceStmt"]!,
            $["CategoryStmt"]!,
            $["DirectionStmt"]!,
          ),
        ),
        "}",
      ),

    InstanceHierarchyDecl: ($) =>
      seq(
        semanticToken("keyword", "instanceHierarchy"),
        field("name", choice($["StringLiteral"]!, $["Identifier"]!)),
        optional(
          seq(
            semanticToken("keyword", "version"),
            field("version", choice($["StringLiteral"]!, $["NumberLiteral"]!, $["Identifier"]!)),
          ),
        ),
        "{",
        repeat(choice($["ElementDecl"]!, $["LinkStmt"]!)),
        "}",
      ),

    ElementDecl: ($) =>
      seq(
        choice(semanticToken("keyword", "internalElement"), semanticToken("keyword", "element")),
        field("name", choice($["StringLiteral"]!, $["Identifier"]!)),
        optional(
          seq(
            choice(":", semanticToken("keyword", "extends")),
            field("sysUnit", choice($["StringLiteral"]!, $["Identifier"]!)),
          ),
        ),
        optional($["ElementMeta"]!),
        optional(
          seq(
            "{",
            repeat(
              choice(
                $["ElementDecl"]!,
                $["RoleReqStmt"]!,
                $["SupportedRoleStmt"]!,
                $["FrameStmt"]!,
                $["AttributeStmt"]!,
                $["InterfaceStmt"]!,
                $["LinkStmt"]!,
              ),
            ),
            "}",
          ),
        ),
      ),

    ElementMeta: ($) => seq("[", optional(seq($["MetaEntry"]!, repeat(seq(",", $["MetaEntry"]!)), optional(","))), "]"),

    MetaEntry: ($) =>
      seq(
        field("key", $["Identifier"]!),
        choice("=", ":"),
        field("value", choice($["StringLiteral"]!, $["NumberLiteral"]!, $["Identifier"]!)),
      ),

    RoleReqStmt: ($) =>
      seq(
        choice(semanticToken("keyword", "roleRequirement"), semanticToken("keyword", "roleRequirements")),
        field("rolePath", choice($["StringLiteral"]!, $["Identifier"]!)),
        repeat(choice($["RequiresInterfacesClause"]!, $["RequiresAttributesClause"]!)),
        optional(";"),
      ),

    SupportedRoleStmt: ($) =>
      seq(
        semanticToken("keyword", "supportedRole"),
        field("rolePath", choice($["StringLiteral"]!, $["Identifier"]!)),
        repeat(choice($["RequiresInterfacesClause"]!, $["RequiresAttributesClause"]!)),
        optional(";"),
      ),

    RequiresInterfacesClause: ($) => seq(semanticToken("keyword", "requiresInterfaces"), "=", $["IdentList"]!),

    RequiresAttributesClause: ($) => seq(semanticToken("keyword", "requiresAttributes"), "=", $["IdentList"]!),

    IdentList: ($) => seq("[", repeat(choice($["StringLiteral"]!, $["Identifier"]!, ",")), "]"),

    FrameStmt: ($) =>
      seq(semanticToken("keyword", "frame"), "(", repeat(seq($["FrameField"]!, optional(","))), ")", optional(";")),

    FrameField: ($) => seq(field("axis", $["Identifier"]!), choice("=", ":"), field("value", $["NumberLiteral"]!)),

    AttributeStmt: ($) =>
      seq(
        semanticToken("keyword", "attribute"),
        field("name", choice($["StringLiteral"]!, $["Identifier"]!)),
        optional(seq(":", field("dataType", choice($["StringLiteral"]!, $["Identifier"]!)))),
        optional(seq("=", field("value", choice($["StringLiteral"]!, $["NumberLiteral"]!, $["Identifier"]!)))),
        optional($["UnitSpec"]!),
        optional(";"),
      ),

    UnitSpec: ($) =>
      seq("[", repeat1(choice($["Identifier"]!, $["NumberLiteral"]!, "/", "*", "^", "-", "%", ".")), "]"),

    InterfaceStmt: ($) =>
      seq(
        choice(
          semanticToken("keyword", "externalInterface"),
          semanticToken("keyword", "interface"),
          semanticToken("keyword", "port"),
        ),
        field("name", choice($["StringLiteral"]!, $["Identifier"]!)),
        optional(
          seq(
            ":",
            repeat1(
              choice(
                $["StringLiteral"]!,
                semanticToken("keyword", "In"),
                semanticToken("keyword", "Out"),
                semanticToken("keyword", "InOut"),
                semanticToken("keyword", "in"),
                semanticToken("keyword", "out"),
                semanticToken("keyword", "inout"),
                $["Identifier"]!,
              ),
            ),
          ),
        ),
        repeat(choice($["ExtendsClause"]!, $["InterfaceAttrClause"]!)),
        optional(";"),
      ),

    ExtendsClause: ($) =>
      seq(semanticToken("keyword", "extends"), field("base", choice($["StringLiteral"]!, $["Identifier"]!))),

    InterfaceAttrClause: ($) =>
      seq(
        field("key", $["Identifier"]!),
        "=",
        field("value", choice($["StringLiteral"]!, $["NumberLiteral"]!, $["Identifier"]!)),
      ),

    CategoryStmt: ($) =>
      seq(
        semanticToken("keyword", "category"),
        optional(choice(":", "=")),
        field("value", choice($["StringLiteral"]!, $["Identifier"]!)),
        optional(";"),
      ),

    DirectionStmt: ($) =>
      seq(
        semanticToken("keyword", "direction"),
        optional(choice(":", "=")),
        field("value", choice($["StringLiteral"]!, $["Identifier"]!)),
        optional(";"),
      ),

    LinkStmt: ($) =>
      seq(
        choice(semanticToken("keyword", "internalLink"), semanticToken("keyword", "link")),
        optional(field("name", choice($["StringLiteral"]!))),
        field("sideA", $["EndpointRef"]!),
        field("connector", choice("->", "<->", "--")),
        field("sideB", $["EndpointRef"]!),
        optional(";"),
      ),

    EndpointRef: ($) =>
      seq(field("element", $["EndpointAtom"]!), optional(seq(":", field("port", $["EndpointAtom"]!)))),

    EndpointAtom: ($) => choice($["StringLiteral"]!, $["Identifier"]!, $["NumberLiteral"]!),

    StringLiteral: () => semanticToken("string", /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/),
    NumberLiteral: () => semanticToken("number", /[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/),
    Identifier: () => semanticToken("variable", /[A-Za-z_][A-Za-z0-9_.-]*/),
    Comment: () => semanticToken("comment", /(?:\/\/|#)[^\r\n]*/),
  },
});
