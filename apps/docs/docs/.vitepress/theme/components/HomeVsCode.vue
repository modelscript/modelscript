<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref } from "vue";
import type { IconName } from "../data/icons";
import MsIcon from "./MsIcon.vue";

interface Feature {
  icon: IconName;
  title: string;
  description: string;
}

const features: Feature[] = [
  {
    icon: "code",
    title: "Polyglot Language Server",
    description: "Deep diagnostics, AST hover, semantic completion, and document symbols across 66 engineering formats.",
  },
  {
    icon: "shield",
    title: "770+ Compiler Lint Rules",
    description: "Pre-flight checks for unit consistency, typing, causality, acausal balancing, and syntax errors as you type.",
  },
  {
    icon: "layers",
    title: "Interactive 2D & 3D Schematics",
    description: "Visual schematic editing with auto-routed acausal connect diagrams, block diagrams, and OpenCASCADE CAD viewports.",
  },
  {
    icon: "activity",
    title: "In-Editor DAE Simulation",
    description: "Run stiff numerical ODE/DAE solvers (SUNDIALS CVODE, IDA, Rodas4P) with interactive trajectory plots in editor panes.",
  },
  {
    icon: "cube",
    title: "Bundled MSL & Standard Libraries",
    description: "Pre-indexed Modelica Standard Library (MSL 4.0.0), SysML v2 standard libraries, and schema definitions ready out of the box.",
  },
  {
    icon: "cpu",
    title: "100% Offline & Private",
    description: "Native WebAssembly GLR execution; zero cloud telemetry or internet dependency. Safe for air-gapped engineering.",
  },
];

const copiedCode = ref(false);
const copiedCodium = ref(false);

async function copyCodeCmd() {
  try {
    await navigator.clipboard.writeText("code --install-extension modelscript.modelscript");
    copiedCode.value = true;
    setTimeout(() => (copiedCode.value = false), 2000);
  } catch {
    /* clipboard unavailable */
  }
}

async function copyCodiumCmd() {
  try {
    await navigator.clipboard.writeText("codium --install-extension modelscript.modelscript");
    copiedCodium.value = true;
    setTimeout(() => (copiedCodium.value = false), 2000);
  } catch {
    /* clipboard unavailable */
  }
}
</script>

<template>
  <section id="vscode" class="ms-section home-vscode">
    <div class="ms-container">
      <header class="ms-section-head">
        <span class="ms-eyebrow">Editor Tooling</span>
        <h2 class="ms-h2">ModelScript for VS Code &amp; VSCodium</h2>
        <p class="ms-lead">
          Full language intelligence, live schematics, and simulation debugging for 66 formats — published to both primary extension ecosystems.
        </p>
      </header>

      <!-- Prominent Marketplaces Grid -->
      <div class="marketplaces-grid">
        <!-- Visual Studio Marketplace Card -->
        <div class="marketplace-card marketplace-vs">
          <div class="card-glow vs-glow" aria-hidden="true" />
          <div class="card-header">
            <div class="icon-wrap vs-icon-wrap">
              <MsIcon name="vscode" :size="32" :duotone="true" />
            </div>
            <div class="header-text">
              <div class="title-row">
                <h3 class="card-title">Visual Studio Marketplace</h3>
                <span class="card-tag">Official</span>
              </div>
              <p class="card-sub">VS Code · Cursor · Windsurf · Trae</p>
            </div>
          </div>

          <p class="card-desc">
            Directly available from Microsoft's Visual Studio Marketplace for official VS Code and compatible editor distributions.
          </p>

          <div class="badge-row">
            <a
              href="https://marketplace.visualstudio.com/items?itemName=modelscript.modelscript"
              target="_blank"
              rel="noopener noreferrer"
              class="badge-pill badge-pill-vs"
            >
              <span class="badge-pill-label">VS Marketplace</span>
              <span class="badge-pill-val">modelscript.modelscript</span>
            </a>
          </div>

          <div class="cli-install-box">
            <span class="cli-label">CLI Install</span>
            <code class="cli-cmd">code --install-extension modelscript.modelscript</code>
            <button
              type="button"
              class="cli-copy-btn"
              :title="copiedCode ? 'Copied to clipboard' : 'Copy command'"
              @click="copyCodeCmd"
            >
              <MsIcon :name="copiedCode ? 'check' : 'copy'" :size="15" />
              <span>{{ copiedCode ? "Copied" : "Copy" }}</span>
            </button>
          </div>

          <div class="card-actions">
            <a
              href="https://marketplace.visualstudio.com/items?itemName=modelscript.modelscript"
              target="_blank"
              rel="noopener noreferrer"
              class="ms-btn ms-btn-brand"
            >
              <MsIcon name="download" :size="16" /> Install from Marketplace
            </a>
          </div>
        </div>

        <!-- Open VSX Registry Card -->
        <div class="marketplace-card marketplace-ovsx">
          <div class="card-glow ovsx-glow" aria-hidden="true" />
          <div class="card-header">
            <div class="icon-wrap ovsx-icon-wrap">
              <MsIcon name="openvsx" :size="32" :duotone="true" />
            </div>
            <div class="header-text">
              <div class="title-row">
                <h3 class="card-title">Open VSX Registry</h3>
                <span class="card-tag tag-open">Open Source</span>
              </div>
              <p class="card-sub">VSCodium · Gitpod · Eclipse Theia · Code-OSS</p>
            </div>
          </div>

          <p class="card-desc">
            Neutral open-source extension registry maintained by the Eclipse Foundation for privacy-focused and cloud-hosted editors.
          </p>

          <div class="badge-row">
            <a
              href="https://open-vsx.org/extension/modelscript/modelscript"
              target="_blank"
              rel="noopener noreferrer"
              class="badge-pill badge-pill-ovsx"
            >
              <span class="badge-pill-label">Open VSX</span>
              <span class="badge-pill-val">modelscript/modelscript</span>
            </a>
          </div>

          <div class="cli-install-box">
            <span class="cli-label">CLI Install</span>
            <code class="cli-cmd">codium --install-extension modelscript.modelscript</code>
            <button
              type="button"
              class="cli-copy-btn"
              :title="copiedCodium ? 'Copied to clipboard' : 'Copy command'"
              @click="copyCodiumCmd"
            >
              <MsIcon :name="copiedCodium ? 'check' : 'copy'" :size="15" />
              <span>{{ copiedCodium ? "Copied" : "Copy" }}</span>
            </button>
          </div>

          <div class="card-actions">
            <a
              href="https://open-vsx.org/extension/modelscript/modelscript"
              target="_blank"
              rel="noopener noreferrer"
              class="ms-btn ms-btn-ghost"
            >
              <MsIcon name="download" :size="16" /> Install from Open VSX
            </a>
          </div>
        </div>
      </div>

      <!-- Feature Highlights Grid -->
      <div class="features-grid">
        <div v-for="feat in features" :key="feat.title" class="feat-card">
          <span class="feat-icon">
            <MsIcon :name="feat.icon" :size="20" :duotone="true" />
          </span>
          <div class="feat-body">
            <h4 class="feat-title">{{ feat.title }}</h4>
            <p class="feat-desc">{{ feat.description }}</p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-vscode {
  position: relative;
  border-top: 1px solid var(--vp-c-divider);
}

.marketplaces-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
  margin-bottom: 48px;
}

@media (max-width: 820px) {
  .marketplaces-grid {
    grid-template-columns: 1fr;
  }
}

.marketplace-card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 32px;
  border-radius: 20px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--ms-border-strong);
  overflow: hidden;
  box-shadow: 0 10px 30px -15px rgba(2, 6, 23, 0.35);
  transition:
    transform 0.25s ease,
    border-color 0.25s ease,
    box-shadow 0.25s ease;
}

.marketplace-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 20px 40px -20px rgba(2, 6, 23, 0.45);
}

.marketplace-vs:hover {
  border-color: #38bdf8;
}

.marketplace-ovsx:hover {
  border-color: #f59e0b;
}

.card-glow {
  position: absolute;
  top: -60px;
  right: -60px;
  width: 180px;
  height: 180px;
  border-radius: 50%;
  filter: blur(50px);
  pointer-events: none;
  opacity: 0.35;
}

.vs-glow {
  background: #0284c7;
}

.ovsx-glow {
  background: #d97706;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 14px;
}

.icon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 14px;
  flex-shrink: 0;
}

.vs-icon-wrap {
  background: rgba(2, 132, 199, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.3);
  color: #38bdf8;
}

.ovsx-icon-wrap {
  background: rgba(217, 119, 6, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.3);
  color: #f59e0b;
}

.header-text {
  flex: 1;
  min-width: 0;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.card-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--vp-c-text-1);
}

.card-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: rgba(14, 165, 233, 0.15);
  color: #38bdf8;
  border: 1px solid rgba(56, 189, 248, 0.3);
}

.card-tag.tag-open {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.card-sub {
  margin: 4px 0 0 0;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--vp-c-text-2);
}

.card-desc {
  margin: 0 0 16px 0;
  font-size: 0.95rem;
  line-height: 1.55;
  color: var(--vp-c-text-2);
}

.badge-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
}

.badge-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 6px;
  overflow: hidden;
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1;
  text-decoration: none;
  border: 1px solid var(--vp-c-divider);
  transition: border-color 0.2s ease, transform 0.15s ease;
}

.badge-pill:hover {
  transform: translateY(-1px);
  border-color: var(--vp-c-brand-1);
}

.badge-pill-label {
  padding: 5px 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
}

.badge-pill-val {
  padding: 5px 9px;
  font-family: var(--vp-font-family-mono);
}

.badge-pill-vs .badge-pill-val {
  background: rgba(2, 132, 199, 0.16);
  color: #38bdf8;
}

.badge-pill-ovsx .badge-pill-val {
  background: rgba(217, 119, 6, 0.16);
  color: #f59e0b;
}

.cli-install-box {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--vp-c-bg);
  border: 1px solid var(--ms-border);
  margin-bottom: 24px;
}

.cli-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--vp-c-text-3);
  padding-right: 6px;
  border-right: 1px solid var(--vp-c-divider);
}

.cli-cmd {
  flex: 1;
  font-family: var(--ms-font-mono, monospace);
  font-size: 12px;
  color: var(--vp-c-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cli-copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 600;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--ms-border);
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition:
    background 0.2s,
    color 0.2s,
    border-color 0.2s;
  flex-shrink: 0;
}

.cli-copy-btn:hover {
  background: var(--ms-surface-hover);
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-brand-1);
}

.card-actions {
  margin-top: auto;
  display: flex;
  gap: 12px;
}

.card-actions .ms-btn {
  width: 100%;
  justify-content: center;
}

/* Features Grid */
.features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

@media (max-width: 960px) {
  .features-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .features-grid {
    grid-template-columns: 1fr;
  }
}

.feat-card {
  display: flex;
  gap: 14px;
  padding: 18px;
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--ms-border);
  transition:
    border-color 0.2s ease,
    background 0.2s ease;
}

.feat-card:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--ms-surface-hover);
}

.feat-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--ms-brand-soft);
  color: var(--vp-c-brand-1);
  flex-shrink: 0;
}

.feat-body {
  flex: 1;
  min-width: 0;
}

.feat-title {
  margin: 0 0 6px 0;
  font-size: 0.98rem;
  font-weight: 650;
  color: var(--vp-c-text-1);
}

.feat-desc {
  margin: 0;
  font-size: 0.86rem;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}
</style>
