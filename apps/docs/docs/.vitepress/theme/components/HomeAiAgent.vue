<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { IconName } from "../data/icons";
import MsIcon from "./MsIcon.vue";

interface AgentToolCall {
  tool: string;
  args: string;
  resultTitle: string;
  metrics: { label: string; value: string; status?: "pass" | "info" }[];
}

interface AgentScenario {
  id: string;
  badge: string;
  icon: IconName;
  title: string;
  prompt: string;
  summary: string;
  calls: AgentToolCall[];
  verdict: string;
}

const scenarios: AgentScenario[] = [
  {
    id: "synthesize",
    badge: "Closed-Loop Synthesis",
    icon: "sparkles",
    title: "Autonomous controller tuning with STL proofs",
    prompt:
      "Tune the DC motor PID gains in Actuator.mo so step overshoot stays below 4% and settling time is under 0.35s.",
    summary:
      "The agent invokes sensitivity-guided parameter synthesis over the DAE arena until every Signal Temporal Logic (STL) requirement holds.",
    calls: [
      {
        tool: "modelica_flatten",
        args: '{ "className": "Actuator.DCMotorPID" }',
        resultTitle: "Arena DAE lowered · 18 states/algebraics · 18 equations [Balanced]",
        metrics: [
          { label: "Index reduction", value: "Index-1 ODE", status: "info" },
          { label: "BLT blocks", value: "6×6 torn", status: "info" },
        ],
      },
      {
        tool: "modelscript_closed_loop_synthesize",
        args: '{ "className": "Actuator.DCMotorPID", "tunableParameters": ["Kp", "Ki", "Kd"], "tEnd": 1.0 }',
        resultTitle: "Converged in 4 sensitivity iterations (SUNDIALS CVODE + Forward AD)",
        metrics: [
          { label: "Overshoot", value: "2.8% (< 4.0%)", status: "pass" },
          { label: "Settling time", value: "0.29s (< 0.35s)", status: "pass" },
          { label: "STL robustness ρ", value: "+0.062 PASS", status: "pass" },
        ],
      },
    ],
    verdict: "Verified patch applied: Kp = 14.2, Ki = 38.5, Kd = 0.84",
  },
  {
    id: "tgg",
    badge: "Cross-Domain Digital Thread",
    icon: "link",
    title: "SysML v2 ↔ Modelica bidirectional reconciliation",
    prompt:
      "Check whether BrakeSystem.mo satisfies the SysML v2 architecture constraints and reconcile any parameter drift.",
    summary:
      "Triple Graph Grammar (TGG) rules inspect correspondence links across architecture and physics models, resolving conflicts with AST-level precision.",
    calls: [
      {
        tool: "validate_system_consistency",
        args: '{ "sysmlCode": "part def BrakeSystem ...", "modelicaCode": "model BrakeSystem ..." }',
        resultTitle: "1 parameter divergence detected on slot BrakeActuator.maxPressure",
        metrics: [
          { label: "Port topology", value: "12 / 12 matched", status: "pass" },
          { label: "SI units", value: "Pa ≡ N/m²", status: "pass" },
        ],
      },
      {
        tool: "tgg_reconcile_slot",
        args: '{ "slotId": "BrakeActuator.maxPressure", "authority": "sysml" }',
        resultTitle: "Propagated authoritative SysML v2 constraint (18.5 MPa) into Modelica binding",
        metrics: [
          { label: "CPA conflicts", value: "0 remaining", status: "pass" },
          { label: "RTM status", value: "@satisfies valid", status: "pass" },
        ],
      },
    ],
    verdict: "Synchronized BrakeSystem.sysml ↔ BrakeSystem.mo with 100% RTM coverage",
  },
  {
    id: "grid",
    badge: "Grid Compliance · EMT",
    icon: "zap",
    title: "Automated IEEE 2800 ride-through verification",
    prompt:
      "Run EMT lint checks and verify IEEE Std 2800 LVRT compliance on SolarPlant_250MW.pscx for a 0.15 pu fault.",
    summary:
      "AI agents execute fixed-step nodal admittance EMT simulations and evaluate standard ride-through envelopes without a desktop license.",
    calls: [
      {
        tool: "pscad_lint",
        args: '{ "fileName": "SolarPlant_250MW.pscx" }',
        resultTitle: "Checked 11 EMT static rules (M6001–M6011) across 42 buses",
        metrics: [
          { label: "Diagnostics", value: "0 errors, 0 warnings", status: "pass" },
          { label: "Step ratio", value: "20 μs validated", status: "info" },
        ],
      },
      {
        tool: "pscad_verify_ieee2800",
        args: '{ "tStop": 3.0, "stepUs": 20.0 }',
        resultTitle: "IEEE Std 2800-2022 Clause 7.2 LVRT & reactive current injection check",
        metrics: [
          { label: "LVRT envelope", value: "No trip (3.0s)", status: "pass" },
          { label: "Reactive response", value: "tr = 28 ms (≤ 30 ms)", status: "pass" },
          { label: "Post-fault recovery", value: "96.4% at 0.5s", status: "pass" },
        ],
      },
    ],
    verdict: "Compliance report generated · All IEEE 2800 ride-through criteria satisfied",
  },
];

const active = ref(0);
const interacted = ref(false);
const copied = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

function select(index: number): void {
  active.value = index;
  interacted.value = true;
  if (timer) clearInterval(timer);
}

async function copyMcpCommand(): Promise<void> {
  try {
    await navigator.clipboard.writeText("npx -y @modelscript/mcp");
    copied.value = true;
    setTimeout(() => (copied.value = false), 1800);
  } catch {
    /* clipboard unavailable */
  }
}

onMounted(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  timer = setInterval(() => {
    if (!interacted.value) active.value = (active.value + 1) % scenarios.length;
  }, 6500);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <section class="ms-section home-ai" aria-label="AI Agents and Model Context Protocol">
    <div class="ms-container">
      <header class="ms-section-head">
        <span class="ms-eyebrow">AI-Native Engineering · Model Context Protocol</span>
        <h2 class="ms-h2">Give AI agents a deterministic compiler and physics engine</h2>
        <p class="ms-lead">
          Language models hallucinate when guessing differential equations in plain text.
          <code>@modelscript/mcp</code> exposes 31 compiler, solver, and formal verification tools so AI agents can
          compile, simulate, and prove engineering designs in a closed loop.
        </p>
      </header>

      <div class="ai-layout">
        <!-- Left column: Scenario selector + MCP quick config -->
        <div class="ai-sidebar">
          <div class="ai-tabs" role="tablist" aria-label="AI agent workflows">
            <button
              v-for="(s, i) in scenarios"
              :key="s.id"
              type="button"
              role="tab"
              class="ai-tab"
              :class="{ active: active === i }"
              :aria-selected="active === i"
              :aria-controls="`ai-panel-${s.id}`"
              @click="select(i)"
            >
              <div class="ai-tab-top">
                <span class="ai-tab-icon"><MsIcon :name="s.icon" :size="20" :duotone="true" /></span>
                <span class="ai-tab-badge">{{ s.badge }}</span>
              </div>
              <span class="ai-tab-title">{{ s.title }}</span>
              <span class="ai-tab-summary">{{ s.summary }}</span>
              <span v-if="active === i && !interacted" class="ai-tab-progress" aria-hidden="true" />
            </button>
          </div>

          <div class="mcp-config-card">
            <div class="mcp-config-head">
              <span class="mcp-config-title">
                <MsIcon name="terminal" :size="15" /> Connect Claude, Cursor, or Windsurf
              </span>
              <a href="/reference/mcp-and-ide" class="mcp-config-link">
                All 31 MCP tools <MsIcon name="arrowRight" :size="13" :stroke="2" />
              </a>
            </div>
            <div class="mcp-cmd-row">
              <code>npx -y @modelscript/mcp</code>
              <button type="button" class="mcp-copy-btn" @click="copyMcpCommand">
                {{ copied ? "Copied" : "Copy" }}
              </button>
            </div>
            <div class="mcp-tiers">
              <span class="mcp-tier">stdio &amp; SSE transports</span>
              <span class="mcp-tier">In-WASM AOT dispatch</span>
              <a href="/llms.txt" target="_blank" rel="noopener" class="mcp-tier mcp-tier-link">llms.txt context ↗</a>
            </div>
          </div>
        </div>

        <!-- Right column: Live Agent / MCP Inspector trace -->
        <div
          v-for="(s, i) in scenarios"
          v-show="active === i"
          :id="`ai-panel-${s.id}`"
          :key="s.id"
          role="tabpanel"
          class="ai-console"
        >
          <div class="console-bar">
            <div class="console-dots">
              <span class="dot" /><span class="dot" /><span class="dot" />
            </div>
            <span class="console-title">mcp://modelscript · agent session</span>
            <span class="console-status"><span class="status-dot" /> WASM Kernel Ready</span>
          </div>

          <div class="console-body">
            <!-- Engineer prompt -->
            <div class="msg-prompt">
              <span class="msg-role">Engineer Prompt</span>
              <p>{{ s.prompt }}</p>
            </div>

            <!-- Tool call trace -->
            <div v-for="(call, idx) in s.calls" :key="call.tool" class="tool-step">
              <div class="tool-header">
                <span class="tool-step-num">0{{ idx + 1 }}</span>
                <span class="tool-rpc">JSON-RPC tools/call</span>
                <code class="tool-name">{{ call.tool }}</code>
              </div>
              <pre class="tool-args"><code>{{ call.args }}</code></pre>

              <div class="tool-result">
                <div class="tool-result-title">
                  <MsIcon name="check" :size="14" :stroke="2.25" />
                  <span>{{ call.resultTitle }}</span>
                </div>
                <div class="tool-metrics">
                  <div
                    v-for="m in call.metrics"
                    :key="m.label"
                    class="tool-metric"
                    :class="{ pass: m.status === 'pass' }"
                  >
                    <span class="metric-label">{{ m.label }}</span>
                    <span class="metric-val">{{ m.value }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Final verified synthesis verdict -->
            <div class="console-verdict">
              <span class="verdict-icon"><MsIcon name="shield" :size="18" :duotone="true" /></span>
              <div class="verdict-text">
                <span class="verdict-label">Deterministic Compiler Proof</span>
                <span class="verdict-body">{{ s.verdict }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ai-layout {
  display: grid;
  grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
  gap: 28px;
  align-items: start;
}

.ai-sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ai-tabs {
  display: grid;
  gap: 10px;
}

.ai-tab {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 20px;
  border-radius: 16px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  text-align: left;
  overflow: hidden;
  transition:
    border-color 0.25s ease,
    background 0.25s ease,
    box-shadow 0.25s ease;
}

.ai-tab:hover {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 40%, transparent);
}

.ai-tab.active {
  background: var(--vp-c-bg);
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 55%, transparent);
  box-shadow: 0 18px 38px -22px rgba(6, 182, 212, 0.35);
}

.ai-tab-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.ai-tab-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  color: var(--vp-c-brand-1);
  background:
    radial-gradient(circle at 25% 20%, rgba(34, 211, 238, 0.22), transparent 68%),
    radial-gradient(circle at 80% 85%, rgba(129, 140, 248, 0.16), transparent 68%),
    var(--vp-c-brand-soft);
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 28%, transparent);
}

.ai-tab-badge {
  padding: 2px 9px;
  border-radius: 999px;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.ai-tab-title {
  margin-top: 4px;
  font-size: 1rem;
  font-weight: 680;
  color: var(--vp-c-text-1);
}

.ai-tab-summary {
  display: none;
  font-size: 0.86rem;
  line-height: 1.55;
  color: var(--vp-c-text-2);
}

.ai-tab.active .ai-tab-summary {
  display: block;
}

.ai-tab-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  width: 100%;
  background: var(--ms-gradient);
  transform-origin: left;
  animation: ai-progress 6.5s linear forwards;
}

@keyframes ai-progress {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

.mcp-config-card {
  padding: 16px 18px;
  border-radius: 16px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mcp-config-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.mcp-config-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--vp-c-text-1);
}

.mcp-config-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.mcp-cmd-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px 7px 12px;
  border-radius: 10px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
}

.mcp-cmd-row code {
  flex: 1;
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  color: var(--vp-c-text-1);
  background: none;
  padding: 0;
}

.mcp-copy-btn {
  padding: 5px 11px;
  border-radius: 7px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.mcp-tiers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mcp-tier {
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  text-decoration: none;
}

.mcp-tier-link {
  color: var(--vp-c-brand-1);
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 35%, transparent);
}

/* Console panel */
.ai-console {
  border-radius: 18px;
  overflow: hidden;
  background: #080d19;
  border: 1px solid rgba(148, 163, 184, 0.2);
  box-shadow:
    0 36px 72px -36px rgba(6, 182, 212, 0.38),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.console-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 16px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
}

.console-dots {
  display: flex;
  gap: 6px;
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #334155;
}

.console-title {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: #94a3b8;
}

.console-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: #2dd4bf;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #2dd4bf;
  box-shadow: 0 0 8px #2dd4bf;
}

.console-body {
  padding: 18px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.msg-prompt {
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(129, 140, 248, 0.26);
}

.msg-role {
  display: block;
  margin-bottom: 4px;
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #a5b4fc;
}

.msg-prompt p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: #e2e8f0;
}

.tool-step {
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.16);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tool-step-num {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: #64748b;
}

.tool-rpc {
  padding: 1px 7px;
  border-radius: 4px;
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.12);
}

.tool-name {
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  font-weight: 600;
  color: #22d3ee;
  background: none;
  padding: 0;
}

.tool-args {
  margin: 0;
  padding: 7px 10px;
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.65);
  border: 1px solid rgba(148, 163, 184, 0.1);
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  color: #cbd5e1;
  overflow-x: auto;
}

.tool-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 4px;
}

.tool-result-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 550;
  color: #2dd4bf;
}

.tool-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 8px;
}

.tool-metric {
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(148, 163, 184, 0.14);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tool-metric.pass {
  border-color: rgba(45, 212, 191, 0.3);
  background: rgba(20, 184, 166, 0.08);
}

.metric-label {
  font-size: 10.5px;
  color: #94a3b8;
}

.metric-val {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  font-weight: 600;
  color: #f1f5f9;
}

.console-verdict {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: linear-gradient(90deg, rgba(20, 184, 166, 0.16), rgba(34, 211, 238, 0.08));
  border: 1px solid rgba(45, 212, 191, 0.35);
}

.verdict-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  color: #2dd4bf;
  background: rgba(20, 184, 166, 0.2);
  flex-shrink: 0;
}

.verdict-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.verdict-label {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #5eead4;
}

.verdict-body {
  font-size: 12.5px;
  font-weight: 600;
  color: #f8fafc;
}

@media (max-width: 960px) {
  .ai-layout {
    grid-template-columns: 1fr;
  }
}
</style>
