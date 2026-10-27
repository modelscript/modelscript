<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from "vue";
import { INDUSTRIES } from "../data/industries";
import type { IconName } from "../data/icons";
import { LANGUAGE_COUNT } from "../data/languages";
import lintRules from "../data/lint-rules.generated.json";
import MsIcon from "./MsIcon.vue";

interface StatItem {
  value: string;
  label: string;
  description: string;
  icon: IconName;
  link: string;
}

const totalLintRules = (lintRules as { rules: any[] }[]).reduce((sum, cat) => sum + cat.rules.length, 0);

// Counts are derived from the shared data catalog so they never drift from the docs.
const stats = computed<StatItem[]>(() => [
  {
    value: String(LANGUAGE_COUNT),
    label: "Languages & formats",
    description: "From Modelica and SysML v2 to PSCAD, AUTOSAR, and STEP.",
    icon: "layers",
    link: "/languages/overview",
  },
  {
    value: String(INDUSTRIES.length),
    label: "Industries served",
    description: "Aerospace, automotive, grid, rail, offshore, and more.",
    icon: "globe",
    link: "/industries/",
  },
  {
    value: `${totalLintRules}`,
    label: "Compiler lint rules",
    description: "Pre-flight diagnostics for syntax, types, units, and DAE balance.",
    icon: "shield",
    link: "/reference/linter-rules",
  },
  {
    value: "0",
    label: "Installs required",
    description: "Native WebAssembly runs in the browser, Node.js, and the CLI.",
    icon: "cube",
    link: "/architecture/overview",
  },
]);
</script>

<template>
  <section class="home-stats" aria-label="ModelScript at a glance">
    <div class="ms-container">
      <div class="stats-grid">
        <a v-for="item in stats" :key="item.label" :href="item.link" class="stat">
          <span class="stat-icon"><MsIcon :name="item.icon" :size="24" :duotone="true" /></span>
          <span class="stat-value">{{ item.value }}</span>
          <span class="stat-label">{{ item.label }}</span>
          <span class="stat-desc">{{ item.description }}</span>
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-stats {
  position: relative;
  z-index: 2;
  padding: 8px 0 24px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border: 1px solid var(--ms-border-strong);
  border-radius: 22px;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 78%, transparent);
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  box-shadow:
    0 24px 48px -24px rgba(2, 6, 23, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.stat {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-areas:
    "icon value"
    "label label"
    "desc desc";
  align-items: center;
  column-gap: 14px;
  padding: 28px 26px 26px;
  text-decoration: none;
  color: inherit;
  transition: background 0.25s ease;
}

.stat + .stat {
  border-left: 1px solid var(--vp-c-divider);
}

.stat:hover {
  background: var(--ms-surface-hover);
}

.stat-icon {
  position: relative;
  grid-area: icon;
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  color: var(--vp-c-brand-1);
  background:
    radial-gradient(circle at 25% 20%, rgba(34, 211, 238, 0.24), transparent 68%),
    radial-gradient(circle at 80% 85%, rgba(129, 140, 248, 0.18), transparent 68%),
    var(--vp-c-brand-soft);
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 35%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    0 8px 20px -8px rgba(6, 182, 212, 0.45);
  transition:
    transform 0.25s ease,
    border-color 0.25s ease,
    box-shadow 0.25s ease;
}

.stat:hover .stat-icon {
  transform: translateY(-2px) scale(1.04);
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 60%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.25),
    0 12px 24px -8px rgba(6, 182, 212, 0.6);
}

.stat-value {
  grid-area: value;
  font-size: 2.2rem;
  font-weight: 750;
  line-height: 1;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  background: var(--ms-gradient-text);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.stat-label {
  grid-area: label;
  margin-top: 16px;
  font-size: 0.96rem;
  font-weight: 660;
  color: var(--vp-c-text-1);
}

.stat-desc {
  grid-area: desc;
  margin-top: 4px;
  font-size: 0.84rem;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}

@media (max-width: 960px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .stat:nth-child(3) {
    border-left: none;
  }
  .stat:nth-child(n + 3) {
    border-top: 1px solid var(--vp-c-divider);
  }
}

@media (max-width: 560px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
  .stat + .stat {
    border-left: none;
    border-top: 1px solid var(--vp-c-divider);
  }
}
</style>
