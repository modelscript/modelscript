<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/language

The **ModelScript Language Workbench** is a toolkit for rapidly designing, generating, and experimenting with domains-specific languages (DSLs) and system modeling dialects. It allows you to declaratively define the syntax and semantics of a language in a single TypeScript file and automatically generates all necessary language tooling.

## Overview

Modern language engineering requires writing a lot of boilerplate across multiple tooling boundaries:

- A Tree-Sitter grammar (`grammar.js`) and optional external C scanners
- Syntax highlighting queries (`queries/highlights.scm`)
- Fold and indentation queries (`queries/folds.scm`, `queries/indents.scm`)
- Error recovery anchor heuristics for robust IDE parsing
- Typed AST wrapper classes for runtime semantic analysis
- Symbol indexing and cross-reference hooks
- Language-specific semantic linting rules
- Context-aware AST diff tracking and blast-radius analysis

`@modelscript/language` unifies these definitions. Using our fluent API, you define your language rules once, and the workbench compiles them into all the required artifacts.

## Architecture

This package provides:

- **`modelscript-language` CLI**: The command-line tool that compiles language configurations into Tree-Sitter grammars and TypeScript artifacts.
- **Generator Core**: The underlying modules in `src/generators/` that walk your AST rules and infer typing, highlighting, and indexing behavior.
- **Error Recovery**: The `src/recovery.ts` module defines synchronization anchors and fallback nodes to ensure the generated parser recovers gracefully from syntax errors during live IDE editing.
- **Playground**: A WebSocket-enabled live testing environment that recompiles the grammar in memory and provides real-time AST/CST visualization.

## Quick Start

### 1. Define your language

Create a `language.ts` file in your workspace:

```typescript
import { language, def, seq, field, rule } from "@modelscript/language";

export default language({
  name: "MyLanguage",
  rules: {
    source_file: ($) => seq(field("statements", $.statement)),
    statement: ($) =>
      def(
        {
          symbol: (self) => ({ kind: "Statement", name: self.name }),
          ast: { className: "StatementNode" },
        },
        seq("let", field("name", $.identifier), "=", field("value", $.number)),
      ),
    identifier: ($) => /[a-zA-Z_]+/,
    number: ($) => /\d+/,
  },
});
```

### 2. Generate artifacts

Run the `modelscript-language` compiler:

```bash
npx modelscript-language generate path/to/language.ts --output=dist/lang
```

This will output:

- `dist/lang/grammar.js`
- `dist/lang/queries/highlights.scm`
- `dist/lang/src-gen/ast.ts`
- `dist/lang/src-gen/config.ts`

### 3. Add Linting & Diff Rules

The `def()` and `ref()` combinators accept options for adding **semantic lint rules** and **diff tracking options**:

```typescript
def({
  syntax: seq(
    optional(field("documentation", $.doc_comment)),
    optional(field("visibility", choice("public", "private"))),
    "class",
    field("name", $.identifier),
  ),
  symbol: (self) => ({
    kind: "Class",
    name: self.name,
    attributes: { visibility: self.visibility },
  }),
  lints: {
    namingConvention: (db, self) => {
      if (/^[a-z]/.test(self.name)) return warning("Classes should start with uppercase");
      return null;
    },
  },
  diff: {
    ignore: ["documentation"],
    minor: ["visibility"],
  },
});
```

With these options in place, if a developer modifies a class definition:

```diff
- // Old documentation
- public class User {}
+ // Updated user management docs
+ private class user {}
```

The language workbench automatically provides real-time validation without any extra tooling logic:

```bash
[warning] NamingConvention: Classes should start with uppercase
  at file.ts:2:14
```

Additionally, the semantic diff engine intelligently categorizes the structural changes instead of reporting a generic source code conflict:

- The documentation update is completely **ignored**.
- The `public` to `private` transition is specifically flagged as a **minor** attribute change.
- The `User` to `user` rename is flagged as a **major** breaking change.

The resulting semantic diff report output looks like this:

```json
{
  "status": "major",
  "changes": [
    {
      "type": "rename",
      "node": "User",
      "kind": "Class",
      "from": "User",
      "to": "user",
      "severity": "major"
    },
    {
      "type": "attribute_change",
      "node": "user",
      "kind": "Class",
      "attribute": "visibility",
      "from": "public",
      "to": "private",
      "severity": "minor"
    }
  ],
  "ignored": 1
}
```

This translates to the following human-readable impact summary:

> **⚠️ MAJOR CHANGES DETECTED**
>
> - **[Major]** Class \`User\` was renamed to \`user\`
> - **[Minor]** Class \`user\` changed visibility from \`public\` to \`private\`
> - _1 change was ignored (documentation)_

And for reference sites using `ref()`:

```typescript
ref({
  syntax: seq("extends", field("target", $.identifier)),
  name: (self) => self.target,
  targetKinds: ["Class"],
  resolve: "lexical",
});
```

These lints are automatically bundled with your language tooling. The queries defined here run directly on the ModelScript `QueryDB`.

### 4. Test your language interactively

Launch the web playground:

```bash
npx modelscript-language play path/to/language.ts
```

This starts a local server and opens a web app where you can type code in your new language, see the parse tree update instantly, and inspect the semantic symbol index, queries, and lints.

## Generation Modules

The generator logic is modularized under `src/generators/`:

- `ast.ts`: Scaffolds TypeScript wrappers (`SemanticNode` subclasses) with typed getters for AST fields.
- `highlights.ts`: Infers tree-sitter highlighting queries (e.g., matching `@keyword` or `@variable`) directly from rule tokens and AST hints.
- `indexer.ts`: Extracts `IndexerHook` definitions for the ModelScript Polyglot runtime to resolve symbols.
- `queries.ts`: Compiles custom tree-sitter queries.
- `refs.ts`: Compiles reference resolution hooks for cross-linking identifiers.
- `scanner.ts`: Generates custom external C scanners if manual tokenization is required.

## Building and Testing

To build the workbench:

```bash
npm run build --workspace=@modelscript/language
```

To run the unit tests (driven by Vitest):

```bash
npm run test --workspace=@modelscript/language
```
