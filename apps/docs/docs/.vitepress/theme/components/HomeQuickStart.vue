<script setup lang="ts">
import { ref } from "vue";

interface QuickStep {
  step: number;
  title: string;
  description: string;
  code: string;
}

const steps: QuickStep[] = [
  {
    step: 1,
    title: "Install the CLI",
    description: "Install the unified command-line toolchain globally via npm.",
    code: "npm install -g @modelscript/cli",
  },
  {
    step: 2,
    title: "Flatten a Hierarchical Model",
    description: "Lower Modelica classes to Differential Algebraic Equations with arena-native speed.",
    code: "msc flatten Modelica.Electrical.Analog.Examples.CauerLowPassAnalog path/to/MSL",
  },
  {
    step: 3,
    title: "Simulate ODE / DAE System",
    description: "Execute numerical simulations with automatic index reduction and BLT partitioning.",
    code: "msc simulate BouncingBall model.mo --stop-time 5",
  },
  {
    step: 4,
    title: "Render Interactive SVG Diagram",
    description: "Generate crisp vector diagrams from Modelica visual annotations.",
    code: "msc render MyModel model.mo > diagram.svg",
  },
];

const copiedIndex = ref<number | null>(null);

async function copyCode(code: string, index: number) {
  try {
    await navigator.clipboard.writeText(code);
    copiedIndex.value = index;
    setTimeout(() => {
      if (copiedIndex.value === index) copiedIndex.value = null;
    }, 2000);
  } catch {
    // fallback
  }
}
</script>

<template>
  <section class="home-section quickstart-section">
    <div class="section-container">
      <div class="section-header">
        <span class="section-badge">Get Started Fast</span>
        <h2 class="section-title">Quick Start</h2>
        <p class="section-subtitle">
          From installation to computable digital thread simulation and rendering in under two minutes with the unified <code>msc</code> CLI.
        </p>
      </div>

      <div class="quickstart-timeline">
        <div v-for="(item, idx) in steps" :key="item.step" class="timeline-step">
          <div class="step-badge">
            <span class="step-num">{{ item.step }}</span>
          </div>

          <div class="step-card">
            <div class="step-meta">
              <h3 class="step-title">{{ item.title }}</h3>
              <p class="step-desc">{{ item.description }}</p>
            </div>

            <div class="terminal-block">
              <div class="terminal-bar">
                <div class="terminal-dots">
                  <span class="dot red"></span>
                  <span class="dot yellow"></span>
                  <span class="dot green"></span>
                </div>
                <span class="terminal-label">bash</span>
                <button
                  type="button"
                  class="copy-btn"
                  :aria-label="'Copy command for step ' + item.step"
                  @click="copyCode(item.code, idx)"
                >
                  <span v-if="copiedIndex === idx" class="copied-text">✓ Copied</span>
                  <span v-else class="copy-text">Copy</span>
                </button>
              </div>
              <pre class="terminal-code"><code><span class="prompt">$ </span>{{ item.code }}</code></pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-section {
  padding: 64px 24px;
}

.section-container {
  max-width: 920px;
  margin: 0 auto;
}

.section-header {
  text-align: center;
  margin-bottom: 48px;
}

.section-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  margin-bottom: 12px;
}

.section-title {
  font-size: clamp(1.8rem, 3.5vw, 2.4rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--vp-c-text-1);
}

.section-subtitle {
  color: var(--vp-c-text-2);
  font-size: 1.05rem;
  margin-top: 8px;
  line-height: 1.6;
}

.quickstart-timeline {
  display: flex;
  flex-direction: column;
  gap: 24px;
  position: relative;
}

.timeline-step {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

.step-badge {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--vp-c-brand-1), var(--vp-c-brand-3));
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 1.05rem;
  box-shadow: 0 4px 12px var(--vp-c-brand-soft);
}

.step-card {
  flex: 1;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 14px;
  padding: 20px;
  transition: border-color 0.25s ease, box-shadow 0.25s ease;
}

.step-card:hover {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
}

.step-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin: 0;
}

.step-desc {
  font-size: 0.92rem;
  color: var(--vp-c-text-2);
  margin: 6px 0 14px;
  line-height: 1.5;
}

.terminal-block {
  background: #0d1117;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  overflow: hidden;
  font-family: var(--vp-font-family-mono);
}

.terminal-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.terminal-dots {
  display: flex;
  gap: 6px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.dot.red { background: #ff5f56; }
.dot.yellow { background: #ffbd2e; }
.dot.green { background: #27c93f; }

.terminal-label {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.45);
}

.copy-btn {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.75rem;
  padding: 2px 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.copy-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.copied-text {
  color: #3fb950;
  font-weight: 600;
}

.terminal-code {
  padding: 12px 16px;
  margin: 0;
  font-size: 0.88rem;
  color: #e6edf3;
  overflow-x: auto;
}

.prompt {
  color: #7ee787;
  user-select: none;
}

@media (max-width: 640px) {
  .timeline-step {
    flex-direction: column;
    gap: 12px;
  }
}
</style>
