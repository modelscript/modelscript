// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleFillIcon,
  ChecklistIcon,
  GearIcon,
  PaperAirplaneIcon,
  PlusIcon,
  SparklesFillIcon,
  SquareIcon,
  TrashIcon,
  XCircleFillIcon,
  XIcon,
} from "@primer/octicons-react";
import { Button, IconButton, Label } from "@primer/react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_ANSATZ_AI_SETTINGS,
  escalateAnsatzTurnToArena,
  fallbackTaskTitle,
  fetchAnsatzProvidersInfo,
  generateAnsatzTaskTitle,
  loadAnsatzAiSettings,
  runAnsatzAiTurn,
  saveAnsatzAiSettings,
  submitAnsatzTurnFeedback,
  type AnsatzAiProviderMode,
  type AnsatzAiSettings,
  type AnsatzChatMessage,
  type AnsatzCustomProtocol,
  type AnsatzMemoryRetrievalEvent,
  type AnsatzProvidersInfo,
} from "../util/ansatz-ai-client";
import type {
  AnsatzDiagnosticSummary,
  AnsatzToolCall,
  AnsatzToolHost,
  AnsatzToolResult,
} from "../util/ansatz-tool-bridge";

import type { ComputeDialPreset } from "./AnsatzTrainingStudioPanel";

export interface AnsatzAiPanelProps {
  isOpen: boolean;
  onClose: () => void;
  colorMode: "dark" | "light";
  toolHost: AnsatzToolHost;
  fileName: string;
  dialect: string;
  diagnostics: AnsatzDiagnosticSummary[];
  initialPrompt?: string | undefined;
  onConsumeInitialPrompt?: (() => void) | undefined;
  floating?: boolean | undefined;
  topOffset?: number | undefined;
  bottomOffset?: number | undefined;
  isNarrow?: boolean | undefined;
  width?: number | undefined;
  computeDial?: ComputeDialPreset | undefined;
  onChangeComputeDial?: ((preset: ComputeDialPreset) => void) | undefined;
  packagePins?: Record<string, string> | undefined;
}

interface UiTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string | undefined;
  providerUsed?: AnsatzAiProviderMode | undefined;
  traceId?: string | undefined;
  userRating?: "up" | "down" | undefined;
  escalatedUrl?: string | undefined;
  feedbackMessage?: string | undefined;
  toolCalls: { call: AnsatzToolCall; result?: AnsatzToolResult | undefined }[];
  memoryRetrieval?: AnsatzMemoryRetrievalEvent | undefined;
  error?: string | undefined;
}

export type AnsatzAiTaskStatus = "idle" | "running" | "completed" | "error" | "aborted";

export interface AnsatzAiTask {
  id: string;
  title: string;
  isTitleGenerating: boolean;
  status: AnsatzAiTaskStatus;
  turns: UiTurn[];
  localProgress: string | null;
  createdAt: number;
  updatedAt: number;
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

export const AnsatzAiPanel: React.FC<AnsatzAiPanelProps> = ({
  isOpen,
  onClose,
  colorMode,
  toolHost,
  fileName,
  dialect,
  diagnostics,
  initialPrompt,
  onConsumeInitialPrompt,
  floating = true,
  topOffset = 72,
  bottomOffset = 44,
  isNarrow = false,
  width = 380,
  computeDial,
  onChangeComputeDial,
  packagePins,
}) => {
  const [settings, setSettings] = useState<AnsatzAiSettings>(() => loadAnsatzAiSettings());
  const [providersInfo, setProvidersInfo] = useState<AnsatzProvidersInfo | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [localComputeDial, setLocalComputeDial] = useState<ComputeDialPreset>(computeDial ?? "auto-escalate");
  const [tasks, setTasks] = useState<AnsatzAiTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [isTasksDrawerOpen, setIsTasksDrawerOpen] = useState(false);
  const [input, setInput] = useState("");
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const tasksRef = useRef<AnsatzAiTask[]>(tasks);
  tasksRef.current = tasks;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const activeComputeDial: ComputeDialPreset = computeDial ?? localComputeDial;
  const handleSelectComputeDial = useCallback(
    (preset: ComputeDialPreset) => {
      setLocalComputeDial(preset);
      onChangeComputeDial?.(preset);
    },
    [onChangeComputeDial],
  );

  const isDark = colorMode === "dark";
  const errorCount = diagnostics.filter((d) => d.severity === "error").length;

  const activeTask = useMemo(() => tasks.find((t) => t.id === activeTaskId) ?? null, [tasks, activeTaskId]);
  const turns = activeTask?.turns ?? [];
  const isRunning = activeTask?.status === "running";
  const localProgress = activeTask?.localProgress ?? null;
  const runningTaskCount = useMemo(() => tasks.filter((t) => t.status === "running").length, [tasks]);

  useEffect(() => {
    saveAnsatzAiSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!isOpen) return;
    const ctrl = new AbortController();
    void fetchAnsatzProvidersInfo(ctrl.signal).then((info) => {
      if (info) setProvidersInfo(info);
    });
    return () => ctrl.abort();
  }, [isOpen]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeTaskId, turns.length, localProgress]);

  const updateTask = useCallback((taskId: string, updater: (task: AnsatzAiTask) => AnsatzAiTask) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? updater(t) : t)));
  }, []);

  const handleNewChat = useCallback(() => {
    setActiveTaskId(null);
    setInput("");
  }, []);

  const handleDeleteTask = useCallback(
    (taskId: string) => {
      const ctrl = abortControllersRef.current.get(taskId);
      if (ctrl) {
        ctrl.abort();
        abortControllersRef.current.delete(taskId);
      }
      setTasks((prev) => {
        const next = prev.filter((t) => t.id !== taskId);
        if (activeTaskId === taskId) {
          setActiveTaskId(next[0]?.id ?? null);
        }
        return next;
      });
    },
    [activeTaskId],
  );

  const sendPrompt = useCallback(
    async (promptText: string, forceNewTask = false) => {
      const trimmed = promptText.trim();
      if (!trimmed) return;

      const existing = !forceNewTask && activeTaskId ? tasksRef.current.find((t) => t.id === activeTaskId) : null;
      if (existing && existing.status === "running") {
        // Active task is already running; do not double-submit into it
        return;
      }

      const now = Date.now();
      const taskId = existing ? existing.id : `task_${now}_${Math.random().toString(36).slice(2, 7)}`;
      const isNewTask = !existing;

      const userTurn: UiTurn = {
        id: `u_${now}`,
        role: "user",
        content: trimmed,
        toolCalls: [],
      };
      const assistantId = `a_${now + 1}`;
      const assistantTurn: UiTurn = {
        id: assistantId,
        role: "assistant",
        content: "",
        toolCalls: [],
      };

      const priorTurns = existing ? existing.turns : [];

      if (isNewTask) {
        const newTask: AnsatzAiTask = {
          id: taskId,
          title: fallbackTaskTitle(trimmed),
          isTitleGenerating: true,
          status: "running",
          turns: [userTurn, assistantTurn],
          localProgress: null,
          createdAt: now,
          updatedAt: now,
        };
        setTasks((prev) => [newTask, ...prev]);
        setActiveTaskId(taskId);
        setIsTasksDrawerOpen(true);

        // Generate concise LLM task title in parallel without blocking the main turn
        void generateAnsatzTaskTitle(trimmed, settings).then((generatedTitle) => {
          updateTask(taskId, (t) => ({
            ...t,
            title: generatedTitle,
            isTitleGenerating: false,
          }));
        });
      } else {
        updateTask(taskId, (t) => ({
          ...t,
          status: "running",
          localProgress: null,
          updatedAt: now,
          turns: [...t.turns, userTurn, assistantTurn],
        }));
      }

      setInput("");

      const history: AnsatzChatMessage[] = [
        ...priorTurns.map((t) => ({ role: t.role, content: t.content })),
        { role: "user", content: trimmed },
      ];

      const controller = new AbortController();
      abortControllersRef.current.set(taskId, controller);

      try {
        const res = await runAnsatzAiTurn(history, toolHost, settings, {
          signal: controller.signal,
          computeDial: activeComputeDial,
          packagePins,
          onLocalProgress: (msg) => updateTask(taskId, (t) => ({ ...t, localProgress: msg })),
          onMemoryRetrieval: (evt) => {
            updateTask(taskId, (t) => ({
              ...t,
              updatedAt: Date.now(),
              turns: t.turns.map((turn) => (turn.id === assistantId ? { ...turn, memoryRetrieval: evt } : turn)),
            }));
          },
          onTraceCreated: (evt) => {
            updateTask(taskId, (t) => ({
              ...t,
              updatedAt: Date.now(),
              turns: t.turns.map((turn) => (turn.id === assistantId ? { ...turn, traceId: evt.traceId } : turn)),
            }));
          },
          onTextDelta: (delta) => {
            updateTask(taskId, (t) => ({
              ...t,
              updatedAt: Date.now(),
              turns: t.turns.map((turn) =>
                turn.id === assistantId ? { ...turn, content: turn.content + delta } : turn,
              ),
            }));
          },
          onToolCall: (call) => {
            updateTask(taskId, (t) => ({
              ...t,
              updatedAt: Date.now(),
              turns: t.turns.map((turn) =>
                turn.id === assistantId ? { ...turn, toolCalls: [...turn.toolCalls, { call }] } : turn,
              ),
            }));
          },
          onToolResult: (result) => {
            updateTask(taskId, (t) => ({
              ...t,
              updatedAt: Date.now(),
              turns: t.turns.map((turn) => {
                if (turn.id !== assistantId) return turn;
                const updated = [...turn.toolCalls];
                const idx = updated.findIndex((x) => x.call.name === result.name && !x.result);
                if (idx >= 0) {
                  updated[idx] = { ...updated[idx]!, result };
                }
                return { ...turn, toolCalls: updated };
              }),
            }));
          },
        });

        updateTask(taskId, (t) => ({
          ...t,
          status: "completed",
          localProgress: null,
          updatedAt: Date.now(),
          turns: t.turns.map((turn) =>
            turn.id === assistantId
              ? {
                  ...turn,
                  content: turn.content || res.content,
                  model: res.model,
                  providerUsed: res.providerUsed,
                  memoryRetrieval: turn.memoryRetrieval ?? res.memoryRetrieval,
                  traceId: turn.traceId ?? res.traceId,
                }
              : turn,
          ),
        }));
      } catch (err) {
        const aborted = controller.signal.aborted;
        const message = aborted ? "Stopped by user." : err instanceof Error ? err.message : "AI request failed";
        updateTask(taskId, (t) => ({
          ...t,
          status: aborted ? "aborted" : "error",
          localProgress: null,
          updatedAt: Date.now(),
          turns: t.turns.map((turn) => (turn.id === assistantId ? { ...turn, error: message } : turn)),
        }));
      } finally {
        abortControllersRef.current.delete(taskId);
      }
    },
    [activeComputeDial, activeTaskId, packagePins, settings, toolHost, updateTask],
  );

  useEffect(() => {
    if (isOpen && initialPrompt) {
      void sendPrompt(initialPrompt, true);
      onConsumeInitialPrompt?.();
    }
  }, [isOpen, initialPrompt, sendPrompt, onConsumeInitialPrompt]);

  if (!isOpen) return null;

  const drawerWidth = isNarrow ? 180 : 240;
  const totalWidth = isTasksDrawerOpen ? width + drawerWidth : width;

  return (
    <aside
      data-testid="ansatz-ai-panel"
      aria-label="Ansatz AI Assistant"
      style={{
        ...(isNarrow
          ? {
              position: "fixed",
              top: 56,
              left: 8,
              right: 8,
              bottom: 72,
              width: "auto",
              zIndex: 45,
            }
          : floating
            ? {
                position: "absolute",
                top: topOffset,
                right: 12,
                bottom: bottomOffset,
                width: totalWidth,
                maxWidth: "calc(100% - 24px)",
                zIndex: 25,
              }
            : {
                position: "relative",
                width: totalWidth,
                height: "100%",
                flexShrink: 0,
                zIndex: 10,
              }),
        display: "flex",
        flexDirection: "row",
        borderRadius: "var(--ms-radius-lg, 12px)",
        background: isDark ? "rgba(22, 27, 34, 0.96)" : "rgba(255, 255, 255, 0.96)",
        backdropFilter: "blur(16px)",
        border: "1px solid var(--borderColor-default, var(--ms-border))",
        boxShadow: floating ? "0 12px 36px rgba(0, 0, 0, 0.35)" : undefined,
        overflow: "hidden",
      }}
    >
      {/* Main AI Chat Column */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
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
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <SparklesFillIcon size={16} />
            <span style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap" }}>Ansatz AI</span>
            <Label size="small" variant="accent">
              {settings.mode}
            </Label>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <IconButton
              size="small"
              variant="invisible"
              icon={PlusIcon}
              aria-label="New AI task"
              title="New chat task"
              onClick={handleNewChat}
            />
            <Button
              size="small"
              variant={isTasksDrawerOpen ? "primary" : "invisible"}
              leadingVisual={ChecklistIcon}
              aria-label="Toggle tasks drawer"
              aria-expanded={isTasksDrawerOpen}
              onClick={() => setIsTasksDrawerOpen((o) => !o)}
              style={{ padding: "0 6px", fontSize: 11 }}
            >
              {runningTaskCount > 0 ? `${runningTaskCount}/${tasks.length}` : tasks.length}
            </Button>
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
              onClick={() => {
                if (activeTaskId) {
                  handleDeleteTask(activeTaskId);
                }
              }}
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
            <label htmlFor="ansatz-ai-mode" style={{ opacity: 0.75, fontSize: 11 }}>
              Engine:
            </label>
            <select
              id="ansatz-ai-mode"
              value={settings.mode}
              onChange={(e) => setSettings((s) => ({ ...s, mode: e.target.value as AnsatzAiProviderMode }))}
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

          {/* Test-Time Compute Dial (m=0 <-> 32) */}
          <div
            data-testid="ansatz-ai-compute-dial"
            role="group"
            aria-label="Test-Time Compute Dial (m=0 to 32)"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
            }}
          >
            <span
              title="Dynamic-m Relational Zonotope Test-Time Compute Dial"
              style={{
                opacity: 0.75,
                fontSize: 10.5,
                fontFamily: "var(--ms-font-mono, ui-monospace, monospace)",
                whiteSpace: "nowrap",
              }}
            >
              m=0↔32
            </span>
            <div
              style={{
                flex: 1,
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 2,
                padding: 2,
                borderRadius: 999,
                background: isDark ? "rgba(13, 17, 23, 0.85)" : "rgba(234, 238, 242, 0.9)",
                border: `1px solid ${isDark ? "rgba(48, 54, 61, 0.9)" : "rgba(208, 215, 222, 0.9)"}`,
              }}
            >
              {(
                [
                  ["fast-m0", "Fast (m=0)", "Fast point mode (m=0) — lowest latency"],
                  ["auto-escalate", "Auto (Δ_t>τ)", "Auto-escalate zonotope generators when spread Δ_t > τ"],
                  ["certified-m32", "Certified (m=32)", "Certified relational zonotope mode (m=32)"],
                ] as const
              ).map(([preset, label, title]) => {
                const isSelected = activeComputeDial === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    title={title}
                    aria-pressed={isSelected}
                    onClick={() => handleSelectComputeDial(preset)}
                    style={{
                      border: "none",
                      borderRadius: 999,
                      padding: "3px 5px",
                      fontSize: 10.5,
                      fontWeight: isSelected ? 600 : 500,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      transition: "background 140ms ease, color 140ms ease",
                      background: isSelected
                        ? isDark
                          ? "rgba(56, 189, 248, 0.22)"
                          : "rgba(9, 105, 218, 0.14)"
                        : "transparent",
                      color: isSelected
                        ? isDark
                          ? "#7dd3fc"
                          : "#0969da"
                        : isDark
                          ? "rgba(230, 237, 243, 0.72)"
                          : "rgba(31, 35, 40, 0.72)",
                      boxShadow: isSelected
                        ? isDark
                          ? "inset 0 0 0 1px rgba(56, 189, 248, 0.45)"
                          : "inset 0 0 0 1px rgba(9, 105, 218, 0.35)"
                        : "none",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
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
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, customProtocol: e.target.value as AnsatzCustomProtocol }))
                  }
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
                  ? "Runs Qwen3 WebGPU or Chrome Prompt API locally with AnsatzToolBridge."
                  : "Uses Ansatz backend heavy models & hosted MCP tools (falls back to deterministic engineering mode if unconfigured)."}
              </div>
            )}

            <Button size="small" variant="invisible" onClick={() => setSettings(DEFAULT_ANSATZ_AI_SETTINGS)}>
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
              Ask Ansatz AI to explain equations, fix compiler diagnostics, edit your model, flatten, or run a
              simulation.
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
              {turn.memoryRetrieval && turn.memoryRetrieval.chunkCount > 0 && (
                <div
                  data-testid="ansatz-ai-memory-badge"
                  title={turn.memoryRetrieval.sources
                    .map((s) => `${s.sourceUri} (score=${s.score.toFixed(2)}${s.formalVerified ? ", verified" : ""})`)
                    .join("\n")}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 4,
                    marginBottom: 6,
                    padding: "3px 7px",
                    borderRadius: 6,
                    fontSize: 10.5,
                    background: isDark ? "rgba(56, 189, 248, 0.12)" : "rgba(9, 105, 218, 0.08)",
                    border: `1px solid ${isDark ? "rgba(56, 189, 248, 0.3)" : "rgba(9, 105, 218, 0.22)"}`,
                    color: isDark ? "#7dd3fc" : "#0969da",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>
                    DiskANN · {turn.memoryRetrieval.chunkCount} source
                    {turn.memoryRetrieval.chunkCount === 1 ? "" : "s"} ({turn.memoryRetrieval.latencyMs.toFixed(1)} ms)
                  </span>
                  {turn.memoryRetrieval.sources.slice(0, 3).map((src) => (
                    <span
                      key={src.chunkId}
                      style={{
                        fontSize: 10,
                        padding: "1px 5px",
                        borderRadius: 4,
                        fontFamily: "var(--ms-font-mono, ui-monospace, monospace)",
                        background: isDark ? "rgba(13, 17, 23, 0.55)" : "rgba(255, 255, 255, 0.7)",
                        maxWidth: 180,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {src.packageName
                        ? `${src.packageName}${src.packageVersion ? `@${src.packageVersion}` : ""}`
                        : src.sourceUri}
                    </span>
                  ))}
                </div>
              )}

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
                        {tc.call.name === "ansatz_apply_edit" && tc.result?.previousCode !== undefined && (
                          <button
                            type="button"
                            onClick={() => {
                              toolHost.applyCodeEdit(tc.result!.previousCode!, "Ansatz AI revert");
                              if (turn.traceId) {
                                void submitAnsatzTurnFeedback(turn.traceId, { editOutcome: "reverted" });
                              }
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
                      {tc.call.name === "ansatz_apply_edit" &&
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
                                    d.kind === "del"
                                      ? isDark
                                        ? "#ff7b72"
                                        : "#cf222e"
                                      : isDark
                                        ? "#7ee787"
                                        : "#1a7f37",
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

              {turn.role === "assistant" && turn.traceId && activeTask && (
                <div
                  data-testid="ansatz-ai-feedback-bar"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flexWrap: "wrap",
                    marginTop: 6,
                    paddingTop: 5,
                    borderTop: "1px solid var(--borderColor-muted, rgba(128,128,128,0.2))",
                    fontSize: 10,
                  }}
                >
                  <button
                    type="button"
                    title="Helpful response"
                    onClick={() => {
                      const tid = turn.traceId!;
                      const taskId = activeTask.id;
                      updateTask(taskId, (t) => ({
                        ...t,
                        turns: t.turns.map((u) => (u.id === turn.id ? { ...u, userRating: "up" } : u)),
                      }));
                      void submitAnsatzTurnFeedback(tid, { userRating: "up", editOutcome: "accepted" });
                    }}
                    style={{
                      fontSize: 10,
                      padding: "1px 6px",
                      borderRadius: 4,
                      border: "1px solid var(--borderColor-default, #30363d)",
                      background: turn.userRating === "up" ? "rgba(46,160,67,0.2)" : "transparent",
                      color: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    Helpful
                  </button>
                  <button
                    type="button"
                    title="Needs work"
                    onClick={() => {
                      const tid = turn.traceId!;
                      const taskId = activeTask.id;
                      updateTask(taskId, (t) => ({
                        ...t,
                        turns: t.turns.map((u) => (u.id === turn.id ? { ...u, userRating: "down" } : u)),
                      }));
                      void submitAnsatzTurnFeedback(tid, { userRating: "down" });
                    }}
                    style={{
                      fontSize: 10,
                      padding: "1px 6px",
                      borderRadius: 4,
                      border: "1px solid var(--borderColor-default, #30363d)",
                      background: turn.userRating === "down" ? "rgba(248,81,73,0.2)" : "transparent",
                      color: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    Needs Fix
                  </button>
                  <button
                    type="button"
                    title="Contribute your current verified editor code as a Gate 1-4 fix (+15 credits)"
                    onClick={() => {
                      const tid = turn.traceId!;
                      const taskId = activeTask.id;
                      const currentCode = toolHost.getCode();
                      void submitAnsatzTurnFeedback(tid, {
                        editOutcome: "manual_fixed",
                        userFixedCode: currentCode,
                        allowTrainingOptIn: true,
                      }).then((fb) => {
                        updateTask(taskId, (t) => ({
                          ...t,
                          turns: t.turns.map((u) =>
                            u.id === turn.id
                              ? {
                                  ...u,
                                  feedbackMessage: fb?.harvestedToDiskAnn
                                    ? `Verified fix indexed (+${fb.creditsAwarded ?? 0} cr)`
                                    : "Feedback recorded",
                                }
                              : u,
                          ),
                        }));
                      });
                    }}
                    style={{
                      fontSize: 10,
                      padding: "1px 6px",
                      borderRadius: 4,
                      border: "1px solid var(--borderColor-default, #30363d)",
                      background: "transparent",
                      color: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    Contribute Fix
                  </button>
                  {turn.escalatedUrl ? (
                    <a
                      href={turn.escalatedUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "var(--fgColor-accent, #58a6ff)", textDecoration: "underline" }}
                    >
                      Open Arena Challenge
                    </a>
                  ) : (
                    <button
                      type="button"
                      title="Escalate to Social RLHF Arena for community engineers"
                      onClick={() => {
                        const tid = turn.traceId!;
                        const taskId = activeTask.id;
                        void escalateAnsatzTurnToArena(tid, { challengeType: "fix_it_bounty" }).then((esc) => {
                          if (!esc) return;
                          updateTask(taskId, (t) => ({
                            ...t,
                            turns: t.turns.map((u) => (u.id === turn.id ? { ...u, escalatedUrl: esc.annotateUrl } : u)),
                          }));
                        });
                      }}
                      style={{
                        fontSize: 10,
                        padding: "1px 6px",
                        borderRadius: 4,
                        border: "1px solid var(--borderColor-default, #30363d)",
                        background: "transparent",
                        color: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      Escalate to Arena
                    </button>
                  )}
                  {turn.feedbackMessage && <span style={{ opacity: 0.8 }}>{turn.feedbackMessage}</span>}
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
              onClick={() => {
                if (activeTaskId) {
                  abortControllersRef.current.get(activeTaskId)?.abort();
                }
              }}
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
      </div>

      {/* Expandable Tasks Drawer (to the right of the main AI chat panel) */}
      {isTasksDrawerOpen && (
        <div
          data-testid="ansatz-ai-tasks-drawer"
          aria-label="AI Tasks"
          style={{
            width: drawerWidth,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            borderLeft: "1px solid var(--borderColor-muted, var(--ms-divider))",
            background: isDark ? "rgba(13, 17, 23, 0.72)" : "rgba(246, 248, 250, 0.85)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 10px",
              borderBottom: "1px solid var(--borderColor-muted, var(--ms-divider))",
              gap: 6,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 12 }}>Tasks ({tasks.length})</span>
            <Button
              size="small"
              variant="invisible"
              leadingVisual={PlusIcon}
              onClick={handleNewChat}
              style={{ padding: "0 6px", fontSize: 11 }}
            >
              New
            </Button>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: 6,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {tasks.length === 0 ? (
              <div style={{ padding: 10, fontSize: 11, opacity: 0.65, lineHeight: 1.4 }}>
                Each new chat creates a task here. Multiple tasks can run simultaneously.
              </div>
            ) : (
              tasks.map((task) => {
                const isActive = task.id === activeTaskId;
                const statusColor =
                  task.status === "running"
                    ? isDark
                      ? "#58a6ff"
                      : "#0969da"
                    : task.status === "completed"
                      ? isDark
                        ? "#3fb950"
                        : "#1a7f37"
                      : task.status === "error"
                        ? isDark
                          ? "#f85149"
                          : "#cf222e"
                        : isDark
                          ? "#8b949e"
                          : "#6e7781";
                return (
                  <div
                    key={task.id}
                    data-testid={`ansatz-ai-task-${task.id}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveTaskId(task.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setActiveTaskId(task.id);
                      }
                    }}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 6,
                      padding: "7px 8px",
                      borderRadius: 8,
                      cursor: "pointer",
                      background: isActive
                        ? isDark
                          ? "rgba(56, 139, 253, 0.16)"
                          : "rgba(9, 105, 218, 0.1)"
                        : "transparent",
                      border: isActive
                        ? "1px solid var(--borderColor-accent-muted, rgba(56, 139, 253, 0.4))"
                        : "1px solid transparent",
                    }}
                  >
                    <span
                      title={task.status}
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        backgroundColor: statusColor,
                        marginTop: 5,
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: isActive ? 600 : 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={task.title}
                      >
                        {task.title}
                      </div>
                      <div style={{ fontSize: 10, opacity: 0.65, marginTop: 2 }}>
                        {task.status === "running"
                          ? "Running…"
                          : `${Math.max(1, Math.floor(task.turns.length / 2))} turn${Math.floor(task.turns.length / 2) === 1 ? "" : "s"} · ${task.status}`}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Delete task ${task.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteTask(task.id);
                      }}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "inherit",
                        opacity: 0.55,
                        cursor: "pointer",
                        padding: 2,
                        lineHeight: 1,
                      }}
                    >
                      <XIcon size={12} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
