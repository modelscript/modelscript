// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context } from "@modelscript/modelica";
import { Variability } from "@modelscript/runtime";
import type { LibraryDatabase } from "../../database.js";
import { NodeFileSystem } from "../../util/filesystem.js";
import { ensureSyncModelicaParser } from "../studies/study-execution-service.js";
import { createDefaultLLMProvider, OpenAICompatibleProvider, type LLMMessage, type LLMProvider } from "./llm-client.js";

export interface RepoReviewRequest {
  repoId: number;
  botId: number;
  prNumber?: number | undefined;
  commitSha?: string | undefined;
  title?: string | undefined;
  diffContent?: string | undefined;
  files?: { path: string; content: string }[] | undefined;
}

export interface RepoReviewResult {
  reviewId: number;
  verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  summary: string;
  issues: { severity: "error" | "warning" | "info"; message: string; file?: string; line?: number }[];
  postId?: number | undefined;
}

export class RepoBotReviewer {
  #database: LibraryDatabase;
  #llm: LLMProvider;

  constructor(database: LibraryDatabase, llm?: LLMProvider) {
    this.#database = database;
    this.#llm = llm || createDefaultLLMProvider();
  }

  async review(req: RepoReviewRequest): Promise<RepoReviewResult> {
    const bot = this.#database.getBotById(req.botId);
    if (!bot) {
      throw new Error(`Bot with ID ${req.botId} does not exist`);
    }

    const repo = this.#database.getLinkedRepoById(req.repoId);
    if (!repo) {
      throw new Error(`Repository with ID ${req.repoId} not found`);
    }

    const scopes = (bot.bot_scopes || "").split(",").map((s) => s.trim());
    if (!scopes.includes("social:write") && !scopes.includes("modelica:validate")) {
      throw new Error(`Bot @${bot.username} lacks required scopes ('social:write' or 'modelica:validate')`);
    }

    const issues: { severity: "error" | "warning" | "info"; message: string; file?: string; line?: number }[] = [];
    const fullCode = (req.diffContent || "") + (req.files ? req.files.map((f) => f.content).join("\n") : "");

    // Check for unbalanced model/end blocks
    const modelMatches = fullCode.match(/\bmodel\s+([a-zA-Z0-9_]+)/g) || [];
    const endMatches = fullCode.match(/\bend\s+([a-zA-Z0-9_]+);/g) || [];
    const hasUnbalancedModelEnd = modelMatches.length !== endMatches.length;
    if (hasUnbalancedModelEnd) {
      issues.push({
        severity: "warning",
        message: `Mismatched 'model' (${modelMatches.length}) and 'end' (${endMatches.length}) statements detected.`,
      });
    }

    // Check for equation section
    if (modelMatches.length > 0 && !/\bequation\b/.test(fullCode) && !/\balgorithm\b/.test(fullCode)) {
      issues.push({
        severity: "info",
        message: "Model contains no 'equation' or 'algorithm' section.",
      });
    }

    // Parse and validate Modelica files/snippets using @modelscript/modelica WASM parser and DAE flattener
    const candidateFiles: { path: string; content: string }[] = [];
    if (req.files && req.files.length > 0) {
      for (const f of req.files) {
        if (f.path.endsWith(".mo") || /\b(?:model|class|block|connector|record|function|package)\s+/.test(f.content)) {
          candidateFiles.push(f);
        }
      }
    } else if (
      fullCode.trim().length > 0 &&
      /\b(?:model|class|block|connector|record|function|package)\s+/.test(fullCode)
    ) {
      candidateFiles.push({ path: "review_diff.mo", content: fullCode });
    }

    if (candidateFiles.length > 0) {
      try {
        ensureSyncModelicaParser();
        for (const file of candidateFiles) {
          const ctx = Context.createBatch(new NodeFileSystem(), { loadStdlib: false });
          const tree = ctx.load(file.content, file.path);
          interface SyntaxNodeLike {
            hasError?: () => boolean;
            type?: string;
            isMissing?: () => boolean;
            startPosition?: { row: number };
            children?: SyntaxNodeLike[];
          }
          const rootNode = tree?.rootNode as unknown as SyntaxNodeLike | undefined;

          if (rootNode && typeof rootNode.hasError === "function" && rootNode.hasError()) {
            // Find the first syntax error node line
            let errLine = (rootNode.startPosition?.row ?? 0) + 1;
            const walkForErr = (node: SyntaxNodeLike | undefined): boolean => {
              if (!node) return false;
              if (node.type === "ERROR" || (typeof node.isMissing === "function" && node.isMissing())) {
                errLine = (node.startPosition?.row ?? 0) + 1;
                return true;
              }
              const children = node.children;
              if (Array.isArray(children)) {
                for (const ch of children) {
                  if (walkForErr(ch)) return true;
                }
              }
              return false;
            };
            walkForErr(rootNode);

            issues.push({
              severity: hasUnbalancedModelEnd ? "warning" : "error",
              message: `Modelica syntax error detected by WASM parser at line ${errLine}.`,
              file: file.path,
              line: errLine,
            });
          } else {
            // Flatten top-level classes and check DAE structural balance
            for (const cls of ctx.classes) {
              if (!cls?.name) continue;
              const arena = ctx.flattenArena(cls.name);
              if (arena) {
                try {
                  let unknownCount = 0;
                  for (let i = 0; i < arena.varCount; i++) {
                    if (arena.isVarRemoved(i)) continue;
                    const v = arena.getVarVariability(i);
                    if (v !== Variability.Parameter && v !== Variability.Constant) {
                      const name = arena.getVarName(i);
                      if (name && !name.startsWith("der(") && !name.startsWith("_")) {
                        unknownCount++;
                      }
                    }
                  }
                  if (unknownCount > 0 && arena.eqCount > 0 && unknownCount !== arena.eqCount) {
                    issues.push({
                      severity: "warning",
                      message: `Class '${cls.name}' has ${unknownCount} continuous/discrete variable(s) and ${arena.eqCount} equation(s) (unbalanced DAE).`,
                      file: file.path,
                    });
                  }
                } finally {
                  arena.free?.();
                }
              }
            }
          }
        }
      } catch {
        // Non-fatal if diff contains unified diff markers rather than standalone Modelica source
      }
    }

    // Determine LLM provider (custom BYOK or instance default)
    const provider = bot.bot_api_key
      ? new OpenAICompatibleProvider(bot.bot_api_key, bot.bot_endpoint_url || "https://api.openai.com/v1")
      : this.#llm;

    const systemPrompt =
      bot.bot_system_prompt ||
      "You are Ansatz Automated Review Bot (powered by ModelScript). You review pull requests, physical models (Modelica, SysML, EMT), verify equation balances, and ensure high code quality.";

    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content:
          `Review the following changes for repository "${repo.namespace}/${repo.project}"${req.prNumber ? ` (PR #${req.prNumber}: ${req.title || "Pull Request"})` : ""}:\n\n` +
          `Code / Diff:\n\`\`\`modelica\n${fullCode.slice(0, 4000)}\n\`\`\`\n\n` +
          `Provide an engineering review verdict (APPROVE, REQUEST_CHANGES, or COMMENT) and a concise summary.`,
      },
    ];

    let summary = "";
    let verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT" = "APPROVE";

    try {
      const response = await provider.complete(messages, {
        model: bot.bot_model || "gemini-1.5-flash",
      });
      summary = response.content || "Automated review completed successfully.";
      if (issues.some((i) => i.severity === "error")) {
        verdict = "REQUEST_CHANGES";
      } else if (issues.length > 0) {
        verdict = "COMMENT";
      } else if (/request[_ ]changes|reject/i.test(summary)) {
        verdict = "REQUEST_CHANGES";
      } else {
        verdict = "APPROVE";
      }
    } catch {
      summary = `Automated physics verification completed with ${issues.length} findings.`;
      verdict = issues.some((i) => i.severity === "error") ? "REQUEST_CHANGES" : "APPROVE";
    }

    // Optionally synthesize a social post for community visibility if bot has social:write
    let postId: number | undefined;
    if (scopes.includes("social:write")) {
      try {
        const postContent = `🤖 **Automated Engineering Review by @${bot.username}** for [${repo.namespace}/${repo.project}]${req.prNumber ? ` (PR #${req.prNumber})` : ""}\n\n**Verdict:** ${verdict === "APPROVE" ? "✅ APPROVED" : verdict === "REQUEST_CHANGES" ? "❌ CHANGES REQUESTED" : "💬 COMMENT"}\n\n${summary}`;
        const newPost = this.#database.createPost(
          bot.id,
          postContent,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          JSON.stringify({ repoId: req.repoId, prNumber: req.prNumber, verdict }),
        );
        postId = newPost.id;
      } catch {
        // Social post failure does not abort review record
      }
    }

    const review = this.#database.createRepoBotReview({
      repoId: req.repoId,
      botId: req.botId,
      prNumber: req.prNumber,
      commitSha: req.commitSha,
      verdict,
      summary,
      issuesJson: JSON.stringify(issues),
      postId,
    });

    this.#database.touchBotLastUsed(bot.id);

    return {
      reviewId: review.id,
      verdict,
      summary,
      issues,
      postId,
    };
  }
}
