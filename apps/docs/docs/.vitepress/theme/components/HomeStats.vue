<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
interface StatItem {
  value: string;
  label: string;
  description: string;
  icon: string;
  link?: string;
}

const stats: StatItem[] = [
  {
    value: "33+",
    label: "CAE & Modeling Languages",
    description: "SysML v2, Modelica, STEP CAD, SIMPACK, AUTOSAR, and continuum physics.",
    icon: "🌐",
    link: "/languages/overview",
  },
  {
    value: "250+",
    label: "Compiler Lint Rules",
    description: "Sub-millisecond diagnostics across syntax, types, and connection balance.",
    icon: "⚡",
    link: "/reference/linter-rules",
  },
  {
    value: "0",
    label: "Intermediate AST Overhead",
    description: "Arena-native DAE flattening lowering directly into WebAssembly linear memory.",
    icon: "🧬",
    link: "/architecture/dae-arena",
  },
  {
    value: "100%",
    label: "Native WebAssembly",
    description: "Compiles and executes in any modern browser, Node.js edge, and CLI.",
    icon: "📦",
    link: "/architecture/overview",
  },
];
</script>

<template>
  <section class="home-stats-strip">
    <div class="stats-container">
      <div class="stats-grid">
        <component
          :is="item.link ? 'a' : 'div'"
          v-for="item in stats"
          :key="item.label"
          :href="item.link"
          class="stat-card"
        >
          <div class="stat-top">
            <span class="stat-icon">{{ item.icon }}</span>
            <span class="stat-value">{{ item.value }}</span>
          </div>
          <div class="stat-label">{{ item.label }}</div>
          <p class="stat-desc">{{ item.description }}</p>
        </component>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-stats-strip {
  padding: 16px 24px 48px;
  position: relative;
  z-index: 2;
}

.stats-container {
  max-width: 1152px;
  margin: 0 auto;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 14px;
  padding: 20px 18px;
  text-decoration: none;
  color: inherit;
  transition: all 0.25s ease;
  position: relative;
  overflow: hidden;
}

.stat-card:hover {
  transform: translateY(-2px);
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
}

.stat-top {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}

.stat-icon {
  font-size: 1.1rem;
}

.stat-value {
  font-size: 2rem;
  font-weight: 800;
  line-height: 1;
  font-family: var(--vp-font-family-mono);
  background: -webkit-linear-gradient(120deg, #bd34fe 20%, #41d1ff 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.stat-label {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin-bottom: 6px;
}

.stat-desc {
  font-size: 0.82rem;
  color: var(--vp-c-text-2);
  line-height: 1.45;
  margin: 0;
}

@media (max-width: 960px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 14px;
  }
}

@media (max-width: 640px) {
  .stats-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .stat-card {
    padding: 16px;
  }
}
</style>
