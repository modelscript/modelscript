// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared Reusable `@modelscript/dsl` Grammar Families.
 *
 * Provides conflict-free, composable grammar rule suites for the four most
 * common engineering file families (INI/Sectioned Decks, JSON/GeoJSON, XML,
 * and Key-Value Configuration Blocks), eliminating boilerplate and GLR
 * shift/reduce conflicts across polyglot language packages.
 */

import type { RuleBuilder, RuleLike } from "./combinators.js";
import { choice, field, optional, prec, repeat, seq, token } from "./combinators.js";
import { language, type LanguageOptions } from "./language.js";

export type SharedRuleMap<K extends string = string> = Record<K, RuleBuilder<K, string>>;

export type SharedLanguageOverrides<K extends string = string> = Partial<
  Omit<LanguageOptions<K, string, string, Record<string, Record<string, unknown>>>, "name" | "rules">
> & {
  rules?: Record<string, RuleBuilder<K, string>> | undefined;
};

type JsonKey =
  | "Document"
  | "JsonValue"
  | "JsonObject"
  | "JsonPair"
  | "JsonArray"
  | "JsonString"
  | "JsonNumber"
  | "JsonBoolean"
  | "JsonNull";

/**
 * Shared RFC 8259 JSON / GeoJSON grammar rules.
 */
export const jsonRules = {
  Document: ($): RuleLike<string> => $.JsonValue,
  JsonValue: ($): RuleLike<string> =>
    choice($.JsonObject, $.JsonArray, $.JsonString, $.JsonNumber, $.JsonBoolean, $.JsonNull),
  JsonObject: ($): RuleLike<string> => seq("{", optional(seq($.JsonPair, repeat(seq(",", $.JsonPair)))), "}"),
  JsonPair: ($): RuleLike<string> => seq(field("key", $.JsonString), ":", field("value", $.JsonValue)),
  JsonArray: ($): RuleLike<string> => seq("[", optional(seq($.JsonValue, repeat(seq(",", $.JsonValue)))), "]"),
  JsonString: (): RuleLike<string> => /"([^"\\]|\\.)*"/,
  JsonNumber: (): RuleLike<string> => /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/,
  JsonBoolean: (): RuleLike<string> => choice("true", "false"),
  JsonNull: (): RuleLike<string> => "null",
} satisfies Record<JsonKey, RuleBuilder<JsonKey, string>>;

/**
 * Creates a complete `@modelscript/dsl` LanguageDefinition for JSON/GeoJSON-based formats.
 */
export function createJsonLanguage(name: string, overrides?: SharedLanguageOverrides<keyof typeof jsonRules>) {
  return language({
    name,
    extras: () => [/[ \t\r\n]+/],
    lsp: {
      folding: ["JsonObject", "JsonArray"],
      outline: ["JsonPair"],
    },
    ...overrides,
    rules: {
      ...jsonRules,
      ...overrides?.rules,
    },
  });
}

type XmlKey =
  | "Document"
  | "XmlProlog"
  | "XmlElement"
  | "XmlSelfClosingTag"
  | "XmlMatchedElement"
  | "XmlOpenTag"
  | "XmlCloseTag"
  | "XmlAttribute"
  | "XmlName"
  | "XmlAttrValue"
  | "XmlComment"
  | "XmlCdata"
  | "XmlText";

/**
 * Shared XML engineering document grammar rules (ReqIF, URDF, SBML, CellML, SSP, SCL, etc.).
 */
export const xmlRules = {
  Document: ($): RuleLike<string> => seq(optional($.XmlProlog), repeat(choice($.XmlComment, $.XmlElement))),
  XmlProlog: ($): RuleLike<string> => seq("<?xml", repeat($.XmlAttribute), "?>"),
  XmlElement: ($): RuleLike<string> => choice($.XmlSelfClosingTag, $.XmlMatchedElement),
  XmlSelfClosingTag: ($): RuleLike<string> => seq("<", field("tagName", $.XmlName), repeat($.XmlAttribute), "/>"),
  XmlMatchedElement: ($): RuleLike<string> =>
    seq($.XmlOpenTag, repeat(choice($.XmlElement, $.XmlComment, $.XmlCdata, $.XmlText)), $.XmlCloseTag),
  XmlOpenTag: ($): RuleLike<string> => seq("<", field("tagName", $.XmlName), repeat($.XmlAttribute), ">"),
  XmlCloseTag: ($): RuleLike<string> => seq("</", field("tagName", $.XmlName), ">"),
  XmlAttribute: ($): RuleLike<string> => seq(field("attrName", $.XmlName), "=", field("attrValue", $.XmlAttrValue)),
  XmlName: (): RuleLike<string> => /[A-Za-z_:][A-Za-z0-9_.:-]*/,
  XmlAttrValue: (): RuleLike<string> => choice(/"[^"]*"/, /'[^']*'/),
  XmlComment: (): RuleLike<string> => token(/<!--[\s\S]*?-->/),
  XmlCdata: (): RuleLike<string> => token(/<!\[CDATA\[[\s\S]*?\]\]>/),
  XmlText: (): RuleLike<string> => /[^<]+/,
} satisfies Record<XmlKey, RuleBuilder<XmlKey, string>>;

/**
 * Creates a complete `@modelscript/dsl` LanguageDefinition for XML-based engineering formats.
 */
export function createXmlLanguage(name: string, overrides?: SharedLanguageOverrides<keyof typeof xmlRules>) {
  return language({
    name,
    extras: () => [/[ \t\r\n]+/],
    lsp: {
      folding: ["XmlMatchedElement", "XmlComment"],
      outline: ["XmlMatchedElement", "XmlSelfClosingTag"],
    },
    ...overrides,
    rules: {
      ...xmlRules,
      ...overrides?.rules,
    },
  });
}

type IniKey =
  | "Document"
  | "IniSectionHeader"
  | "IniKeyValue"
  | "IniRecord"
  | "IniScalar"
  | "IniIdentifier"
  | "IniNumber"
  | "IniString"
  | "IniComment";

/**
 * Shared INI / Sectioned Engineering Deck grammar rules (EPANET, SWMM, MODFLOW, etc.).
 */
export const iniSectionRules = {
  Document: ($): RuleLike<string> => repeat(choice($.IniSectionHeader, $.IniKeyValue, $.IniRecord, $.IniComment)),
  IniSectionHeader: ($): RuleLike<string> => seq("[", field("sectionName", $.IniIdentifier), "]"),
  IniKeyValue: ($): RuleLike<string> => seq(field("key", $.IniIdentifier), "=", field("value", $.IniScalar)),
  IniRecord: ($): RuleLike<string> => prec.left(1, seq(field("head", $.IniScalar), repeat($.IniScalar))),
  IniScalar: ($): RuleLike<string> => choice($.IniNumber, $.IniString, $.IniIdentifier),
  IniIdentifier: (): RuleLike<string> => /[A-Za-z_][A-Za-z0-9_./:-]*/,
  IniNumber: (): RuleLike<string> => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
  IniString: (): RuleLike<string> => choice(/"[^"\r\n]*"/, /'[^'\r\n]*'/),
  IniComment: (): RuleLike<string> => token(/[;#][^\r\n]*/),
} satisfies Record<IniKey, RuleBuilder<IniKey, string>>;

/**
 * Creates a complete `@modelscript/dsl` LanguageDefinition for INI/Sectioned-Deck formats.
 */
export function createIniDeckLanguage(name: string, overrides?: SharedLanguageOverrides<keyof typeof iniSectionRules>) {
  return language({
    name,
    extras: ($) => [/[ \t\r\n]+/, $.IniComment],
    lsp: {
      folding: ["IniSectionHeader"],
      outline: ["IniSectionHeader"],
    },
    ...overrides,
    rules: {
      ...iniSectionRules,
      ...overrides?.rules,
    },
  });
}

type KvKey = "Document" | "KvBlock" | "KvEntry" | "KvIdentifier" | "KvNumber" | "KvString" | "KvComment";

/**
 * Shared Key-Value & Brace-Block configuration grammar rules (OpenFOAM dictionaries, CFD/FEA configs).
 */
export const keyValueBlockRules = {
  Document: ($): RuleLike<string> => repeat(choice($.KvBlock, $.KvEntry)),
  KvBlock: ($): RuleLike<string> => seq(field("name", $.KvIdentifier), "{", repeat(choice($.KvBlock, $.KvEntry)), "}"),
  KvEntry: ($): RuleLike<string> =>
    seq(field("key", $.KvIdentifier), repeat(choice($.KvNumber, $.KvString, $.KvIdentifier)), ";"),
  KvIdentifier: (): RuleLike<string> => /[A-Za-z_][A-Za-z0-9_.:/-]*/,
  KvNumber: (): RuleLike<string> => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?[0-9]+)?/,
  KvString: (): RuleLike<string> => /"([^"\\]|\\.)*"/,
  KvComment: (): RuleLike<string> => token(choice(/\/\/[^\r\n]*/, /\/\*[\s\S]*?\*\//, /#[^\r\n]*/)),
} satisfies Record<KvKey, RuleBuilder<KvKey, string>>;

/**
 * Creates a complete `@modelscript/dsl` LanguageDefinition for brace-block / dictionary formats.
 */
export function createKeyValueBlockLanguage(
  name: string,
  overrides?: SharedLanguageOverrides<keyof typeof keyValueBlockRules>,
) {
  return language({
    name,
    extras: ($) => [/[ \t\r\n]+/, $.KvComment],
    lsp: {
      folding: ["KvBlock"],
      outline: ["KvBlock"],
    },
    ...overrides,
    rules: {
      ...keyValueBlockRules,
      ...overrides?.rules,
    },
  });
}
