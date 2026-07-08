import { LanguageOptions, Rule, TokenClass } from "../dsl.js";

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectTokens(rule: Rule<any>, acc: Record<string, Set<string>>, currentClass?: TokenClass) {
  if (!rule) return;
  if (rule.type === "SYNTAX_TOKEN") {
    currentClass = rule.value as TokenClass;
  }
  if (rule.type === "TOKEN" && typeof rule.value === "string") {
    const cls = currentClass || "other";
    acc[cls] = acc[cls] || new Set();
    acc[cls].add(rule.value);
  }

  if (rule.type === "def" && (rule as any).rule) {
    collectTokens((rule as any).rule, acc, currentClass);
  }

  if (rule.children) {
    for (const child of rule.children) {
      collectTokens(child, acc, currentClass);
    }
  }

  if ((rule as any).args && Array.isArray((rule as any).args)) {
    for (const child of (rule as any).args) {
      collectTokens(child, acc, currentClass);
    }
  }

  if ((rule as any).arg) {
    collectTokens((rule as any).arg, acc, currentClass);
  }
}

export function generateTextMate(langConfig: LanguageOptions): { tm: string; monarch: string } {
  const acc: Record<string, Set<string>> = {};

  const $ = new Proxy(
    {},
    {
      get(target, prop) {
        return { type: "REF", value: prop as string };
      },
    },
  );

  for (const ruleFn of Object.values(langConfig.rules)) {
    const rule = (ruleFn as any)($);
    collectTokens(rule, acc);
  }

  if (langConfig.reserved) {
    for (const [cls, ruleFn] of Object.entries(langConfig.reserved)) {
      if (typeof ruleFn === "function") {
        const rule = (ruleFn as any)($);
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

  const keywords = explicitKeywords.filter((s) => s.length > 1).sort();
  const typeKeywords = explicitTypes.sort();
  const operators = explicitOperators.sort();

  const langName = langConfig.name.toLowerCase();

  const tm = {
    $schema: "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
    name: langConfig.name,
    scopeName: `source.${langName}`,
    patterns: [
      { include: "#keywords" },
      { include: "#types" },
      { include: "#operators" },
      { include: "#strings" },
      { include: "#comments" },
    ],
    repository: {
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
        ],
      },
      comments: {
        patterns: [
          {
            begin: "/\\*",
            end: "\\*/",
            name: `comment.block.${langName}`,
          },
          {
            match: "//.*$",
            name: `comment.line.double-slash.${langName}`,
          },
        ],
      },
    },
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
        [/\/\*/, "comment", "@comment"],
        [/\/\/.*$/, "comment"],
      ],
    },
  };

  return {
    tm: JSON.stringify(tm, null, 2) + "\n",
    monarch: JSON.stringify(monarch, null, 2) + "\n",
  };
}
