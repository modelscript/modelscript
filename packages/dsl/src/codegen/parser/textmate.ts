// SPDX-License-Identifier: AGPL-3.0-or-later

import { LanguageOptions, Rule, TokenClass } from "../../dsl/language.js";

/**
 * Escapes special regular expression meta-characters in a raw string.
 * @param string The input string to escape.
 * @returns Escaped regex string safe for inclusion in RegExp patterns.
 */
function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Recursively traverses grammar DSL rules to extract string literals grouped by TokenClass.
 *
 * @param rule The current rule tree node being inspected.
 * @param acc Accumulator dictionary mapping token classes to sets of token strings.
 * @param currentClass Inherited token class override.
 */
interface RuleWithMeta extends Rule<string> {
  rule?: Rule<string>;
  args?: Rule<string>[];
  arg?: Rule<string>;
}

function collectTokens(rule: Rule<string>, acc: Record<string, Set<string>>, currentClass?: TokenClass) {
  if (!rule) return;
  if (rule.type === "SYNTAX_TOKEN") {
    currentClass = rule.value as TokenClass;
  }
  const semanticVal = rule.value as { type?: string } | undefined;
  if (rule.type === "SEMANTIC" && semanticVal?.type) {
    currentClass = semanticVal.type as TokenClass;
  }
  if (rule.type === "TOKEN" && typeof rule.value === "string") {
    const cls = currentClass || "other";
    acc[cls] = acc[cls] || new Set();
    acc[cls].add(rule.value);
  }

  const meta = rule as RuleWithMeta;
  if (rule.type === "def" && meta.rule) {
    collectTokens(meta.rule, acc, currentClass);
  }

  if (rule.children) {
    for (const child of rule.children) {
      collectTokens(child, acc, currentClass);
    }
  }

  if (meta.args && Array.isArray(meta.args)) {
    for (const child of meta.args) {
      collectTokens(child, acc, currentClass);
    }
  }

  if (meta.arg) {
    collectTokens(meta.arg, acc, currentClass);
  }
}

/**
 * Generates VS Code TextMate (.tmLanguage.json) and Monaco Editor (Monarch) syntax highlighters.
 *
 * @param langConfig Language DSL configuration options.
 * @returns Object containing formatted JSON strings for TextMate (`tm`) and Monarch (`monarch`) rules.
 */
export function generateTextMate(langConfig: LanguageOptions): { tm: string; monarch: string } {
  const acc: Record<string, Set<string>> = {};

  const $ = new Proxy(
    {},
    {
      get(_target, prop) {
        return { type: "REF", value: prop as string };
      },
    },
  );

  for (const ruleFn of Object.values(langConfig.rules ?? {})) {
    const rule = (ruleFn as (d: Record<string, unknown>) => Rule<string>)($);
    collectTokens(rule, acc);
  }

  if (langConfig.reserved) {
    for (const [cls, ruleFn] of Object.entries(langConfig.reserved)) {
      if (typeof ruleFn === "function") {
        const rule = (ruleFn as (d: Record<string, unknown>) => Rule<string> | Array<string | Rule<string>>)($);
        if (Array.isArray(rule)) {
          acc[cls] = acc[cls] || new Set();
          for (const word of rule) {
            if (typeof word === "string") {
              acc[cls].add(word);
            } else if (word && word.type === "TOKEN" && typeof word.value === "string") {
              acc[cls].add(word.value);
            }
          }
        } else {
          collectTokens({ type: "SYNTAX_TOKEN", value: cls, children: [rule] }, acc);
        }
      }
    }
  }

  const explicitKeywords = acc["keyword"] ? [...acc["keyword"]] : [];
  const explicitTypes = acc["type"] ? [...acc["type"]] : [];
  const explicitOperators = acc["operator"] ? [...acc["operator"]] : [];

  // Also harvest word-like identifiers from grammar tokens in acc["other"]
  const otherTokens = acc["other"] ? [...acc["other"]] : [];
  const autoKeywords = otherTokens.filter(
    (s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s) && s.length > 1 && !explicitTypes.includes(s),
  );
  const autoOperators = otherTokens.filter(
    (s) => /^[^a-zA-Z0-9_\s]+$/.test(s) && !["{", "}", "(", ")", "[", "]", ";", ",", '"', "'"].includes(s),
  );

  const ruleKeys = new Set(Object.keys(langConfig.rules ?? {}));
  const isXml = ruleKeys.has("StartTag") && ruleKeys.has("CloseTag") && ruleKeys.has("PROCESSING_INSTRUCTION");
  const isIni = ruleKeys.has("IniSectionHeader") && ruleKeys.has("IniKeyValue") && ruleKeys.has("IniComment");
  const isJson = ruleKeys.has("JsonObject") && ruleKeys.has("JsonArray") && ruleKeys.has("JsonPair");
  const isKvBlock = ruleKeys.has("KvBlock") && ruleKeys.has("KvEntry") && ruleKeys.has("KvComment");

  const langName = langConfig.name.toLowerCase();

  const extraKeywords: string[] = [];
  const extraTypes: string[] = [];
  if (langName === "step") {
    extraKeywords.push("ISO-10303-21", "HEADER", "DATA", "ENDSEC", "END-ISO-10303-21");
  } else if (langName === "modelica" && explicitTypes.length === 0) {
    extraTypes.push("Real", "Integer", "Boolean", "String", "StateSelect", "AssertionLevel");
  } else if ((langName === "sysml2" || langName === "sysml") && explicitTypes.length === 0) {
    extraTypes.push("Boolean", "Integer", "Natural", "Positive", "Real", "Complex", "String", "ScalarValue", "Number");
  }

  const keywords = Array.from(new Set([...explicitKeywords, ...autoKeywords, ...extraKeywords])).sort();
  const typeKeywords = Array.from(new Set([...explicitTypes, ...extraTypes])).sort();
  const operators = Array.from(new Set([...explicitOperators, ...autoOperators])).sort();

  const lineComment = langConfig.primitives?.lineComment;
  const commentPatterns: Record<string, unknown>[] = [];
  if (isXml || lineComment === "<!--") {
    commentPatterns.push({
      begin: "<!--",
      end: "-->",
      name: `comment.block.${langName}`,
    });
  } else if (isIni) {
    commentPatterns.push({
      match: "[;#].*$",
      name: `comment.line.${langName}`,
    });
  } else if (isJson) {
    // JSON has no comments
  } else if (langName === "spice") {
    commentPatterns.push(
      { match: "^\\s*\\*.*$", name: `comment.line.asterisk.${langName}` },
      { match: "[;$].*$", name: `comment.line.${langName}` },
    );
  } else if (langName === "matpower") {
    commentPatterns.push({ match: "%.*$", name: `comment.line.percentage.${langName}` });
  } else if (["ampl", "cantera", "bngl"].includes(langName)) {
    commentPatterns.push({ match: "#.*$", name: `comment.line.number-sign.${langName}` });
  } else if (lineComment && lineComment !== "//") {
    commentPatterns.push({
      match: `${escapeRegExp(lineComment)}.*$`,
      name: `comment.line.${langName}`,
    });
  } else {
    if (isKvBlock) {
      commentPatterns.push({ match: "#.*$", name: `comment.line.number-sign.${langName}` });
    }
    commentPatterns.push(
      {
        begin: "/\\*",
        end: "\\*/",
        name: `comment.block.${langName}`,
      },
      {
        match: "//.*$",
        name: `comment.line.double-slash.${langName}`,
      },
    );
  }

  const buildRepositoryAndPatterns = (): {
    patterns: Record<string, unknown>[];
    repository: Record<string, unknown>;
  } => {
    if (isXml) {
      return {
        patterns: [
          { include: "#comments" },
          { include: "#cdata" },
          { include: "#processingInstruction" },
          { include: "#tags" },
        ],
        repository: {
          comments: { patterns: commentPatterns },
          cdata: {
            patterns: [{ begin: "<!\\[CDATA\\[", end: "\\]\\]>", name: `string.unquoted.cdata.${langName}` }],
          },
          processingInstruction: {
            patterns: [{ begin: "<\\?", end: "\\?>", name: `meta.tag.preprocessor.${langName}` }],
          },
          tags: {
            patterns: [
              {
                begin: "(</?)([A-Za-z_:][A-Za-z0-9_.:-]*)",
                beginCaptures: {
                  1: { name: `punctuation.definition.tag.${langName}` },
                  2: { name: `entity.name.tag.${langName}` },
                },
                end: "(/?>)",
                endCaptures: {
                  1: { name: `punctuation.definition.tag.${langName}` },
                },
                patterns: [
                  {
                    match: "\\b([A-Za-z_:][A-Za-z0-9_.:-]*)\\s*(=)",
                    captures: {
                      1: { name: `entity.other.attribute-name.${langName}` },
                      2: { name: `punctuation.separator.key-value.${langName}` },
                    },
                  },
                  { begin: '"', end: '"', name: `string.quoted.double.${langName}` },
                  { begin: "'", end: "'", name: `string.quoted.single.${langName}` },
                ],
              },
            ],
          },
        },
      };
    }

    if (isJson) {
      return {
        patterns: [
          {
            match: '"([^"\\\\]|\\\\.)*"\\s*(?=:)',
            name: `support.type.property-name.${langName}`,
          },
          {
            begin: '"',
            end: '"',
            name: `string.quoted.double.${langName}`,
            patterns: [{ match: "\\\\.", name: `constant.character.escape.${langName}` }],
          },
          { match: "\\b(true|false|null)\\b", name: `constant.language.${langName}` },
          { match: "-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?", name: `constant.numeric.${langName}` },
        ],
        repository: {},
      };
    }

    const extraPatterns: Record<string, unknown>[] = [];
    if (isIni) {
      extraPatterns.push(
        {
          match: "^\\s*(\\[)([^\\]]+)(\\])",
          captures: {
            1: { name: `punctuation.definition.section.${langName}` },
            2: { name: `entity.name.section.${langName}` },
            3: { name: `punctuation.definition.section.${langName}` },
          },
        },
        {
          match: "^\\s*([A-Za-z_][A-Za-z0-9_./:-]*)\\s*(=)",
          captures: {
            1: { name: `variable.other.property.${langName}` },
            2: { name: `keyword.operator.${langName}` },
          },
        },
      );
    } else if (langName === "step") {
      extraPatterns.push(
        { match: "#[0-9]+", name: `variable.other.entity.${langName}` },
        { match: "\\.[A-Za-z_][A-Za-z0-9_]*\\.", name: `constant.language.${langName}` },
        { match: "\\b[A-Z][A-Z0-9_]{2,}\\b(?=\\s*\\()", name: `entity.name.type.${langName}` },
      );
    }

    const singleQuoteBegin = langName === "modelica" ? "(?<![A-Za-z0-9_\\)\\]])'" : "'";

    return {
      patterns: [
        { include: "#comments" },
        ...extraPatterns,
        { include: "#strings" },
        { include: "#numbers" },
        { include: "#keywords" },
        { include: "#types" },
        { include: "#operators" },
      ],
      repository: {
        numbers: {
          patterns: [
            {
              match:
                "\\b0[xX][0-9a-fA-F]+\\b|\\b[0-9]+(\\.[0-9]+)?([eEdD][+-]?[0-9]+)?([fFuUlL]+|[kKmMuUnNpP]|Meg)?\\b",
              name: `constant.numeric.${langName}`,
            },
          ],
        },
        keywords: {
          patterns:
            keywords.length > 0
              ? [
                  {
                    match: `\\b(${keywords.map(escapeRegExp).join("|")})\\b`,
                    name: `keyword.control.${langName}`,
                  },
                ]
              : [],
        },
        types: {
          patterns:
            typeKeywords.length > 0
              ? [
                  {
                    match: `\\b(${typeKeywords.map(escapeRegExp).join("|")})\\b`,
                    name: `entity.name.type.${langName}`,
                  },
                ]
              : [],
        },
        operators: {
          patterns:
            operators.length > 0
              ? [
                  {
                    match: `(${operators.map(escapeRegExp).join("|")})`,
                    name: `keyword.operator.${langName}`,
                  },
                ]
              : [],
        },
        strings: {
          patterns: [
            {
              begin: '"',
              end: '"',
              name: `string.quoted.double.${langName}`,
              patterns: [
                {
                  match: "\\\\.",
                  name: `constant.character.escape.${langName}`,
                },
              ],
            },
            {
              begin: singleQuoteBegin,
              end: "'",
              name: `string.quoted.single.${langName}`,
              patterns: [
                {
                  match: "''|\\\\.",
                  name: `constant.character.escape.${langName}`,
                },
              ],
            },
          ],
        },
        comments: {
          patterns: commentPatterns,
        },
      },
    };
  };

  const tmContent = buildRepositoryAndPatterns();
  const tm = {
    $schema: "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
    name: langConfig.name,
    scopeName: `source.${langName}`,
    ...tmContent,
  };

  const monarch = {
    keywords: keywords,
    typeKeywords: typeKeywords,
    operators: operators,
    symbols: /[=><!~?:&|+\-*/^%]+/,
    escapes: /\\\\(?:[abfnrtv\\\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
    tokenizer: {
      root: [
        [
          /[a-zA-Z_$][\\w$]*/,
          { cases: { "@typeKeywords": "keyword", "@keywords": "keyword", "@default": "identifier" } },
        ],
        { include: "@whitespace" },
        [/[{}()\\[\\]]/, "@brackets"],
        [/@symbols/, { cases: { "@operators": "operator", "@default": "" } }],
        [/\\d*\\.\\d+([eE][-+]?\\d+)?/, "number.float"],
        [/0[xX][0-9a-fA-F]+/, "number.hex"],
        [/\\d+/, "number"],
        [/[;,.]/, "delimiter"],
        [/"([^"\\\\]|\\\\.)*$/, "string.invalid"],
        [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],
        [/'([^'\\\\]|\\\\.)*'/, "string"],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\/\*/, "comment", "@push"],
        ["\\*/", "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
      string: [
        [/[^\\\\"]+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\\\./, "string.escape.invalid"],
        [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }],
      ],
      whitespace: [
        [/[ \\t\\r\\n]+/, "white"],
        ...(lineComment && lineComment !== "//" && lineComment !== "<!--"
          ? [[new RegExp(`${escapeRegExp(lineComment)}.*$`), "comment"]]
          : isIni
            ? [[/[;#].*$/, "comment"]]
            : langName === "spice"
              ? [
                  [/^\s*\*.*$/, "comment"],
                  [/[;$].*$/, "comment"],
                ]
              : langName === "matpower"
                ? [[/%.*$/, "comment"]]
                : ["ampl", "cantera", "bngl"].includes(langName)
                  ? [[/#.*$/, "comment"]]
                  : [
                      [/\/\*/, "comment", "@comment"],
                      [/\/\/.*$/, "comment"],
                    ]),
      ],
    },
  };

  return {
    tm: JSON.stringify(tm, null, 2) + "\n",
    monarch: JSON.stringify(monarch, null, 2) + "\n",
  };
}
