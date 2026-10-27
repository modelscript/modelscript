<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { INDUSTRIES } from "../data/industries";
import { LANGUAGE_COUNT } from "../data/languages";
import HomeIndustries from "./HomeIndustries.vue";
import MsIcon from "./MsIcon.vue";
</script>

<template>
  <div class="ind-index">
    <section class="idx-hero">
      <div class="idx-grid-bg" aria-hidden="true" />
      <div class="ms-container idx-inner">
        <span class="ms-eyebrow">Industries</span>
        <h1 class="idx-title">Engineering simulation for every domain, connected</h1>
        <p class="idx-lead">
          ModelScript reads {{ LANGUAGE_COUNT }} languages and formats across {{ INDUSTRIES.length }} industries and
          links them through one open, computable digital thread. Pick your domain to see the formats, standards, and
          workflows we support.
        </p>
        <div class="idx-actions">
          <a class="ms-btn ms-btn-brand" href="/languages/overview">
            Browse all languages <MsIcon name="arrowRight" :size="16" :stroke="2" />
          </a>
          <a class="ms-btn ms-btn-ghost" href="/guide/getting-started">Get started</a>
        </div>
      </div>
    </section>
    <HomeIndustries :heading="false" />
  </div>
</template>

<style scoped>
.idx-hero {
  position: relative;
  overflow: hidden;
  padding: 80px 0 24px;
  text-align: center;
}

.idx-grid-bg {
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(ellipse 55% 60% at 70% 35%, var(--ms-glow-cyan), transparent 70%),
    radial-gradient(ellipse 45% 50% at 25% 25%, var(--ms-glow-indigo), transparent 70%),
    linear-gradient(var(--ms-grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--ms-grid-line) 1px, transparent 1px),
    linear-gradient(var(--ms-grid-sub) 1px, transparent 1px),
    linear-gradient(90deg, var(--ms-grid-sub) 1px, transparent 1px);
  background-size:
    100% 100%,
    100% 100%,
    64px 64px,
    64px 64px,
    16px 16px,
    16px 16px;
  mask-image: radial-gradient(ellipse 80% 80% at 50% 25%, #000 35%, transparent 78%);
  -webkit-mask-image: radial-gradient(ellipse 80% 80% at 50% 25%, #000 35%, transparent 78%);
  pointer-events: none;
}

.idx-inner {
  position: relative;
  max-width: 860px;
}

.idx-title {
  margin: 0 0 18px;
  font-size: clamp(2rem, 4.6vw, 3.4rem);
  line-height: 1.08;
  font-weight: 760;
  letter-spacing: -0.028em;
  color: var(--vp-c-text-1);
}

.idx-lead {
  margin: 0 auto;
  max-width: 680px;
  font-size: 1.08rem;
  line-height: 1.65;
  color: var(--vp-c-text-2);
}

.idx-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 32px;
}

.ind-index :deep(.home-industries) {
  padding-top: 48px;
}
</style>
