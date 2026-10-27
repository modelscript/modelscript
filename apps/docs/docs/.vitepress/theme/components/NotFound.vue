<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { withBase } from "vitepress";
import { onMounted, ref } from "vue";
import type { IconName } from "../data/icons";
import MsIcon from "./MsIcon.vue";

const path = ref("");
onMounted(() => {
  path.value = window.location.pathname;
});

const links: { icon: IconName; title: string; detail: string; href: string }[] = [
  {
    icon: "sparkles",
    title: "Getting Started",
    detail: "Install and run your first model",
    href: "/guide/getting-started",
  },
  { icon: "terminal", title: "CLI Reference", detail: "Every msx command and option", href: "/cli/commands" },
  { icon: "code", title: "Languages", detail: "All supported formats and dialects", href: "/languages/overview" },
  { icon: "layers", title: "Industries", detail: "Workflows by engineering domain", href: "/industries/" },
];

function openSearch(): void {
  // VitePress local search listens for Ctrl/Cmd+K on the window.
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, metaKey: true }));
}
</script>

<template>
  <main class="nf" aria-labelledby="nf-title">
    <p class="nf-code">404</p>
    <h1 id="nf-title" class="nf-title">This page doesn’t exist</h1>
    <p class="nf-lead">
      <template v-if="path">
        Nothing is published at <code>{{ path }}</code
        >.
      </template>
      It may have moved during a docs reorganization. Try searching, or start from one of these sections.
    </p>

    <div class="nf-actions">
      <button id="nf-search" type="button" class="nf-btn nf-btn-primary" @click="openSearch">
        <MsIcon name="search" :size="16" />
        Search the docs
        <kbd>Ctrl K</kbd>
      </button>
      <a id="nf-home" class="nf-btn" :href="withBase('/')">Back to home</a>
    </div>

    <nav class="nf-grid" aria-label="Popular sections">
      <a v-for="l in links" :key="l.href" class="nf-card" :href="withBase(l.href)">
        <MsIcon :name="l.icon" :size="20" class="nf-card-icon" />
        <span class="nf-card-title">{{ l.title }}</span>
        <span class="nf-card-detail">{{ l.detail }}</span>
      </a>
    </nav>

    <p class="nf-foot">
      Followed a broken link?
      <a href="https://github.com/modelscript/modelscript/issues/new" target="_blank" rel="noopener"
        >Report it on GitHub</a
      >.
    </p>
  </main>
</template>

<style scoped>
.nf {
  max-width: 760px;
  margin: 0 auto;
  padding: 96px 24px 120px;
  text-align: center;
}
.nf-code {
  margin: 0;
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.2em;
  color: var(--vp-c-brand-1);
}
.nf-title {
  margin: 12px 0 0;
  font-size: clamp(28px, 4vw, 40px);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
  color: var(--vp-c-text-1);
}
.nf-lead {
  margin: 16px auto 0;
  max-width: 560px;
  font-size: 16px;
  line-height: 1.65;
  color: var(--vp-c-text-2);
}
.nf-lead code {
  font-size: 0.9em;
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--vp-c-default-soft);
  word-break: break-all;
}
.nf-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 32px;
}
.nf-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 18px;
  border-radius: 10px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}
.nf-btn:hover {
  border-color: var(--vp-c-brand-1);
}
.nf-btn:focus-visible,
.nf-card:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
.nf-btn-primary {
  border-color: transparent;
  background: var(--vp-c-brand-3);
  color: var(--vp-c-white);
}
.nf-btn-primary:hover {
  background: var(--vp-c-brand-2);
  border-color: transparent;
}
.nf-btn kbd {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.18);
}
.nf-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 56px;
  text-align: left;
}
.nf-card {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  column-gap: 14px;
  row-gap: 2px;
  padding: 16px 18px;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  text-decoration: none;
  transition:
    border-color 0.2s,
    transform 0.2s;
}
.nf-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-1px);
}
.nf-card-icon {
  grid-row: span 2;
  align-self: center;
  color: var(--vp-c-brand-1);
}
.nf-card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}
.nf-card-detail {
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.nf-foot {
  margin-top: 48px;
  font-size: 13px;
  color: var(--vp-c-text-3);
}
.nf-foot a {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
  text-underline-offset: 2px;
}
@media (max-width: 560px) {
  .nf {
    padding-top: 64px;
  }
  .nf-grid {
    grid-template-columns: 1fr;
  }
}
@media (prefers-reduced-motion: reduce) {
  .nf-card,
  .nf-btn {
    transition: none;
  }
  .nf-card:hover {
    transform: none;
  }
}
</style>
