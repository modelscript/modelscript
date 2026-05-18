/* eslint-disable */
import * as fs from "fs";
import * as path from "path";
import { extractIndexerHooks, serializeIndexerConfig } from "./generators/indexer.js";
import { extractQueryHooks, serializeQueryHooks } from "./generators/queries.js";
import { extractRefHooks, serializeRefConfig } from "./generators/refs.js";
import { generateScanner } from "./generators/scanner.js";
import { extractRecoverySpecs, type RecoverySpec } from "./recovery.js";

// ---------------------------------------------------------------------------
// Rule Serializer — Converts DSL AST nodes to Tree-Sitter grammar.js syntax
// ---------------------------------------------------------------------------

function serializeRule(ruleAST: any): string {
  if (typeof ruleAST === "string") {
    return JSON.stringify(ruleAST);
  }
  if (ruleAST instanceof RegExp) {
    return ruleAST.toString();
  }
  if (ruleAST && typeof ruleAST === "object") {
    switch (ruleAST.type) {
      case "sym":
        return `$.${ruleAST.name}`;
      case "seq":
        return `seq(${ruleAST.args.map(serializeRule).join(", ")})`;
      case "choice":
        return `choice(${ruleAST.args.map(serializeRule).join(", ")})`;
      case "optional":
        return `optional(${serializeRule(ruleAST.arg)})`;
      case "repeat":
        return `repeat(${serializeRule(ruleAST.arg)})`;
      case "repeat1":
        return `repeat1(${serializeRule(ruleAST.arg)})`;
      case "token":
        return `token(${serializeRule(ruleAST.arg)})`;
      case "token_immediate":
        return `token.immediate(${serializeRule(ruleAST.arg)})`;
      case "field":
        return `field(${JSON.stringify(ruleAST.name)}, ${serializeRule(ruleAST.arg)})`;
      case "prec":
        return `prec(${ruleAST.precedence}, ${serializeRule(ruleAST.arg)})`;
      case "prec_left":
        return `prec.left(${ruleAST.precedence}, ${serializeRule(ruleAST.arg)})`;
      case "prec_right":
        return `prec.right(${ruleAST.precedence}, ${serializeRule(ruleAST.arg)})`;
      case "prec_dynamic":
        return `prec.dynamic(${ruleAST.precedence}, ${serializeRule(ruleAST.arg)})`;
      case "alias":
        return `alias(${serializeRule(ruleAST.arg)}, ${serializeAliasValue(ruleAST.value)})`;
      case "blank":
        return `blank()`;
      case "def":
        // Strip the semantic layer — grammar.js only needs the syntax rule
        return serializeRule(ruleAST.rule);
      case "ref":
        // Strip the semantic layer — grammar.js only needs the syntax rule
        return serializeRule(ruleAST.rule);
    }
  }
  throw new Error(`Unknown rule AST: ${JSON.stringify(ruleAST)}`);
}

function serializeAliasValue(value: any): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  // SymbolNode — reference to another rule
  if (value && value.type === "sym") {
    return `$.${value.name}`;
  }
  throw new Error(`Unknown alias value: ${JSON.stringify(value)}`);
}

// ---------------------------------------------------------------------------
// Grammar Section Serializers
// ---------------------------------------------------------------------------

function serializeRuleArray(rules: any[]): string {
  return `[${rules.map(serializeRule).join(", ")}]`;
}

function serializeConflicts(conflictSets: any[][]): string {
  const inner = conflictSets.map((set) => serializeRuleArray(set)).join(", ");
  return `[${inner}]`;
}

// ---------------------------------------------------------------------------
// Recovery-aware Rule Serializer
// ---------------------------------------------------------------------------

/**
 * Serialize a rule AST with recovery blob injection.
 * For each RecoverySpec, finds the matching field(name, repeat(choice(...)))
 * and appends `prec(-1, $._recovery_*)` to the choice alternatives.
 */
function serializeRuleWithRecovery(ruleAST: any, specs: RecoverySpec[]): string {
  // Build a set of field names that need injection
  const fieldToSpec = new Map<string, RecoverySpec>();
  for (const s of specs) fieldToSpec.set(s.fieldName, s);

  return serializeRuleRecoveryWalk(ruleAST, fieldToSpec);
}

function serializeRuleRecoveryWalk(node: any, fieldToSpec: Map<string, RecoverySpec>): string {
  if (typeof node === "string") return JSON.stringify(node);
  if (node instanceof RegExp) return node.toString();

  if (node && typeof node === "object") {
    switch (node.type) {
      case "field": {
        const spec = fieldToSpec.get(node.name);
        if (spec) {
          // This is the target field — inject recovery into its repeat(choice(...))
          const injected = injectRecoveryIntoField(node.arg, spec);
          return `field(${JSON.stringify(node.name)}, ${injected})`;
        }
        return `field(${JSON.stringify(node.name)}, ${serializeRuleRecoveryWalk(node.arg, fieldToSpec)})`;
      }
      case "seq":
        return `seq(${node.args.map((a: any) => serializeRuleRecoveryWalk(a, fieldToSpec)).join(", ")})`;
      case "def":
        return serializeRuleRecoveryWalk(node.rule, fieldToSpec);
      case "ref":
        return serializeRuleRecoveryWalk(node.rule, fieldToSpec);
      default:
        // For all other node types, use the standard serializer
        return serializeRule(node);
    }
  }
  return serializeRule(node);
}

/**
 * Given the inner content of a field (e.g., repeat(choice(A, B, C))),
 * inject `prec(-1, $._recovery_*)` into the choice.
 */
function injectRecoveryIntoField(node: any, spec: RecoverySpec): string {
  if (!node || typeof node !== "object") return serializeRule(node);

  const recoveryToken = `prec(-1, $.${spec.externalTokenName})`;

  if (node.type === "repeat" || node.type === "repeat1") {
    const inner = node.arg;
    const repeatFn = node.type === "repeat" ? "repeat" : "repeat1";

    if (inner && inner.type === "choice") {
      // repeat(choice(A, B, C)) → repeat(choice(A, B, C, prec(-1, $._recovery_*)))
      const alts = inner.args.map(serializeRule);
      alts.push(recoveryToken);
      return `${repeatFn}(choice(${alts.join(", ")}))`;
    } else {
      // repeat(A) → repeat(choice(A, prec(-1, $._recovery_*)))
      return `${repeatFn}(choice(${serializeRule(inner)}, ${recoveryToken}))`;
    }
  }

  // Fallback: wrap in choice with recovery
  return `choice(${serializeRule(node)}, ${recoveryToken})`;
}

// ---------------------------------------------------------------------------
// CLI Entry Point
// ---------------------------------------------------------------------------

async function generate(fileArg: string) {
  const inputFile = path.resolve(fileArg);
  const mod = await import(`file://${inputFile}`);
  const langConfig = mod.default || mod;

  if (!langConfig || !langConfig.name) {
    console.error("Invalid configuration. Expected default export to include a 'name'.");
    process.exit(1);
  }

  const $ = new Proxy(
    {},
    {
      get(target, prop) {
        return { type: "sym", name: prop };
      },
    },
  );

  const outputDir = path.dirname(inputFile);

  // -------------------------------------------------------------------------
  // Recovery: infer sync tokens and inject into rule ASTs before serialization
  // -------------------------------------------------------------------------
  const recoverySpecs = extractRecoverySpecs(langConfig, $);
  if (recoverySpecs.length > 0) {
    console.log(`[recovery] Found ${recoverySpecs.length} recovery spec(s):`);
    for (const s of recoverySpecs) {
      console.log(
        `  ${s.ruleName}.${s.fieldName} → sync on "${s.syncToken}"${s.additionalSyncTokens.length > 0 ? ` + [${s.additionalSyncTokens.join(", ")}]` : ""}`,
      );
    }
  }

  // Build a map of ruleName → RecoverySpec[] for injection
  const recoveryByRule = new Map<string, RecoverySpec[]>();
  for (const s of recoverySpecs) {
    const arr = recoveryByRule.get(s.ruleName) || [];
    arr.push(s);
    recoveryByRule.set(s.ruleName, arr);
  }

  // -------------------------------------------------------------------------
  // Artifact A: grammar.js (Tree-Sitter parser)
  // -------------------------------------------------------------------------
  const grammarSections: string[] = [];
  grammarSections.push(`  name: '${langConfig.name}'`);

  // Extras
  if (langConfig.extras) {
    const extrasRules = langConfig.extras($);
    grammarSections.push(`\n  extras: $ => ${serializeRuleArray(extrasRules)}`);
  }

  // Conflicts
  if (langConfig.conflicts) {
    const conflictSets = langConfig.conflicts($);
    grammarSections.push(`\n  conflicts: $ => ${serializeConflicts(conflictSets)}`);
  }

  // Externals — merge user-defined + auto-generated recovery tokens
  const externalTokens: string[] = [];
  if (langConfig.externals) {
    const externalRules = langConfig.externals($);
    externalTokens.push(...externalRules.map(serializeRule));
  }
  for (const s of recoverySpecs) {
    externalTokens.push(`$.${s.externalTokenName}`);
  }
  if (externalTokens.length > 0) {
    grammarSections.push(`\n  externals: $ => [${externalTokens.join(", ")}]`);
  }

  // Inline
  if (langConfig.inline) {
    const inlineRules = langConfig.inline($);
    grammarSections.push(`\n  inline: $ => ${serializeRuleArray(inlineRules)}`);
  }

  // Supertypes
  if (langConfig.supertypes) {
    const supertypeRules = langConfig.supertypes($);
    grammarSections.push(`\n  supertypes: $ => ${serializeRuleArray(supertypeRules)}`);
  }

  // Word
  if (langConfig.word) {
    const wordRule = langConfig.word($);
    grammarSections.push(`\n  word: $ => ${serializeRule(wordRule)}`);
  }

  // Rules — with recovery injection
  let rulesContent = "";
  if (langConfig.rules) {
    for (const [ruleName, ruleFn] of Object.entries<any>(langConfig.rules)) {
      const ruleAST = ruleFn($);
      const specs = recoveryByRule.get(ruleName);
      if (specs && specs.length > 0) {
        // Serialize with recovery injection
        rulesContent += `    ${ruleName}: $ => ${serializeRuleWithRecovery(ruleAST, specs)},\n`;
      } else {
        rulesContent += `    ${ruleName}: $ => ${serializeRule(ruleAST)},\n`;
      }
    }

    // No extra grammar rules needed — recovery_error is an external scanner token
  } else {
    rulesContent = "    // empty rules\n";
  }

  grammarSections.push(`\n  rules: {\n${rulesContent.replace(/\n$/, "")}\n  }`);

  const grammarContent = `export default grammar({\n${grammarSections.join(",")}\n});\n`;

  const grammarFile = path.join(outputDir, "grammar.js");
  fs.writeFileSync(grammarFile, grammarContent, "utf-8");
  console.log(`Generated ${grammarFile}`);

  // -------------------------------------------------------------------------
  // Artifact B: config.ts (Symbol Indexer, Reference resolution, Graphics, Diff)
  // -------------------------------------------------------------------------
  const srcGenDir = path.join(outputDir, "src-gen");
  fs.mkdirSync(srcGenDir, { recursive: true });

  const indexerHooks = extractIndexerHooks(langConfig, $);
  const indexerContent = serializeIndexerConfig(indexerHooks).replace(
    /import type \{ IndexerHook \} from ".*";\n*/g,
    "",
  );

  const refHooks = extractRefHooks(langConfig, $);
  const refContent = serializeRefConfig(refHooks).replace(/import type \{ RefHook \} from ".*";\n*/g, "");

  const { extractClassSpecs, generateAstClasses } = await import("./generators/ast.js");
  const classSpecs = extractClassSpecs(langConfig, $);

  let graphicsContent = "";
  const graphicsSpecs = classSpecs.filter((s: any) => s.graphicsConfig);
  if (graphicsSpecs.length > 0) {
    const gfxLines: string[] = [];
    gfxLines.push(`export const graphicsConfig: Record<string, GraphicsConfig> = {`);
    for (const spec of graphicsSpecs) {
      gfxLines.push(
        `  ${JSON.stringify(spec.ruleName)}: ${JSON.stringify(spec.graphicsConfig, null, 4)
          .split("\\n")
          .map((l: string, i: number) => (i === 0 ? l : `  ${l}`))
          .join("\\n")},`,
      );
    }
    gfxLines.push(`};`);
    gfxLines.push(``);
    graphicsContent = gfxLines.join("\n");
  }

  let diffContent = "";
  const diffSpecs = classSpecs.filter((s: any) => s.diffConfig);
  if (diffSpecs.length > 0) {
    const diffLines: string[] = [];
    diffLines.push(`export const diffConfig: Record<string, DiffConfig> = {`);
    for (const spec of diffSpecs) {
      let serializedJSON = JSON.stringify(spec.diffConfig, null, 4);
      // Safely unquote the __FUNCTION__ blocks so they execute as lambdas
      serializedJSON = serializedJSON.replace(/"__FUNCTION__(.*?)__FUNCTION__"/g, (match, p1) => {
        return p1.replace(/\\\\n/g, "\\n").replace(/\\\\"/g, '"');
      });
      const indentedJSON = serializedJSON
        .split("\\n")
        .map((l: string, i: number) => (i === 0 ? l : `  ${l}`))
        .join("\\n");
      diffLines.push(`  ${JSON.stringify(spec.ruleName)}: ${indentedJSON},`);
    }
    diffLines.push(`};`);
    diffLines.push(``);
    diffContent = diffLines.join("\n");
  }

  const imports = ["IndexerHook", "RefHook"];
  if (graphicsSpecs.length > 0) imports.push("GraphicsConfig");
  if (diffSpecs.length > 0) imports.push("DiffConfig");

  const combinedConfigContent =
    `import type { ${imports.join(", ")} } from "@modelscript/compiler";\n\n` +
    indexerContent +
    "\n" +
    refContent +
    "\n" +
    graphicsContent +
    "\n" +
    diffContent;

  const configFile = path.join(srcGenDir, "config.ts");
  fs.writeFileSync(configFile, combinedConfigContent, "utf-8");
  console.log(`Generated ${configFile}`);

  // -------------------------------------------------------------------------
  // Artifact C: query-hooks.ts (Bound Query Engine hooks)
  // -------------------------------------------------------------------------
  const queryHooks = extractQueryHooks(langConfig, $);
  const queryContent = serializeQueryHooks(queryHooks, inputFile, srcGenDir);
  const queryFile = path.join(srcGenDir, "query-hooks.ts");
  fs.writeFileSync(queryFile, queryContent, "utf-8");
  console.log(`Generated ${queryFile}`);

  // -------------------------------------------------------------------------
  // Artifact D: ast.ts (Pull-Up AST classes, if ast configs exist)
  // -------------------------------------------------------------------------
  if (classSpecs.length > 0) {
    const astClassesContent = generateAstClasses(classSpecs, langConfig.name);
    const astFile = path.join(srcGenDir, "ast.ts");
    fs.writeFileSync(astFile, astClassesContent, "utf-8");
    console.log(`Generated ${astFile}`);
  }

  // -------------------------------------------------------------------------
  // Artifact F: src/scanner.c (auto-generated external scanner)
  // -------------------------------------------------------------------------
  if (recoverySpecs.length > 0) {
    const scannerContent = generateScanner(recoverySpecs, langConfig.name);
    const srcDir = path.join(outputDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    const scannerFile = path.join(srcDir, "scanner.c");
    fs.writeFileSync(scannerFile, scannerContent, "utf-8");
    console.log(`Generated ${scannerFile}`);
  }

  // -------------------------------------------------------------------------
  // Artifact G: queries/ (highlights.scm, indents.scm, folds.scm)
  // -------------------------------------------------------------------------
  const { generateHighlights, generateIndents, generateFolds } = await import("./generators/highlights.js");
  const queriesDir = path.join(outputDir, "queries");
  fs.mkdirSync(queriesDir, { recursive: true });

  const highlightsContent = generateHighlights(langConfig, $, outputDir);
  fs.writeFileSync(path.join(queriesDir, "highlights.scm"), highlightsContent, "utf-8");
  console.log(`Generated ${path.join(queriesDir, "highlights.scm")}`);

  const indentsContent = generateIndents(langConfig, $);
  fs.writeFileSync(path.join(queriesDir, "indents.scm"), indentsContent, "utf-8");
  console.log(`Generated ${path.join(queriesDir, "indents.scm")}`);

  const foldsContent = generateFolds(langConfig, $);
  fs.writeFileSync(path.join(queriesDir, "folds.scm"), foldsContent, "utf-8");
  console.log(`Generated ${path.join(queriesDir, "folds.scm")}`);
}

async function playground(fileArg: string) {
  const { startPlayground } = await import("./playground.js");
  const port = parseInt(process.argv[3] ?? "3377", 10);
  startPlayground({ languageFile: fileArg, port });
}

async function main() {
  const command = process.argv[2];

  if (command === "init") {
    const dir = process.argv[3];
    if (!dir) {
      console.error("Usage: tsx src/cli.ts init <directory> [--name <lang>]");
      process.exit(1);
    }
    const nameIdx = process.argv.indexOf("--name");
    const langName = nameIdx >= 0 ? process.argv[nameIdx + 1] : undefined;
    const { initProject } = await import("./init.js");
    initProject({ dir, langName });
  } else if (command === "playground") {
    const fileArg = process.argv[3];
    if (!fileArg) {
      console.error("Usage: tsx src/cli.ts playground <path-to-language.ts> [path-to-second-language.ts] [port]");
      process.exit(1);
    }
    // Parse remaining args: positional files and --port flag
    const remaining = process.argv.slice(4);
    let secondLangFile: string | undefined;
    let port: number | undefined;
    for (let i = 0; i < remaining.length; i++) {
      const arg = remaining[i];
      if (arg === "--port" && i + 1 < remaining.length) {
        port = parseInt(remaining[++i], 10);
      } else if (!arg.startsWith("-")) {
        const maybePort = parseInt(arg, 10);
        if (!isNaN(maybePort) && String(maybePort) === arg) {
          port = maybePort;
        } else {
          secondLangFile = arg;
        }
      }
    }
    const { startPlayground } = await import("./playground.js");
    await startPlayground({ languageFile: fileArg, secondLanguageFile: secondLangFile, port });
  } else if (command === "generate") {
    const fileArg = process.argv[3];
    if (!fileArg) {
      console.error("Usage: tsx src/cli.ts generate <path-to-language.ts>");
      process.exit(1);
    }
    await generate(fileArg);
  } else if (command) {
    // Legacy: treat first arg as path to language.ts
    await generate(command);
  } else {
    console.error("Usage:");
    console.error("  tsx src/cli.ts init <directory> [--name <lang>]    Scaffold a new language project");
    console.error("  tsx src/cli.ts generate <path-to-language.ts>      Generate artifacts");
    console.error("  tsx src/cli.ts playground <language.ts> [port]     Start playground");
    process.exit(1);
  }
}

main().catch(console.error);
