<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from "vue";
import { INDUSTRIES, INDUSTRY_BY_SLUG } from "../data/industries";
import { LANGUAGE_BY_SLUG } from "../data/languages";
import MsIcon from "./MsIcon.vue";

const props = defineProps<{ slug: string }>();

const industry = computed(() => INDUSTRY_BY_SLUG[props.slug]);
const languages = computed(() =>
  (industry.value?.languages ?? []).map((s) => LANGUAGE_BY_SLUG[s]).filter((l) => l !== undefined),
);
const related = computed(() => {
  const ind = industry.value;
  if (!ind) return [];
  const same = INDUSTRIES.filter((i) => i.slug !== ind.slug && i.group === ind.group);
  return same.slice(0, 3);
});
</script>

<template>
  <div v-if="industry" class="ind-page" :style="{ '--accent': industry.accent }">
    <!-- Hero -->
    <section class="ind-hero">
      <div class="ind-grid-bg" aria-hidden="true" />
      <div class="ind-glow" aria-hidden="true" />
      <div class="ms-container ind-hero-inner">
        <div class="ind-hero-copy">
          <nav class="ind-crumbs" aria-label="Breadcrumb">
            <a href="/industries/">Industries</a>
            <span aria-hidden="true">/</span>
            <span>{{ industry.name }}</span>
          </nav>
          <span class="ind-eyebrow">
            <span class="ind-eyebrow-icon"><MsIcon :name="industry.icon" :size="16" :duotone="true" /></span>
            {{ industry.name }}
          </span>
          <h1 class="ind-title">{{ industry.headline }}</h1>
          <p class="ind-summary">{{ industry.summary }}</p>
          <div class="ind-actions">
            <a class="ms-btn ms-btn-brand" href="/guide/getting-started">
              Get started <MsIcon name="arrowRight" :size="16" :stroke="2" />
            </a>
            <a class="ms-btn ms-btn-ghost" href="https://modelscript.org/playground">Open Playground</a>
          </div>
        </div>

        <div class="ind-terminal" role="figure" aria-label="Example CLI session">
          <div class="term-bar">
            <span class="dot" /><span class="dot" /><span class="dot" />
            <span class="term-title">msx — {{ industry.slug }}</span>
          </div>
          <pre
            class="term-body"
          ><code><template v-for="(line, i) in industry.cli" :key="i"><span class="term-prompt">$</span> {{ line }}
</template></code></pre>
        </div>
      </div>
    </section>

    <!-- Pains -->
    <section class="ms-section">
      <div class="ms-container">
        <header class="ms-section-head">
          <span class="ms-eyebrow">The challenge</span>
          <h2 class="ms-h2">What slows {{ industry.name.toLowerCase() }} teams down</h2>
        </header>
        <div class="pain-grid">
          <article v-for="(p, i) in industry.pains" :key="p.title" class="pain-card">
            <span class="pain-num">0{{ i + 1 }}</span>
            <h3>{{ p.title }}</h3>
            <p>{{ p.body }}</p>
          </article>
        </div>
      </div>
    </section>

    <!-- Workflow -->
    <section class="ms-section ms-section-alt">
      <div class="ms-container">
        <header class="ms-section-head">
          <span class="ms-eyebrow">Reference workflow</span>
          <h2 class="ms-h2">One pipeline, end to end</h2>
        </header>
        <ol class="flow">
          <li v-for="(s, i) in industry.workflow" :key="s.label" class="flow-step">
            <span class="flow-idx">{{ i + 1 }}</span>
            <div>
              <h3>{{ s.label }}</h3>
              <p>{{ s.detail }}</p>
            </div>
          </li>
        </ol>
      </div>
    </section>

    <!-- Capabilities -->
    <section class="ms-section">
      <div class="ms-container">
        <header class="ms-section-head">
          <span class="ms-eyebrow">Capabilities</span>
          <h2 class="ms-h2">What ModelScript does for you</h2>
        </header>
        <div class="cap-grid">
          <article v-for="c in industry.capabilities" :key="c.title" class="cap-card">
            <span class="cap-check"><MsIcon name="check" :size="18" :stroke="2.25" /></span>
            <div>
              <h3>{{ c.title }}</h3>
              <p>{{ c.body }}</p>
            </div>
          </article>
        </div>
      </div>
    </section>

    <!-- Formats + standards -->
    <section class="ms-section ms-section-alt">
      <div class="ms-container fmt-layout">
        <div>
          <header class="ms-section-head left">
            <span class="ms-eyebrow">Supported formats</span>
            <h2 class="ms-h2">Works with the tools you already use</h2>
          </header>
          <div class="fmt-grid">
            <a v-for="l in languages" :key="l!.slug" :href="`/languages/${l!.slug}`" class="fmt-card">
              <span class="fmt-ext">{{ l!.ext }}</span>
              <span class="fmt-name">{{ l!.name }}</span>
              <span class="fmt-role">{{ l!.role }}</span>
            </a>
          </div>
        </div>
        <aside class="std-card">
          <h3><MsIcon name="shield" :size="20" :duotone="true" /> Standards &amp; interchange</h3>
          <ul>
            <li v-for="s in industry.standards" :key="s"><MsIcon name="check" :size="14" :stroke="2.25" /> {{ s }}</li>
          </ul>
          <a href="/reference/export-formats" class="std-link">
            All export formats <MsIcon name="arrowRight" :size="14" :stroke="2" />
          </a>
        </aside>
      </div>
    </section>

    <!-- Related + CTA -->
    <section class="ms-section">
      <div class="ms-container">
        <div v-if="related.length" class="related">
          <h2 class="related-title">Related industries</h2>
          <div class="related-grid">
            <a
              v-for="r in related"
              :key="r.slug"
              :href="`/industries/${r.slug}`"
              class="related-card"
              :style="{ '--accent': r.accent }"
            >
              <span class="related-icon"><MsIcon :name="r.icon" :size="22" :duotone="true" /></span>
              <span>
                <strong>{{ r.name }}</strong>
                <small>{{ r.tagline }}</small>
              </span>
              <MsIcon name="arrowRight" :size="16" class="related-arrow" />
            </a>
          </div>
        </div>

        <div class="ms-cta">
          <div>
            <h2>Free, open source, and runs anywhere</h2>
            <p>Browser, CLI, VS Code, or your CI pipeline. AGPL-3.0, with no license server.</p>
          </div>
          <div class="ms-cta-actions">
            <a class="ms-btn ms-btn-brand" href="/guide/installation">Install ModelScript</a>
            <a class="ms-btn ms-btn-ghost" href="https://github.com/modelscript/modelscript">
              <MsIcon name="github" :size="16" /> Star on GitHub
            </a>
          </div>
        </div>
      </div>
    </section>
  </div>
  <div v-else class="ms-container ms-section">
    <h1>Industry not found</h1>
    <p><a href="/industries/">Browse all industries</a></p>
  </div>
</template>

<style scoped>
.ind-page {
  --accent: var(--vp-c-brand-1);
}

/* ── Hero ── */
.ind-hero {
  position: relative;
  overflow: hidden;
  padding: 72px 0 80px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.ind-grid-bg {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(var(--ms-grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--ms-grid-line) 1px, transparent 1px),
    linear-gradient(var(--ms-grid-sub) 1px, transparent 1px),
    linear-gradient(90deg, var(--ms-grid-sub) 1px, transparent 1px);
  background-size:
    64px 64px,
    64px 64px,
    16px 16px,
    16px 16px;
  mask-image: radial-gradient(ellipse 85% 75% at 50% 25%, #000 30%, transparent 78%);
  -webkit-mask-image: radial-gradient(ellipse 85% 75% at 50% 25%, #000 30%, transparent 78%);
  pointer-events: none;
}

.ind-glow {
  position: absolute;
  top: -220px;
  right: -120px;
  width: 640px;
  height: 640px;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--accent) 28%, transparent), transparent 65%);
  filter: blur(30px);
  pointer-events: none;
}

.ind-hero-inner {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 56px;
  align-items: center;
}

.ind-crumbs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  font-size: 13px;
  color: var(--vp-c-text-3);
}

.ind-crumbs a {
  color: var(--vp-c-text-2);
  text-decoration: none;
}

.ind-crumbs a:hover {
  color: var(--vp-c-brand-1);
}

.ind-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px 5px 6px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
}

.ind-eyebrow-icon {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}

.ind-title {
  margin: 20px 0 16px;
  font-size: clamp(2rem, 4.2vw, 3.25rem);
  line-height: 1.08;
  font-weight: 750;
  letter-spacing: -0.025em;
  color: var(--vp-c-text-1);
}

.ind-summary {
  margin: 0;
  max-width: 600px;
  font-size: 1.075rem;
  line-height: 1.65;
  color: var(--vp-c-text-2);
}

.ind-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 32px;
}

.ind-terminal {
  border-radius: 14px;
  overflow: hidden;
  background: #0a0f1c;
  border: 1px solid rgba(148, 163, 184, 0.18);
  box-shadow:
    0 40px 80px -30px color-mix(in srgb, var(--accent) 45%, transparent),
    0 20px 40px -20px rgba(0, 0, 0, 0.6);
}

.term-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
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
  padding: 18px 20px 22px;
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  line-height: 2;
  color: #e2e8f0;
  white-space: pre-wrap;
  word-break: break-word;
}

.term-prompt {
  color: var(--accent);
  user-select: none;
}

/* ── Pains ── */
.pain-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.pain-card {
  position: relative;
  padding: 28px;
  border-radius: 16px;
  background: linear-gradient(180deg, var(--vp-c-bg-soft), var(--vp-c-bg));
  border: 1px solid var(--vp-c-divider);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  overflow: hidden;
}

.pain-card::before {
  content: "";
  position: absolute;
  top: 0;
  left: 20px;
  right: 20px;
  height: 1px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 50%, transparent), transparent);
  opacity: 0.6;
}

.pain-num {
  display: inline-grid;
  place-items: center;
  padding: 3px 9px;
  border-radius: 8px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  font-weight: 650;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
}

.pain-card h3,
.cap-card h3,
.flow-step h3 {
  margin: 12px 0 8px;
  font-size: 1.05rem;
  font-weight: 650;
  color: var(--vp-c-text-1);
}

.pain-card p,
.cap-card p,
.flow-step p {
  margin: 0;
  font-size: 0.92rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}

/* ── Workflow ── */
.flow {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  counter-reset: flow;
}

.flow-step {
  position: relative;
  padding: 24px;
  border-radius: 16px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.flow-step:not(:last-child)::after {
  content: "";
  position: absolute;
  top: 40px;
  right: -17px;
  width: 18px;
  height: 1px;
  background: linear-gradient(90deg, var(--accent), transparent);
}

.flow-idx {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  font-family: var(--vp-font-family-mono);
  font-weight: 700;
  font-size: 14px;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
  background:
    radial-gradient(circle at 25% 20%, color-mix(in srgb, var(--accent) 26%, transparent), transparent 68%),
    radial-gradient(circle at 80% 85%, rgba(129, 140, 248, 0.15), transparent 68%),
    color-mix(in srgb, var(--accent) 12%, var(--vp-c-bg-soft));
  border: 1px solid color-mix(in srgb, var(--accent) 34%, transparent);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16);
}

/* ── Capabilities ── */
.cap-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.cap-card {
  display: flex;
  gap: 16px;
  padding: 24px;
  border-radius: 16px;
  background: linear-gradient(180deg, var(--vp-c-bg-soft), var(--vp-c-bg));
  border: 1px solid var(--vp-c-divider);
  transition:
    border-color 0.25s,
    transform 0.25s;
}

.cap-card:hover {
  border-color: color-mix(in srgb, var(--accent) 50%, transparent);
  transform: translateY(-2px);
}

.cap-card h3 {
  margin-top: 0;
}

.cap-check {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
  background:
    radial-gradient(circle at 30% 25%, color-mix(in srgb, var(--accent) 26%, transparent), transparent 70%),
    color-mix(in srgb, var(--accent) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
}

/* ── Formats ── */
.fmt-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 32px;
  align-items: start;
}

.fmt-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 12px;
}

.fmt-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px;
  border-radius: 12px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  text-decoration: none;
  transition:
    border-color 0.2s,
    transform 0.2s;
}

.fmt-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
}

.fmt-ext {
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.fmt-name {
  margin-top: 6px;
  font-weight: 650;
  font-size: 0.95rem;
  color: var(--vp-c-text-1);
}

.fmt-role {
  font-size: 0.82rem;
  line-height: 1.45;
  color: var(--vp-c-text-2);
}

.std-card {
  position: sticky;
  top: calc(var(--vp-nav-height) + 24px);
  padding: 24px;
  border-radius: 16px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.std-card h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 14px;
  font-size: 1rem;
  font-weight: 650;
  color: var(--vp-c-text-1);
}

.std-card ul {
  list-style: none;
  margin: 0 0 18px;
  padding: 0;
  display: grid;
  gap: 10px;
}

.std-card li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
}

.std-card li .ms-icon {
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
}

.std-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

/* ── Related ── */
.related {
  margin-bottom: 64px;
}

.related-title {
  margin: 0 0 20px;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.related-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

.related-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px;
  border-radius: 16px;
  border: 1px solid var(--vp-c-divider);
  background: linear-gradient(180deg, var(--vp-c-bg-soft), var(--vp-c-bg));
  text-decoration: none;
  color: var(--vp-c-text-1);
  transition:
    border-color 0.25s ease,
    transform 0.25s ease,
    box-shadow 0.25s ease;
}

.related-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  box-shadow: 0 18px 36px -22px color-mix(in srgb, var(--accent) 50%, transparent);
}

.related-card strong {
  display: block;
  font-size: 0.95rem;
}

.related-card small {
  display: block;
  margin-top: 2px;
  font-size: 0.8rem;
  color: var(--vp-c-text-2);
}

.related-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
  background:
    radial-gradient(circle at 25% 20%, color-mix(in srgb, var(--accent) 26%, transparent), transparent 68%),
    radial-gradient(circle at 80% 85%, rgba(129, 140, 248, 0.15), transparent 68%),
    color-mix(in srgb, var(--accent) 12%, var(--vp-c-bg-soft));
  border: 1px solid color-mix(in srgb, var(--accent) 34%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    0 8px 18px -8px color-mix(in srgb, var(--accent) 50%, transparent);
}

.related-arrow {
  margin-left: auto;
  color: var(--vp-c-text-3);
  transition:
    transform 0.2s,
    color 0.2s;
}

.related-card:hover .related-arrow {
  transform: translateX(3px);
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
}

@media (max-width: 960px) {
  .ind-hero-inner,
  .fmt-layout {
    grid-template-columns: 1fr;
  }
  .pain-grid,
  .related-grid {
    grid-template-columns: 1fr;
  }
  .flow {
    grid-template-columns: repeat(2, 1fr);
  }
  .flow-step::after {
    display: none;
  }
  .std-card {
    position: static;
  }
}

@media (max-width: 640px) {
  .ind-hero {
    padding: 48px 0 56px;
  }
  .flow,
  .cap-grid {
    grid-template-columns: 1fr;
  }
}
</style>
