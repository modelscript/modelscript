<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref } from "vue";
import type { IconName } from "../data/icons";
import { LANGUAGE_COUNT } from "../data/languages";
import mcpData from "../data/mcp-tools.generated.json";
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
    description: `Deep diagnostics, AST hover, semantic completion, and document symbols across ${LANGUAGE_COUNT} engineering formats.`,
  },
  {
    icon: "shield",
    title: "1,000+ Compiler Lint Rules",
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

// ── MCP Installation Config Tabs (100% accurate per client) ──
type McpClientTabId = "vscode" | "claude-code" | "cursor" | "vscode-ext";
interface McpClientConfigOption {
  id: McpClientTabId;
  label: string;
  fileHint: string;
  isJson: boolean;
  code: string;
  secondaryCmd?: string;
}

const mcpClientOptions: McpClientConfigOption[] = [
  {
    id: "vscode",
    label: "VS Code",
    fileHint: ".vscode/mcp.json (or CLI)",
    isJson: true,
    code: `{\n  "servers": {\n    "modelscript": {\n      "type": "stdio",\n      "command": "npx",\n      "args": ["-y", "@modelscript/mcp"]\n    }\n  }\n}`,
    secondaryCmd: `code --add-mcp '{"name":"modelscript","command":"npx","args":["-y","@modelscript/mcp"]}'`,
  },
  {
    id: "claude-code",
    label: "Claude Code",
    fileHint: "Terminal CLI",
    isJson: false,
    code: "claude mcp add modelscript -- npx -y @modelscript/mcp",
  },
  {
    id: "cursor",
    label: "Cursor / Windsurf",
    fileHint: ".cursor/mcp.json · claude_desktop_config.json",
    isJson: true,
    code: `{\n  "mcpServers": {\n    "modelscript": {\n      "command": "npx",\n      "args": ["-y", "@modelscript/mcp"]\n    }\n  }\n}`,
  },
  {
    id: "vscode-ext",
    label: "IDE Extension",
    fileHint: "Built-in @modelscript Chat & LM Tools",
    isJson: false,
    code: "code --install-extension modelscript.modelscript",
  },
];

const selectedMcpClient = ref<McpClientTabId>("vscode");
const copiedMcp = ref(false);
const copiedMcpSecondary = ref(false);

const activeMcpClientOption = computed(
  () => mcpClientOptions.find((o) => o.id === selectedMcpClient.value) ?? mcpClientOptions[0],
);

async function copyMcpConfig(): Promise<void> {
  try {
    await navigator.clipboard.writeText(activeMcpClientOption.value.code);
    copiedMcp.value = true;
    setTimeout(() => (copiedMcp.value = false), 1800);
  } catch {
    /* clipboard unavailable */
  }
}

async function copySecondaryMcpCmd(): Promise<void> {
  const cmd = activeMcpClientOption.value.secondaryCmd;
  if (!cmd) return;
  try {
    await navigator.clipboard.writeText(cmd);
    copiedMcpSecondary.value = true;
    setTimeout(() => (copiedMcpSecondary.value = false), 1800);
  } catch {
    /* clipboard unavailable */
  }
}
</script>

<template>
  <section id="vscode" class="ms-section home-vscode">
    <div class="ms-container">
      <div class="vscode-divider" aria-hidden="true"></div>
      <header class="ms-section-head">
        <span class="ms-eyebrow">Editor Tooling</span>
        <h2 class="ms-h2">ModelScript for VS Code &amp; VSCodium</h2>
        <p class="ms-lead">
          Full language intelligence, live schematics, and simulation debugging for {{ LANGUAGE_COUNT }} formats — published to both primary extension ecosystems.
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

      <!-- Add ModelScript AI to your IDE (MCP Configuration Card) -->
      <div class="mcp-ide-card">
        <div class="card-glow mcp-glow" aria-hidden="true" />
        <div class="card-header mcp-ide-header">
          <div class="icon-wrap mcp-icon-wrap">
            <MsIcon name="sparkles" :size="32" :duotone="true" />
          </div>
          <div class="header-text">
            <div class="title-row">
              <h3 class="card-title">Add ModelScript AI to your IDE</h3>
              <span class="card-tag tag-mcp">Model Context Protocol</span>
            </div>
            <p class="card-sub">VS Code · Claude Code · Cursor · Windsurf · {{ mcpData.toolCount }} MCP Tools</p>
          </div>
          <a href="/reference/mcp-and-ide" class="mcp-config-link">
            All {{ mcpData.toolCount }} MCP tools <MsIcon name="arrowRight" :size="13" :stroke="2" />
          </a>
        </div>

        <p class="card-desc">
          Give AI coding agents direct, deterministic access to ModelScript's {{ mcpData.toolCount }} multi-physics compilation, simulation, CAD, and formal verification tools.
        </p>

        <!-- Client Switcher Tabs -->
        <div class="mcp-client-tabs" role="tablist" aria-label="MCP client configuration">
          <button
            v-for="opt in mcpClientOptions"
            :key="opt.id"
            type="button"
            role="tab"
            class="mcp-client-tab"
            :class="{ active: selectedMcpClient === opt.id }"
            :aria-selected="selectedMcpClient === opt.id"
            @click="selectedMcpClient = opt.id"
          >
            {{ opt.label }}
          </button>
        </div>

        <div class="mcp-snippet-box">
          <div class="mcp-snippet-bar">
            <span class="mcp-file-hint">{{ activeMcpClientOption.fileHint }}</span>
            <button
              type="button"
              class="cli-copy-btn"
              :title="copiedMcp ? 'Copied to clipboard' : 'Copy configuration'"
              @click="copyMcpConfig"
            >
              <MsIcon :name="copiedMcp ? 'check' : 'copy'" :size="13" />
              <span>{{ copiedMcp ? "Copied" : "Copy" }}</span>
            </button>
          </div>
          <pre class="mcp-code-block"><code>{{ activeMcpClientOption.code }}</code></pre>
        </div>

        <div v-if="activeMcpClientOption.secondaryCmd" class="mcp-cmd-row">
          <span class="mcp-cli-tag">CLI</span>
          <code>{{ activeMcpClientOption.secondaryCmd }}</code>
          <button
            type="button"
            class="cli-copy-btn"
            :title="copiedMcpSecondary ? 'Copied to clipboard' : 'Copy command'"
            @click="copySecondaryMcpCmd"
          >
            <MsIcon :name="copiedMcpSecondary ? 'check' : 'copy'" :size="13" />
            <span>{{ copiedMcpSecondary ? "Copied" : "Copy" }}</span>
          </button>
        </div>

        <div class="mcp-tiers">
          <span class="mcp-tier">stdio &amp; SSE transports</span>
          <span class="mcp-tier">In-WASM AOT dispatch</span>
          <a href="/llms.txt" target="_blank" rel="noopener" class="mcp-tier mcp-tier-link">llms.txt context ↗</a>
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
  padding-top: 0;
  padding-bottom: 56px;
}

.vscode-divider {
  width: 100%;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--vp-c-divider) 15%,
    var(--vp-c-divider) 85%,
    transparent 100%
  );
  margin-bottom: 64px;
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

/* MCP IDE Card */
.mcp-ide-card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 32px;
  border-radius: 20px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--ms-border-strong);
  overflow: hidden;
  box-shadow: 0 10px 30px -15px rgba(2, 6, 23, 0.35);
  margin-bottom: 48px;
  transition:
    transform 0.25s ease,
    border-color 0.25s ease,
    box-shadow 0.25s ease;
}

.mcp-ide-card:hover {
  transform: translateY(-2px);
  border-color: #a78bfa;
  box-shadow: 0 20px 40px -20px rgba(139, 92, 246, 0.3);
}

@media (max-width: 820px) {
  .mcp-ide-card {
    padding: 24px 20px;
  }
}

.mcp-glow {
  background: #8b5cf6;
}

.mcp-ide-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.mcp-icon-wrap {
  background: rgba(139, 92, 246, 0.12);
  border: 1px solid rgba(167, 139, 250, 0.3);
  color: #a78bfa;
}

.card-tag.tag-mcp {
  background: rgba(139, 92, 246, 0.15);
  color: #a78bfa;
  border: 1px solid rgba(167, 139, 250, 0.3);
}

.mcp-config-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
  padding: 6px 12px;
  border-radius: 8px;
  background: var(--vp-c-brand-soft);
  transition: all 0.2s ease;
  white-space: nowrap;
}

.mcp-config-link:hover {
  background: var(--ms-surface-hover);
  transform: translateX(2px);
}

.mcp-client-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px;
  border-radius: 10px;
  background: var(--vp-c-bg);
  border: 1px solid var(--ms-border);
  margin-bottom: 14px;
  max-width: 520px;
}

.mcp-client-tab {
  flex: 1;
  min-width: 95px;
  padding: 6px 12px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  text-align: center;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.mcp-client-tab:hover {
  color: var(--vp-c-text-1);
}

.mcp-client-tab.active {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.mcp-snippet-box {
  border-radius: 12px;
  background: var(--vp-c-bg);
  border: 1px solid var(--ms-border);
  overflow: hidden;
  margin-bottom: 14px;
}

.mcp-snippet-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  border-bottom: 1px solid var(--ms-border);
  background: color-mix(in srgb, var(--vp-c-bg-soft) 60%, transparent);
}

.mcp-file-hint {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--vp-c-text-2);
}

.mcp-code-block {
  margin: 0 !important;
  padding: 12px 16px !important;
  font-family: var(--vp-font-family-mono);
  font-size: 12px !important;
  line-height: 1.5;
  color: var(--vp-c-text-1);
  background: transparent !important;
  overflow-x: auto;
}

.mcp-cmd-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--vp-c-bg);
  border: 1px solid var(--ms-border);
  margin-bottom: 16px;
}

.mcp-cli-tag {
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  flex-shrink: 0;
}

.mcp-cmd-row code {
  flex: 1;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-text-1);
  background: none;
  padding: 0;
  white-space: nowrap;
  overflow-x: auto;
}

.mcp-tiers {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.mcp-tier {
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 11.5px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg);
  border: 1px solid var(--ms-border);
  text-decoration: none;
  transition: all 0.15s ease;
}

.mcp-tier-link {
  color: var(--vp-c-brand-1);
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 35%, transparent);
}

.mcp-tier-link:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

@media (max-width: 768px) {
  .vscode-divider {
    margin-bottom: 48px;
  }
  .home-vscode {
    padding-bottom: 40px;
  }
}
</style>
