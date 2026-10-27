<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import MsIcon from "./MsIcon.vue";

const pillars = [
  { title: "Open source", body: "AGPL-3.0. Read, audit, and extend every line." },
  { title: "No license server", body: "Run on laptops, clusters, CI, and air-gapped networks." },
  { title: "Standards first", body: "FMI, SSP, SysML v2, STEP, and ReqIF interchange." },
];
</script>

<template>
  <section class="ms-section home-cta">
    <div class="ms-container">
      <div class="pillars">
        <div v-for="p in pillars" :key="p.title" class="pillar">
          <span class="pillar-check"><MsIcon name="check" :size="16" :stroke="2.25" /></span>
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
          <a class="ms-btn ms-btn-brand" href="/guide/getting-started">
            Get started <MsIcon name="arrowRight" :size="16" :stroke="2" />
          </a>
          <a class="ms-btn ms-btn-ghost" href="https://github.com/modelscript/modelscript">
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
  gap: 24px;
  margin-bottom: 48px;
}

.pillar {
  display: flex;
  gap: 14px;
}

.pillar-check {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
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
