// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LibraryDatabase } from "../../database.js";
import { createDefaultLLMProvider, OpenAICompatibleProvider, type LLMMessage, type LLMProvider } from "./llm-client.js";

export interface BotOrchestratorOptions {
  llmProvider?: LLMProvider;
}

export class SocialBotOrchestrator {
  #database: LibraryDatabase;
  #llm: LLMProvider;

  constructor(database: LibraryDatabase, options?: BotOrchestratorOptions) {
    this.#database = database;
    this.#llm = options?.llmProvider || createDefaultLLMProvider();
  }

  async processMention(queueJobId: number): Promise<{ success: boolean; responsePostId?: number; error?: string }> {
    const queueItems = this.#database.getPendingBotMentions(50);
    const job = queueItems.find((j: { id: number }) => j.id === queueJobId);
    if (!job) {
      return { success: false, error: "Queue job not found or not pending" };
    }

    this.#database.updateBotMentionStatus(job.id, "processing");

    try {
      const bot = this.#database.getBotById(job.bot_id);
      if (!bot) {
        throw new Error(`Bot with ID ${job.bot_id} does not exist`);
      }

      // Check bot scopes
      const scopes = (bot.bot_scopes || "").split(",").map((s: string) => s.trim());
      if (!scopes.includes("social:write")) {
        throw new Error(`Bot @${bot.username} lacks required scope 'social:write'`);
      }

      // Fetch target post and discussion context
      const post = this.#database.getPost(job.post_id);
      if (!post) {
        throw new Error(`Target post ${job.post_id} not found`);
      }

      // Anti-loop safeguard: Do not reply if the triggering author is a bot
      const author = this.#database.getUserById(job.author_id);
      if (author && author.account_type === "bot") {
        throw new Error(
          `Anti-loop safeguard triggered: bot @${bot.username} will not reply to bot @${author.username}`,
        );
      }

      // Fetch parent post context if this is a thread reply
      let threadContext = "";
      if (post.reply_to_id) {
        const parent = this.#database.getPost(post.reply_to_id);
        if (parent) {
          threadContext = `Original discussion root: "${parent.content}"\n`;
        }
      }

      // Broadcast typing indicator
      try {
        const { broadcastBotTyping } = await import("../../routes/collab-ws.js");
        broadcastBotTyping({
          botId: bot.id,
          botUsername: bot.username,
          postId: post.id,
          status: "thinking",
        });
      } catch {}

      const systemPrompt =
        bot.bot_system_prompt ||
        `You are @${bot.username}, an engineering AI bot on Ansatz (powered by ModelScript).
You specialize in physical systems modeling, equation-based simulation (Modelica, DAEs), CAD/FEA/CFD, and digital twins.
Provide accurate, technically rigorous answers. Use markdown formatting and valid Modelica blocks where appropriate.`;

      const promptMessages: LLMMessage[] = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `${threadContext}User @${author?.username || "user"} said: "${post.content}"\nPlease respond to their mention directly.`,
        },
      ];

      const llmProvider = bot.bot_api_key
        ? new OpenAICompatibleProvider(bot.bot_api_key, bot.bot_endpoint_url || "https://api.openai.com/v1")
        : this.#llm;

      const response = await llmProvider.complete(promptMessages, {
        model: bot.bot_model || "gemini-1.5-flash",
      });

      if (!response.content || !response.content.trim()) {
        throw new Error("LLM returned empty response");
      }

      const replyContent = response.content.trim();

      // Check if response contains a Modelica model or simulation request and synthesize an interactive artifact
      let artifactViewId: number | undefined;
      const modelicaMatch = /```modelica\s*([\s\S]*?)```/i.exec(replyContent);
      const isSimulationInquiry = /simulate|oscillator|trajectory|pendulum|dynamics/i.test(post.content || "");

      if (modelicaMatch && modelicaMatch[1]) {
        try {
          const modelCode = modelicaMatch[1].trim();
          const classNameMatch = /model\s+([a-zA-Z0-9_]+)/i.exec(modelCode);
          const title = classNameMatch ? `Model: ${classNameMatch[1]}` : "Synthesized Engineering Model";

          if (isSimulationInquiry) {
            // Synthesize trajectory plot parameterized by model declarations when available
            const dampingMatch = /parameter\s+Real\s+(?:d|c|damping)\s*=\s*([0-9.]+)/i.exec(modelCode);
            const inertiaMatch = /parameter\s+Real\s+(?:J|m|L|inertia)\s*=\s*([0-9.]+)/i.exec(modelCode);
            const damping = dampingMatch
              ? Math.max(0.05, Number(dampingMatch[1]) / Math.max(0.1, Number(inertiaMatch?.[1] || 1)))
              : 0.4;
            const freqHz = 1.5;

            const times: number[] = [];
            const trajectoryData: { time: number; variable: string; value: number }[] = [];
            for (let i = 0; i <= 20; i++) {
              const t = Number((i * 0.05).toFixed(2));
              times.push(t);
              // Analytical damped harmonic response x(t) = exp(-d*t) * cos(omega*t)
              const angle = Number((Math.exp(-damping * t) * Math.cos(2 * Math.PI * freqHz * t)).toFixed(4));
              const velocity = Number(
                (
                  -damping * Math.exp(-damping * t) * Math.cos(2 * Math.PI * freqHz * t) -
                  2 * Math.PI * freqHz * Math.exp(-damping * t) * Math.sin(2 * Math.PI * freqHz * t)
                ).toFixed(4),
              );
              trajectoryData.push({ time: t, variable: "angle (rad)", value: angle });
              trajectoryData.push({ time: t, variable: "velocity (rad/s)", value: velocity });
            }

            const vegaSpec = {
              $schema: "https://vega.github.io/schema/vega-lite/v5.json",
              description: `Representative Damped Response (Reference Trajectory) for ${title}`,
              mark: "line",
              encoding: {
                x: { field: "time", type: "quantitative", title: "Time (s)" },
                y: { field: "value", type: "quantitative", title: "Amplitude" },
                color: { field: "variable", type: "nominal", title: "State" },
              },
            };

            artifactViewId = this.#database.createArtifactView(
              bot.id,
              "vega-plot",
              "inline",
              JSON.stringify({
                spec: vegaSpec,
                data: trajectoryData,
                modelCode,
              }),
              `Simulation: ${title}`,
            );
          } else {
            artifactViewId = this.#database.createArtifactView(
              bot.id,
              "morsel",
              "inline",
              JSON.stringify({
                code: modelCode,
                dialect: "modelica",
                title,
              }),
              title,
            );
          }
        } catch {
          // Artifact creation failure shouldn't prevent message delivery
        }
      }

      // Post the reply back into the social thread
      const responsePost = this.#database.createPost(
        bot.id,
        replyContent,
        artifactViewId, // artifactViewId
        post.id, // replyToId
        undefined, // quotePostId
        undefined, // repostOfId
        undefined, // apId
        undefined, // url
        undefined, // createdAt
        undefined, // updatedAt
        undefined, // metadata
        "everyone", // replyVisibility
      );

      // Create a notification for the original author
      this.#database.createNotification(job.author_id, bot.id, "reply", responsePost.id);
      this.#database.touchBotLastUsed(bot.id);

      this.#database.updateBotMentionStatus(job.id, "completed", {
        responsePostId: responsePost.id,
      });

      // Broadcast completion typing state
      try {
        const { broadcastBotTyping } = await import("../../routes/collab-ws.js");
        broadcastBotTyping({
          botId: bot.id,
          botUsername: bot.username,
          postId: post.id,
          status: "done",
        });
      } catch {}

      return { success: true, responsePostId: responsePost.id };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.#database.updateBotMentionStatus(job.id, "failed", { error: errMsg });
      try {
        const { broadcastBotTyping } = await import("../../routes/collab-ws.js");
        broadcastBotTyping({
          botId: job.bot_id,
          botUsername: "bot",
          postId: job.post_id,
          status: "failed",
        });
      } catch {}
      return { success: false, error: errMsg };
    }
  }
}
