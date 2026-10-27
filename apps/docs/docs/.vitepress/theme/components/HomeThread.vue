<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { IconName } from "../data/icons";
import lintRules from "../data/lint-rules.generated.json";
import MsIcon from "./MsIcon.vue";

const totalLintRules = lintRules.reduce((sum, lang) => sum + lang.rules.length, 0);

interface ThreadStep {
  id: string;
  icon: IconName;
  title: string;
  body: string;
  lines: { kind: "comment" | "cmd"; text: string }[];
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
    artifacts: [".slx", ".arxml", ".pscx", ".step", ".sysml"],
  },
  {
    id: "analyze",
    icon: "search",
    title: "Analyze",
    body: `${totalLintRules} lint rules across ${lintRules.length} languages catch unresolved references, type and unit mismatches, and unbalanced equations as you type.`,
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
      { kind: "cmd", text: "msx mc RLC_Filter filter.mo" },
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
let timer: ReturnType<typeof setInterval> | undefined;

function select(i: number): void {
  active.value = i;
  interacted.value = true;
  if (timer) clearInterval(timer);
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
          <li v-for="(s, i) in steps" :key="s.id">
            <button
              type="button"
              role="tab"
              class="thread-step"
              :class="{ active: active === i }"
              :aria-selected="active === i"
              :aria-controls="`thread-panel-${s.id}`"
              @click="select(i)"
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
              <span class="art-label">Outputs</span>
              <span v-for="a in s.artifacts" :key="a" class="art">{{ a }}</span>
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

@media (max-width: 960px) {
  .thread-layout {
    grid-template-columns: 1fr;
  }
}
</style>
