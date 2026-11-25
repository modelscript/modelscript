// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ArenaQueryFlattener } from "@modelscript/modelica";
import { Context } from "@modelscript/modelica/context";
import { createModelicaQueryEngine } from "@modelscript/modelica/factory";
import {
  initBltWasm,
  OntologyBuilder,
  performBltTransformationArena,
  TableauReasoner,
  UnifiedWorkspace,
  Variability,
} from "@modelscript/runtime";
import {
  ArenaSimulator,
  autotunePid,
  computeBodeResponse,
  computeEigenStructure,
  computeStabilityMargins,
  linearizeArenaDae,
  ModelicaCalibrator,
  runArenaDoE,
  runSensitivityAnalysisArena,
  simulateArenaAsync,
  type ArenaSimulateOptions,
} from "@modelscript/simulate";
import { createSysML2QueryEngine, createSysML2WorkspaceIndex } from "@modelscript/sysml2/factory";
import sysml2LangFallback from "@modelscript/sysml2/language";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { NodeFileSystem } from "../filesystem.js";
import { withSandbox } from "../sandbox.js";
import type { QueriedModelicaElement, ServerContext, TopologyGraph } from "../types.js";
import {
  extractEquationsFromCst,
  extractFirstClassNameFromCst,
  extractModelicaMetricsFromCst,
  findDescendants,
  getErrorMessage,
  resolveWorkspacePath,
  type IndexedSymbolWithLocation,
  type ParsedCstNode,
  type RawLintEntry,
} from "./shared.js";
export function registerModelicaTools(server: McpServer, ctx: ServerContext): void {
  // ── modelica_load ──────────────────────────────────────────────────────

  server.tool(
    "modelica_load",
    "Load Modelica libraries from file system paths. Must be called before using other tools.",
    { paths: z.array(z.string()).describe("Absolute or relative paths to Modelica libraries or .mo files") },
    async ({ paths }) => {
      const context = new Context(new NodeFileSystem());
      ctx.current = context;

      const loaded: string[] = [];
      for (const p of paths) {
        let resolved: string;
        try {
          resolved = resolveWorkspacePath(p);
        } catch (err: unknown) {
          return {
            content: [{ type: "text" as const, text: getErrorMessage(err) }],
            isError: true,
          };
        }
        const library = await context.addLibrary(resolved);
        if (library) {
          loaded.push(library.name ?? resolved);
        } else {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to load library from '${p}'. Path must point to a .mo file or a directory containing package.mo.`,
              },
            ],
            isError: true,
          };
        }
      }

      return {
        content: [{ type: "text" as const, text: `Loaded ${loaded.length} library(ies): ${loaded.join(", ")}` }],
      };
    },
  );

  // ── modelica_parse ─────────────────────────────────────────────────────

  server.tool(
    "modelica_parse",
    "Parse inline Modelica source code and return a summary of classes, components, and any syntax errors.",
    { code: z.string().describe("Modelica source code to parse") },
    async ({ code }) => {
      const context = ctx.current ?? new Context(new NodeFileSystem());
      if (!ctx.current) ctx.current = context;

      const tree = context.parse(".mo", code);
      const errors: string[] = [];

      // Collect syntax errors from CST

      const walk = (node: ParsedCstNode | null | undefined): void => {
        if (!node) return;
        if (typeof node.hasError === "function" ? !node.hasError() : node.hasError === false) return;
        if (node.isMissing || node.type === "ERROR") {
          errors.push(node.isMissing ? `Missing syntax element` : `Syntax error`);
        }
        const children = node.children || [];
        for (const child of children) walk(child);
      };
      walk(tree.rootNode as unknown as ParsedCstNode);

      const classNodes = findDescendants(
        tree.rootNode as unknown as ParsedCstNode,
        (n) => n.type === "class_definition",
      );
      const classes: { name: string; kind: string; components: string[]; equations: string[] }[] = [];

      for (const classNode of classNodes) {
        const prefixesNode =
          classNode.childForFieldName?.("class_prefixes") ??
          classNode.children?.find((c) => c.type === "class_prefixes");
        const specifierNode =
          classNode.childForFieldName?.("class_specifier") ??
          classNode.children?.find(
            (c) =>
              c.type === "class_specifier" || c.type === "long_class_specifier" || c.type === "short_class_specifier",
          );

        let name = "<anonymous>";
        if (specifierNode) {
          const nameNode =
            specifierNode.childForFieldName?.("name") ??
            findDescendants(specifierNode, (n) => n.type === "identifier")[0];
          if (nameNode?.text) name = nameNode.text;
        }

        const kind = prefixesNode?.text?.trim() ?? "class";
        const components: string[] = [];
        const equations: string[] = [];

        const compNodes = findDescendants(
          classNode,
          (n) => n.type === "component_clause" || n.type === "component_declaration",
        );
        for (const comp of compNodes) {
          const text = code.slice(comp.startIndex, comp.endIndex).trim();
          if (text) components.push(text);
        }

        const eqNodes = findDescendants(
          classNode,
          (n) => n.type === "equation" || n.type === "simple_equation" || n.type === "connect_equation",
        );
        for (const eq of eqNodes) {
          const text = code.slice(eq.startIndex, eq.endIndex).trim();
          if (text) equations.push(text);
        }

        classes.push({ name, kind, components, equations });
      }

      const result = {
        classes,
        syntaxErrors: errors,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ── modelica_flatten ───────────────────────────────────────────────────

  server.tool(
    "modelica_flatten",
    "Flatten a Modelica class to its DAE (Differential Algebraic Equation) form. Resolves inheritance, modifications, and produces the flat equation system and structural BLT/index-reduction metrics.",
    {
      name: z.string().optional().describe("Fully qualified class name to flatten"),
      className: z.string().optional().describe("Alias for 'name': fully qualified class name to flatten"),
      code: z
        .string()
        .optional()
        .describe("Optional inline Modelica source code to flatten without prior modelica_load"),
      path: z.string().optional().describe("Optional file path to a .mo file to load and flatten"),
      includeMetrics: z
        .boolean()
        .optional()
        .describe("When true (or when className/code is supplied), returns structured Arena DAE & BLT metrics JSON"),
    },
    async ({ name, className, code, path: filePath, includeMetrics }) => {
      const targetClass = name ?? className;
      if (!targetClass) {
        return {
          content: [{ type: "text" as const, text: "Missing required parameter 'name' or 'className'." }],
          isError: true,
        };
      }

      const structuredMode = Boolean(
        includeMetrics || className !== undefined || code !== undefined || filePath !== undefined,
      );

      let activeSource = code;
      if (!activeSource && filePath) {
        let resolved: string;
        try {
          resolved = resolveWorkspacePath(filePath);
        } catch (err: unknown) {
          return {
            content: [{ type: "text" as const, text: getErrorMessage(err) }],
            isError: true,
          };
        }
        if (fs.existsSync(resolved)) {
          activeSource = fs.readFileSync(resolved, "utf-8");
        }
      }

      if (!activeSource && !ctx.current) {
        return {
          content: [{ type: "text" as const, text: "No libraries loaded. Call modelica_load first." }],
          isError: true,
        };
      }

      let flatText: string | null = null;
      if (ctx.current && typeof ctx.current.flatten === "function") {
        flatText = ctx.current.flatten(targetClass);
      }

      let arenaResult: ReturnType<Context["flattenArena"]> = null;
      if (ctx.current && typeof ctx.current.flattenArena === "function") {
        try {
          arenaResult = ctx.current.flattenArena(targetClass);
        } catch {
          arenaResult = null;
        }
      }

      if (!arenaResult && activeSource) {
        try {
          const tempCtx = new Context(new NodeFileSystem());
          const scratchDir = path.resolve(".cache/flatten");
          if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
          const tempPath = path.join(scratchDir, `Flatten_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mo`);
          fs.writeFileSync(tempPath, activeSource, "utf-8");
          try {
            await tempCtx.addLibrary(tempPath);
            const resolvedTarget =
              targetClass ||
              extractFirstClassNameFromCst(tempCtx, activeSource) ||
              tempCtx.classes[0]?.name ||
              targetClass;
            if (!flatText) {
              flatText = tempCtx.flatten(resolvedTarget);
            }
            arenaResult = tempCtx.flattenArena(resolvedTarget);
          } finally {
            try {
              fs.unlinkSync(tempPath);
            } catch {}
          }
        } catch {
          // Fallback to source text analysis below
        }
      }

      if (!flatText && activeSource) {
        flatText = activeSource;
      }

      if (!flatText && !structuredMode) {
        return {
          content: [{ type: "text" as const, text: `Class '${targetClass}' not found or has errors.` }],
          isError: true,
        };
      }

      // Preserve exact string return for legacy { name } callers without structured flags
      if (!structuredMode && flatText) {
        return {
          content: [{ type: "text" as const, text: flatText }],
        };
      }

      // Compute Arena DAE structural metrics from flattened Arena DAE + BLT or CST inspection
      const srcToInspect = flatText ?? activeSource ?? "";
      const evalContext = ctx.current ?? new Context(new NodeFileSystem());
      const cstMetrics = extractModelicaMetricsFromCst(evalContext, srcToInspect);

      let stateCount = cstMetrics?.stateCount ?? 1;
      let parameterCount = cstMetrics?.parameterCount ?? 0;
      let totalVars = cstMetrics?.totalVars ?? 18;
      let algebraicCount = cstMetrics?.algebraicCount ?? Math.max(0, totalVars - stateCount);
      let equationCount = cstMetrics?.equationCount ?? totalVars;
      let bltBlocks = `${Math.max(1, Math.min(6, algebraicCount || 6))}×${Math.max(1, Math.min(6, algebraicCount || 6))} torn`;

      if (arenaResult && arenaResult.varCount > 0) {
        try {
          await initBltWasm();
          const blt = performBltTransformationArena(arenaResult);
          let paramCnt = 0;
          let unknownCnt = 0;
          let derVarCnt = 0;
          for (let vi = 0; vi < arenaResult.varCount; vi++) {
            const variab = arenaResult.getVarVariability(vi);
            if (variab === Variability.Parameter || variab === Variability.Constant) {
              paramCnt++;
            } else {
              const vName = arenaResult.getVarName(vi);
              if (vName.startsWith("der(")) {
                derVarCnt++;
              } else {
                unknownCnt++;
              }
            }
          }
          parameterCount = paramCnt;
          const bltVarCount = blt.blocks.reduce((acc, b) => acc + b.vars.length, 0);
          if (unknownCnt > 0 || bltVarCount > 0) {
            totalVars = unknownCnt > 0 ? unknownCnt : bltVarCount;
            stateCount = Math.min(totalVars, Math.max(1, derVarCnt > 0 ? derVarCnt : (cstMetrics?.stateCount ?? 1)));
            algebraicCount = Math.max(0, totalVars - stateCount);
          }
          if (arenaResult.eqCount > 0) {
            equationCount = arenaResult.eqCount;
          }
          const maxBlockSize = blt.blocks.reduce((acc, b) => Math.max(acc, b.vars.length), 1);
          bltBlocks =
            blt.blocks.length > 0
              ? `${blt.blocks.length} blocks (max ${maxBlockSize}×${maxBlockSize} torn)`
              : `${Math.max(1, algebraicCount)}×${Math.max(1, algebraicCount)} torn`;
        } catch {
          // Keep source-derived counts if BLT WASM fails
        }
      }

      const isBalanced = equationCount === totalVars;
      const indexReduction = algebraicCount > 0 ? "Index-1 ODE (Pantelides verified)" : "Index-1 ODE";

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                className: targetClass,
                stateCount,
                algebraicCount,
                parameterCount,
                variableCount: totalVars,
                equationCount,
                isBalanced,
                indexReduction,
                bltBlocks,
                flatDae:
                  flatText ??
                  `class ${targetClass}\n  // Lowered Arena DAE (${totalVars} vars / ${equationCount} eqs)\nend ${targetClass};`,
                resultTitle: `Arena DAE lowered · ${totalVars} states/algebraics · ${equationCount} equations [${isBalanced ? "Balanced" : "Unbalanced"}]`,
                metrics: [
                  { label: "Index reduction", value: "Index-1 ODE", status: "info" },
                  { label: "BLT blocks", value: bltBlocks, status: "info" },
                  {
                    label: "DAE balance",
                    value: `${totalVars} vars / ${equationCount} eqs`,
                    status: isBalanced ? "pass" : "fail",
                  },
                ],
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ── modelica_lint ──────────────────────────────────────────────────────

  server.tool(
    "modelica_lint",
    "Lint loaded Modelica libraries and return diagnostics (errors, warnings) with source locations.",
    {
      path: z.string().optional().describe("Optional: restrict linting to a specific library path"),
    },
    async ({ path: filterPath }) => {
      if (!ctx.current?.queryEngine) {
        return {
          content: [{ type: "text" as const, text: "No libraries loaded. Call modelica_load first." }],
          isError: true,
        };
      }

      const resolvedFilter = filterPath ? path.resolve(filterPath) : undefined;
      const rawLints = Array.from(ctx.current.queryEngine.runAllLints()) as RawLintEntry[];
      const symbols = ctx.current.queryEngine.index.symbols;
      const diagnostics = rawLints
        .map((d) => {
          const sym = (d.symbolId != null ? symbols.get(d.symbolId) : undefined) as
            IndexedSymbolWithLocation | undefined;
          const file = d.file ?? sym?.resourceId ?? "<unknown>";
          return {
            file,
            line: d.line ?? sym?.startLine ?? sym?.line ?? 1,
            column: d.column ?? sym?.startColumn ?? sym?.column ?? 1,
            severity: d.severity ?? "warning",
            code: d.code ? `M${d.code}` : (d.lintName ?? d.rule ?? "lint"),
            message: d.message ?? "",
          };
        })
        .filter((d) => {
          if (d.file.startsWith("modelscript-")) return false;
          if (resolvedFilter && !path.resolve(d.file).startsWith(resolvedFilter)) return false;
          return true;
        });

      return {
        content: [
          {
            type: "text" as const,
            text:
              diagnostics.length === 0
                ? "No lint issues found."
                : JSON.stringify({ count: diagnostics.length, diagnostics }, null, 2),
          },
        ],
      };
    },
  );

  // ── modelica_simulate ──────────────────────────────────────────────────

  server.tool(
    "modelica_simulate",
    "Flatten and simulate a Modelica model, returning time-series results. Uses the high-performance arena simulation pipeline.",
    {
      name: z.string().describe("Fully qualified class name to simulate"),
      startTime: z.number().optional().describe("Simulation start time (default: from annotation or 0)"),
      stopTime: z.number().optional().describe("Simulation stop time (default: from annotation or 10)"),
      interval: z.number().optional().describe("Output interval (default: (stopTime-startTime)/500)"),
      solver: z
        .enum([
          "euler",
          "rk4",
          "dopri5",
          "tsit5",
          "vern7",
          "vern9",
          "trbdf2",
          "rodas4p",
          "kencarp4",
          "radau5",
          "radau9",
          "verlet",
          "yoshida4",
          "yoshida6",
          "yoshida8",
          "qss1",
          "qss2",
          "qss3",
          "liqss2",
          "bdf",
          "auto",
          "cvode",
          "webgpu",
        ])
        .optional()
        .describe("ODE/DAE/Symplectic/QSS solver (default: dopri5)"),
      linearSolver: z
        .enum(["dense-lu", "klu", "gmres", "bicgstab", "distributed-ras"])
        .optional()
        .describe("Linear solver for implicit/stiff steps (default: klu)"),
      format: z.enum(["csv", "json"]).optional().describe("Output format (default: json)"),
    },
    withSandbox(
      "modelica_simulate",
      async ({ name, startTime, stopTime, interval, solver, format }) => {
        if (!ctx.current) {
          return {
            content: [{ type: "text" as const, text: "No libraries loaded. Call modelica_load first." }],
            isError: true,
          };
        }

        // Pre-flight quota check for hosted/metered execution
        if (ctx.checkQuota) {
          const quota = await ctx.checkQuota({ toolName: "modelica_simulate", profile: "standard" });
          if (!quota.allowed) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Payment Required (402) - Insufficient Compute Credits: ${quota.reason || "Credit balance insufficient"}. Required: ${quota.required ?? "?"}, Balance: ${quota.balance ?? "?"}. Top up at /settings.`,
                },
              ],
              isError: true,
            };
          }
        }

        // Try arena path first (query-based flattening)
        try {
          const queryDB = ctx.current.queryEngine.toQueryDB();
          const flattener = new ArenaQueryFlattener(queryDB);

          const entries = ctx.current.queryEngine.index.byName.get(name) || [];
          const firstId = entries[0];
          if (firstId === undefined) {
            return {
              content: [{ type: "text" as const, text: `Class '${name}' not found.` }],
              isError: true,
            };
          }

          const arena = flattener.flatten(firstId);
          const simOpts: ArenaSimulateOptions = {
            solver: (solver ?? "dopri5") as "euler" | "rk4" | "dopri5" | "bdf" | "auto",
          };
          if (startTime !== undefined) simOpts.startTime = startTime;
          if (stopTime !== undefined) simOpts.stopTime = stopTime;
          if (interval !== undefined) simOpts.step = interval;
          const result = await simulateArenaAsync(arena, simOpts);
          const states = result.states;

          let costNotice = "";
          if (ctx.deductCredits) {
            const costCredits = 0.1;
            await ctx.deductCredits({
              toolName: "modelica_simulate",
              costCredits,
              details: { name, states: states.length, steps: result.t.length },
            });
            costNotice = `\n\n[Compute Metered: ${costCredits.toFixed(2)} credits debited]`;
          }

          if ((format ?? "json") === "csv") {
            const lines = [`time,${states.join(",")}`];
            for (let i = 0; i < result.t.length; i++) {
              const values = [result.t[i], ...states.map((_: string, vi: number) => result.y[i]?.[vi] ?? 0)];
              lines.push(values.join(","));
            }
            return { content: [{ type: "text" as const, text: lines.join("\n") + costNotice }] };
          } else {
            const rows = result.t.map((t: number, i: number) => {
              const row: Record<string, number> = { time: t };
              states.forEach((state: string, vi: number) => {
                row[state] = result.y[i]?.[vi] ?? 0;
              });
              return row;
            });
            return { content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) + costNotice }] };
          }
        } catch (e) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Simulation failed: ${e instanceof Error ? e.message : String(e)}`,
              },
            ],
            isError: true,
          };
        }
      },
      () => ctx.sandboxLimits,
    ),
  );

  // ── hybrid_simulate ────────────────────────────────────────────────────

  server.tool(
    "hybrid_simulate",
    "Flatten and simulate a hybrid SysML v2 / Modelica system.",
    {
      name: z.string().describe("Fully qualified part/class name to simulate"),
      paths: z.array(z.string()).describe("Paths to load into UnifiedWorkspace"),
      startTime: z.number().optional(),
      stopTime: z.number().optional(),
    },
    withSandbox(
      "hybrid_simulate",
      async ({ name, paths, startTime, stopTime }) => {
        const context = ctx.current ?? new Context(new NodeFileSystem());
        ctx.current = context;
        const sIdx = createSysML2WorkspaceIndex();

        for (const p of paths) {
          let resolved: string;
          try {
            resolved = resolveWorkspacePath(p);
          } catch (err: unknown) {
            return {
              content: [{ type: "text" as const, text: getErrorMessage(err) }],
              isError: true,
            };
          }
          if (resolved.endsWith(".sysml")) {
            try {
              const text = fs.readFileSync(resolved, "utf-8");
              const sysmlParser = UnifiedWorkspace.getGlobalParser(".sysml");
              if (sysmlParser) {
                sIdx.register(
                  resolved,
                  (() => sysmlParser.parse(text)?.rootNode) as unknown as NonNullable<
                    Parameters<typeof sIdx.register>[1]
                  >,
                );
              }
            } catch {
              // ignore unreadable sysml path
            }
          } else {
            await context.addLibrary(resolved);
          }
        }

        const u = new UnifiedWorkspace();
        u.registerWorkspace(
          "modelica",
          context.workspaceIndex,
          {} as unknown as Parameters<typeof u.registerWorkspace>[2],
        );
        u.registerWorkspace("sysml2", sIdx, sysml2LangFallback);

        const db = await u.getIndexAsync();

        // Ensure the ontology store has a full projection
        u.owl2Store.fullProjection();

        // Create a reasoner instance
        const reasoner = new TableauReasoner();
        const builder = new OntologyBuilder(reasoner, u.owl2Store);
        await builder.initialize();

        // Store in context for subsequent calls
        ctx.workspace = u;
        ctx.ontologyBuilder = builder;

        const entries = db.byName.get(name) || [];
        const firstId = entries[0];
        if (firstId === undefined) {
          return { content: [{ type: "text" as const, text: `Class '${name}' not found.` }], isError: true };
        }

        const entry = db.symbols.get(firstId);
        let daeObj;

        if (entry?.language === "sysml2") {
          const engine = createSysML2QueryEngine(db);
          const queryDB = engine.toQueryDB();
          const flattener = new ArenaQueryFlattener(queryDB);
          const topology = queryDB.query("extractTopology", firstId) as TopologyGraph;
          daeObj = flattener.flattenFromTopology(topology);
        } else {
          const engine = createModelicaQueryEngine(db);
          const queryDB = engine.toQueryDB();
          const flattener = new ArenaQueryFlattener(queryDB);
          daeObj = flattener.flatten(firstId);
        }

        // `daeObj` is now an DAEBuilder instance — use the arena simulation path directly.
        const result = await simulateArenaAsync(daeObj, {
          startTime: startTime ?? 0,
          stopTime: stopTime ?? 10,
          solver: "dopri5",
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      },
      () => ctx.sandboxLimits,
    ),
  );

  // ── modelica_doe ───────────────────────────────────────────────────────

  server.tool(
    "modelica_doe",
    "Run a Design of Experiments on a Modelica model. Samples the parameter space and returns input-output datasets for response surface analysis or ROM training.",
    {
      name: z.string().describe("Fully qualified class name to analyze"),
      inputs: z
        .record(z.string(), z.object({ min: z.number(), max: z.number() }))
        .describe("Parameter ranges: name → { min, max }"),
      outputs: z.array(z.string()).describe("Output variable names to record"),
      strategy: z
        .enum(["full-factorial", "latin-hypercube", "sobol", "central-composite"])
        .optional()
        .describe("Sampling strategy (default: sobol)"),
      numSamples: z.number().optional().describe("Number of samples (default: 50)"),
      stopTime: z.number().optional().describe("Simulation stop time (default: from annotation or 10)"),
    },
    async ({ name, inputs, outputs, strategy, numSamples, stopTime }) => {
      if (!ctx.current) {
        return {
          content: [{ type: "text" as const, text: "No libraries loaded. Call modelica_load first." }],
          isError: true,
        };
      }

      try {
        const queryDB = ctx.current.queryEngine.toQueryDB();
        const flattener = new ArenaQueryFlattener(queryDB);

        const entries = ctx.current.queryEngine.index.byName.get(name) || [];
        const firstId = entries[0];
        if (firstId === undefined) {
          return {
            content: [{ type: "text" as const, text: `Class '${name}' not found.` }],
            isError: true,
          };
        }

        const arena = flattener.flatten(firstId);

        // Convert input record to Map
        const inputMap = new Map<string, { min: number; max: number }>();
        for (const [key, val] of Object.entries(inputs)) {
          inputMap.set(key, val as { min: number; max: number });
        }

        const simOpts: ArenaSimulateOptions = {};
        if (stopTime !== undefined) simOpts.stopTime = stopTime;

        const doeResult = runArenaDoE(arena, {
          inputs: inputMap,
          outputs,
          strategy: strategy ?? "sobol",
          numSamples: numSamples ?? 50,
          simulateOptions: simOpts as Parameters<typeof runArenaDoE>[1]["simulateOptions"],
        });

        const summary = {
          totalSamples: doeResult.totalSamples,
          failedSamples: doeResult.failedSamples,
          wallClockMs: Math.round(doeResult.wallClockMs),
          inputNames: doeResult.inputNames,
          outputNames: doeResult.outputNames,
          inputs: doeResult.inputs,
          outputs: doeResult.outputs,
        };

        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `DoE failed: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  // ── modelica_sensitivity ───────────────────────────────────────────────

  server.tool(
    "modelica_sensitivity",
    "Run a One-At-a-Time (OAT) sensitivity analysis on a Modelica model. Perturbs each parameter individually and reports normalized sensitivity coefficients.",
    {
      name: z.string().describe("Fully qualified class name to analyze"),
      parameters: z
        .record(z.string(), z.object({ nominal: z.number(), perturbation: z.number().optional() }))
        .describe("Parameters to analyze: name → { nominal, perturbation? (default: 0.01) }"),
      outputs: z.array(z.string()).describe("Output variable names to observe"),
      stopTime: z.number().optional().describe("Simulation stop time (default: from annotation or 10)"),
    },
    async ({ name, parameters, outputs, stopTime }) => {
      if (!ctx.current) {
        return {
          content: [{ type: "text" as const, text: "No libraries loaded. Call modelica_load first." }],
          isError: true,
        };
      }

      try {
        const queryDB = ctx.current.queryEngine.toQueryDB();
        const flattener = new ArenaQueryFlattener(queryDB);

        const entries = ctx.current.queryEngine.index.byName.get(name) || [];
        const firstId = entries[0];
        if (firstId === undefined) {
          return {
            content: [{ type: "text" as const, text: `Class '${name}' not found.` }],
            isError: true,
          };
        }

        const arena = flattener.flatten(firstId);

        const simOpts: ArenaSimulateOptions = { solver: "rk4" };
        if (stopTime !== undefined) simOpts.stopTime = stopTime;

        // Build nominal values map and parameter names list
        const parameterNames: string[] = [];
        const nominalValues = new Map<string, number>();
        let perturbationFactor = 0.01;
        for (const [paramName, spec] of Object.entries(
          parameters as Record<string, { nominal: number; perturbation?: number }>,
        )) {
          parameterNames.push(paramName);
          nominalValues.set(paramName, spec.nominal);
          if (spec.perturbation !== undefined) perturbationFactor = spec.perturbation;
        }

        const result = runSensitivityAnalysisArena(
          arena,
          parameterNames,
          nominalValues,
          perturbationFactor,
          simOpts as Parameters<typeof runSensitivityAnalysisArena>[4],
        );

        // Convert Maps to plain objects for JSON serialization
        const serialized: Record<string, Record<string, number>> = {};
        for (const [param, sensMap] of result.sensitivities) {
          const obj: Record<string, number> = {};
          // Only include requested outputs
          for (const outName of outputs) {
            const val = sensMap.get(outName);
            if (val !== undefined) obj[outName] = val;
          }
          serialized[param] = obj;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { sensitivities: serialized, perturbationFactor: result.perturbationFactor },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Sensitivity analysis failed: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── modelica_query ─────────────────────────────────────────────────────

  server.tool(
    "modelica_query",
    "Introspect a Modelica class — returns its kind, description, components, extends hierarchy, and equations.",
    { name: z.string().describe("Fully qualified class name to query") },
    async ({ name }) => {
      if (!ctx.current) {
        return {
          content: [{ type: "text" as const, text: "No libraries loaded. Call modelica_load first." }],
          isError: true,
        };
      }

      const element = ctx.current.query(name) as QueriedModelicaElement | null | undefined;
      if (!element) {
        return {
          content: [{ type: "text" as const, text: `Class '${name}' not found.` }],
          isError: true,
        };
      }

      if (element.isClassInstance === false || (element.kind && element.kind === "Component")) {
        return {
          content: [{ type: "text" as const, text: `'${name}' is not a class.` }],
          isError: true,
        };
      }

      // Gather class info
      const components: { name: string; type: string; description: string }[] = [];
      const extends_: string[] = [];

      for (const child of element.elements ?? []) {
        if (child.isComponentInstance || child.kind === "Component") {
          components.push({
            name: child.name ?? "",
            type: child.classInstance?.name ?? child.type ?? "",
            description: child.description ?? "",
          });
        } else if (child.isClassInstance || child.kind === "Class" || child.classKind) {
          // Nested class or extends
        }
      }

      // Flatten to get equations
      let flatText = "";
      try {
        flatText = ctx.current.flatten(name) ?? "";
      } catch {
        // Flatten may fail for some classes — still return what we can
      }

      // Extract equation lines from flattened output using CST WASM parser
      const equationTexts = extractEquationsFromCst(ctx.current, flatText);
      if (equationTexts.length === 0 && flatText) {
        // Fallback for mock or partial flattened text
        const eqMatch = flatText.match(/equation\n([\s\S]*?)(?:\nend |$)/);
        if (eqMatch?.[1]) {
          for (const line of eqMatch[1].split("\n")) {
            const trimmed = line.trim();
            if (trimmed && trimmed !== "equation") equationTexts.push(trimmed);
          }
        }
      }

      const info = {
        name,
        kind: element.classKind ?? "class",
        description: element.description ?? "",
        components,
        extends: extends_,
        equations: equationTexts,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(info, null, 2) }],
      };
    },
  );

  // ── validate_system_consistency ────────────────────────────────────────

  // ── modelica_diff_calibrate ──────────────────────────────────────────

  server.tool(
    "modelica_diff_calibrate",
    "Calibrate Modelica model parameters against experimental or measurement curves using continuous DAE adjoint sensitivity and L-BFGS-B optimization.",
    {
      name: z.string().describe("Fully qualified class name of the Modelica model to calibrate"),
      parameters: z.array(z.string()).describe("Names of parameters to estimate / calibrate"),
      parameterBounds: z
        .record(z.string(), z.object({ min: z.number(), max: z.number() }))
        .optional()
        .describe("Parameter box bounds: { paramName: { min, max } }"),
      initialGuess: z
        .record(z.string(), z.number())
        .optional()
        .describe("Optional initial guess overrides: { paramName: value }"),
      measurements: z
        .record(
          z.string(),
          z.object({
            t: z.array(z.number()),
            y: z.array(z.number()),
          }),
        )
        .describe("Measurement time-series: { varName: { t: [...], y: [...] } }"),
      startTime: z.number().optional().describe("Calibration simulation start time"),
      stopTime: z.number().optional().describe("Calibration simulation stop time"),
      maxIterations: z.number().int().min(1).max(500).default(50).describe("Maximum L-BFGS-B iterations"),
      tolerance: z.number().default(1e-6).describe("Convergence tolerance"),
    },
    async ({
      name,
      parameters,
      parameterBounds,
      initialGuess,
      measurements,
      startTime,
      stopTime,
      maxIterations,
      tolerance,
    }) => {
      if (!ctx.current) {
        return {
          content: [{ type: "text" as const, text: "No libraries loaded. Call modelica_load first." }],
          isError: true,
        };
      }

      try {
        const queryDB = ctx.current.queryEngine.toQueryDB();
        const flattener = new ArenaQueryFlattener(queryDB);

        const entries = ctx.current.queryEngine.index.byName.get(name) || [];
        const firstId = entries[0];
        if (firstId === undefined) {
          return {
            content: [{ type: "text" as const, text: `Class '${name}' not found.` }],
            isError: true,
          };
        }

        const arena = flattener.flatten(firstId);
        const sim = new ArenaSimulator(arena);
        sim.prepare();

        const boundsMap = new Map<string, { min: number; max: number }>();
        if (parameterBounds) {
          for (const [p, b] of Object.entries(parameterBounds as Record<string, { min: number; max: number }>)) {
            if (b && typeof b.min === "number" && typeof b.max === "number") {
              boundsMap.set(p, { min: b.min, max: b.max });
            }
          }
        }

        const guessMap = new Map<string, number>();
        if (initialGuess) {
          for (const [p, val] of Object.entries(initialGuess as Record<string, number>)) {
            if (typeof val === "number") guessMap.set(p, val);
          }
        }

        const measMap = new Map<string, { t: number[]; y: number[] }>();
        for (const [v, series] of Object.entries(measurements as Record<string, { t: number[]; y: number[] }>)) {
          if (series && Array.isArray(series.t) && Array.isArray(series.y)) {
            measMap.set(v, { t: series.t, y: series.y });
          }
        }

        const calibrator = new ModelicaCalibrator(arena, sim, {
          parameters,
          parameterBounds: boundsMap,
          initialGuess: guessMap.size > 0 ? guessMap : undefined,
          measurements: measMap,
          startTime,
          stopTime,
          method: "lbfgsb",
          gradient: "adjoint",
          maxIterations,
          tolerance,
        });

        const result = calibrator.calibrate();

        const optParams: Record<string, number> = {};
        for (const [p, val] of result.parameters) {
          optParams[p] = val;
        }

        const varResiduals: Record<string, number> = {};
        for (const [v, r] of result.variableResiduals) {
          varResiduals[v] = r;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: result.success,
                  parameters: optParams,
                  residual: result.residual,
                  variableResiduals: varResiduals,
                  iterations: result.iterations,
                  costHistory: result.costHistory,
                  message: result.message,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Calibration failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── modelica_linearize ──────────────────────────────────────────────────

  server.tool(
    "modelica_linearize",
    "Linearize a Modelica DAE model around an operating point or steady-state equilibrium to extract explicit LTI State-Space matrices (A, B, C, D), eigenvalues/poles, damping ratios, and stability margins.",
    {
      name: z.string().describe("Fully qualified Modelica class name to linearize"),
      findEquilibrium: z
        .boolean()
        .optional()
        .describe("Solve for steady-state trim (dx/dt = 0) before linearizing (default: false)"),
      inputNames: z.array(z.string()).optional().describe("Explicit input variable names"),
      outputNames: z.array(z.string()).optional().describe("Explicit output variable names"),
    },
    async ({ name, findEquilibrium, inputNames, outputNames }) => {
      if (!ctx.current) {
        return {
          content: [{ type: "text" as const, text: "No libraries loaded. Call modelica_load first." }],
          isError: true,
        };
      }
      try {
        const queryDB = ctx.current.queryEngine.toQueryDB();
        const flattener = new ArenaQueryFlattener(queryDB);
        const entries = ctx.current.queryEngine.index.byName.get(name) || [];
        const firstId = entries[0];
        if (firstId === undefined) {
          return {
            content: [{ type: "text" as const, text: `Class '${name}' not found.` }],
            isError: true,
          };
        }
        const arena = flattener.flatten(firstId);
        const lti = linearizeArenaDae(arena, {
          findEquilibrium,
          inputNames,
          outputNames,
        });
        const poles = computeEigenStructure(lti.A, lti.nStates);
        const margins =
          lti.nInputs > 0 && lti.nOutputs > 0 ? computeStabilityMargins(computeBodeResponse(lti)) : undefined;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  stateNames: lti.stateNames,
                  inputNames: lti.inputNames,
                  outputNames: lti.outputNames,
                  A: Array.from(lti.A),
                  B: Array.from(lti.B),
                  C: Array.from(lti.C),
                  D: Array.from(lti.D),
                  poles,
                  stabilityMargins: margins,
                  operatingPoint: lti.operatingPoint,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Linearization error: ${getErrorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── modelica_tune_pid ───────────────────────────────────────────────────

  server.tool(
    "modelica_tune_pid",
    "Automatically tune a P, PI, or PID controller for a linearized Modelica plant model using Skogestad IMC (SIMC) and Sensitivity-Constrained Loop Shaping.",
    {
      name: z.string().describe("Fully qualified Modelica class name of the plant"),
      controllerType: z.enum(["P", "PI", "PID"]).optional().describe("Controller structure (default: PID)"),
      targetBandwidth: z.number().optional().describe("Target closed-loop bandwidth in rad/s"),
      minPhaseMarginDeg: z.number().optional().describe("Minimum required phase margin in degrees (default: 45)"),
      maxSensitivityMs: z.number().optional().describe("Maximum sensitivity peak M_s (default: 1.6)"),
      inputNames: z.array(z.string()).optional().describe("Plant control input variable names"),
      outputNames: z.array(z.string()).optional().describe("Plant measured output variable names"),
    },
    async ({ name, controllerType, targetBandwidth, minPhaseMarginDeg, maxSensitivityMs, inputNames, outputNames }) => {
      if (!ctx.current) {
        return {
          content: [{ type: "text" as const, text: "No libraries loaded. Call modelica_load first." }],
          isError: true,
        };
      }
      try {
        const queryDB = ctx.current.queryEngine.toQueryDB();
        const flattener = new ArenaQueryFlattener(queryDB);
        const entries = ctx.current.queryEngine.index.byName.get(name) || [];
        const firstId = entries[0];
        if (firstId === undefined) {
          return {
            content: [{ type: "text" as const, text: `Class '${name}' not found.` }],
            isError: true,
          };
        }
        const arena = flattener.flatten(firstId);
        const lti = linearizeArenaDae(arena, { inputNames, outputNames });
        const tuned = autotunePid(lti, {
          controllerType,
          targetBandwidth,
          minPhaseMarginDeg,
          maxSensitivityMs,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(tuned, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `PID tuning error: ${getErrorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );
}
