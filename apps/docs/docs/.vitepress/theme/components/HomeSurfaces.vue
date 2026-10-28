<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import type { IconName } from "../data/icons";
import mcpData from "../data/mcp-tools.generated.json";
import { type Tone, toneStyle } from "../data/tones";
import MsIcon from "./MsIcon.vue";

type SurfaceId = "playground" | "webide" | "vscode" | "cli" | "mcp" | "desktop";

interface Surface {
  id: SurfaceId;
  icon: IconName;
  tone: Tone;
  title: string;
  body: string;
  cta: string;
  link: string;
  tag?: string;
  target?: string;
}

const surfaces: Surface[] = [
  {
    id: "playground",
    icon: "globe",
    tone: ["cyan", "emerald"],
    title: "Playground",
    body: "Edit, lint, and simulate models in your browser. Nothing to install.",
    cta: "Open Playground",
    link: "/playground",
    tag: "Zero install",
    target: "_self",
  },
  {
    id: "webide",
    icon: "layers",
    tone: ["indigo", "cyan"],
    title: "Web IDE",
    body: "A full VS Code-based workbench with diagrams, plots, and a simulation debugger.",
    cta: "Launch IDE",
    link: "/ide",
    target: "_self",
  },
  {
    id: "vscode",
    icon: "code",
    tone: ["cyan", "amber"],
    title: "VS Code extension",
    body: "Language server for every supported format: diagnostics, completion, go-to-definition.",
    cta: "Install extension",
    link: "https://marketplace.visualstudio.com/items?itemName=modelscript.modelscript",
  },
  {
    id: "cli",
    icon: "terminal",
    tone: ["indigo", "emerald"],
    title: "CLI & CI",
    body: "The msx command line for flattening, simulation, verification, and FMU export in pipelines.",
    cta: "CLI reference",
    link: "/cli/overview",
  },
  {
    id: "mcp",
    icon: "sparkles",
    tone: ["violet", "cyan"],
    title: "MCP for AI agents",
    body: "A Model Context Protocol server that lets AI assistants compile, simulate, and analyze models.",
    cta: "MCP docs",
    link: "/reference/mcp-and-ide",
    tag: `${mcpData.toolCount} AI tools`,
  },
  {
    id: "desktop",
    icon: "download",
    tone: ["indigo", "emerald"],
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
        <a
          v-for="s in surfaces"
          :key="s.title"
          :href="s.link"
          :target="s.target"
          class="surf-card"
          :style="toneStyle(s.tone)"
        >
          <div class="ms-schematic surf-schematic" aria-hidden="true">
            <svg viewBox="0 0 280 100" fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <!-- 1. Browser Playground: editor + live plot -->
              <template v-if="s.id === 'playground'">
                <rect class="sx-ink-f" x="16" y="10" width="248" height="80" rx="7" />
                <path class="sx-ink" d="M16 26 H264 M140 26 V90" />
                <circle class="sx-ink-d" cx="27" cy="18" r="2.5" />
                <circle class="sx-ink-d" cx="35" cy="18" r="2.5" />
                <circle class="sx-ink-d" cx="43" cy="18" r="2.5" />
                <rect class="sx-af sx-glow" x="214" y="12.5" width="40" height="11" rx="5.5" />
                <text class="sx-mono sx-ta" x="234" y="20.8" text-anchor="middle" style="font-size: 7.5px">▶ Run</text>
                <rect class="sx-pd" x="26" y="36" width="26" height="5" rx="2" />
                <rect class="sx-ink-d" x="56" y="36" width="44" height="5" rx="2" />
                <rect class="sx-ink-d" x="34" y="48" width="36" height="5" rx="2" />
                <rect class="sx-pd" x="74" y="48" width="40" height="5" rx="2" />
                <rect class="sx-ink-d" x="34" y="60" width="56" height="5" rx="2" />
                <rect class="sx-pd" x="26" y="72" width="30" height="5" rx="2" />
                <path class="sx-ink" d="M150 80 H254" />
                <path class="sx-ink" d="M152 68 C172 58 194 46 220 60 C234 66 246 54 254 54" stroke-dasharray="3 2" />
                <path class="sx-p" d="M152 76 C168 36 184 74 202 50 C218 34 236 54 254 46" stroke-width="2" />
                <circle class="sx-ad sx-glow" cx="254" cy="46" r="2.6" />
              </template>

              <!-- 2. Web IDE: activity bar, block diagram, debugger console, plot -->
              <template v-else-if="s.id === 'webide'">
                <rect class="sx-ink-f" x="16" y="10" width="248" height="80" rx="7" />
                <path class="sx-ink" d="M40 10 V90 M176 10 V90" />
                <rect class="sx-pf" x="23" y="20" width="10" height="10" rx="2.5" />
                <rect class="sx-ink-f" x="23" y="36" width="10" height="10" rx="2.5" />
                <rect class="sx-ink-f" x="23" y="52" width="10" height="10" rx="2.5" />
                <path class="sx-p" d="M86 33 H104 M144 33 H153" stroke-width="1.5" />
                <path class="sx-a" d="M160 40 V54 H69 V44" stroke-dasharray="2.5 2" />
                <rect class="sx-pf" x="52" y="22" width="34" height="22" rx="4" />
                <text class="sx-mono sx-tp" x="69" y="36.5" text-anchor="middle">PID</text>
                <rect class="sx-pf" x="104" y="22" width="40" height="22" rx="4" />
                <text class="sx-mono sx-tp" x="124" y="36.5" text-anchor="middle">Plant</text>
                <circle class="sx-af sx-glow" cx="160" cy="33" r="7" />
                <rect class="sx-ink-f" x="52" y="64" width="114" height="16" rx="3" />
                <circle class="sx-ad" cx="60" cy="72" r="2.2" />
                <text class="sx-mono" x="66" y="75" style="font-size: 8px">t = 0.42 s · 18 eqs</text>
                <path class="sx-a" d="M186 78 C206 64 228 52 254 50" stroke-dasharray="2.5 2" />
                <path class="sx-p" d="M186 74 L202 42 L218 58 L236 30 L254 44" stroke-width="1.75" />
              </template>

              <!-- 3. VS Code: CodeLens, diagnostics squiggle, hover -->
              <template v-else-if="s.id === 'vscode'">
                <rect class="sx-pf" x="20" y="12" width="132" height="16" rx="4" />
                <text class="sx-mono sx-tp" x="27" y="23" style="font-size: 8px">▶ Simulate · ✓ Balanced</text>
                <rect class="sx-ink-d" x="20" y="38" width="44" height="6" rx="2" />
                <rect class="sx-pd" x="70" y="38" width="70" height="6" rx="2" />
                <rect class="sx-ink-d" x="32" y="52" width="64" height="6" rx="2" />
                <rect class="sx-ink-d" x="102" y="52" width="40" height="6" rx="2" />
                <path
                  class="sx-a sx-glow"
                  d="M102 63 Q104 60 106 63 T110 63 T114 63 T118 63 T122 63 T126 63 T130 63 T134 63 T138 63 T142 63"
                />
                <rect class="sx-ink-d" x="32" y="70" width="50" height="6" rx="2" />
                <rect class="sx-pop" x="150" y="40" width="114" height="44" rx="6" />
                <text class="sx-mono sx-tp" x="158" y="57" style="font-size: 8px">parameter Real τ</text>
                <text class="sx-mono" x="158" y="72" style="font-size: 8px">unit = "N.m"</text>
              </template>

              <!-- 4. CLI & CI pipeline -->
              <template v-else-if="s.id === 'cli'">
                <path class="sx-ink" d="M86 48 H101 M182 48 H197" />
                <polygon class="sx-ink-d" points="105,48 100,45 100,51" />
                <polygon class="sx-ink-d" points="201,48 196,45 196,51" />
                <rect class="sx-pf" x="16" y="28" width="70" height="40" rx="6" />
                <text class="sx-mono sx-tp" x="25" y="45">msx lint</text>
                <text class="sx-label" x="25" y="58">0 errors</text>
                <rect class="sx-pf" x="106" y="28" width="76" height="40" rx="6" />
                <text class="sx-mono sx-tp" x="115" y="45">msx verify</text>
                <text class="sx-label" x="115" y="58">STL · IEEE</text>
                <rect class="sx-af sx-glow" x="202" y="28" width="62" height="40" rx="6" />
                <text class="sx-mono sx-ta" x="211" y="45">✓ SARIF</text>
                <text class="sx-label" x="211" y="58">FMI 3.0</text>
              </template>

              <!-- 5. MCP: agent ⇄ ModelScript host -->
              <template v-else-if="s.id === 'mcp'">
                <path class="sx-a" d="M92 40 H184" stroke-width="1.6" stroke-dasharray="3 2" />
                <polygon class="sx-ad" points="188,40 182,36.5 182,43.5" />
                <text class="sx-mono sx-ta" x="139" y="33" text-anchor="middle">tools/call</text>
                <path class="sx-p" d="M188 60 H96" stroke-width="1.6" />
                <polygon class="sx-pd" points="92,60 98,56.5 98,63.5" />
                <text class="sx-mono sx-tp" x="139" y="74" text-anchor="middle">DAE · proof</text>
                <rect class="sx-pf" x="18" y="25" width="72" height="50" rx="8" />
                <text class="sx-label sx-tp" x="54" y="47" text-anchor="middle">AI agent</text>
                <text class="sx-label" x="54" y="60" text-anchor="middle" style="font-size: 8px">any MCP client</text>
                <rect class="sx-af sx-glow" x="190" y="25" width="72" height="50" rx="8" />
                <text class="sx-label sx-ta" x="226" y="47" text-anchor="middle">ModelScript</text>
                <text class="sx-label" x="226" y="60" text-anchor="middle" style="font-size: 8px">31 tools</text>
              </template>

              <!-- 6. Native desktop: CAD view, local compute, offline -->
              <template v-else>
                <rect class="sx-ink-f" x="38" y="10" width="204" height="62" rx="6" />
                <path class="sx-ink" d="M126 72 L122 86 H158 L154 72" />
                <polygon class="sx-pf" points="78,24 100,34 78,44 56,34" />
                <path class="sx-p" d="M56 34 V50 L78 60 L100 50 V34 M78 44 V60" />
                <rect class="sx-pf" x="116" y="26" width="72" height="30" rx="6" />
                <text class="sx-label sx-tp" x="152" y="39" text-anchor="middle">Local GPU</text>
                <text class="sx-label" x="152" y="50" text-anchor="middle" style="font-size: 8px">air-gapped</text>
                <circle class="sx-af sx-glow" cx="214" cy="41" r="12" stroke-width="1.5" />
                <path class="sx-a" d="M209 41 L213 45 L220 37" stroke-width="1.8" />
              </template>
            </svg>
          </div>

          <div class="surf-top">
            <span class="surf-icon ms-tone-tile"><MsIcon :name="s.icon" :size="20" :duotone="true" /></span>
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
  gap: 18px;
}

.surf-card {
  display: flex;
  flex-direction: column;
  padding: 22px;
  border-radius: 18px;
  border: 1px solid var(--vp-c-divider);
  background: linear-gradient(180deg, var(--vp-c-bg-soft), var(--vp-c-bg));
  text-decoration: none;
  color: inherit;
  transition:
    transform 0.25s ease,
    border-color 0.25s ease,
    box-shadow 0.25s ease;
}

.surf-card:hover {
  transform: translateY(-4px);
  border-color: color-mix(in srgb, var(--tone-p) 45%, transparent);
  box-shadow: 0 24px 48px -28px color-mix(in srgb, var(--tone-p) 45%, transparent);
}

.surf-schematic {
  aspect-ratio: 280 / 100;
  margin-bottom: 16px;
}

.surf-card:hover .surf-schematic {
  border-color: color-mix(in srgb, var(--tone-p) 38%, transparent);
}

.surf-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.surf-icon {
  width: 38px;
  height: 38px;
  border-radius: 10px;
}

.surf-tag {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 650;
  color: var(--tone-p);
  background: color-mix(in srgb, var(--tone-p) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--tone-p) 35%, transparent);
}

.surf-card h3 {
  margin: 14px 0 6px;
  font-size: 1.06rem;
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
