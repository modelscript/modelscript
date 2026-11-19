// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleFillIcon,
  GearIcon,
  PaperAirplaneIcon,
  SparklesFillIcon,
  SquareIcon,
  TrashIcon,
  XCircleFillIcon,
  XIcon,
} from "@primer/octicons-react";
import { Button, IconButton, Label } from "@primer/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_MORSEL_AI_SETTINGS,
  fetchMorselProvidersInfo,
  loadMorselAiSettings,
  runMorselAiTurn,
  saveMorselAiSettings,
  type MorselAiProviderMode,
  type MorselAiSettings,
  type MorselChatMessage,
  type MorselCustomProtocol,
  type MorselProvidersInfo,
} from "../util/morsel-ai-client";
import type {
  MorselDiagnosticSummary,
  MorselToolCall,
  MorselToolHost,
  MorselToolResult,
} from "../util/morsel-tool-bridge";

export interface MorselAiPanelProps {
  isOpen: boolean;
  onClose: () => void;
  colorMode: "dark" | "light";
  toolHost: MorselToolHost;
  fileName: string;
  dialect: string;
  diagnostics: MorselDiagnosticSummary[];
  initialPrompt?: string | undefined;
  onConsumeInitialPrompt?: (() => void) | undefined;
}

interface UiTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string | undefined;
  providerUsed?: MorselAiProviderMode | undefined;
  toolCalls: { call: MorselToolCall; result?: MorselToolResult | undefined }[];
  error?: string | undefined;
}

function computeCompactDiff(before: string, after: string): { kind: "del" | "add"; text: string }[] {
  const prevLines = before.split("\n");
  const nextLines = after.split("\n");
  const prevSet = new Set(prevLines);
  const nextSet = new Set(nextLines);
  const diff: { kind: "del" | "add"; text: string }[] = [];
  for (const line of prevLines) {
    if (!nextSet.has(line)) diff.push({ kind: "del", text: line });
  }
  for (const line of nextLines) {
    if (!prevSet.has(line)) diff.push({ kind: "add", text: line });
  }
  return diff.slice(0, 12);
}

export const MorselAiPanel: React.FC<MorselAiPanelProps> = ({
  isOpen,
  onClose,
  colorMode,
  toolHost,
  fileName,
  dialect,
  diagnostics,
  initialPrompt,
  onConsumeInitialPrompt,
}) => {
  const [settings, setSettings] = useState<MorselAiSettings>(() => loadMorselAiSettings());
  const [providersInfo, setProvidersInfo] = useState<MorselProvidersInfo | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [turns, setTurns] = useState<UiTurn[]>([]);
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [localProgress, setLocalProgress] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const isDark = colorMode === "dark";
  const errorCount = diagnostics.filter((d) => d.severity === "error").length;

  useEffect(() => {
    saveMorselAiSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!isOpen) return;
    const ctrl = new AbortController();
    void fetchMorselProvidersInfo(ctrl.signal).then((info) => {
      if (info) setProvidersInfo(info);
    });
    return () => ctrl.abort();
  }, [isOpen]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, localProgress]);

  const sendPrompt = useCallback(
    async (promptText: string) => {
      const trimmed = promptText.trim();
      if (!trimmed || isRunning) return;

      const userTurn: UiTurn = {
        id: `u_${Date.now()}`,
        role: "user",
        content: trimmed,
        toolCalls: [],
      };
      const assistantId = `a_${Date.now() + 1}`;
      const assistantTurn: UiTurn = {
        id: assistantId,
        role: "assistant",
        content: "",
        toolCalls: [],
      };

      setTurns((prev) => [...prev, userTurn, assistantTurn]);
      setInput("");
      setIsRunning(true);
      setLocalProgress(null);

      const history: MorselChatMessage[] = [
        ...turns.map((t) => ({ role: t.role, content: t.content })),
        { role: "user", content: trimmed },
      ];

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await runMorselAiTurn(history, toolHost, settings, {
          signal: controller.signal,
          onLocalProgress: (msg) => setLocalProgress(msg),
          onTextDelta: (delta) => {
            setTurns((prev) => prev.map((t) => (t.id === assistantId ? { ...t, content: t.content + delta } : t)));
          },
          onToolCall: (call) => {
            setTurns((prev) =>
              prev.map((t) => (t.id === assistantId ? { ...t, toolCalls: [...t.toolCalls, { call }] } : t)),
            );
          },
          onToolResult: (result) => {
            setTurns((prev) =>
              prev.map((t) => {
                if (t.id !== assistantId) return t;
                const updated = [...t.toolCalls];
                const idx = updated.findIndex((x) => x.call.name === result.name && !x.result);
                if (idx >= 0) {
                  updated[idx] = { ...updated[idx]!, result };
                }
                return { ...t, toolCalls: updated };
              }),
            );
          },
        });

        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId
              ? {
                  ...t,
                  content: t.content || res.content,
                  model: res.model,
                  providerUsed: res.providerUsed,
                }
              : t,
          ),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "AI request failed";
        setTurns((prev) => prev.map((t) => (t.id === assistantId ? { ...t, error: message } : t)));
      } finally {
        setIsRunning(false);
        setLocalProgress(null);
        abortRef.current = null;
      }
    },
    [isRunning, settings, toolHost, turns],
  );

  useEffect(() => {
    if (isOpen && initialPrompt && !isRunning) {
      void sendPrompt(initialPrompt);
      onConsumeInitialPrompt?.();
    }
  }, [isOpen, initialPrompt, isRunning, sendPrompt, onConsumeInitialPrompt]);

  if (!isOpen) return null;

  return (
    <aside
      data-testid="morsel-ai-panel"
      aria-label="Ansatz AI Assistant"
      style={{
        position: "fixed",
        top: 56,
        right: 12,
        bottom: 72,
        width: 380,
        maxWidth: "calc(100vw - 24px)",
        zIndex: 45,
        display: "flex",
        flexDirection: "column",
        borderRadius: "var(--ms-radius-lg, 12px)",
        background: isDark ? "rgba(22, 27, 34, 0.96)" : "rgba(255, 255, 255, 0.96)",
        backdropFilter: "blur(16px)",
        border: "1px solid var(--borderColor-default, var(--ms-border))",
        boxShadow: "0 12px 36px rgba(0, 0, 0, 0.35)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          borderBottom: "1px solid var(--borderColor-muted, var(--ms-divider))",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <SparklesFillIcon size={16} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Ansatz AI</span>
          <Label size="small" variant="accent">
            {settings.mode}
          </Label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <IconButton
            size="small"
            variant="invisible"
            icon={GearIcon}
            aria-label="AI provider settings"
            onClick={() => setShowSettings((s) => !s)}
          />
          <IconButton
            size="small"
            variant="invisible"
            icon={TrashIcon}
            aria-label="Clear conversation"
            onClick={() => setTurns([])}
          />
          <IconButton size="small" variant="invisible" icon={XIcon} aria-label="Close Ansatz AI" onClick={onClose} />
        </div>
      </div>

      {/* Provider Mode Selector + Context Bar */}
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--borderColor-muted, var(--ms-divider))",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          fontSize: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label htmlFor="morsel-ai-mode" style={{ opacity: 0.75, fontSize: 11 }}>
            Engine:
          </label>
          <select
            id="morsel-ai-mode"
            value={settings.mode}
            onChange={(e) => setSettings((s) => ({ ...s, mode: e.target.value as MorselAiProviderMode }))}
            style={{
              flex: 1,
              fontSize: 12,
              padding: "3px 6px",
              borderRadius: 6,
              background: isDark ? "#0d1117" : "#f6f8fa",
              color: "inherit",
              border: "1px solid var(--borderColor-default, #30363d)",
            }}
          >
            <option value="auto">Auto (Local WebGPU / Ansatz Cloud)</option>
            <option value="local">Local Browser (WebGPU / Prompt API + MCP)</option>
            <option value="local-endpoint">Local Endpoint (Ollama / vLLM)</option>
            <option value="ansatz">
              Ansatz Cloud ({providersInfo?.ollamaQualityModel || providersInfo?.defaultModel || "Heavy Backend"})
            </option>
            <option value="custom" disabled={providersInfo?.airgapMode}>
              {providersInfo?.airgapMode
                ? "3rd-Party Provider (Blocked in Air-Gap Mode)"
                : "3rd-Party Provider (OpenAI / Anthropic BYOK)"}
            </option>
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
          <span style={{ opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {fileName} · {dialect}
          </span>
          {errorCount > 0 && (
            <Button
              size="small"
              variant="danger"
              onClick={() =>
                void sendPrompt(
                  `Please inspect the ${errorCount} error(s) in ${fileName}, explain the root cause, and fix the model.`,
                )
              }
              disabled={isRunning}
            >
              Fix {errorCount} error{errorCount === 1 ? "" : "s"}
            </Button>
          )}
        </div>
      </div>

      {/* Provider Settings Drawer */}
      {showSettings && (
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid var(--borderColor-muted, var(--ms-divider))",
            background: isDark ? "rgba(13, 17, 23, 0.7)" : "rgba(246, 248, 250, 0.9)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontSize: 12,
          }}
        >
          {settings.mode === "local-endpoint" && (
            <>
              <input
                type="text"
                placeholder="Endpoint URL (e.g. http://127.0.0.1:11434/v1)"
                value={settings.localEndpointUrl}
                onChange={(e) => setSettings((s) => ({ ...s, localEndpointUrl: e.target.value }))}
                style={{ padding: "4px 8px", borderRadius: 6, fontSize: 12 }}
              />
              <input
                type="text"
                placeholder="Model (e.g. qwen2.5-coder:7b)"
                value={settings.localEndpointModel}
                onChange={(e) => setSettings((s) => ({ ...s, localEndpointModel: e.target.value }))}
                style={{ padding: "4px 8px", borderRadius: 6, fontSize: 12 }}
              />
            </>
          )}

          {settings.mode === "custom" && (
            <>
              <select
                value={settings.customProtocol}
                onChange={(e) => setSettings((s) => ({ ...s, customProtocol: e.target.value as MorselCustomProtocol }))}
                style={{ padding: "4px 8px", borderRadius: 6, fontSize: 12 }}
              >
                <option value="openai">OpenAI-Compatible (/v1/chat/completions)</option>
                <option value="anthropic">Anthropic (/v1/messages)</option>
              </select>
              <input
                type="text"
                placeholder="Base URL"
                value={settings.customBaseUrl}
                onChange={(e) => setSettings((s) => ({ ...s, customBaseUrl: e.target.value }))}
                style={{ padding: "4px 8px", borderRadius: 6, fontSize: 12 }}
              />
              <input
                type="text"
                placeholder="Model ID"
                value={settings.customModel}
                onChange={(e) => setSettings((s) => ({ ...s, customModel: e.target.value }))}
                style={{ padding: "4px 8px", borderRadius: 6, fontSize: 12 }}
              />
              <input
                type="password"
                placeholder="API Key (stored locally in browser)"
                value={settings.customApiKey}
                onChange={(e) => setSettings((s) => ({ ...s, customApiKey: e.target.value }))}
                style={{ padding: "4px 8px", borderRadius: 6, fontSize: 12 }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                <input
                  type="checkbox"
                  checked={settings.directBrowserCustom}
                  onChange={(e) => setSettings((s) => ({ ...s, directBrowserCustom: e.target.checked }))}
                />
                Call provider directly from browser (requires CORS)
              </label>
            </>
          )}

          {settings.mode !== "local-endpoint" && settings.mode !== "custom" && (
            <div style={{ opacity: 0.75, fontSize: 11 }}>
              {settings.mode === "local"
                ? "Runs Qwen3 WebGPU or Chrome Prompt API locally with MorselToolBridge."
                : "Uses Ansatz backend heavy models & hosted MCP tools (falls back to deterministic engineering mode if unconfigured)."}
            </div>
          )}

          <Button size="small" variant="invisible" onClick={() => setSettings(DEFAULT_MORSEL_AI_SETTINGS)}>
            Reset AI settings
          </Button>
        </div>
      )}

      {/* Conversation */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          fontSize: 13,
        }}
      >
        {turns.length === 0 && (
          <div style={{ opacity: 0.7, fontSize: 12, lineHeight: 1.5 }}>
            Ask Ansatz AI to explain equations, fix compiler diagnostics, edit your model, flatten, or run a simulation.
          </div>
        )}

        {localProgress && (
          <div
            style={{
              fontSize: 11,
              opacity: 0.8,
              padding: "6px 8px",
              borderRadius: 6,
              background: isDark ? "#1f242c" : "#eaeef2",
            }}
          >
            {localProgress}
          </div>
        )}

        {turns.map((turn) => (
          <div
            key={turn.id}
            style={{
              alignSelf: turn.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "92%",
              padding: "8px 10px",
              borderRadius: 10,
              background: turn.role === "user" ? (isDark ? "#1f6feb" : "#0969da") : isDark ? "#21262d" : "#f6f8fa",
              color: turn.role === "user" ? "#ffffff" : "inherit",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {turn.toolCalls.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
                {turn.toolCalls.map((tc, idx) => (
                  <div
                    key={`${turn.id}_tc_${idx}`}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      fontSize: 11,
                      padding: "4px 6px",
                      borderRadius: 6,
                      background: isDark ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.06)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {tc.result ? (
                        tc.result.ok ? (
                          <CheckCircleFillIcon size={12} />
                        ) : (
                          <XCircleFillIcon size={12} />
                        )
                      ) : null}
                      <span style={{ flex: 1 }}>{tc.call.name}</span>
                      {tc.call.name === "morsel_apply_edit" && tc.result?.previousCode !== undefined && (
                        <button
                          type="button"
                          onClick={() => {
                            toolHost.applyCodeEdit(tc.result!.previousCode!, "Morsel AI revert");
                          }}
                          style={{
                            fontSize: 10,
                            padding: "1px 6px",
                            borderRadius: 4,
                            cursor: "pointer",
                            border: "1px solid var(--borderColor-default, #30363d)",
                            background: "transparent",
                            color: "inherit",
                          }}
                        >
                          Revert
                        </button>
                      )}
                    </div>
                    {tc.call.name === "morsel_apply_edit" &&
                      tc.result?.previousCode !== undefined &&
                      tc.result?.editedCode !== undefined &&
                      tc.result.previousCode !== tc.result.editedCode && (
                        <pre
                          style={{
                            margin: 0,
                            padding: "4px 6px",
                            borderRadius: 4,
                            fontSize: 10,
                            fontFamily: "var(--ms-font-mono, ui-monospace, monospace)",
                            overflowX: "auto",
                            background: isDark ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.7)",
                          }}
                        >
                          {computeCompactDiff(tc.result.previousCode, tc.result.editedCode).map((d, di) => (
                            <div
                              key={di}
                              style={{
                                color:
                                  d.kind === "del" ? (isDark ? "#ff7b72" : "#cf222e") : isDark ? "#7ee787" : "#1a7f37",
                              }}
                            >
                              {d.kind === "del" ? "- " : "+ "}
                              {d.text}
                            </div>
                          ))}
                        </pre>
                      )}
                  </div>
                ))}
              </div>
            )}

            {turn.error ? (
              <div style={{ color: isDark ? "#ff7b72" : "#cf222e", fontSize: 12 }}>{turn.error}</div>
            ) : (
              <div>{turn.content || (isRunning && turn.role === "assistant" ? "Thinking…" : "")}</div>
            )}

            {turn.model && (
              <div style={{ fontSize: 10, opacity: 0.65, marginTop: 4 }}>
                {turn.providerUsed} · {turn.model}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendPrompt(input);
        }}
        style={{
          padding: 10,
          borderTop: "1px solid var(--borderColor-muted, var(--ms-divider))",
          display: "flex",
          gap: 6,
          alignItems: "flex-end",
        }}
      >
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendPrompt(input);
            }
          }}
          placeholder="Ask about this model, fix errors, or simulate…"
          style={{
            flex: 1,
            resize: "none",
            padding: "6px 8px",
            borderRadius: 8,
            fontSize: 12,
            background: isDark ? "#0d1117" : "#ffffff",
            color: "inherit",
            border: "1px solid var(--borderColor-default, #30363d)",
          }}
        />
        {isRunning ? (
          <IconButton
            type="button"
            icon={SquareIcon}
            aria-label="Stop AI generation"
            onClick={() => abortRef.current?.abort()}
          />
        ) : (
          <IconButton
            type="submit"
            variant="primary"
            icon={PaperAirplaneIcon}
            aria-label="Send prompt"
            disabled={!input.trim()}
          />
        )}
      </form>
    </aside>
  );
};
