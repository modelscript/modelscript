<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import MsIcon from "./MsIcon.vue";

const TurbineHero = defineAsyncComponent(() => import("./TurbineHero.vue"));

const LINKED_SPECS = [
  {
    file: "Turbofan2Spool.mo",
    format: "Modelica",
    role: "Two-spool Brayton cycle & rotor kinematics",
    href: "/languages/modelica",
  },
  {
    file: "TurbofanCSG.scad",
    format: "OpenSCAD",
    role: "Parametric 3D casing, fan & stator geometry",
    href: "/languages/scad",
  },
  {
    file: "TurbofanMBD.qif",
    format: "QIF 3.0",
    role: "ASME Y14.5 datums & GD&T tolerance stack",
    href: "/languages/qif",
  },
  {
    file: "TurbofanAP242.step",
    format: "STEP AP242",
    role: "Compiled B-Rep solids & PMI provenance",
    href: "/languages/step",
  },
] as const;
</script>

<template>
  <section id="turbine-showcase" class="ms-section home-turbine-showcase" aria-label="3D CAD, GD&T and multi-physics digital twin showcase">
    <div class="ms-container">
      <header class="ms-section-head">
        <span class="ms-eyebrow">3D CAD, GD&amp;T &amp; Multi-Physics Digital Twin</span>
        <h2 class="ms-h2">One engine, four synchronized specifications</h2>
        <p class="ms-lead">
          Scrub the cutaway plane, inspect ASME Y14.5 GD&amp;T datums, or click
          <strong>Inspect in Live WASM LSP</strong> to edit thermodynamics, CSG geometry, QIF metrology, and compiled
          STEP AP242 B-Rep side by side in your browser.
        </p>
      </header>

      <div class="turbine-showcase-frame">
        <div class="turbine-stage-shell">
          <ClientOnly>
            <TurbineHero />
            <template #fallback>
              <div class="turbine-ssr-fallback">
                <img class="fallback-img" src="/ms-logo.png" alt="ModelScript Turbofan Digital Twin" />
              </div>
            </template>
          </ClientOnly>
        </div>

        <div class="turbine-spec-strip" role="list" aria-label="Synchronized digital twin files">
          <a
            v-for="spec in LINKED_SPECS"
            :key="spec.file"
            :href="spec.href"
            class="turbine-spec-card"
            role="listitem"
          >
            <div class="turbine-spec-top">
              <code class="turbine-spec-file">{{ spec.file }}</code>
              <span class="turbine-spec-format">{{ spec.format }}</span>
            </div>
            <p class="turbine-spec-role">{{ spec.role }}</p>
            <span class="turbine-spec-link">
              Language docs <MsIcon name="arrowRight" :size="12" />
            </span>
          </a>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-turbine-showcase {
  position: relative;
  overflow: visible;
}

.turbine-showcase-frame {
  position: relative;
  border-radius: 20px;
  border: 1px solid var(--ms-border-strong, var(--vp-c-divider));
  background:
    radial-gradient(ellipse 60% 65% at 50% 36%, var(--ms-glow-cyan, rgba(6, 182, 212, 0.1)), transparent 70%),
    radial-gradient(ellipse 50% 55% at 15% 15%, var(--ms-glow-indigo, rgba(99, 102, 241, 0.08)), transparent 70%),
    var(--vp-c-bg-soft);
  padding: 20px 20px 20px;
  overflow: visible;
}

.turbine-stage-shell {
  position: relative;
  width: 100%;
  max-width: 920px;
  height: 580px;
  margin: 0 auto;
  overflow: visible;
}

.turbine-ssr-fallback {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.turbine-ssr-fallback .fallback-img {
  max-height: 300px;
  width: auto;
  filter: drop-shadow(0 16px 36px rgba(6, 182, 212, 0.35));
}

.turbine-spec-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid var(--vp-c-divider);
}

.turbine-spec-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  background: color-mix(in srgb, var(--vp-c-bg) 82%, transparent);
  text-decoration: none;
  transition:
    border-color 0.2s ease,
    transform 0.2s ease;
}

.turbine-spec-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
}

.turbine-spec-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.turbine-spec-file {
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  background: transparent;
  padding: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.turbine-spec-format {
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.turbine-spec-role {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--vp-c-text-2);
  flex: 1;
}

.turbine-spec-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
}

@media (max-width: 960px) {
  .turbine-stage-shell {
    height: 460px;
  }

  .turbine-spec-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .turbine-showcase-frame {
    padding: 12px;
  }

  .turbine-stage-shell {
    height: 360px;
  }

  .turbine-spec-strip {
    grid-template-columns: 1fr;
  }
}
</style>
