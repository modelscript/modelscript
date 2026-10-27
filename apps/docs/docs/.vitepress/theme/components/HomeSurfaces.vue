<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import type { IconName } from "../data/icons";
import MsIcon from "./MsIcon.vue";

interface Surface {
  icon: IconName;
  title: string;
  body: string;
  cta: string;
  link: string;
  tag?: string;
}

const surfaces: Surface[] = [
  {
    icon: "globe",
    title: "Playground",
    body: "Edit, lint, and simulate models in your browser. Nothing to install.",
    cta: "Open Playground",
    link: "https://modelscript.org/playground",
    tag: "Zero install",
  },
  {
    icon: "layers",
    title: "Web IDE",
    body: "A full VS Code-based workbench with diagrams, plots, and a simulation debugger.",
    cta: "Launch IDE",
    link: "https://ide.modelscript.org",
  },
  {
    icon: "code",
    title: "VS Code extension",
    body: "Language server for every supported format: diagnostics, completion, go-to-definition.",
    cta: "Install extension",
    link: "https://marketplace.visualstudio.com/items?itemName=modelscript.modelscript",
  },
  {
    icon: "terminal",
    title: "CLI & CI",
    body: "The msx command line for flattening, simulation, verification, and FMU export in pipelines.",
    cta: "CLI reference",
    link: "/cli/overview",
  },
  {
    icon: "sparkles",
    title: "MCP for AI agents",
    body: "A Model Context Protocol server that lets AI assistants compile, simulate, and analyze models.",
    cta: "MCP docs",
    link: "/reference/mcp-and-ide",
    tag: "New",
  },
  {
    icon: "download",
    title: "Desktop app",
    body: "Native desktop builds for offline and air-gapped engineering environments.",
    cta: "Download",
    link: "https://github.com/modelscript/modelscript/releases",
  },
];
</script>

<template>
  <section class="ms-section home-surfaces">
    <div class="ms-container">
      <header class="ms-section-head">
        <span class="ms-eyebrow">Run it anywhere</span>
        <h2 class="ms-h2">One engine, every surface</h2>
        <p class="ms-lead">
          The same WebAssembly compiler core runs in the browser, on the desktop, in your editor, and in CI.
        </p>
      </header>

      <div class="surf-grid">
        <a v-for="s in surfaces" :key="s.title" :href="s.link" class="surf-card">
          <div class="surf-top">
            <span class="surf-icon"><MsIcon :name="s.icon" :size="20" /></span>
            <span v-if="s.tag" class="surf-tag">{{ s.tag }}</span>
          </div>
          <h3>{{ s.title }}</h3>
          <p>{{ s.body }}</p>
          <span class="surf-cta">{{ s.cta }} <MsIcon name="arrowRight" :size="14" :stroke="2" /></span>
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.surf-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.surf-card {
  display: flex;
  flex-direction: column;
  padding: 26px;
  border-radius: 18px;
  border: 1px solid var(--vp-c-divider);
  background: linear-gradient(180deg, var(--vp-c-bg-soft), var(--vp-c-bg));
  text-decoration: none;
  color: inherit;
  transition:
    transform 0.25s,
    border-color 0.25s,
    box-shadow 0.25s;
}

.surf-card:hover {
  transform: translateY(-3px);
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 50%, transparent);
  box-shadow: 0 24px 48px -28px rgba(6, 182, 212, 0.45);
}

.surf-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.surf-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.surf-tag {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 650;
  color: var(--vp-c-brand-1);
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 35%, transparent);
}

.surf-card h3 {
  margin: 18px 0 6px;
  font-size: 1.05rem;
  font-weight: 680;
  color: var(--vp-c-text-1);
}

.surf-card p {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--vp-c-text-2);
}

.surf-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  padding-top: 18px;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  transition: gap 0.2s;
}

.surf-card:hover .surf-cta {
  gap: 10px;
}

@media (max-width: 960px) {
  .surf-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 560px) {
  .surf-grid {
    grid-template-columns: 1fr;
  }
}
</style>
