<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import type { IconName } from "../data/icons";
import MsIcon from "./MsIcon.vue";

const pillars: { icon: IconName; title: string; body: string }[] = [
  { icon: "code", title: "Open source", body: "AGPL-3.0. Read, audit, and extend every line." },
  { icon: "cpu", title: "No license server", body: "Run on laptops, clusters, CI, and air-gapped networks." },
  { icon: "layers", title: "Standards first", body: "FMI, SSP, SysML v2, STEP, and ReqIF interchange." },
];
</script>

<template>
  <section class="ms-section home-cta">
    <div class="ms-container">
      <div class="pillars">
        <div v-for="p in pillars" :key="p.title" class="pillar">
          <span class="pillar-icon"><MsIcon :name="p.icon" :size="22" :duotone="true" /></span>
          <div>
            <h3>{{ p.title }}</h3>
            <p>{{ p.body }}</p>
          </div>
        </div>
      </div>

      <div class="ms-cta">
        <div>
          <h2>Start building your digital thread today</h2>
          <p>Free and open source. Try it in the browser in seconds, or install the CLI.</p>
        </div>
        <div class="ms-cta-actions">
          <a class="ms-btn ms-btn-lg ms-btn-brand" href="/guide/getting-started">
            Get started <MsIcon name="arrowRight" :size="16" :stroke="2" />
          </a>
          <a class="ms-btn ms-btn-lg ms-btn-ghost" href="https://github.com/modelscript/modelscript">
            <MsIcon name="github" :size="16" /> GitHub
          </a>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-cta {
  padding-top: 72px;
  padding-bottom: 0;
}

.pillars {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
  margin-bottom: 48px;
}

.pillar {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 20px 22px;
  border-radius: 16px;
  border: 1px solid var(--vp-c-divider);
  background: linear-gradient(180deg, var(--vp-c-bg-soft), var(--vp-c-bg));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.pillar-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 46px;
  height: 46px;
  border-radius: 13px;
  color: var(--vp-c-brand-1);
  background:
    radial-gradient(circle at 25% 20%, rgba(34, 211, 238, 0.24), transparent 68%),
    radial-gradient(circle at 80% 85%, rgba(129, 140, 248, 0.18), transparent 68%),
    var(--vp-c-brand-soft);
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 34%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    0 8px 18px -8px rgba(6, 182, 212, 0.4);
}

.pillar h3 {
  margin: 2px 0 4px;
  font-size: 1rem;
  font-weight: 660;
  color: var(--vp-c-text-1);
}

.pillar p {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}

@media (max-width: 768px) {
  .pillars {
    grid-template-columns: 1fr;
  }
}
</style>
