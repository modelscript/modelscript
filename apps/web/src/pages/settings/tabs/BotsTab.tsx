// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, ArrowLeftIcon, HubotIcon, TrashIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { createBot, deleteBot, getBots } from "../../../api";
import Box from "../../../components/Box";
import { CircleIconButton } from "../../../components/SharedStyles";
import { safeCssImageUrl } from "../../../util/url";
import { DetailSubtitle, DetailTitle, FormInput, FormLabel, Header, PrimaryButton } from "../settingsStyles";

export interface BotsTabProps {
  onBack: () => void;
}

export const BotsTab: React.FC<BotsTabProps> = ({ onBack }) => {
  const [bots, setBots] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newBotToken, setNewBotToken] = useState<string | null>(null);

  const [botUsername, setBotUsername] = useState("");
  const [botDisplayName, setBotDisplayName] = useState("");
  const [botBio, setBotBio] = useState("");
  const [botAvatarUrl, setBotAvatarUrl] = useState("");
  const [botSystemPrompt, setBotSystemPrompt] = useState("");
  const [botModel, setBotModel] = useState("gemini-1.5-flash");
  const [botApiKey, setBotApiKey] = useState("");
  const [botEndpointUrl, setBotEndpointUrl] = useState("");
  const [botScopes, setBotScopes] = useState<string[]>([
    "social:read",
    "social:write",
    "social:simulate",
    "modelica:validate",
  ]);

  useEffect(() => {
    getBots()
      .then((data) => setBots(data))
      .catch(() => {});
  }, []);

  return (
    <>
      <Header>
        <CircleIconButton onClick={onBack} style={{ marginRight: "8px" }}>
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        Developer / Bots
      </Header>
      <Box px={3} pb={3}>
        <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.4" }}>
          Manage your third-party bots and API applications. Bots can interact with the API on your behalf.
        </DetailSubtitle>

        <Box mt={4} mb={4}>
          <DetailTitle style={{ fontWeight: "bold", display: "block", marginBottom: "8px" }}>
            Your Registered Bots
          </DetailTitle>
          {bots.length === 0 ? (
            <Text color="var(--color-fg-muted)">You haven't registered any bots yet.</Text>
          ) : (
            <Box display="flex" flexDirection="column" gap={2}>
              {bots.map((bot) => (
                <Box
                  key={bot.id}
                  p={3}
                  style={{
                    border: "1px solid var(--color-border-default)",
                    borderRadius: "8px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Box display="flex" alignItems="center" gap={3}>
                    <Box
                      style={{
                        width: "40px",
                        height: "40px",
                        borderRadius: "50%",
                        background: "var(--color-canvas-subtle)",
                        backgroundImage: safeCssImageUrl(bot.avatar_url),
                        backgroundSize: "cover",
                      }}
                    />
                    <Box display="flex" flexDirection="column" gap={1}>
                      <Box display="flex" alignItems="center" gap={2}>
                        <Text fontWeight="bold">{bot.display_name}</Text>
                        <HubotIcon size={14} color="var(--color-fg-muted)" />
                        <span
                          style={{
                            fontSize: "10.5px",
                            padding: "1px 6px",
                            borderRadius: "4px",
                            background: "rgba(139, 92, 246, 0.15)",
                            color: "var(--color-accent-purple, #a78bfa)",
                            border: "1px solid rgba(139, 92, 246, 0.3)",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {bot.bot_model || "gemini-1.5-flash"}
                        </span>
                        {bot.bot_api_key && (
                          <span
                            style={{
                              fontSize: "10.5px",
                              padding: "1px 6px",
                              borderRadius: "4px",
                              background: "rgba(56, 189, 248, 0.15)",
                              color: "var(--color-accent-cyan, #38bdf8)",
                              border: "1px solid rgba(56, 189, 248, 0.3)",
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            🔑 BYOK
                          </span>
                        )}
                      </Box>
                      <Text color="var(--color-fg-muted)" fontSize="13px">
                        @{bot.username}
                        {bot.bot_last_used_at ? ` · active ${bot.bot_last_used_at}` : " · standby"}
                      </Text>
                    </Box>
                  </Box>
                  <CircleIconButton
                    onClick={async () => {
                      if (confirm("Are you sure you want to delete this bot?")) {
                        await deleteBot(bot.id);
                        setBots(bots.filter((b) => b.id !== bot.id));
                      }
                    }}
                  >
                    <TrashIcon size={16} color="var(--color-danger-fg)" />
                  </CircleIconButton>
                </Box>
              ))}
            </Box>
          )}
        </Box>

        <Box mt={4} style={{ borderTop: "1px solid var(--color-border-default)", paddingTop: "16px" }}>
          <DetailTitle style={{ fontWeight: "bold", display: "block", marginBottom: "16px" }}>
            Register a New Bot
          </DetailTitle>

          {error && (
            <Box
              mb={3}
              p={3}
              style={{
                background: "var(--color-danger-subtle)",
                color: "var(--color-danger-fg)",
                borderRadius: "6px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <AlertIcon size={16} />
              <Text fontSize="14px">{error}</Text>
            </Box>
          )}

          {newBotToken && (
            <Box
              mb={3}
              p={3}
              style={{
                background: "var(--color-success-subtle)",
                color: "var(--color-success-fg)",
                borderRadius: "6px",
              }}
            >
              <Text fontWeight="bold" display="block" mb={2}>
                Bot created successfully!
              </Text>
              <Text fontSize="14px" display="block" mb={2}>
                Save this API token now. You will not be able to see it again:
              </Text>
              <Box
                p={2}
                style={{
                  background: "var(--color-bg-primary)",
                  border: "1px solid var(--color-border-subtle)",
                  borderRadius: "4px",
                  fontFamily: "monospace",
                  wordBreak: "break-all",
                }}
              >
                {newBotToken}
              </Box>
            </Box>
          )}

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              setNewBotToken(null);
              try {
                const res = await createBot({
                  username: botUsername,
                  display_name: botDisplayName,
                  bio: botBio,
                  avatar_url: botAvatarUrl,
                  scopes: botScopes.join(","),
                  system_prompt: botSystemPrompt,
                  model: botModel,
                  api_key: botApiKey || undefined,
                  endpoint_url: botEndpointUrl || undefined,
                });
                setBots([res.bot, ...bots]);
                setNewBotToken(res.token);
                setBotUsername("");
                setBotDisplayName("");
                setBotBio("");
                setBotAvatarUrl("");
                setBotSystemPrompt("");
                setBotApiKey("");
                setBotEndpointUrl("");
              } catch (err: any) {
                setError(err.response?.data?.error || "Failed to create bot");
              }
            }}
          >
            <FormLabel>Bot Handle (Username)</FormLabel>
            <FormInput
              placeholder="e.g. dynamics_bot"
              value={botUsername}
              onChange={(e) => setBotUsername(e.target.value)}
              required
              pattern="^[a-zA-Z0-9_]+$"
              title="Only letters, numbers, and underscores"
            />

            <FormLabel>Display Name</FormLabel>
            <FormInput
              placeholder="e.g. Dynamics &amp; Simulation Bot"
              value={botDisplayName}
              onChange={(e) => setBotDisplayName(e.target.value)}
              required
            />

            <FormLabel>Bio (Optional)</FormLabel>
            <FormInput
              placeholder="What does this bot do?"
              value={botBio}
              onChange={(e) => setBotBio(e.target.value)}
            />

            <FormLabel>Avatar URL (Optional)</FormLabel>
            <FormInput
              placeholder="https://..."
              value={botAvatarUrl}
              onChange={(e) => setBotAvatarUrl(e.target.value)}
              type="url"
            />

            <FormLabel>Inference Model</FormLabel>
            <select
              value={botModel}
              onChange={(e) => setBotModel(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "var(--color-canvas-default, #0d1117)",
                border: "1px solid var(--color-border-default)",
                borderRadius: "6px",
                color: "var(--color-fg-default)",
                marginBottom: "16px",
                fontFamily: "var(--font-sans)",
              }}
            >
              <option value="gemini-1.5-flash">Gemini 1.5 Flash (Fast &amp; Multimodal)</option>
              <option value="gemini-1.5-pro">Gemini 1.5 Pro (Deep Engineering Reasoning)</option>
              <option value="gpt-4o-mini">GPT-4o Mini (OpenAI Fast)</option>
              <option value="gpt-4o">GPT-4o (OpenAI Flagship)</option>
              <option value="deepseek-r1">DeepSeek R1 (Math &amp; Code Specialist)</option>
              <option value="qwen-2.5-coder">Qwen 2.5 Coder (Engineering Code)</option>
            </select>

            <FormLabel>System Prompt / Engineering Persona (Optional)</FormLabel>
            <FormInput
              placeholder="e.g. You are DynamicsBot, specializing in pendulum and vibration ODE systems."
              value={botSystemPrompt}
              onChange={(e) => setBotSystemPrompt(e.target.value)}
            />

            <FormLabel>Bring-Your-Own-Key (BYOK) API Key (Optional)</FormLabel>
            <FormInput
              type="password"
              placeholder="sk-... or AIzaSy... (leave blank to use instance default)"
              value={botApiKey}
              onChange={(e) => setBotApiKey(e.target.value)}
              autoComplete="off"
            />

            <FormLabel>Custom Endpoint Base URL (Optional)</FormLabel>
            <FormInput
              placeholder="e.g. https://api.openai.com/v1 or http://localhost:11434/v1 for Ollama"
              value={botEndpointUrl}
              onChange={(e) => setBotEndpointUrl(e.target.value)}
            />

            <FormLabel>Bot Capabilities &amp; Scopes</FormLabel>
            <Box display="flex" flexDirection="column" gap={2} mb={3}>
              {[
                { id: "social:read", label: "social:read — Read public threads and mentions" },
                { id: "social:write", label: "social:write — Post responses to social mentions" },
                { id: "social:simulate", label: "social:simulate — Synthesize timeseries trajectory plots" },
                { id: "modelica:validate", label: "modelica:validate — Compile and validate Modelica models" },
              ].map((s) => (
                <label
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={botScopes.includes(s.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setBotScopes([...botScopes, s.id]);
                      } else {
                        setBotScopes(botScopes.filter((x) => x !== s.id));
                      }
                    }}
                  />
                  <span>{s.label}</span>
                </label>
              ))}
            </Box>

            <Box mt={3} mb={3}>
              <PrimaryButton type="submit">Create Autonomous Bot</PrimaryButton>
            </Box>
          </form>
        </Box>
      </Box>
    </>
  );
};
