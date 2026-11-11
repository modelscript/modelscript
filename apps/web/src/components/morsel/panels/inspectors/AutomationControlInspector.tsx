// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable react-refresh/only-export-components */

import React, { useMemo, useState } from "react";

export interface AutomationControlInspectorProps {
  code: string;
  lines: string[];
  colorMode: "dark" | "light";
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
}

export interface SfcStep {
  name: string;
  isInitial: boolean;
  actions: string[];
  line: number;
}

export interface SfcTransition {
  from: string;
  to: string;
  condition: string;
  line: number;
}

export interface AutomationSummary {
  steps: SfcStep[];
  transitions: SfcTransition[];
  tasks: Array<{ name: string; intervalMs: number; priority: number; wcetMs: number; line: number }>;
  interlocks: Array<{ symbol: string; expression: string; line: number }>;
}

function parseIecDurationMs(raw: string): number {
  const m = /(?:T|TIME)#([0-9.]+)(ms|s|m|us)/i.exec(raw);
  if (!m) return 10;
  const val = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  if (unit === "us") return val / 1000;
  if (unit === "ms") return val;
  if (unit === "s") return val * 1000;
  if (unit === "m") return val * 60000;
  return 10;
}

export function analyzeAutomationSfc(_code: string, lines: string[]): AutomationSummary {
  const stepMap = new Map<string, SfcStep>();
  const transitions: SfcTransition[] = [];
  const tasks: AutomationSummary["tasks"] = [];
  const interlocks: AutomationSummary["interlocks"] = [];

  let activeStep: SfcStep | null = null;
  let logicOpCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (!t || t.startsWith("//") || t.startsWith("(*") || t.startsWith("<!--")) continue;

    // ST SFC steps: INITIAL_STEP Init: ... END_STEP or STEP Run: ... END_STEP
    const stStep = /^(INITIAL_STEP|STEP)\s+([A-Za-z_]\w*)\s*:?/.exec(t);
    if (stStep) {
      const s: SfcStep = {
        name: stStep[2]!,
        isInitial: stStep[1] === "INITIAL_STEP",
        actions: [],
        line: i + 1,
      };
      stepMap.set(s.name, s);
      activeStep = s;
      continue;
    }
    if (/^END_STEP\b/i.test(t)) {
      activeStep = null;
      continue;
    }

    // PLCopen XML <step name="..." initialStep="true">
    const xmlStep = /<step\b[^>]*\bname=["']([^"']+)["']([^>]*)>/i.exec(t);
    if (xmlStep) {
      const name = xmlStep[1]!;
      const isInitial = /\binitialStep=["']true["']/i.test(xmlStep[2]!);
      const s: SfcStep = { name, isInitial, actions: [], line: i + 1 };
      stepMap.set(name, s);
      activeStep = s;
      continue;
    }
    if (/<\/step>/i.test(t)) {
      activeStep = null;
      continue;
    }

    // Actions inside active step
    if (activeStep) {
      const xmlAct = /<actionBlock\b|<reference\b[^>]*\bname=["']([^"']+)["']/i.exec(t);
      if (xmlAct?.[1]) {
        activeStep.actions.push(xmlAct[1]);
        continue;
      }
      const stAct = /^([A-Za-z_]\w*)\s*\(\s*([NP01SLD]|DS|SD|SL)\s*\)\s*;/.exec(t);
      if (stAct) {
        activeStep.actions.push(`${stAct[1]}(${stAct[2]})`);
        continue;
      }
      const assignAct = /^([A-Za-z_]\w*)\s*:=\s*([^;]+);/.exec(t);
      if (assignAct) {
        activeStep.actions.push(`${assignAct[1]} := ${assignAct[2]!.trim()}`);
        logicOpCount++;
        continue;
      }
    }

    // ST TRANSITION FROM StepA TO StepB := Cond;
    const stTrans =
      /^TRANSITION\b(?:\s+[A-Za-z_]\w*)?\s+FROM\s+([A-Za-z_]\w*)\s+TO\s+([A-Za-z_]\w*)\s*:=\s*([^;]+)/i.exec(t);
    if (stTrans) {
      transitions.push({
        from: stTrans[1]!,
        to: stTrans[2]!,
        condition: stTrans[3]!.trim(),
        line: i + 1,
      });
      continue;
    }

    // Task configuration (ST TASK MainTask(INTERVAL := T#10ms, PRIORITY := 1); or XML <task name="..." interval="...">)
    const stTask = /^TASK\s+([A-Za-z_]\w*)\s*\(([^)]+)\)/i.exec(t);
    if (stTask) {
      const intervalMs = parseIecDurationMs(stTask[2]!);
      const prio = Number(/\bPRIORITY\s*:=\s*(\d+)/i.exec(stTask[2]!)?.[1] ?? 1);
      tasks.push({ name: stTask[1]!, intervalMs, priority: prio, wcetMs: 0, line: i + 1 });
      continue;
    }
    const xmlTask = /<task\b[^>]*\bname=["']([^"']+)["']([^>]*)>/i.exec(t);
    if (xmlTask) {
      const intervalMs = parseIecDurationMs(xmlTask[2]!);
      const prio = Number(/\bpriority=["'](\d+)["']/i.exec(xmlTask[2]!)?.[1] ?? 1);
      tasks.push({ name: xmlTask[1]!, intervalMs, priority: prio, wcetMs: 0, line: i + 1 });
      continue;
    }

    // Count general ST statements & detect safety interlock guards
    if (t.includes(":=") || /^IF\b/i.test(t) || /^ELSIF\b/i.test(t)) {
      logicOpCount++;
      if (/\b(estop|e_stop|emergency|fault|interlock|safety|guard|overtemp|trip)\b/i.test(t)) {
        const sym = /^([A-Za-z_]\w*)\s*:=/.exec(t)?.[1] ?? "SafetyGuard";
        interlocks.push({ symbol: sym, expression: t.replace(/;\s*$/, "").slice(0, 80), line: i + 1 });
      }
    }
  }

  const steps = Array.from(stepMap.values());
  const estimatedWcetMs = Number(
    Math.max(0.05, (logicOpCount + steps.length * 3 + transitions.length * 2) * 0.018).toFixed(2),
  );
  for (const task of tasks) {
    task.wcetMs = estimatedWcetMs;
  }
  if (tasks.length === 0 && (steps.length > 0 || logicOpCount > 0)) {
    tasks.push({
      name: "DefaultScanTask",
      intervalMs: 10,
      priority: 1,
      wcetMs: estimatedWcetMs,
      line: 1,
    });
  }

  return { steps, transitions, tasks, interlocks };
}

export const AutomationControlInspector: React.FC<AutomationControlInspectorProps> = ({
  code,
  lines,
  colorMode,
  onRevealLine,
}) => {
  const isDark = colorMode === "dark";
  const [subView, setSubView] = useState<"sfc" | "schedule" | "safety">("sfc");

  const borderCol = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
  const cardBg = isDark ? "rgba(22, 27, 34, 0.7)" : "rgba(255, 255, 255, 0.9)";
  const textPrimary = isDark ? "#e6edf3" : "#1f2328";
  const textMuted = isDark ? "#8b949e" : "#59636e";

  const { steps, transitions, tasks, interlocks } = useMemo(() => analyzeAutomationSfc(code, lines), [code, lines]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {[
          { id: "sfc", label: `⚙️ SFC State Graph (${steps.length} steps)` },
          { id: "schedule", label: `⏱️ Scan Cycle & WCET (${tasks.length} tasks)` },
          { id: "safety", label: `🛡️ Safety Interlocks (${interlocks.length})` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubView(t.id as typeof subView)}
            style={{
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              border: `1px solid ${borderCol}`,
              cursor: "pointer",
              backgroundColor: subView === t.id ? "#1f6feb" : cardBg,
              color: subView === t.id ? "#ffffff" : textPrimary,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subView === "sfc" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            IEC 61131-3 Sequential Function Chart (SFC) Steps & Transitions
          </div>
          {steps.length === 0 && transitions.length === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>
              No SFC <code>INITIAL_STEP</code> / <code>STEP</code> blocks found in this POU (pure Structured Text / FBD
              logic). Switch to <strong>Scan Cycle &amp; WCET</strong> or <strong>Safety Interlocks</strong> to inspect
              timing and guards.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {steps.map((s) => (
                <div
                  key={s.name}
                  onClick={() => onRevealLine?.(s.line, s.name)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: `1px solid ${s.isInitial ? "#3fb950" : borderCol}`,
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 11,
                    fontFamily: "monospace",
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 700, color: s.isInitial ? "#3fb950" : "#58a6ff" }}>
                      {s.isInitial ? `[INITIAL] ${s.name}` : s.name}
                    </span>
                    <span style={{ color: textMuted, marginLeft: 10 }}>Actions: {s.actions.join(", ") || "Idle"}</span>
                  </div>
                  <span style={{ color: textMuted }}>L{s.line}</span>
                </div>
              ))}
              {transitions.map((tr, idx) => (
                <div
                  key={idx}
                  onClick={() => onRevealLine?.(tr.line, tr.from)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: `1px dashed ${borderCol}`,
                    cursor: "pointer",
                    fontSize: 11,
                    fontFamily: "monospace",
                    color: textMuted,
                  }}
                >
                  {tr.from} ──[ <strong style={{ color: "#d29922" }}>{tr.condition}</strong> ]──▶ {tr.to} (L{tr.line})
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subView === "schedule" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            Cyclic PLC Task Deadlines & Estimated WCET Utilization
          </div>
          {tasks.length === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>No cyclic PLC tasks or executable statements parsed.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {tasks.map((task, idx) => {
                const utilPct = Number(((task.wcetMs / Math.max(task.intervalMs, 0.001)) * 100).toFixed(1));
                const ok = utilPct <= 80;
                return (
                  <div
                    key={idx}
                    onClick={() => onRevealLine?.(task.line, task.name)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 6,
                      border: `1px solid ${borderCol}`,
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 11,
                      fontFamily: "monospace",
                    }}
                  >
                    <span style={{ fontWeight: 700, color: "#58a6ff" }}>
                      {task.name} (Priority {task.priority})
                    </span>
                    <span>
                      WCET ≈ {task.wcetMs} ms / Period {task.intervalMs} ms
                    </span>
                    <span style={{ color: ok ? "#3fb950" : "#f85149", fontWeight: 700 }}>
                      {utilPct}% {ok ? "✓ Schedulable" : "⚠ Overrun Risk"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {subView === "safety" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            Safety Interlock & Fault-Guard Statements (IEC 61508 / ISO 13849)
          </div>
          {interlocks.length === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>
              No explicit E-Stop, fault, or safety-guard boolean expressions detected in the active POU.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {interlocks.map((il, idx) => (
                <div
                  key={idx}
                  onClick={() => onRevealLine?.(il.line, il.symbol)}
                  style={{
                    padding: "7px 10px",
                    borderRadius: 6,
                    border: `1px solid ${borderCol}`,
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 11,
                    fontFamily: "monospace",
                  }}
                >
                  <span style={{ color: textPrimary }}>{il.expression}</span>
                  <span style={{ color: "#3fb950", fontWeight: 600 }}>L{il.line}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
