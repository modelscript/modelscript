/* eslint-disable */
import * as fs from "fs";
import * as path from "path";
import { extractIndexerHooks, serializeIndexerConfig } from "./generators/indexer.js";
import { extractQueryHooks, serializeQueryHooks } from "./generators/queries.js";
import { extractRefHooks, serializeRefConfig } from "./generators/refs.js";
import { type RecoverySpec } from "./recovery.js";

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
    const type = ruleAST.type ? String(ruleAST.type).toLowerCase() : "";
    const children = ruleAST.children || ruleAST.args || [];
    const child = children.length > 0 ? children[0] : ruleAST.arg || ruleAST.rule;

    switch (type) {
      case "sym":
      case "symbol":
        return `$.${ruleAST.name || ruleAST.value}`;
      case "seq":
        return `seq(${children.map(serializeRule).join(", ")})`;
      case "choice":
        return `choice(${children.map(serializeRule).join(", ")})`;
      case "optional":
        return `optional(${serializeRule(child)})`;
      case "repeat":
        return `repeat(${serializeRule(child)})`;
      case "repeat1":
        return `repeat1(${serializeRule(child)})`;
      case "token":
        return `token(${serializeRule(child !== undefined ? child : ruleAST.value)})`;
      case "token_immediate":
        return `token.immediate(${serializeRule(child !== undefined ? child : ruleAST.value)})`;
      case "pattern":
        return ruleAST.value instanceof RegExp ? ruleAST.value.toString() : new RegExp(ruleAST.value).toString();
      case "string":
        return JSON.stringify(ruleAST.value);
      case "field":
        return `field(${JSON.stringify(ruleAST.name)}, ${serializeRule(child)})`;
      case "prec":
        return `prec(${ruleAST.precedence}, ${serializeRule(child)})`;
      case "prec_left":
        return `prec.left(${ruleAST.precedence}, ${serializeRule(child)})`;
      case "prec_right":
        return `prec.right(${ruleAST.precedence}, ${serializeRule(child)})`;
      case "prec_dynamic":
        return `prec.dynamic(${ruleAST.precedence}, ${serializeRule(child)})`;
      case "alias":
        return `alias(${serializeRule(child)}, ${serializeAliasValue(ruleAST.value)})`;
      case "blank":
        return `blank()`;
      case "semantic":
        return serializeRule(child);
      case "def":
      case "ref":
        return serializeRule(ruleAST.rule || child);
    }
  }
  throw new Error(`Unknown rule AST: ${JSON.stringify(ruleAST)}`);
}

function serializeAliasValue(value: any): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  // SymbolNode — reference to another rule
  if (value && (value.type === "sym" || value.type === "SYMBOL" || value.type === "symbol")) {
    return `$.${value.name || value.value}`;
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
    const type = node.type ? String(node.type).toLowerCase() : "";
    const children = node.children || node.args || [];
    const child = children.length > 0 ? children[0] : node.arg || node.rule;

    switch (type) {
      case "field": {
        const spec = fieldToSpec.get(node.name);
        if (spec) {
          // This is the target field — inject recovery into its repeat(choice(...))
          const injected = injectRecoveryIntoField(child, spec);
          return `field(${JSON.stringify(node.name)}, ${injected})`;
        }
        return `field(${JSON.stringify(node.name)}, ${serializeRuleRecoveryWalk(child, fieldToSpec)})`;
      }
      case "seq":
        return `seq(${children.map((a: any) => serializeRuleRecoveryWalk(a, fieldToSpec)).join(", ")})`;
      case "def":
      case "ref":
        return serializeRuleRecoveryWalk(node.rule || child, fieldToSpec);
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
  const type = node.type ? String(node.type).toLowerCase() : "";
  const children = node.children || node.args || [];
  const child = children.length > 0 ? children[0] : node.arg;

  if (type === "repeat" || type === "repeat1") {
    const inner = child;
    const repeatFn = type === "repeat" ? "repeat" : "repeat1";
    const innerType = inner && inner.type ? String(inner.type).toLowerCase() : "";
    const innerChildren = inner ? inner.children || inner.args || [] : [];

    if (inner && innerType === "choice") {
      // repeat(choice(A, B, C)) → repeat(choice(A, B, C, prec(-1, $._recovery_*)))
      const alts = innerChildren.map(serializeRule);
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

  const outputDir =
    path.basename(path.dirname(inputFile)) === "src" ? path.dirname(path.dirname(inputFile)) : path.dirname(inputFile);

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

  let graphicsContent = "export const graphicsConfig: Record<string, GraphicsConfig> = {};\n";
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

  let diffContent = "export const diffConfig: Record<string, DiffConfig> = {};\n";
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

  let i18nContent = "export const i18nConfig: Record<string, I18nConfig> = {};\n";
  const i18nSpecs = classSpecs.filter((s: any) => s.i18nConfig);
  if (i18nSpecs.length > 0) {
    const i18nLines: string[] = [];
    i18nLines.push(`export const i18nConfig: Record<string, I18nConfig> = {`);
    for (const spec of i18nSpecs) {
      let serializedJSON = JSON.stringify(spec.i18nConfig, null, 4);
      // Safely unquote the __FUNCTION__ blocks so they execute as lambdas
      serializedJSON = serializedJSON.replace(/"__FUNCTION__(.*?)__FUNCTION__"/g, (match, p1) => {
        return p1.replace(/\\n/g, "\n").replace(/\\"/g, '"');
      });
      const indentedJSON = serializedJSON
        .split("\n")
        .map((l: string, i: number) => (i === 0 ? l : `  ${l}`))
        .join("\n");
      i18nLines.push(`  ${JSON.stringify(spec.ruleName)}: ${indentedJSON},`);
    }
    i18nLines.push(`};`);
    i18nLines.push(``);
    i18nContent = i18nLines.join("\n");
  }

  const imports = ["IndexerHook", "RefHook", "GraphicsConfig", "DiffConfig", "I18nConfig"];

  const combinedConfigContent =
    `import type { ${imports.join(", ")} } from "@modelscript/compiler";\n\n` +
    indexerContent +
    "\n" +
    refContent +
    "\n" +
    graphicsContent +
    "\n" +
    diffContent +
    "\n" +
    i18nContent;

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
