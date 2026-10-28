<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { useData } from "vitepress";
import { computed } from "vue";
import LANG_DATA from "../data/languages.generated.json";
import MsIcon from "./MsIcon.vue";

const props = defineProps<{
  slug?: string;
}>();

const { page } = useData();

interface LangItem {
  slug: string;
  name: string;
  sidebar: string;
  ext: string;
  role: string;
  group: string;
  pkgName: string;
  version: string;
  cliCommand: string;
  actions: string[];
  capabilities: {
    parse: boolean;
    lint: boolean;
    dae: boolean;
    simulate: boolean;
    projections: string[];
  };
  ruleCount: number;
  tier?: "stable" | "beta" | "preview";
}

const currentSlug = computed<string>(() => {
  if (props.slug) return props.slug;
  const rel = page.value.relativePath ?? "";
  if (!rel.startsWith("languages/")) return "";
  const base = rel.replace(/^languages\//, "").replace(/\.md$/, "");
  return base === "overview" ? "" : base;
});

const lang = computed<LangItem | undefined>(() => {
  if (!currentSlug.value) return undefined;
  return (LANG_DATA as LangItem[]).find((l) => l.slug === currentSlug.value);
});

const maturity = computed(() => {
  if (!lang.value) return null;
  const t = lang.value.tier;
  const c = lang.value.capabilities;
  if (t === "stable" || (!t && c.simulate && c.dae && lang.value.ruleCount > 0)) {
    return {
      tier: "Stable",
      badgeClass: "badge-stable",
      hint: "Production-ready pipeline: native WASM GLR parser, static diagnostics, DAE arena lowering, and numerical solvers verified in CI.",
    };
  }
  if (t === "beta" || (!t && (c.dae || lang.value.ruleCount > 0))) {
    return {
      tier: "Beta",
      badgeClass: "badge-beta",
      hint: "Native WASM parser, semantic linter diagnostics, and DAE arena lowering with cross-language projections.",
    };
  }
  return {
    tier: "Preview",
    badgeClass: "badge-preview",
    hint: "Native GLR grammar parser, AST inspection, and schema querying.",
  };
});
</script>

<template>
  <div v-if="lang" class="lang-header-card" role="region" :aria-label="`${lang.name} status and capabilities`">
    <div class="lang-header-top">
      <div class="lang-badges">
        <span v-if="maturity" class="lang-maturity-badge" :class="maturity.badgeClass" :title="maturity.hint">
          <span class="badge-dot" />
          {{ maturity.tier }}
        </span>

        <span class="lang-ext-chip">
          <code>{{ lang.ext }}</code>
        </span>

        <span class="lang-pkg-badge">
          <code>{{ lang.pkgName }}</code>
        </span>

        <span v-if="lang.ruleCount > 0" class="lang-rules-badge" title="Catalogued pre-flight diagnostics">
          <MsIcon name="check" :size="12" />
          {{ lang.ruleCount }} diagnostic rules
        </span>
      </div>

      <div class="lang-actions">
        <a
          :href="`https://github.com/modelscript/modelscript/tree/main/languages/${lang.slug}`"
          target="_blank"
          rel="noopener noreferrer"
          class="lang-action-btn"
          title="View language compiler source code on GitHub"
        >
          <MsIcon name="github" :size="13" />
          <span>Source</span>
        </a>
        <a
          :href="`/playground?lang=${lang.slug}`"
          target="_blank"
          rel="noopener noreferrer"
          class="lang-action-btn lang-action-primary"
          title="Open ModelScript interactive WebAssembly playground"
        >
          <MsIcon name="play" :size="13" />
          <span>Playground</span>
        </a>
      </div>
    </div>

    <div class="lang-caps-grid">
      <div class="cap-cell" :class="{ 'is-active': lang.capabilities.parse }">
        <span class="cap-name">Parser</span>
        <span class="cap-status">
          <span class="status-indicator" />
          WASM GLR
        </span>
      </div>

      <div class="cap-cell" :class="{ 'is-active': lang.capabilities.lint }">
        <span class="cap-name">Diagnostics</span>
        <span class="cap-status">
          <span class="status-indicator" />
          {{ lang.ruleCount > 0 ? `${lang.ruleCount} rules` : "Typecheck" }}
        </span>
      </div>

      <div class="cap-cell" :class="{ 'is-active': lang.capabilities.dae }">
        <span class="cap-name">DAE Arena</span>
        <span class="cap-status">
          <span class="status-indicator" />
          {{ lang.capabilities.dae ? "Lowering" : "AST Only" }}
        </span>
      </div>

      <div class="cap-cell" :class="{ 'is-active': lang.capabilities.simulate }">
        <span class="cap-name">Simulation</span>
        <span class="cap-status">
          <span class="status-indicator" />
          {{ lang.capabilities.simulate ? "Native Solvers" : "Co-sim / Export" }}
        </span>
      </div>

      <div
        class="cap-cell"
        :class="{ 'is-active': lang.capabilities.projections && lang.capabilities.projections.length > 0 }"
      >
        <span class="cap-name">Projections</span>
        <span class="cap-status">
          <span class="status-indicator" />
          {{
            lang.capabilities.projections && lang.capabilities.projections.length > 0
              ? lang.capabilities.projections.join(", ")
              : "DAE"
          }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lang-header-card {
  margin: 12px 0 28px;
  padding: 16px 20px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  transition: border-color 0.2s ease;
}

.lang-header-card:hover {
  border-color: var(--ms-border-strong);
}

.lang-header-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.lang-badges {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.lang-maturity-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: 9999px;
  cursor: help;
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.badge-stable {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.3);
}
.badge-stable .badge-dot {
  background: #10b981;
  box-shadow: 0 0 6px #10b981;
}

.badge-beta {
  background: rgba(6, 182, 212, 0.12);
  color: #06b6d4;
  border: 1px solid rgba(6, 182, 212, 0.3);
}
.badge-beta .badge-dot {
  background: #06b6d4;
  box-shadow: 0 0 6px #06b6d4;
}

.badge-preview {
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.3);
}
.badge-preview .badge-dot {
  background: #f59e0b;
  box-shadow: 0 0 6px #f59e0b;
}

.lang-ext-chip code {
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  padding: 3px 8px;
  border-radius: 6px;
}

.lang-pkg-badge code {
  font-size: 12px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  padding: 3px 8px;
  border-radius: 6px;
}

.lang-rules-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  padding: 3px 9px;
  border-radius: 9999px;
}

.lang-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.lang-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  padding: 5px 11px;
  border-radius: 6px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  text-decoration: none;
  transition: all 0.15s ease;
}

.lang-action-btn:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-border);
  background: var(--ms-surface-hover);
}

.lang-action-primary {
  color: #fff !important;
  background: var(--vp-button-brand-bg);
  border-color: transparent;
}

.lang-action-primary:hover {
  background: var(--vp-button-brand-hover-bg);
}

.lang-caps-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--vp-c-divider);
}

.cap-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 10px;
  background: var(--vp-c-bg-elv);
  border-radius: 6px;
  border: 1px solid var(--vp-c-divider);
}

.cap-name {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vp-c-text-3);
}

.cap-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-indicator {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--vp-c-text-3);
}

.cap-cell.is-active .status-indicator {
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 5px var(--vp-c-brand-1);
}

.cap-cell.is-active .cap-status {
  color: var(--vp-c-text-1);
}

@media (max-width: 840px) {
  .lang-caps-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 540px) {
  .lang-caps-grid {
    grid-template-columns: 1fr;
  }
}
</style>
