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
import { getApiErrorMessage } from "../../../util/error";
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

interface BotAccount {
  id: number;
  username: string;
  display_name: string;
  bio?: string | null | undefined;
  avatar_url?: string | null | undefined;
  bot_system_prompt?: string | null | undefined;
  bot_model?: string | null | undefined;
  bot_endpoint_url?: string | null | undefined;
  bot_scopes?: string | null | undefined;
  bot_last_used_at?: string | null | undefined;
  has_bot_api_key?: boolean | undefined;
  has_api_key?: boolean | undefined;
  bot_api_key?: string | null | undefined;
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
  const [bots, setBots] = useState<BotAccount[]>([]);
  const [isLoadingBots, setIsLoadingBots] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmingDeleteBotId, setConfirmingDeleteBotId] = useState<number | null>(null);
  const [deletingBotId, setDeletingBotId] = useState<number | null>(null);
  const [confirmingRotateBotId, setConfirmingRotateBotId] = useState<number | null>(null);
  const [rotatingBotId, setRotatingBotId] = useState<number | null>(null);
  const [editingBotId, setEditingBotId] = useState<number | null>(null);
  const [savingBotEdit, setSavingBotEdit] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newBotToken, setNewBotToken] = useState<string | null>(null);

  // Edit bot form states
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editAvatarUrl, setEditAvatarUrl] = useState("");
  const [editSystemPrompt, setEditSystemPrompt] = useState("");
  const [editModel, setEditModel] = useState("gemini-1.5-flash");
  const [editApiKey, setEditApiKey] = useState("");
  const [clearEditApiKey, setClearEditApiKey] = useState(false);
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
    let cancelled = false;
    setIsLoadingBots(true);
    setLoadError(null);
    getBots()
      .then((data) => {
        if (!cancelled) {
          setBots(data || []);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(getApiErrorMessage(err, "Failed to load registered bots."));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingBots(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const startEditingBot = (bot: BotAccount) => {
    setEditingBotId(bot.id);
    setConfirmingDeleteBotId(null);
    setConfirmingRotateBotId(null);
    setEditDisplayName(bot.display_name || "");
    setEditBio(bot.bio || "");
    setEditAvatarUrl(bot.avatar_url || "");
    setEditSystemPrompt(bot.bot_system_prompt || "");
    setEditModel(bot.bot_model || "gemini-1.5-flash");
    setEditApiKey("");
    setClearEditApiKey(false);
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
        ...(clearEditApiKey ? { api_key: "" } : editApiKey.trim() ? { api_key: editApiKey.trim() } : {}),
      };
      const res = await updateBot(botId, payload);
      setBots((prev) =>
        prev.map((b) =>
          b.id === botId
            ? res?.bot || {
                ...b,
                display_name: payload.display_name ?? b.display_name,
                bio: payload.bio,
                avatar_url: payload.avatar_url,
                bot_scopes: payload.scopes,
                bot_system_prompt: payload.system_prompt,
                bot_model: payload.model,
                bot_endpoint_url: payload.endpoint_url,
                has_bot_api_key: clearEditApiKey ? false : Boolean(editApiKey.trim()) || b.has_bot_api_key,
                has_api_key: clearEditApiKey ? false : Boolean(editApiKey.trim()) || b.has_api_key,
                bot_api_key: clearEditApiKey ? null : b.bot_api_key,
              }
            : b,
        ),
      );
      setEditingBotId(null);
      setClearEditApiKey(false);
      toast.success("Bot configuration updated.");
    } catch (err: unknown) {
      const msg = getApiErrorMessage(err, "Failed to update bot");
      setError(msg);
      toast.error(msg);
    } finally {
      setSavingBotEdit(false);
    }
  };

  const handleRotateToken = async (bot: BotAccount) => {
    setConfirmingRotateBotId(null);
    setRotatingBotId(bot.id);
    setError(null);
    try {
      const res = await rotateBotToken(bot.id);
      setNewBotToken(res.token);
      toast.success(`Generated a new API token for @${bot.username}.`);
    } catch (err: unknown) {
      const msg = getApiErrorMessage(err, "Failed to rotate bot token");
      setError(msg);
      toast.error(msg);
    } finally {
      setRotatingBotId(null);
    }
  };

  const handleDeleteBot = async (bot: BotAccount) => {
    if (deletingBotId === bot.id) return;
    setDeletingBotId(bot.id);
    setError(null);
    try {
      await deleteBot(bot.id);
      setConfirmingDeleteBotId(null);
      setBots((prev) => prev.filter((b) => b.id !== bot.id));
      toast.success(`Bot @${bot.username} deleted.`);
    } catch (err: unknown) {
      const msg = getApiErrorMessage(err, "Failed to delete bot");
      setError(msg);
      toast.error(msg);
    } finally {
      setDeletingBotId(null);
    }
  };

  return (
    <>
      <Header>
        <CircleIconButton onClick={onBack} aria-label="Back" style={{ marginRight: "8px" }}>
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        Developer / Bots
      </Header>
      <Box px={3} pb={3}>
        <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.4", display: "block", marginBottom: "16px" }}>
          Manage your third-party bots and API applications. Bots can interact with the API on your behalf.
        </DetailSubtitle>

        {loadError && (
          <Box
            role="alert"
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
            <Text fontSize="14px">{loadError}</Text>
          </Box>
        )}

        {error && (
          <Box
            role="alert"
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
            role="status"
            mb={4}
            p={3}
            style={{
              background: "var(--color-success-subtle)",
              border: "1px solid var(--color-success-fg)",
              color: "var(--color-success-fg)",
              borderRadius: "8px",
            }}
          >
            <Box display="flex" alignItems="center" justifyContent="space-between" gap={2} mb={1}>
              <Box display="flex" alignItems="center" gap={2}>
                <CheckCircleIcon size={18} />
                <Text fontWeight="bold" display="block">
                  Bot API Token Issued
                </Text>
              </Box>
              <SecondaryButton
                type="button"
                style={{ padding: "4px 10px", fontSize: "12px" }}
                onClick={() => setNewBotToken(null)}
              >
                Dismiss
              </SecondaryButton>
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
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(newBotToken);
                    toast.success("Bot token copied to clipboard!");
                  } catch {
                    toast.error("Failed to copy bot token to clipboard.");
                  }
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
          {isLoadingBots ? (
            <Text color="var(--color-fg-muted)">Loading your bots...</Text>
          ) : bots.length === 0 ? (
            <Text color="var(--color-fg-muted)">You haven&apos;t registered any bots yet.</Text>
          ) : (
            <Box display="flex" flexDirection="column" gap={2}>
              {bots.map((bot) => {
                const isEditing = editingBotId === bot.id;
                const isDeleting = deletingBotId === bot.id;
                const hasApiKey = Boolean(bot.has_bot_api_key || bot.has_api_key || bot.bot_api_key);
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
                              disabled={isDeleting}
                              style={{ padding: "6px 12px", fontSize: "13px" }}
                              onClick={() => setConfirmingDeleteBotId(null)}
                            >
                              Cancel
                            </SecondaryButton>
                            <DangerButton
                              type="button"
                              disabled={isDeleting}
                              style={{ padding: "6px 14px", fontSize: "13px" }}
                              onClick={() => handleDeleteBot(bot)}
                            >
                              {isDeleting ? "Deleting…" : "Confirm Delete?"}
                            </DangerButton>
                          </Box>
                        ) : (
                          <CircleIconButton
                            type="button"
                            aria-label="Delete bot"
                            title="Delete Bot"
                            disabled={isDeleting}
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
                            background: "var(--ms-bg-canvas, var(--color-canvas-default))",
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
                          onChange={(e) => {
                            setEditApiKey(e.target.value);
                            if (e.target.value.trim()) {
                              setClearEditApiKey(false);
                            }
                          }}
                          disabled={clearEditApiKey}
                          autoComplete="off"
                        />
                        {hasApiKey && (
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "13px",
                              marginBottom: "12px",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={clearEditApiKey}
                              onChange={(e) => {
                                setClearEditApiKey(e.target.checked);
                                if (e.target.checked) {
                                  setEditApiKey("");
                                }
                              }}
                            />
                            <span>Clear Stored API Key</span>
                          </label>
                        )}

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
                            onClick={() => {
                              setEditingBotId(null);
                              setClearEditApiKey(false);
                            }}
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
              if (isCreating) return;
              setIsCreating(true);
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
                setBots((prev) => [res.bot, ...prev]);
                setNewBotToken(res.token);
                setBotUsername("");
                setBotDisplayName("");
                setBotBio("");
                setBotAvatarUrl("");
                setBotSystemPrompt("");
                setBotApiKey("");
                setBotEndpointUrl("");
              } catch (err: unknown) {
                setError(getApiErrorMessage(err, "Failed to create bot"));
              } finally {
                setIsCreating(false);
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
                background: "var(--ms-bg-canvas, var(--color-canvas-default))",
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
              <PrimaryButton type="submit" disabled={isCreating || botScopes.length === 0}>
                {isCreating ? "Creating…" : "Create Autonomous Bot"}
              </PrimaryButton>
            </Box>
          </form>
        </Box>
      </Box>
    </>
  );
};
