// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  HubotIcon,
  KeyIcon,
  PencilIcon,
  SyncIcon,
  TrashIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { createBot, deleteBot, getBots, rotateBotToken, updateBot } from "../../../api/bots";
import Box from "../../../components/Box";
import { CircleIconButton } from "../../../components/SharedStyles";
import { useToast } from "../../../components/ToastContext";
import { safeCssImageUrl } from "../../../util/url";
import {
  DangerButton,
  DetailSubtitle,
  DetailTitle,
  FormInput,
  FormLabel,
  Header,
  PrimaryButton,
  SaveButton,
  SecondaryButton,
} from "../settingsStyles";

export interface BotsTabProps {
  onBack: () => void;
}

const AVAILABLE_SCOPES = [
  { id: "social:read", label: "social:read — Read timeline posts, replies, and discussions" },
  { id: "social:write", label: "social:write — Publish posts, replies, and reactions" },
  { id: "social:simulate", label: "social:simulate — Trigger and attach simulation runs to social posts" },
  { id: "modelica:validate", label: "modelica:validate — Run Modelica compiler & linter checks on code snippets" },
  { id: "repos:read", label: "repos:read — Read repository files and commit history" },
  { id: "repos:review", label: "repos:review — Post automated code reviews and diagnostics on repositories" },
  { id: "packages:read", label: "packages:read — Inspect published packages and dependencies" },
];

export const BotsTab: React.FC<BotsTabProps> = ({ onBack }) => {
  const toast = useToast();
  const [bots, setBots] = useState<any[]>([]);
  const [confirmingDeleteBotId, setConfirmingDeleteBotId] = useState<number | null>(null);
  const [confirmingRotateBotId, setConfirmingRotateBotId] = useState<number | null>(null);
  const [rotatingBotId, setRotatingBotId] = useState<number | null>(null);
  const [editingBotId, setEditingBotId] = useState<number | null>(null);
  const [savingBotEdit, setSavingBotEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newBotToken, setNewBotToken] = useState<string | null>(null);

  // Edit bot form states
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editAvatarUrl, setEditAvatarUrl] = useState("");
  const [editSystemPrompt, setEditSystemPrompt] = useState("");
  const [editModel, setEditModel] = useState("gemini-1.5-flash");
  const [editApiKey, setEditApiKey] = useState("");
  const [editEndpointUrl, setEditEndpointUrl] = useState("");
  const [editScopes, setEditScopes] = useState<string[]>([]);

  // Create bot form states
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
      .then((data) => setBots(data || []))
      .catch(() => {});
  }, []);

  const startEditingBot = (bot: any) => {
    setEditingBotId(bot.id);
    setConfirmingDeleteBotId(null);
    setConfirmingRotateBotId(null);
    setEditDisplayName(bot.display_name || "");
    setEditBio(bot.bio || "");
    setEditAvatarUrl(bot.avatar_url || "");
    setEditSystemPrompt(bot.bot_system_prompt || "");
    setEditModel(bot.bot_model || "gemini-1.5-flash");
    setEditApiKey("");
    setEditEndpointUrl(bot.bot_endpoint_url || "");
    const rawScopes = typeof bot.bot_scopes === "string" ? bot.bot_scopes : "social:read,social:write";
    setEditScopes(
      rawScopes
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean),
    );
  };

  const handleSaveBotEdit = async (botId: number) => {
    setSavingBotEdit(true);
    setError(null);
    try {
      const payload: Parameters<typeof updateBot>[1] = {
        display_name: editDisplayName.trim(),
        bio: editBio.trim(),
        avatar_url: editAvatarUrl.trim(),
        scopes: editScopes.join(","),
        system_prompt: editSystemPrompt,
        model: editModel,
        endpoint_url: editEndpointUrl.trim(),
        ...(editApiKey.trim() ? { api_key: editApiKey.trim() } : {}),
      };
      const res = await updateBot(botId, payload);
      setBots((prev) =>
        prev.map((b) =>
          b.id === botId
            ? res?.bot || {
                ...b,
                display_name: payload.display_name,
                bio: payload.bio,
                avatar_url: payload.avatar_url,
                bot_scopes: payload.scopes,
                bot_system_prompt: payload.system_prompt,
                bot_model: payload.model,
                bot_endpoint_url: payload.endpoint_url,
                has_bot_api_key: Boolean(editApiKey.trim()) || b.has_bot_api_key,
              }
            : b,
        ),
      );
      setEditingBotId(null);
      toast.success("Bot configuration updated.");
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || "Failed to update bot";
      setError(msg);
      toast.error(msg);
    } finally {
      setSavingBotEdit(false);
    }
  };

  const handleRotateToken = async (bot: any) => {
    setConfirmingRotateBotId(null);
    setRotatingBotId(bot.id);
    setError(null);
    try {
      const res = await rotateBotToken(bot.id);
      setNewBotToken(res.token);
      toast.success(`Generated a new API token for @${bot.username}.`);
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || "Failed to rotate bot token";
      setError(msg);
      toast.error(msg);
    } finally {
      setRotatingBotId(null);
    }
  };

  const handleDeleteBot = async (bot: any) => {
    setConfirmingDeleteBotId(null);
    setError(null);
    try {
      await deleteBot(bot.id);
      setBots((prev) => prev.filter((b) => b.id !== bot.id));
      toast.success(`Bot @${bot.username} deleted.`);
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || "Failed to delete bot";
      setError(msg);
      toast.error(msg);
    }
  };

  return (
    <>
      <Header>
        <CircleIconButton onClick={onBack} style={{ marginRight: "8px" }}>
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        Developer / Bots
      </Header>
      <Box px={3} pb={3}>
        <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.4", display: "block", marginBottom: "16px" }}>
          Manage your third-party bots and API applications. Bots can interact with the API on your behalf.
        </DetailSubtitle>

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
            mb={4}
            p={3}
            style={{
              background: "var(--color-success-subtle)",
              border: "1px solid var(--color-success-fg)",
              color: "var(--color-success-fg)",
              borderRadius: "8px",
            }}
          >
            <Box display="flex" alignItems="center" gap={2} mb={1}>
              <CheckCircleIcon size={18} />
              <Text fontWeight="bold" display="block">
                Bot API Token Issued
              </Text>
            </Box>
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
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>{newBotToken}</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(newBotToken);
                  toast.success("Bot token copied to clipboard!");
                }}
                style={{
                  background: "var(--color-accent-emphasis)",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  padding: "6px 12px",
                  cursor: "pointer",
                  fontWeight: "600",
                  fontSize: "13px",
                  fontFamily: "var(--font-sans, sans-serif)",
                  flexShrink: 0,
                }}
              >
                Copy
              </button>
            </Box>
          </Box>
        )}

        <Box mt={4} mb={4}>
          <DetailTitle style={{ fontWeight: "bold", display: "block", marginBottom: "8px" }}>
            Your Registered Bots
          </DetailTitle>
          {bots.length === 0 ? (
            <Text color="var(--color-fg-muted)">You haven&apos;t registered any bots yet.</Text>
          ) : (
            <Box display="flex" flexDirection="column" gap={2}>
              {bots.map((bot) => {
                const isEditing = editingBotId === bot.id;
                const hasApiKey = Boolean(bot.has_bot_api_key || bot.bot_api_key);
                return (
                  <Box
                    key={bot.id}
                    p={3}
                    style={{
                      border: "1px solid var(--color-border-default)",
                      borderRadius: "8px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "12px",
                    }}
                  >
                    <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
                      <Box display="flex" alignItems="center" gap={3}>
                        <Box
                          style={{
                            width: "40px",
                            height: "40px",
                            borderRadius: "50%",
                            background: "var(--color-canvas-subtle)",
                            backgroundImage: safeCssImageUrl(bot.avatar_url),
                            backgroundSize: "cover",
                            flexShrink: 0,
                          }}
                        />
                        <Box display="flex" flexDirection="column" gap={1}>
                          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
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
                            {hasApiKey && (
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
                                <KeyIcon size={10} /> BYOK
                              </span>
                            )}
                          </Box>
                          <Text color="var(--color-fg-muted)" fontSize="13px">
                            @{bot.username} · Last active:{" "}
                            {bot.bot_last_used_at ? new Date(bot.bot_last_used_at).toLocaleString() : "Never"}
                          </Text>
                        </Box>
                      </Box>

                      <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                        <SecondaryButton
                          type="button"
                          style={{ padding: "6px 12px", fontSize: "13px" }}
                          onClick={() => (isEditing ? setEditingBotId(null) : startEditingBot(bot))}
                        >
                          <PencilIcon size={14} />
                          {isEditing ? "Close" : "Edit"}
                        </SecondaryButton>

                        {confirmingRotateBotId === bot.id ? (
                          <Box display="flex" alignItems="center" gap={2}>
                            <SecondaryButton
                              type="button"
                              style={{ padding: "6px 12px", fontSize: "13px" }}
                              onClick={() => setConfirmingRotateBotId(null)}
                            >
                              Cancel
                            </SecondaryButton>
                            <SaveButton
                              type="button"
                              style={{ padding: "6px 14px", fontSize: "13px" }}
                              disabled={rotatingBotId === bot.id}
                              onClick={() => handleRotateToken(bot)}
                            >
                              {rotatingBotId === bot.id ? "Rotating…" : "Confirm Rotate"}
                            </SaveButton>
                          </Box>
                        ) : (
                          <SecondaryButton
                            type="button"
                            style={{ padding: "6px 12px", fontSize: "13px" }}
                            disabled={rotatingBotId === bot.id}
                            onClick={() => {
                              setConfirmingDeleteBotId(null);
                              setConfirmingRotateBotId(bot.id);
                            }}
                          >
                            <SyncIcon size={14} />
                            Rotate Token
                          </SecondaryButton>
                        )}

                        {confirmingDeleteBotId === bot.id ? (
                          <Box display="flex" alignItems="center" gap={2}>
                            <SecondaryButton
                              type="button"
                              style={{ padding: "6px 12px", fontSize: "13px" }}
                              onClick={() => setConfirmingDeleteBotId(null)}
                            >
                              Cancel
                            </SecondaryButton>
                            <DangerButton
                              type="button"
                              style={{ padding: "6px 14px", fontSize: "13px" }}
                              onClick={() => handleDeleteBot(bot)}
                            >
                              Confirm Delete?
                            </DangerButton>
                          </Box>
                        ) : (
                          <CircleIconButton
                            title="Delete Bot"
                            onClick={() => {
                              setConfirmingRotateBotId(null);
                              setConfirmingDeleteBotId(bot.id);
                            }}
                          >
                            <TrashIcon size={16} color="var(--color-danger-fg)" />
                          </CircleIconButton>
                        )}
                      </Box>
                    </Box>

                    {isEditing && (
                      <Box
                        mt={2}
                        pt={3}
                        style={{
                          borderTop: "1px solid var(--color-border-default)",
                        }}
                      >
                        <FormLabel>Display Name</FormLabel>
                        <FormInput
                          value={editDisplayName}
                          onChange={(e) => setEditDisplayName(e.target.value)}
                          required
                        />

                        <FormLabel>Bio</FormLabel>
                        <FormInput value={editBio} onChange={(e) => setEditBio(e.target.value)} />

                        <FormLabel>Avatar URL</FormLabel>
                        <FormInput
                          type="url"
                          placeholder="https://..."
                          value={editAvatarUrl}
                          onChange={(e) => setEditAvatarUrl(e.target.value)}
                        />

                        <FormLabel>Inference Model</FormLabel>
                        <select
                          value={editModel}
                          onChange={(e) => setEditModel(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "8px 12px",
                            background: "var(--color-canvas-default, #0d1117)",
                            border: "1px solid var(--color-border-default)",
                            borderRadius: "6px",
                            color: "var(--color-fg-default)",
                            marginTop: "8px",
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

                        <FormLabel>System Prompt / Engineering Persona</FormLabel>
                        <FormInput value={editSystemPrompt} onChange={(e) => setEditSystemPrompt(e.target.value)} />

                        <FormLabel>Bring-Your-Own-Key (BYOK) API Key (leave blank to keep current)</FormLabel>
                        <FormInput
                          type="password"
                          placeholder={hasApiKey ? "•••••••• (configured)" : "sk-... or AIzaSy..."}
                          value={editApiKey}
                          onChange={(e) => setEditApiKey(e.target.value)}
                          autoComplete="off"
                        />

                        <FormLabel>Custom Endpoint Base URL</FormLabel>
                        <FormInput
                          placeholder="e.g. https://api.openai.com/v1"
                          value={editEndpointUrl}
                          onChange={(e) => setEditEndpointUrl(e.target.value)}
                        />

                        <FormLabel style={{ marginBottom: "8px" }}>Bot Scopes</FormLabel>
                        <Box display="flex" flexDirection="column" gap={2} mb={3}>
                          {AVAILABLE_SCOPES.map((s) => (
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
                                checked={editScopes.includes(s.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setEditScopes([...editScopes, s.id]);
                                  } else {
                                    setEditScopes(editScopes.filter((x) => x !== s.id));
                                  }
                                }}
                              />
                              <span>{s.label}</span>
                            </label>
                          ))}
                        </Box>

                        <Box display="flex" justifyContent="flex-end" gap={2}>
                          <SecondaryButton
                            type="button"
                            style={{ padding: "8px 16px", fontSize: "13px" }}
                            onClick={() => setEditingBotId(null)}
                          >
                            Cancel
                          </SecondaryButton>
                          <SaveButton
                            type="button"
                            disabled={savingBotEdit || !editDisplayName.trim() || editScopes.length === 0}
                            onClick={() => handleSaveBotEdit(bot.id)}
                          >
                            {savingBotEdit ? "Saving…" : "Save Changes"}
                          </SaveButton>
                        </Box>
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>

        <Box mt={4} style={{ borderTop: "1px solid var(--color-border-default)", paddingTop: "16px" }}>
          <DetailTitle style={{ fontWeight: "bold", display: "block", marginBottom: "16px" }}>
            Register a New Bot
          </DetailTitle>

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

            <FormLabel style={{ marginBottom: "8px" }}>Bot Capabilities &amp; Scopes</FormLabel>
            <Box display="flex" flexDirection="column" gap={2} mb={3}>
              {AVAILABLE_SCOPES.map((s) => (
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
              <PrimaryButton type="submit" disabled={botScopes.length === 0}>
                Create Autonomous Bot
              </PrimaryButton>
            </Box>
          </form>
        </Box>
      </Box>
    </>
  );
};
