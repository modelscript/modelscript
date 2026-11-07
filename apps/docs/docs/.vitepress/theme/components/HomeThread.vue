<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { IconName } from "../data/icons";
import languagesData from "../data/languages.generated.json";
import MsIcon from "./MsIcon.vue";

const totalLintRules = languagesData.reduce((sum, lang) => sum + lang.ruleCount, 0);
const lintedLanguageCount = languagesData.filter((lang) => lang.ruleCount > 0).length;

interface ThreadStep {
  id: string;
  icon: IconName;
  title: string;
  body: string;
  lines: { kind: "comment" | "cmd"; text: string }[];
  artifactLabel?: string;
  artifacts: string[];
}

// Commands below are taken verbatim from /cli/commands.
const steps: ThreadStep[] = [
  {
    id: "import",
    icon: "download",
    title: "Import",
    body: "Bring legacy and vendor models into one typed, version-controlled workspace without rewriting them.",
    lines: [
      { kind: "comment", text: "# Translate a Simulink block diagram to Modelica" },
      { kind: "cmd", text: "msx simulink to-modelica Suspension.slx --out=Suspension.mo" },
      { kind: "comment", text: "# Project AUTOSAR software components into SysML v2" },
      { kind: "cmd", text: "msx autosar to-sysml Steering.arxml --out=Steering.sysml" },
    ],
    artifactLabel: "Sources",
    artifacts: [".slx", ".arxml", ".pscx", ".step", ".sysml"],
  },
  {
    id: "analyze",
    icon: "search",
    title: "Analyze",
    body: `${totalLintRules} lint rules across ${lintedLanguageCount} languages catch unresolved references, type and unit mismatches, and unbalanced equations as you type.`,
    lines: [
      { kind: "comment", text: "# Lint an entire polyglot workspace for CI" },
      { kind: "cmd", text: "msx lint ./models ./requirements --format json" },
      { kind: "comment", text: "# Semantic diff for code review" },
      { kind: "cmd", text: "msx diff old/Plant.mo new/Plant.mo" },
    ],
    artifacts: ["JSON diagnostics", "LSP", "PR diff"],
  },
  {
    id: "simulate",
    icon: "activity",
    title: "Simulate",
    body: "Index reduction, BLT partitioning, and tearing feed stiff ODE/DAE solvers, from the browser to the cloud.",
    lines: [
      { kind: "comment", text: "# Stiff DAE with sparse symbolic Jacobians" },
      {
        kind: "cmd",
        text: "msx simulate RLC_Circuit circuit.mo --stop-time 10.0 --solver rodas4p --jacobian sparse --format csv",
      },
      { kind: "comment", text: "# Monte Carlo uncertainty study" },
      { kind: "cmd", text: 'msx mc RLC_Filter filter.mo --params "R:gaussian:100:5,C:uniform:1e-6:1.2e-6"' },
    ],
    artifacts: ["CSV trajectories", "Surrogates", "Monte Carlo"],
  },
  {
    id: "verify",
    icon: "shield",
    title: "Verify",
    body: "Check contracts, decision tables and state machines, falsify temporal-logic requirements, and emit SARIF evidence for code scanning.",
    lines: [
      { kind: "comment", text: "# Contract verification with a SARIF report" },
      {
        kind: "cmd",
        text: "msx verify BrakingController brake.mo --format sarif --report results.sarif",
      },
      { kind: "comment", text: "# Grid-code compliance from a PSCAD project" },
      { kind: "cmd", text: "msx pscad verify-ieee2800 SolarPlant_250MW.pscx --tstop 3.0 --step 20us" },
    ],
    artifacts: ["SARIF", "IEEE 2800", "EN 14363", "nuXmv / SMT-LIB2"],
  },
  {
    id: "deliver",
    icon: "upload",
    title: "Deliver",
    body: "Export standards-compliant FMUs and SSP packages, render diagrams, and publish to the package registry.",
    lines: [
      { kind: "comment", text: "# FMI 3.0 co-simulation FMU with an embedded WebAssembly binary" },
      { kind: "cmd", text: "msx fmu DC_Motor motor.mo --fmi-version 3 --type cs --wasm --output build/DC_Motor.fmu" },
      { kind: "comment", text: "# Render a SysML v2 internal block diagram" },
      { kind: "cmd", text: "msx render SpacecraftPower spacecraft.sysml --view IBD --theme blueprint -o ibd.svg" },
    ],
    artifacts: ["FMI 2.0 / 3.0", "SSP", "SVG", "npm registry"],
  },
];

const active = ref(0);
const interacted = ref(false);
const copied = ref(false);
const tabRefs = ref<HTMLButtonElement[]>([]);
let timer: ReturnType<typeof setInterval> | undefined;

function select(i: number): void {
  active.value = i;
  interacted.value = true;
  if (timer) clearInterval(timer);
}

function onStepKey(e: KeyboardEvent, i: number): void {
  let next = i;
  if (e.key === "ArrowDown" || e.key === "ArrowRight") {
    next = (i + 1) % steps.length;
  } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
    next = (i - 1 + steps.length) % steps.length;
  } else if (e.key === "Home") {
    next = 0;
  } else if (e.key === "End") {
    next = steps.length - 1;
  } else {
    return;
  }
  e.preventDefault();
  select(next);
  tabRefs.value[next]?.focus();
}

// Interactive Parameter Trade-Study state
const payloadMass = ref(2.4);
const thermalCond = ref(5.2);
const pitchDamping = ref(0.68);

const peakCellTemp = computed(() =>
  Number(
    (
      38.5 +
      (payloadMass.value * 9.4) / Math.pow(thermalCond.value, 0.58) +
      Math.abs(pitchDamping.value - 0.7) * 4.2
    ).toFixed(1),
  ),
);

const flightEndurance = computed(() =>
  Number(
    Math.max(
      12.0,
      44.0 -
        payloadMass.value * 5.2 -
        Math.abs(pitchDamping.value - 0.72) * 6.5 +
        (thermalCond.value - 5.0) * 0.4,
    ).toFixed(1),
  ),
);

const structuralFoS = computed(() =>
  Number((2.35 - payloadMass.value * 0.21 + Math.min(pitchDamping.value, 0.85) * 0.18).toFixed(2)),
);

const reqThmPass = computed(() => peakCellTemp.value <= 65.0);
const reqEndPass = computed(() => flightEndurance.value >= 28.0);
const reqStrPass = computed(() => structuralFoS.value >= 1.5);
const allReqsPass = computed(() => reqThmPass.value && reqEndPass.value && reqStrPass.value);

const trajectoryPath = computed(() => {
  const pts: string[] = [];
  const zeta = pitchDamping.value;
  const wn = 4.6 - payloadMass.value * 0.35;
  const wd = wn * Math.sqrt(Math.max(0.05, 1 - zeta * zeta));
  for (let k = 0; k <= 40; k++) {
    const t = (k / 40) * 3.2;
    const env = Math.exp(-zeta * wn * t);
    const resp = 1 - env * (Math.cos(wd * t) + (zeta / Math.sqrt(Math.max(0.05, 1 - zeta * zeta))) * Math.sin(wd * t));
    const x = (k / 40) * 260;
    const y = Math.max(6, Math.min(58, 52 - resp * 34));
    pts.push(`${k === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(" ");
});

function resetTradeStudy(): void {
  payloadMass.value = 2.4;
  thermalCond.value = 5.2;
  pitchDamping.value = 0.68;
}

async function copyInstall(): Promise<void> {
  try {
    await navigator.clipboard.writeText("npm install -g @modelscript/cli");
    copied.value = true;
    setTimeout(() => (copied.value = false), 1800);
  } catch {
    /* clipboard unavailable */
  }
}

onMounted(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  timer = setInterval(() => {
    if (!interacted.value) active.value = (active.value + 1) % steps.length;
  }, 5500);
});
onBeforeUnmount(() => timer && clearInterval(timer));
</script>

<template>
  <section class="ms-section ms-section-alt home-thread">
    <div class="ms-container">
      <header class="ms-section-head">
        <span class="ms-eyebrow">How it works</span>
        <h2 class="ms-h2">One computable digital thread, from import to evidence</h2>
        <p class="ms-lead">
          The same compiler core powers the CLI, the browser IDE, VS Code, and CI, so every step is scriptable and
          reproducible.
        </p>
      </header>

      <div class="thread-layout">
        <ol class="thread-steps" role="tablist" aria-label="Workflow steps">
          <li v-for="(s, i) in steps" :key="s.id" role="presentation">
            <button
              :ref="(el) => { if (el) tabRefs[i] = el as HTMLButtonElement }"
              type="button"
              role="tab"
              class="thread-step"
              :class="{ active: active === i }"
              :aria-selected="active === i"
              :tabindex="active === i ? 0 : -1"
              :aria-controls="`thread-panel-${s.id}`"
              @click="select(i)"
              @keydown="onStepKey($event, i)"
            >
              <span class="step-icon"><MsIcon :name="s.icon" :size="22" :duotone="true" /></span>
              <span class="step-text">
                <span class="step-title"
                  ><span class="step-num">0{{ i + 1 }}</span
                  >{{ s.title }}</span
                >
                <span class="step-body">{{ s.body }}</span>
              </span>
              <span v-if="active === i && !interacted" class="step-progress" aria-hidden="true" />
            </button>
          </li>
        </ol>

        <div class="thread-panel">
          <div class="install">
            <span class="install-label">Install</span>
            <code>npm install -g @modelscript/cli</code>
            <button type="button" class="install-copy" @click="copyInstall">
              {{ copied ? "Copied" : "Copy" }}
            </button>
          </div>

          <div
            v-for="(s, i) in steps"
            v-show="active === i"
            :id="`thread-panel-${s.id}`"
            :key="s.id"
            role="tabpanel"
            class="terminal"
          >
            <div class="term-bar">
              <span class="dot" /><span class="dot" /><span class="dot" />
              <span class="term-title">~/project — msx {{ s.id }}</span>
            </div>
            <pre
              class="term-body"
            ><code><template v-for="(l, j) in s.lines" :key="j"><span v-if="l.kind === 'comment'" class="t-comment">{{ l.text }}</span><template v-else><span class="t-prompt">$ </span><span class="t-cmd">{{ l.text }}</span></template>
</template></code></pre>
            <div class="term-artifacts">
              <span class="art-label">{{ s.artifactLabel ?? "Outputs" }}</span>
              <span v-for="a in s.artifacts" :key="a" class="art">{{ a }}</span>
            </div>
          </div>

          <!-- Interactive Parameter Trade-Study Sandbox -->
          <div class="trade-study-card" role="region" aria-label="Interactive parameter trade-study">
            <div class="trade-study-head">
              <div class="trade-title-group">
                <span class="trade-pill">Interactive Trade-Study</span>
                <span class="trade-subtitle">Multidomain UAV Powertrain &amp; Pitch Loop</span>
              </div>
              <div class="trade-head-actions">
                <span class="trade-verdict" :class="allReqsPass ? 'verdict-pass' : 'verdict-fail'">
                  {{ allReqsPass ? "3/3 Contracts Verified" : "Contract Violation" }}
                </span>
                <button type="button" class="trade-reset-btn" @click="resetTradeStudy">Reset</button>
              </div>
            </div>

            <div class="trade-sliders">
              <label class="trade-slider-row">
                <span class="slider-meta">
                  <span class="slider-name">Payload Mass <code>m</code></span>
                  <span class="slider-val">{{ payloadMass.toFixed(1) }} kg</span>
                </span>
                <input v-model.number="payloadMass" type="range" min="1.0" max="5.0" step="0.1" />
              </label>

              <label class="trade-slider-row">
                <span class="slider-meta">
                  <span class="slider-name">Thermal Conductance <code>G_th</code></span>
                  <span class="slider-val">{{ thermalCond.toFixed(1) }} W/K</span>
                </span>
                <input v-model.number="thermalCond" type="range" min="2.0" max="10.0" step="0.2" />
              </label>

              <label class="trade-slider-row">
                <span class="slider-meta">
                  <span class="slider-name">Pitch Damping <code>&zeta;</code></span>
                  <span class="slider-val">{{ pitchDamping.toFixed(2) }}</span>
                </span>
                <input v-model.number="pitchDamping" type="range" min="0.2" max="1.2" step="0.02" />
              </label>
            </div>

            <div class="trade-results">
              <div class="trade-chart" aria-hidden="true">
                <svg viewBox="0 0 260 64" preserveAspectRatio="none">
                  <line x1="0" y1="18" x2="260" y2="18" stroke="rgba(148,163,184,0.22)" stroke-dasharray="3 3" />
                  <path :d="trajectoryPath" fill="none" stroke="var(--vp-c-brand-1)" stroke-width="2.2" />
                </svg>
                <span class="chart-caption">Pitch step response &theta;(t)</span>
              </div>

              <div class="trade-reqs">
                <div class="req-chip" :class="reqThmPass ? 'is-pass' : 'is-fail'">
                  <span class="req-id">REQ-THM-04</span>
                  <span class="req-metric">{{ peakCellTemp }} &deg;C <small>(&le;65)</small></span>
                  <span class="req-status">{{ reqThmPass ? "PASS" : "FAIL" }}</span>
                </div>
                <div class="req-chip" :class="reqEndPass ? 'is-pass' : 'is-fail'">
                  <span class="req-id">REQ-END-02</span>
                  <span class="req-metric">{{ flightEndurance }} min <small>(&ge;28)</small></span>
                  <span class="req-status">{{ reqEndPass ? "PASS" : "FAIL" }}</span>
                </div>
                <div class="req-chip" :class="reqStrPass ? 'is-pass' : 'is-fail'">
                  <span class="req-id">REQ-STR-09</span>
                  <span class="req-metric">{{ structuralFoS }}x <small>(&ge;1.5)</small></span>
                  <span class="req-status">{{ reqStrPass ? "PASS" : "FAIL" }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.thread-layout {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 32px;
  align-items: start;
}

.thread-steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.thread-step {
  position: relative;
  display: flex;
  gap: 14px;
  width: 100%;
  padding: 16px 18px;
  border-radius: 14px;
  border: 1px solid transparent;
  text-align: left;
  overflow: hidden;
  transition:
    background 0.25s,
    border-color 0.25s;
}

.thread-step:hover {
  background: var(--ms-surface-hover);
}

.thread-step.active {
  background: var(--vp-c-bg);
  border-color: var(--vp-c-divider);
  box-shadow: 0 12px 30px -20px rgba(2, 6, 23, 0.5);
}

.step-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  transition:
    color 0.25s ease,
    background 0.25s ease,
    border-color 0.25s ease,
    box-shadow 0.25s ease,
    transform 0.25s ease;
}

.thread-step.active .step-icon {
  color: var(--vp-c-brand-1);
  background:
    radial-gradient(circle at 25% 20%, rgba(34, 211, 238, 0.24), transparent 68%),
    radial-gradient(circle at 80% 85%, rgba(129, 140, 248, 0.18), transparent 68%),
    var(--vp-c-brand-soft);
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 42%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    0 8px 20px -8px rgba(6, 182, 212, 0.45);
}

.step-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.step-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 1rem;
  font-weight: 650;
  color: var(--vp-c-text-1);
}

.step-num {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-text-3);
}

.step-body {
  display: none;
  font-size: 0.88rem;
  line-height: 1.55;
  color: var(--vp-c-text-2);
}

.thread-step.active .step-body {
  display: block;
}

.step-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  width: 100%;
  background: var(--ms-gradient);
  transform-origin: left;
  animation: progress 5.5s linear forwards;
}

@keyframes progress {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

.thread-panel {
  display: grid;
  gap: 14px;
}

.install {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 8px 8px 16px;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  font-size: 13px;
}

.install-label {
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

.install code {
  flex: 1;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  color: var(--vp-c-text-1);
  background: none;
  padding: 0;
}

.install-copy {
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.terminal {
  border-radius: 16px;
  overflow: hidden;
  background: #0a0f1c;
  border: 1px solid rgba(148, 163, 184, 0.18);
  box-shadow: 0 40px 80px -40px rgba(6, 182, 212, 0.35);
}

.term-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 11px 14px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #334155;
}

.term-title {
  margin-left: 10px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: #94a3b8;
}

.term-body {
  margin: 0;
  min-height: 210px;
  padding: 20px 22px;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.9;
  white-space: pre-wrap;
  word-break: break-word;
  color: #e2e8f0;
}

.t-comment {
  color: #64748b;
}

.t-prompt {
  color: #2dd4bf;
  user-select: none;
}

.t-cmd {
  color: #e2e8f0;
}

.term-artifacts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 14px 22px 18px;
  border-top: 1px solid rgba(148, 163, 184, 0.12);
}

.art-label {
  margin-right: 4px;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #64748b;
}

.art {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  color: #a5f3fc;
  background: rgba(34, 211, 238, 0.1);
  border: 1px solid rgba(34, 211, 238, 0.22);
}

.trade-study-card {
  padding: 16px 18px;
  border-radius: 16px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  display: grid;
  gap: 14px;
}

.trade-study-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.trade-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.trade-pill {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.trade-subtitle {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.trade-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.trade-verdict {
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.verdict-pass {
  color: var(--ms-tier-stable, #10b981);
  background: var(--ms-tier-stable-bg, rgba(16, 185, 129, 0.12));
  border: 1px solid var(--ms-tier-stable-border, rgba(16, 185, 129, 0.3));
}

.verdict-fail {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.trade-reset-btn {
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  cursor: pointer;
}

.trade-reset-btn:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-brand-1);
}

.trade-sliders {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.trade-slider-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
}

.slider-meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px;
  font-size: 11px;
}

.slider-name {
  color: var(--vp-c-text-2);
  font-weight: 500;
}

.slider-name code {
  font-size: 10.5px;
  padding: 0 3px;
  background: transparent;
  color: var(--vp-c-text-1);
}

.slider-val {
  font-family: var(--vp-font-family-mono);
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.trade-slider-row input[type="range"] {
  width: 100%;
  accent-color: var(--vp-c-brand-1);
  cursor: pointer;
}

.trade-results {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr);
  gap: 12px;
  align-items: center;
}

.trade-chart {
  position: relative;
  padding: 8px 10px 4px;
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
}

.trade-chart svg {
  width: 100%;
  height: 52px;
  display: block;
}

.chart-caption {
  display: block;
  font-size: 10px;
  color: var(--vp-c-text-3);
  text-align: right;
}

.trade-reqs {
  display: grid;
  gap: 6px;
}

.req-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px;
  border-radius: 8px;
  font-size: 11.5px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
}

.req-id {
  font-family: var(--vp-font-family-mono);
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.req-metric {
  font-family: var(--vp-font-family-mono);
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.req-metric small {
  color: var(--vp-c-text-3);
  font-weight: 400;
}

.req-status {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
}

.req-chip.is-pass .req-status {
  color: var(--ms-tier-stable, #10b981);
  background: var(--ms-tier-stable-bg, rgba(16, 185, 129, 0.12));
}

.req-chip.is-fail {
  border-color: rgba(239, 68, 68, 0.4);
}

.req-chip.is-fail .req-status {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.14);
}

@media (max-width: 960px) {
  .thread-layout {
    grid-template-columns: 1fr;
  }
  .trade-sliders,
  .trade-results {
    grid-template-columns: 1fr;
  }
}
</style>
