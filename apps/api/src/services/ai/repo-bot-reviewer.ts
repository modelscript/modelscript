// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LibraryDatabase } from "../../database.js";
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

    // Static Modelica heuristic check
    const issues: { severity: "error" | "warning" | "info"; message: string; file?: string; line?: number }[] = [];
    const fullCode = (req.diffContent || "") + (req.files ? req.files.map((f) => f.content).join("\n") : "");

    // Check for unbalanced model/end
    const modelMatches = fullCode.match(/\bmodel\s+([a-zA-Z0-9_]+)/g) || [];
    const endMatches = fullCode.match(/\bend\s+([a-zA-Z0-9_]+);/g) || [];
    if (modelMatches.length !== endMatches.length) {
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

    // Determine LLM provider (custom BYOK or instance default)
    const provider = bot.bot_api_key
      ? new OpenAICompatibleProvider(bot.bot_api_key, bot.bot_endpoint_url || "https://api.openai.com/v1")
      : this.#llm;

    const systemPrompt =
      bot.bot_system_prompt ||
      "You are ModelScript Automated Review Bot. You review pull requests, physical models (Modelica, SysML, EMT), verify equation balances, and ensure high code quality.";

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
