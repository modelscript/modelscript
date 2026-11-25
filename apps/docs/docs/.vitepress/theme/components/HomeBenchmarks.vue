<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import benchmarksData from "../data/benchmarks.generated.json";
import { LANGUAGE_COUNT } from "../data/languages";
import MsIcon from "./MsIcon.vue";

const { overallPassRate, passedCases, totalCases, languagesWithAdapters } = benchmarksData.aggregate;
const { gitSha, recordedAt } = benchmarksData.provenance;
const recordedDate = recordedAt.slice(0, 10);

const adapterCases = benchmarksData.languages.flatMap((l) =>
  l.cases.filter((c) => !c.id.endsWith("-parse-canonical")),
);
const adapterTotal = adapterCases.length;
const adapterPassed = adapterCases.filter((c) => c.passed).length;

const referenceSuites = [
  {
    tool: "OpenModelica (omc)",
    suite: "MSL 4.0 / 4.1",
    criterion: "Trajectory RMSE < 1e-3",
    link: "/languages/modelica",
  },
  {
    tool: "EPRI OpenDSS",
    suite: "IEEE Distribution Feeders",
    criterion: "Voltage error < 0.5%",
    link: "/languages/opendss",
  },
  {
    tool: "Cantera C++",
    suite: "Combustion Kinetics",
    criterion: "Mole fraction RMSE < 1e-3",
    link: "/languages/cantera",
  },
  {
    tool: "US EPA SWMM 5.2",
    suite: "QA Hydraulics",
    criterion: "Flow & head RMSE < 0.2%",
    link: "/languages/swmm",
  },
  {
    tool: "libSBML / RoadRunner",
    suite: "SBML Semantic Suite",
    criterion: "Species RMSE < 1e-3",
    link: "/languages/sbml",
  },
  {
    tool: "ENTSO-E CGMES",
    suite: "Conformity Grid Models",
    criterion: "100% profile validation",
    link: "/languages/cgmes",
  },
];
</script>

<template>
  <section class="home-benchmarks" aria-label="Verification and open-source parity">
    <div class="ms-container">
      <div class="bench-panel">
        <div class="bench-top">
          <div class="bench-lead">
            <span class="bench-eyebrow">Verified Against Upstream Solvers</span>
            <h2 class="bench-title">
              {{ overallPassRate }}% pass rate across {{ totalCases }} automated benchmark cases
            </h2>
            <p class="bench-desc">
              {{ passedCases }} of {{ totalCases }} automated checks pass ({{ adapterPassed }}/{{ adapterTotal }}
              upstream solver parity cases across {{ languagesWithAdapters }} languages with reference adapters, plus
              canonical parse checks across all {{ LANGUAGE_COUNT }} documented formats) — comparing DAE flattening,
              simulation trajectories, and static diagnostics against reference engines.
            </p>
          </div>

          <div class="bench-actions">
            <a
              class="ms-btn ms-btn-ghost"
              href="https://github.com/modelscript/modelscript"
              target="_blank"
              rel="noopener noreferrer"
            >
              <MsIcon name="github" :size="16" />
              <span>View on GitHub</span>
            </a>
            <a class="ms-btn ms-btn-brand" href="/languages/modelica">
              <span>Modelica parity</span>
              <MsIcon name="arrowRight" :size="15" />
            </a>
          </div>
        </div>

        <div class="bench-grid">
          <a
            v-for="item in referenceSuites"
            :key="item.tool"
            :href="item.link"
            class="bench-card"
          >
            <div class="bench-card-top">
              <span class="bench-tool">{{ item.tool }}</span>
              <span class="bench-check">
                <MsIcon name="check" :size="13" />
              </span>
            </div>
            <div class="bench-suite">{{ item.suite }}</div>
            <div class="bench-criterion">{{ item.criterion }}</div>
          </a>
        </div>

        <div class="bench-footer">
          <span class="bench-provenance">
            Recorded {{ recordedDate }} · commit <code>{{ gitSha }}</code>
          </span>
          <a class="bench-more" href="/languages/overview">
            Inspect per-language benchmarks <MsIcon name="arrowRight" :size="13" />
          </a>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-benchmarks {
  position: relative;
  z-index: 2;
  padding: 8px 0 24px;
}

.bench-panel {
  border-radius: 20px;
  border: 1px solid var(--ms-border-strong);
  background: color-mix(in srgb, var(--vp-c-bg-soft) 82%, transparent);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  padding: 26px 24px 20px;
}

.bench-top {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
}

.bench-lead {
  max-width: 680px;
}

.bench-eyebrow {
  display: inline-block;
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #10b981;
}

.bench-title {
  margin: 0;
  font-size: clamp(1.25rem, 2.2vw, 1.65rem);
  line-height: 1.2;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.bench-desc {
  margin: 8px 0 0;
  font-size: 14px;
  line-height: 1.55;
  color: var(--vp-c-text-2);
}

.bench-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.bench-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.bench-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 13px 15px;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  text-decoration: none;
  color: inherit;
  transition:
    border-color 0.2s ease,
    transform 0.2s ease;
}

.bench-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-1px);
}

.bench-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.bench-tool {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.bench-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.14);
  color: #10b981;
}

.bench-suite {
  font-size: 12.5px;
  color: var(--vp-c-text-2);
}

.bench-criterion {
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  color: var(--vp-c-text-3);
}

.bench-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--vp-c-divider);
  font-size: 12.5px;
  color: var(--vp-c-text-3);
}

.bench-provenance code {
  font-size: 11.5px;
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-2);
}

.bench-more {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.bench-more:hover {
  text-decoration: underline;
}

@media (max-width: 900px) {
  .bench-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .bench-panel {
    padding: 20px 16px 16px;
  }

  .bench-grid {
    grid-template-columns: 1fr;
  }
}
</style>
