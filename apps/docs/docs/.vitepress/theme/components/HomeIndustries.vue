<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from "vue";
import { INDUSTRIES, INDUSTRY_GROUPS, type Industry, type IndustryGroupId } from "../data/industries";
import { LANGUAGE_BY_SLUG } from "../data/languages";
import { toneStyle } from "../data/tones";
import MsIcon from "./MsIcon.vue";

const props = withDefaults(
  defineProps<{
    heading?: boolean;
    level?: "h1" | "h2";
    groupFilter?: IndustryGroupId | "all";
  }>(),
  {
    heading: true,
    level: "h2",
    groupFilter: "all",
  },
);

/** Compact chip labels so format pills never overflow or wrap awkwardly in 4-column cards. */
const COMPACT_FORMAT_NAMES: Record<string, string> = {
  "jsbsim": "JSBSim",
  "rocets": "NASA ROCETS",
  "ccsds": "CCSDS",
  "autosar": "AUTOSAR",
  "simulink": "Simulink",
  "gtsuite": "GT-SUITE",
  "gensys": "GENSYS",
  "simpack": "SIMPACK",
  "adams": "MSC Adams",
  "sima": "SIMO / RIFLEX",
  "olga": "OLGA",
  "fea": "FEA / NASTRAN",
  "pscad": "PSCAD",
  "psse": "PSS/E",
  "cgmes": "CIM / CGMES",
  "lps": "PipelineStudio",
  "eclipse": "ECLIPSE",
  "relap5": "RELAP5-3D",
  "modelica": "Modelica",
  "fortran": "Fortran",
  "energyplus": "EnergyPlus",
  "epanet": "EPANET",
  "swmm": "EPA SWMM",
  "spice": "SPICE",
  "verilog-a": "Verilog-A",
  "ibis": "IBIS",
  "urdf": "URDF / Xacro",
  "plcopen": "PLCopen",
  "automationml": "AutomationML",
  "aspen": "Aspen Plus",
  "gproms": "gPROMS",
  "cantera": "Cantera",
  "sbml": "SBML",
  "antimony": "Antimony",
  "bngl": "BioNetGen",
};

/** Compact card display names for the 3 longest titles so every card header stays balanced. */
const COMPACT_CARD_TITLES: Record<string, string> = {
  "buildings": "Buildings & Civil Infrastructure",
  "robotics": "Robotics & Industrial Automation",
  "life-sciences": "Life Sciences, Healthcare & Medical",
};

/** Concise primary standard callout for the card footer bar. */
const PRIMARY_STANDARD: Record<string, string> = {
  "aerospace": "SysML v2 · DO-178C",
  "automotive": "AUTOSAR · ISO 26262",
  "rail": "EN 14363 · UIC 518",
  "marine": "DNV-OS-E301 · FMI",
  "power-systems": "IEEE 2800 · PRC-029",
  "oil-gas": "ISO 20765 · PHREEQC",
  "nuclear": "RELAP5-3D · ReqIF",
  "buildings": "IDF · EPANET · SWMM",
  "electronics": "IEEE 1857 · Touchstone",
  "robotics": "IEC 61131-3 · CAEX",
  "process": "CAPE-OPEN · NASA-7",
  "life-sciences": "DICOM-RT · 21 CFR 11",
};

function formats(slugs: string[]): string[] {
  return slugs
    .slice(0, 3)
    .map((s) => COMPACT_FORMAT_NAMES[s] ?? LANGUAGE_BY_SLUG[s]?.name)
    .filter((n): n is string => !!n);
}

function extraCount(slugs: string[]): number {
  return Math.max(0, slugs.length - 3);
}

function cardStyle(ind: Industry): Record<string, string> {
  return {
    ...toneStyle(ind.tone),
    "--accent": `var(--hue-${ind.tone[0]})`,
    "--accent-sec": `var(--hue-${ind.tone[1]})`,
  };
}

const visibleGroups = computed(() =>
  INDUSTRY_GROUPS.filter((g) => props.groupFilter === "all" || g.id === props.groupFilter).map((g) => {
    const items = INDUSTRIES.filter((i) => i.group === g.id);
    const uniqueFormats = new Set(items.flatMap((i) => i.languages)).size;
    return {
      ...g,
      items,
      uniqueFormats,
    };
  }),
);
</script>

<template>
  <section class="ms-section home-industries">
    <div class="ms-container">
      <header v-if="heading" class="ms-section-head">
        <span class="ms-eyebrow">Industries</span>
        <component :is="level" class="ms-h2">Built for the way your industry engineers</component>
        <p class="ms-lead">
          Domain formats, standards, and verification workflows, all connected in one open digital thread.
        </p>
      </header>

      <div class="ind-sectors">
        <div v-for="group in visibleGroups" :key="group.id" class="ind-sector">
          <div class="sector-rail">
            <span class="sector-code">{{ group.code }}</span>
            <span class="sector-label">{{ group.label }}</span>
            <span class="sector-summary">{{ group.summary }}</span>
            <span class="sector-line" aria-hidden="true" />
            <span class="sector-meta">{{ group.uniqueFormats }} formats · {{ group.items.length }} domains</span>
          </div>

          <div class="ind-grid">
            <a
              v-for="ind in group.items"
              :key="ind.slug"
              :href="`/industries/${ind.slug}`"
              class="ind-card"
              :style="cardStyle(ind)"
            >
              <span class="ind-glow" aria-hidden="true" />

              <!-- Domain technical mini-schematic -->
              <div class="ms-schematic ind-schematic" aria-hidden="true">
                <svg viewBox="0 0 240 68" fill="none" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">
                  <!-- 1. Aerospace: 6-DOF climb envelope + Mach pitch vector + OEM telemetry waypoints -->
                  <template v-if="ind.slug === 'aerospace'">
                    <path class="sx-ink" d="M14 54 H226 M14 14 V54" stroke-opacity="0.45" />
                    <path class="sx-ink" d="M18 48 C70 44, 110 14, 220 12" stroke-dasharray="2.5 2.5" />
                    <path class="sx-ink" d="M18 54 C80 52, 125 30, 220 26" stroke-dasharray="2.5 2.5" />
                    <path class="sx-p" d="M18 51 C74 48, 115 21, 220 18" stroke-width="1.7" />
                    <circle class="sx-pd" cx="58" cy="44.5" r="2.3" />
                    <circle class="sx-pd" cx="176" cy="20" r="2.3" />
                    <g class="sx-glow">
                      <polygon class="sx-af" points="126,25 110,23 114,28 110,32" />
                      <path class="sx-a" d="M126 25 L146 19" stroke-width="1.5" />
                    </g>
                    <text class="sx-mono sx-tp" x="22" y="21">6-DOF · JSBSim</text>
                    <text class="sx-mono sx-ta" x="220" y="48" text-anchor="end">CCSDS OEM</text>
                  </template>

                  <!-- 2. Automotive: OpenDRIVE 2-lane road + ego/lead vehicles + RSS safety envelope -->
                  <template v-else-if="ind.slug === 'automotive'">
                    <path class="sx-ink-f" d="M12 20 H228 V52 H12 Z" />
                    <path class="sx-ink" d="M16 36 H224" stroke-dasharray="5 4" />
                    <rect class="sx-af sx-glow" x="68" y="24" width="66" height="10" rx="2" stroke-dasharray="2.5 2" />
                    <rect class="sx-pf" x="28" y="23" width="36" height="12" rx="3" stroke-width="1.5" />
                    <rect class="sx-ink-f" x="138" y="23" width="36" height="12" rx="3" />
                    <path class="sx-a" d="M68 29 H132" stroke-width="1.4" />
                    <text class="sx-mono sx-ta" x="101" y="47" text-anchor="middle">RSS Δx ≥ d_min</text>
                    <text class="sx-mono sx-tp" x="220" y="15" text-anchor="end">ARXML · SLX</text>
                  </template>

                  <!-- 3. Rail: Track sleepers + damped wheel-rail hunting sinusoid + EN 14363 Y/Q limit -->
                  <template v-else-if="ind.slug === 'rail'">
                    <path class="sx-a" d="M14 18 H226" stroke-dasharray="3 2.5" />
                    <path class="sx-ink" d="M14 52 H226" />
                    <path
                      class="sx-ink"
                      d="M24 52 V56 M48 52 V56 M72 52 V56 M96 52 V56 M120 52 V56 M144 52 V56 M168 52 V56 M192 52 V56 M216 52 V56"
                    />
                    <path
                      class="sx-p"
                      d="M16 36 C32 14, 48 54, 64 36 C80 20, 96 48, 112 36 C128 26, 144 44, 160 36 C176 31, 192 40, 224 36"
                      stroke-width="1.65"
                    />
                    <circle class="sx-af sx-glow" cx="39" cy="23" r="3" />
                    <text class="sx-mono sx-ta" x="222" y="14" text-anchor="end">Y/Q ≤ 0.8</text>
                    <text class="sx-mono sx-tp" x="18" y="48">EN 14363</text>
                  </template>

                  <!-- 4. Marine: Wave profile + offshore platform + catenary mooring & riser to seabed -->
                  <template v-else-if="ind.slug === 'marine'">
                    <path
                      class="sx-ink"
                      d="M12 24 Q30 19, 48 24 T84 24 T120 24 T156 24 T192 24 T228 24"
                    />
                    <path class="sx-ink" d="M12 56 H228" />
                    <rect class="sx-pf" x="52" y="13" width="44" height="12" rx="2.5" stroke-width="1.5" />
                    <path class="sx-p" d="M62 25 C64 42, 92 53, 142 56" stroke-width="1.5" />
                    <path class="sx-a sx-glow" d="M84 25 C92 38, 118 40, 136 56" stroke-width="1.6" />
                    <circle class="sx-ad" cx="136" cy="56" r="2.4" />
                    <circle class="sx-pd" cx="142" cy="56" r="2.2" />
                    <text class="sx-mono sx-tp" x="112" y="18">SIMO · RIFLEX</text>
                    <text class="sx-mono sx-ta" x="222" y="51" text-anchor="end">DNV-OS-E301</text>
                  </template>

                  <!-- 5. Power Systems: IEEE 2800 LVRT voltage sag envelope + fault recovery trajectory -->
                  <template v-else-if="ind.slug === 'power-systems'">
                    <rect class="sx-af sx-glow" x="58" y="12" width="48" height="44" rx="2" stroke-opacity="0.4" />
                    <path class="sx-ink" d="M16 20 H58 V46 H106 L148 24 H224" stroke-dasharray="2.5 2.5" />
                    <path
                      class="sx-p"
                      d="M16 18 H58 C62 42, 70 38, 106 39 C118 22, 132 19, 224 18"
                      stroke-width="1.7"
                    />
                    <circle class="sx-ad" cx="58" cy="39" r="2.4" />
                    <circle class="sx-pd" cx="106" cy="39" r="2.4" />
                    <text class="sx-mono sx-ta" x="82" y="53" text-anchor="middle">LVRT</text>
                    <text class="sx-mono sx-tp" x="222" y="14" text-anchor="end">IEEE 2800 · EMT</text>
                  </template>

                  <!-- 6. Oil & Gas: Compositional two-phase P-T envelope + cricondentherm & critical point -->
                  <template v-else-if="ind.slug === 'oil-gas'">
                    <path class="sx-ink" d="M20 54 H220 M20 12 V54" stroke-opacity="0.45" />
                    <path
                      class="sx-pf"
                      d="M36 52 C46 22, 92 14, 126 22 C164 31, 152 50, 96 52 Z"
                      stroke-width="1.6"
                    />
                    <path class="sx-ink" d="M36 52 L192 18" stroke-dasharray="2.5 2.5" />
                    <circle class="sx-af sx-glow" cx="126" cy="22" r="3.2" />
                    <circle class="sx-pd" cx="98" cy="34" r="2.4" />
                    <text class="sx-mono sx-ta" x="134" y="19">P_c, T_c</text>
                    <text class="sx-mono sx-tp" x="220" y="49" text-anchor="end">OLGA · ECLIPSE</text>
                  </template>

                  <!-- 7. Nuclear: Primary reactor loop + 6-group delayed neutron decay trace -->
                  <template v-else-if="ind.slug === 'nuclear'">
                    <rect class="sx-pf" x="22" y="16" width="28" height="36" rx="5" stroke-width="1.5" />
                    <rect class="sx-ink-f" x="72" y="20" width="20" height="28" rx="3" />
                    <path class="sx-p" d="M50 24 H72" stroke-width="1.6" />
                    <path class="sx-ink" d="M72 44 H50" stroke-width="1.5" />
                    <path class="sx-a sx-glow" d="M30 24 V44 M36 22 V46 M42 24 V44" stroke-width="1.4" />
                    <path class="sx-p" d="M114 46 L126 16 C140 36, 168 42, 222 44" stroke-width="1.6" />
                    <circle class="sx-ad" cx="126" cy="16" r="2.4" />
                    <text class="sx-mono sx-tp" x="136" y="21">6-group β_i</text>
                    <text class="sx-mono sx-ta" x="222" y="38" text-anchor="end">RELAP5-3D</text>
                  </template>

                  <!-- 8. Buildings & Civil: Coupled thermal envelope + pressurized water/SWMM network -->
                  <template v-else-if="ind.slug === 'buildings'">
                    <rect class="sx-pf" x="22" y="14" width="38" height="40" rx="2.5" stroke-width="1.5" />
                    <path class="sx-ink" d="M29 23 H53 M29 32 H53 M29 41 H53" />
                    <path class="sx-p" d="M60 34 H104 L132 20 H188" stroke-width="1.6" />
                    <path class="sx-a sx-glow" d="M104 34 L132 48 H216" stroke-width="1.6" />
                    <circle class="sx-pd" cx="104" cy="34" r="2.8" />
                    <circle class="sx-pd" cx="132" cy="20" r="2.6" />
                    <circle class="sx-ad" cx="132" cy="48" r="2.6" />
                    <circle class="sx-ad" cx="188" cy="48" r="2.6" />
                    <text class="sx-mono sx-tp" x="222" y="22" text-anchor="end">EPANET</text>
                    <text class="sx-mono sx-ta" x="222" y="42" text-anchor="end">SWMM 5</text>
                  </template>

                  <!-- 9. Electronics: IBIS driver → S-parameter channel → passive Bode transfer curve -->
                  <template v-else-if="ind.slug === 'electronics'">
                    <polygon class="sx-pf" points="20,20 44,34 20,48" stroke-width="1.5" />
                    <path class="sx-p" d="M44 30 H68 M44 38 H68" stroke-width="1.4" />
                    <rect class="sx-ink-f" x="68" y="22" width="42" height="24" rx="3" />
                    <text class="sx-mono sx-tp" x="89" y="37" text-anchor="middle">S21(s)</text>
                    <path class="sx-p" d="M110 34 H126" stroke-width="1.4" />
                    <path
                      class="sx-a sx-glow"
                      d="M130 20 H156 C168 20, 174 34, 186 38 C198 42, 208 48, 224 50"
                      stroke-width="1.7"
                    />
                    <text class="sx-mono sx-ta" x="222" y="20" text-anchor="end">SPICE · IBIS</text>
                  </template>

                  <!-- 10. Robotics: 3-DOF articulated kinematic chain + end-effector trajectory arc -->
                  <template v-else-if="ind.slug === 'robotics'">
                    <path class="sx-ink" d="M16 54 H116" />
                    <rect class="sx-ink-f" x="34" y="47" width="24" height="7" rx="1.5" />
                    <path class="sx-p" d="M46 47 L66 23 L102 18 L122 30" stroke-width="1.8" />
                    <path class="sx-a sx-glow" d="M96 46 A34 34 0 0 1 126 16" stroke-dasharray="2.5 2.5" />
                    <circle class="sx-pf" cx="46" cy="47" r="3" />
                    <circle class="sx-af sx-glow" cx="66" cy="23" r="3.2" />
                    <circle class="sx-af sx-glow" cx="102" cy="18" r="3" />
                    <path class="sx-p" d="M150 44 H164 V24 H178 V44 H192 V24 H206 V44 H220" stroke-width="1.4" />
                    <text class="sx-mono sx-tp" x="150" y="18">URDF · PLC</text>
                  </template>

                  <!-- 11. Chemical & Process: P&ID reactor column + reflux loop + collocation profile -->
                  <template v-else-if="ind.slug === 'process'">
                    <rect class="sx-pf" x="32" y="12" width="24" height="44" rx="12" stroke-width="1.5" />
                    <path class="sx-ink" d="M34 24 H54 M34 34 H54 M34 44 H54" />
                    <path class="sx-p" d="M56 18 H82 V28 H56" stroke-width="1.4" />
                    <path class="sx-p" d="M18 34 H32" stroke-width="1.4" />
                    <path
                      class="sx-a sx-glow"
                      d="M110 50 C130 48, 142 18, 174 18 H222"
                      stroke-width="1.7"
                    />
                    <circle class="sx-ad" cx="136" cy="36" r="2.3" />
                    <circle class="sx-ad" cx="158" cy="21" r="2.3" />
                    <circle class="sx-ad" cx="192" cy="18" r="2.3" />
                    <text class="sx-mono sx-tp" x="110" y="18">Aspen · gPROMS</text>
                    <text class="sx-mono sx-ta" x="222" y="48" text-anchor="end">Cantera</text>
                  </template>

                  <!-- 12. Life Sciences: SBML pathway dynamics + TOPAS proton Bragg peak depth-dose -->
                  <template v-else>
                    <path class="sx-ink" d="M16 52 H224 M16 14 V52" stroke-opacity="0.45" />
                    <path
                      class="sx-ink"
                      d="M20 48 C38 18, 62 24, 96 36 C128 45, 168 48, 220 50"
                      stroke-dasharray="2.5 2.5"
                    />
                    <path
                      class="sx-pf"
                      d="M20 42 H112 C136 42, 148 36, 158 12 C164 12, 168 52, 176 52 H20 Z"
                    />
                    <path
                      class="sx-a sx-glow"
                      d="M20 42 H112 C136 42, 148 36, 158 12 C164 12, 168 52, 176 52 H220"
                      stroke-width="1.75"
                    />
                    <circle class="sx-ad" cx="158" cy="12" r="2.8" />
                    <text class="sx-mono sx-ta" x="158" y="25" text-anchor="end">Bragg peak</text>
                    <text class="sx-mono sx-tp" x="24" y="21">SBML · DICOM-RT</text>
                  </template>
                </svg>
              </div>

              <!-- Card Header: Precision blueprint icon tile + metadata badge -->
              <div class="ind-head">
                <span class="ind-icon">
                  <MsIcon :name="ind.icon" :size="22" :duotone="true" />
                </span>
                <div class="ind-badges">
                  <span class="ind-count">{{ ind.languages.length }} formats</span>
                  <span class="ind-stds">{{ ind.standards.length }} stds</span>
                </div>
              </div>

              <!-- Title & Tagline -->
              <h3 class="ind-name">{{ COMPACT_CARD_TITLES[ind.slug] ?? ind.name }}</h3>
              <p class="ind-tag">{{ ind.tagline }}</p>

              <!-- Bottom-anchored Format Strip + Standard/Explore Footer -->
              <div class="ind-bottom">
                <div class="ind-formats">
                  <span v-for="f in formats(ind.languages)" :key="f" class="ind-fmt">{{ f }}</span>
                  <span v-if="extraCount(ind.languages) > 0" class="ind-fmt ind-fmt-more">
                    +{{ extraCount(ind.languages) }}
                  </span>
                </div>

                <div class="ind-foot">
                  <span class="ind-std-pill">{{ PRIMARY_STANDARD[ind.slug] ?? ind.standards[0] }}</span>
                  <span class="ind-more">
                    Explore
                    <span class="ind-arrow">
                      <MsIcon name="arrowRight" :size="13" :stroke="2.2" />
                    </span>
                  </span>
                </div>
              </div>
            </a>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ind-sectors {
  display: flex;
  flex-direction: column;
  gap: 44px;
}

/* ── Sector Group Rail Header ── */
.sector-rail {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.sector-code {
  display: inline-grid;
  place-items: center;
  padding: 2px 7px;
  border-radius: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 30%, transparent);
}

.sector-label {
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-text-1);
  white-space: nowrap;
}

.sector-summary {
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sector-line {
  flex: 1;
  min-width: 24px;
  height: 1px;
  background: linear-gradient(90deg, var(--vp-c-divider), color-mix(in srgb, var(--vp-c-brand-1) 28%, var(--vp-c-divider)), var(--vp-c-divider));
}

.sector-meta {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 550;
  color: var(--vp-c-text-3);
  white-space: nowrap;
}

/* ── 4-Column Domain Grid ── */
.ind-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.ind-card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 16px 20px 18px;
  border-radius: 18px;
  border: 1px solid var(--vp-c-divider);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--vp-c-bg-soft) 75%, var(--vp-c-bg)),
    var(--vp-c-bg)
  );
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.03),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  text-decoration: none;
  color: inherit;
  overflow: hidden;
  isolation: isolate;
  transition:
    transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1),
    border-color 0.28s ease,
    box-shadow 0.28s ease;
}

.ind-card::before {
  content: "";
  position: absolute;
  top: 0;
  left: 18px;
  right: 18px;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--tone-p) 60%, transparent),
    color-mix(in srgb, var(--tone-a) 45%, transparent),
    transparent
  );
  opacity: 0.55;
  transition: opacity 0.28s ease;
}

.ind-glow {
  position: absolute;
  inset: auto -35% -55% auto;
  width: 220px;
  height: 220px;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--tone-p) 22%, transparent), transparent 70%);
  opacity: 0;
  transition: opacity 0.32s ease;
  z-index: -1;
}

.ind-card:hover {
  transform: translateY(-4px);
  border-color: color-mix(in srgb, var(--tone-p) 52%, var(--vp-c-divider));
  box-shadow:
    0 22px 44px -22px color-mix(in srgb, var(--tone-p) 38%, rgba(2, 6, 23, 0.22)),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

.ind-card:hover::before {
  opacity: 1;
}

.ind-card:hover .ind-glow {
  opacity: 1;
}

/* ── Top Mini-Schematic ── */
.ind-schematic {
  height: 68px;
  margin-bottom: 14px;
  border-radius: 11px;
}

.ind-card:hover .ind-schematic {
  border-color: color-mix(in srgb, var(--tone-p) 38%, var(--vp-c-divider));
}

/* ── Icon Tile + Metadata Header ── */
.ind-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.ind-icon {
  position: relative;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  color: var(--tone-p);
  --ms-icon-secondary: var(--tone-a);
  --ms-icon-fill-opacity: 0.18;
  background-color: color-mix(in srgb, var(--tone-p) 8%, var(--vp-c-bg-soft));
  background-image:
    radial-gradient(circle at 22% 18%, color-mix(in srgb, var(--tone-p) 18%, transparent), transparent 65%),
    radial-gradient(circle at 82% 85%, color-mix(in srgb, var(--tone-a) 14%, transparent), transparent 65%),
    linear-gradient(color-mix(in srgb, var(--tone-p) 7%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--tone-p) 7%, transparent) 1px, transparent 1px);
  background-size:
    100% 100%,
    100% 100%,
    11px 11px,
    11px 11px;
  border: 1px solid color-mix(in srgb, var(--tone-p) 30%, var(--vp-c-divider));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.22),
    0 6px 14px -8px color-mix(in srgb, var(--tone-p) 42%, transparent);
  transition:
    transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1),
    border-color 0.28s ease,
    box-shadow 0.28s ease;
}

.ind-card:hover .ind-icon {
  transform: scale(1.06) translateY(-1px);
  border-color: color-mix(in srgb, var(--tone-p) 58%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.32),
    0 10px 20px -8px color-mix(in srgb, var(--tone-p) 55%, transparent);
}

.ind-badges {
  display: flex;
  align-items: center;
  gap: 5px;
}

.ind-count,
.ind-stds {
  padding: 2px 8px;
  border-radius: 999px;
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 560;
  font-variant-numeric: tabular-nums;
  line-height: 1.4;
}

.ind-count {
  color: var(--tone-p);
  background: color-mix(in srgb, var(--tone-p) 10%, var(--vp-c-bg));
  border: 1px solid color-mix(in srgb, var(--tone-p) 26%, var(--vp-c-divider));
}

.ind-stds {
  color: var(--vp-c-text-3);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
}

/* ── Typography ── */
.ind-name {
  margin: 14px 0 5px;
  font-size: 1.02rem;
  font-weight: 700;
  line-height: 1.28;
  letter-spacing: -0.012em;
  color: var(--vp-c-text-1);
}

.ind-tag {
  margin: 0 0 14px;
  font-size: 0.83rem;
  line-height: 1.48;
  color: var(--vp-c-text-2);
}

/* ── Bottom-Anchored Formats & Footer ── */
.ind-bottom {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ind-formats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}

.ind-fmt {
  padding: 2px 7px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 560;
  line-height: 1.4;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  white-space: nowrap;
  transition: border-color 0.2s ease;
}

.ind-card:hover .ind-fmt {
  border-color: color-mix(in srgb, var(--tone-p) 24%, var(--vp-c-divider));
}

.ind-fmt-more {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 650;
  color: var(--tone-p);
  background: color-mix(in srgb, var(--tone-p) 9%, var(--vp-c-bg));
  border-color: color-mix(in srgb, var(--tone-p) 25%, var(--vp-c-divider));
}

.ind-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 11px;
  border-top: 1px solid var(--vp-c-divider);
}

.ind-std-pill {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 540;
  color: var(--vp-c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ind-more {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--tone-p);
  flex-shrink: 0;
}

.ind-arrow {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--tone-p) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--tone-p) 26%, transparent);
  transition:
    transform 0.22s ease,
    background 0.22s ease,
    color 0.22s ease;
}

.ind-card:hover .ind-arrow {
  transform: translateX(2px);
  background: var(--tone-p);
  border-color: var(--tone-p);
  color: var(--vp-c-bg);
}

@media (max-width: 1120px) {
  .ind-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .sector-summary {
    display: none;
  }
}

@media (max-width: 600px) {
  .ind-grid {
    grid-template-columns: 1fr;
  }
  .sector-meta {
    display: none;
  }
}
</style>
