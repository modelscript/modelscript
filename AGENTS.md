# ModelScript Agent Guidelines

## Terminal Workaround (Linux)

**IMPORTANT:** On this system, `node -e` with multi-line inline scripts causes the terminal to hang indefinitely even after the command finishes. This is a known Antigravity bug on Linux.

**Rules:**

1. **Never** use `node -e "..."` with multi-line JavaScript/TypeScript.
2. Instead, write the script to a temp file and run it:
   ```bash
   cat > /tmp/script.ts << 'EOF'
   // your code here
   EOF
   npx tsx /tmp/script.ts
   ```
3. For simple one-liners, prefer `npm run test` or other package scripts.
4. Always set `WaitMsBeforeAsync` appropriately — use short timeouts (500-2000ms) for commands that might hang, and check with `command_status`.
5. **Build commands** (`npm run build`, `nx run`, etc.) hang indefinitely when there are lint or compilation errors. Always use a short `WaitMsBeforeAsync` (e.g., 500ms) and monitor with `command_status`, or pipe through `timeout 30` to force termination.
6. **Command Canceled:** Always query the output of a command using `command_status` with `WaitDurationSeconds: 0` even if its status was previously reported as `CANCELED` during a poll. A canceled command might still have produced useful error output before being terminated.
7. **Apparent hangs:** When a command appears to hang (stuck in RUNNING with no output), **always assume it is the known Antigravity Linux terminal bug first**, not an infinite loop in the code. Query `command_status` with `WaitDurationSeconds: 0` and `OutputCharacterCount` to check if output was already produced. Do not prematurely terminate commands or assume code bugs without first verifying the output.
8. **Test script placement:** Never place test scripts that import project modules in `/tmp/`. Scripts in `/tmp/` cannot resolve monorepo workspace imports (e.g., `@modelscript/core`) or relative paths back into the repo. Always place ad-hoc test scripts inside the repo (e.g., `packages/core/tests/` or a scratch file alongside the source).
9. **Tree-sitter for Node.js:** When writing scripts that run on desktop/Node.js (tests, CLI tools, etc.), always use the **native** `tree-sitter` package — never `web-tree-sitter` or WASM. Follow the pattern in `packages/core/tests/jest.setup.ts`:
   ```typescript
   import Modelica from "@modelscript/tree-sitter-modelica";
   import Parser from "tree-sitter";
   import { Context } from "../src/compiler/context.js";
   const parser = new Parser();
   parser.setLanguage(Modelica);
   Context.registerParser(".mo", parser);
   ```
10. **SafeToAutoRun:** Always set `SafeToAutoRun` to `false` for test scripts, debug scripts, and any command whose output you need to read. Setting it to `true` causes the command to run in the background where it appears frozen. Only use `SafeToAutoRun: true` for trivial commands like `cat`, `ls`, or `echo` that complete almost instantly.

## Concrete Syntax Nodes

**IMPORTANT:** Never use concrete syntax nodes (tree-sitter `SyntaxNode`) for flattening or interpretation logic. Concrete syntax nodes are ephemeral — they are only available during initial parsing and are NOT preserved through cloning, modification merging, or serialization.

**Rules:**

1. **Always use abstract syntax nodes** (`ModelicaClassDefinitionSyntaxNode`, `ModelicaLongClassSpecifierSyntaxNode`, etc.) for accessing class elements, sections, and other structural information in the flattener, interpreter, and model.
2. **Never access `concreteSyntaxNode` fields** for semantic analysis. They may be `null` on cloned or deserialized instances.
3. Properties like `sections`, `elements`, `equations`, `statements` are populated at construction time from whichever source is available (concrete or abstract). After construction, always access them through the abstract syntax node wrappers.

## Linter Rules

When adding new linter rules to `@modelscript/core`, follow this pattern:

### 1. Define the Error Code

Add a new entry to `ModelicaErrorCode` in `packages/core/src/compiler/modelica/errors.ts`:

```typescript
RULE_NAME: {
  code: XXXX,          // Unique numeric code (see numbering scheme below)
  rule: "rule-name",   // Kebab-case identifier
  severity: "error",   // "error" | "warning" | "info"
  message: (param: string) => `Descriptive message with '${param}'.`,
},
```

**Error code numbering:**

- `1xxx` — Parser / Syntax
- `2xxx` — Name resolution
- `3xxx` — Type checking
- `4xxx` — Structural / Semantic
- `5xxx` — Equations & Algorithms

### 2. Register the Lint Rule

Add a `ModelicaLinter.register(...)` call at the bottom of `packages/core/src/compiler/modelica/linter.ts`:

```typescript
ModelicaLinter.register(ModelicaErrorCode.RULE_NAME, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    // Guard: only apply to relevant class kinds
    if (node.classKind !== ModelicaClassKind.FUNCTION) return;

    // Detection logic...

    diagnosticsCallback(
      ModelicaErrorCode.RULE_NAME.severity,
      ModelicaErrorCode.RULE_NAME.code,
      ModelicaErrorCode.RULE_NAME.message(param),
      syntaxNode, // AST node for source location
    );
  },
});
```

### 3. Add a Test Case

Create a `.mo` file in the appropriate `testsuite/OpenModelica/flattening/` subdirectory.

- For **correct** tests (`// status: correct`): the `// Result:` block contains the expected flattened output.
- For **incorrect** tests (`// status: incorrect`): the `// Result:` block contains the expected diagnostic output in the format:
  ```
  // [relative/path/to/file.mo:startLine:startCol-endLine:endCol] Severity: [MXXXX] Message text.
  ```

### 4. Verify

```bash
npm run build --workspace=@modelscript/core   # Compile + lint
npm run test --workspace=@modelscript/core    # Run test suite
```

### Current Lint Rules

| Code  | Rule                             | Description                                     |
| ----- | -------------------------------- | ----------------------------------------------- |
| M1001 | `parser-error`                   | Syntax errors detected by tree-sitter           |
| M2001 | `unresolved-reference`           | Reference to undefined name                     |
| M3001 | `type-mismatch`                  | General type incompatibility                    |
| M3006 | `function-arg-type-mismatch`     | Function argument type mismatch                 |
| M3007 | `function-return-type-mismatch`  | Function return type mismatch                   |
| M3009 | `array-index-type-mismatch`      | Array index must be Integer or Boolean          |
| M4001 | `extends-cycle`                  | Circular extends chain                          |
| M4002 | `duplicate-modification`         | Same element modified twice                     |
| M4003 | `array-dimension-mismatch`       | Array shape mismatch                            |
| M4004 | `unbalanced-model`               | Equation/variable count mismatch                |
| M4007 | `function-public-variable`       | Non-input/output public variable in function    |
| M4008 | `array-subscript-count-mismatch` | Wrong number of array subscripts                |
| M4009 | `function-default-arg-cycle`     | Cyclic dependency in function default arguments |
| M5001 | `equation-type-mismatch`         | Type mismatch in equations                      |
| M5002 | `constrainedby-type-mismatch`    | Replaceable type constraint violation           |

## Test Runner

**IMPORTANT:** The testsuite runner for `@modelscript/core` is located at `packages/core/tests/testsuite-runner.ts` (NOT `src/test/`). It does **not** support `--filter`. Arguments are subdirectory names or `.mo` file paths relative to the `testsuite/` root.

**Run commands (from the monorepo root):**

```bash
# Run all tests
npm run test --workspace=@modelscript/core

# Run a specific subdirectory (e.g., all "types" tests)
cd packages/core && npx tsx tests/testsuite-runner.ts OpenModelica/flattening/modelica/types

# Run a single test file
cd packages/core && npx tsx tests/testsuite-runner.ts OpenModelica/flattening/modelica/types/IntegerToEnumeration.mo

# Update expected output to match actual output (rewrites // Result: blocks)
cd packages/core && npx tsx tests/testsuite-runner.ts --update OpenModelica/flattening/modelica/types/IntegerToEnumeration.mo
```

**Rules:**

1. **Never** use `--filter` — it does not exist and the argument will be interpreted as a path.
2. Arguments are relative to `packages/core/testsuite/`. Use `OpenModelica/flattening/modelica/<subdir>` for subdirectories.
3. Use `--update` to auto-rewrite the `// Result:` block in `.mo` files to match actual output.
4. Pipe through `timeout 60` to guard against hangs: `timeout 60 npx tsx tests/testsuite-runner.ts ...`

## Linter and Flattener Synchronization

**IMPORTANT:** The linter and the flattener must always be in sync. Do not move diagnostics or features from the linter to the flattener (or vice versa) simply to work around implementation difficulties.

**Rules:**

1. **Keep diagnostics where they belong:** If a diagnostic is implemented as a linter rule in ModelScript (analogous to OMC's frontend semantic checks), it must remain in the linter.
2. **Fix the root cause:** If the linter lacks context that the flattener has (e.g., proper state management or hierarchy traversal), fix the linter's implementation rather than moving the check to the flattener.

## Test Diagnostic Messages and Line Ranges

**IMPORTANT:** When a test fails because of a diagnostic mismatch, always fix the **code** to produce the same error message as OpenModelica. The `.mo` test expected output reflects the correct OMC behavior and should be treated as the source of truth for error messages.

**Rules:**

1. If a test fails because the **error message text** differs from the expected output, **update the error message in the ModelScript code** (e.g., in `errors.ts`, `flattener.ts`, or `linter.ts`) to match OpenModelica's format.
2. If a test fails only because of a **line/column range** mismatch in the diagnostic output, **update the `.mo` test file's expected `// Result:` block** to use the line ranges that ModelScript produces — only when it is difficult to make ModelScript produce the exact same ranges.

## Component Ordering in Tests

**IMPORTANT:** Do not reorder components (variables, protected declarations, etc.) in `.mo` test expected output to match ModelScript's current ordering. The expected output reflects the correct ordering from OpenModelica.

**Rules:**

1. If a test fails only because components appear in a different order, **fix the flattener/DAE printer** to emit components in the correct order, matching the test's expected output.
2. **Never** swap, reorder, or rearrange component declarations in test `// Result:` blocks to work around ordering bugs in the flattener.

## Git Commits

**IMPORTANT:** Never run the `git commit` command yourself. The user will handle committing the code.

When generating git commit messages (including via the "generate git commit" button), always use this format:

**Rules:**

1. **Never run `git commit`**. Always let the user run the commit command.
1. **Auto-generate commit messages.** After every successful fix or change, proactively generate a commit message without being asked.

1. **All lowercase** — no capitalization, no title case.
1. **No trailing period** — the message is a phrase, not a sentence.
1. **Comma-separated list of changes** — group related changes with commas.
1. **Start each item with a verb** — use `add`, `fix`, `refactor`, `remove`, `update`, `support`, `detect`, `preserve`, etc.
1. **Be terse but descriptive** — describe _what_ changed, not _why_.

**Examples:**

```
fix nested array toJSON serialization, refactor annotation clause merging
add partial function application support, fix array comprehension flattening
preserve scientific notation in real literals and add function type argument checking
fix 2D array equations, refactor built-in function dispatch to metadata-driven tables
```
