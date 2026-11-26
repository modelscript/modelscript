<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { useData } from "vitepress";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useAnsatzOrigin } from "../util/ansatz";

const props = withDefaults(
  defineProps<{
    /** Hosted Ansatz artifact ID (renders /render-artifact/:id?embed=1) */
    artifactId?: string;
    /** Inline source code for self-contained artifacts (renders /embed/editor) */
    code?: string;
    /** Compressed @modelscript/embed permalink token (#m=...) */
    token?: string;
    /** Engineering language / dialect (e.g. modelica, sysml2, spice, step) */
    dialect?: string;
    /** Editor view mode for inline embeds (diagram | cad | plot | code | split-columns | split-rows) */
    view?: string;
    /** Visual placeholder kind (simulation | diagram | cad | cfd | fea | generic) */
    kind?: string;
    /** Deep-linked component/connection anchor */
    anchor?: string;
    /** Display title in header & placeholder */
    title?: string;
    /** Optional static poster/thumbnail image shown before activation */
    poster?: string;
    /** Optional figure number label (e.g. "Figure 1") */
    figure?: string;
    /** Optional caption rendered beneath the artifact block */
    caption?: string;
    /** Height of the artifact viewport */
    height?: string;
    /** Activation strategy: click (default) or visible (IntersectionObserver) */
    activate?: "click" | "visible";
    /** Whether the inline artifact represents a multi-file package */
    isMultiFile?: boolean;
  }>(),
  {
    dialect: "modelica",
    view: "diagram",
    kind: "simulation",
    height: "500px",
    activate: "click",
    isMultiFile: false,
  },
);

const { isDark } = useData();
const { ansatzOrigin } = useAnsatzOrigin();

const containerRef = ref<HTMLElement | null>(null);
const iframeRef = ref<HTMLIFrameElement | null>(null);
const isInteractive = ref(false);
const isLoaded = ref(false);
const isFullscreen = ref(false);
const showCodePreview = ref(false);

const isHostedArtifact = computed(() => Boolean(props.artifactId && props.artifactId.trim() !== ""));

const hashPayload = computed(() => {
  if (props.token) {
    return `m=${encodeURIComponent(props.token)}`;
  }
  const dialectKey = encodeURIComponent(props.dialect || "modelica");
  const encodedCode = encodeURIComponent((props.code || "").trim());
  return `${dialectKey}=${encodedCode}`;
});

const iframeSrc = computed(() => {
  const origin = ansatzOrigin.value.replace(/\/$/, "");
  const theme = isDark.value ? "dark" : "light";

  if (isHostedArtifact.value) {
    const params = new URLSearchParams();
    params.set("embed", "1");
    params.set("theme", theme);
    return `${origin}/render-artifact/${encodeURIComponent(props.artifactId!.trim())}?${params.toString()}`;
  }

  const params = new URLSearchParams();
  if (props.view) params.set("view", props.view);
  if (props.anchor) params.set("anchor", props.anchor);
  if (props.isMultiFile) params.set("isMultiFile", "1");
  params.set("theme", theme);
  return `${origin}/embed/editor?${params.toString()}#${hashPayload.value}`;
});

const externalUrl = computed(() => {
  const origin = ansatzOrigin.value.replace(/\/$/, "");
  if (isHostedArtifact.value) {
    return `${origin}/render-artifact/${encodeURIComponent(props.artifactId!.trim())}`;
  }
  return `${origin}/studio#${hashPayload.value}`;
});

const normalizedKind = computed(() => (props.kind || "simulation").toLowerCase());

const badgeLabel = computed(() => {
  if (isHostedArtifact.value) return `ANSATZ #${props.artifactId}`;
  return (props.dialect || "modelica").toUpperCase();
});

const displayTitle = computed(() => props.title || (isHostedArtifact.value ? `Ansatz Artifact #${props.artifactId}` : "Interactive ModelScript Artifact"));

function activateArtifact(): void {
  isInteractive.value = true;
  isLoaded.value = false;
}

function resetToPlaceholder(): void {
  isInteractive.value = false;
  isLoaded.value = false;
  isFullscreen.value = false;
}

function toggleFullscreen(): void {
  if (!isInteractive.value) {
    activateArtifact();
  }
  isFullscreen.value = !isFullscreen.value;
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === "Escape" && isFullscreen.value) {
    isFullscreen.value = false;
  }
}

watch(isDark, (dark) => {
  const win = iframeRef.value?.contentWindow;
  if (win) {
    try {
      win.postMessage({ type: "SET_THEME", theme: dark ? "dark" : "light" }, "*");
    } catch {
      /* ignore cross-origin frame errors before load */
    }
  }
});

let observer: IntersectionObserver | null = null;

onMounted(() => {
  window.addEventListener("keydown", onKeyDown);
  if (props.activate === "visible" && containerRef.value && typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          activateArtifact();
          observer?.disconnect();
          observer = null;
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(containerRef.value);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeyDown);
  observer?.disconnect();
});
</script>

<template>
  <figure
    ref="containerRef"
    class="ms-artifact-figure"
    :class="{ 'is-fullscreen': isFullscreen }"
  >
    <div class="ms-artifact-card">
      <!-- Top Studio Bar -->
      <div class="ms-artifact-header">
        <div class="ms-artifact-header-left">
          <span class="ms-artifact-dot" :class="{ active: isInteractive && isLoaded }" />
          <span class="ms-artifact-title">{{ displayTitle }}</span>
          <span class="ms-artifact-badge">{{ badgeLabel }}</span>
          <span v-if="!isHostedArtifact && view" class="ms-artifact-badge subtle">{{ view }}</span>
        </div>

        <div class="ms-artifact-header-actions">
          <button
            v-if="code && !isInteractive"
            type="button"
            class="ms-artifact-btn"
            @click="showCodePreview = !showCodePreview"
          >
            {{ showCodePreview ? "Hide Source" : "View Source" }}
          </button>

          <button
            v-if="isInteractive"
            type="button"
            class="ms-artifact-btn"
            :title="isFullscreen ? 'Exit Fullscreen (Esc)' : 'Expand Fullscreen'"
            @click="toggleFullscreen"
          >
            {{ isFullscreen ? "Exit Fullscreen" : "Fullscreen" }}
          </button>

          <button
            v-if="isInteractive"
            type="button"
            class="ms-artifact-btn"
            title="Unload interactive session and return to preview"
            @click="resetToPlaceholder"
          >
            Suspend
          </button>

          <a
            :href="externalUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="ms-artifact-ext-link"
          >
            Open in Ansatz <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>

      <!-- Optional collapsible code preview before activating -->
      <div v-if="showCodePreview && code && !isInteractive" class="ms-artifact-code-drawer">
        <pre><code>{{ code.trim() }}</code></pre>
      </div>

      <!-- Viewport: Placeholder -> Live Interactive Iframe -->
      <div class="ms-artifact-viewport" :style="isFullscreen ? undefined : { height }">
        <!-- Placeholder State -->
        <div v-if="!isInteractive" class="ms-artifact-placeholder" @click="activateArtifact">
          <img
            v-if="poster"
            :src="poster"
            :alt="displayTitle"
            class="ms-artifact-poster"
            loading="lazy"
          />
          <div v-else class="ms-artifact-blueprint" aria-hidden="true">
            <!-- Technical grid + domain silhouette -->
            <svg viewBox="0 0 800 420" fill="none" xmlns="http://www.w3.org/2000/svg" class="ms-blueprint-svg">
              <defs>
                <pattern id="ms-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                  <path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" stroke-opacity="0.09" stroke-width="1" />
                </pattern>
              </defs>
              <rect width="800" height="420" fill="url(#ms-grid)" />

              <!-- CAD / 3D wireframe silhouette -->
              <g v-if="normalizedKind === 'cad' || normalizedKind === '3d'" stroke="currentColor" stroke-width="1.6" stroke-opacity="0.45">
                <polygon points="400,72 540,144 540,288 400,360 260,288 260,144" fill="currentColor" fill-opacity="0.04" />
                <line x1="400" y1="72" x2="400" y2="216" />
                <line x1="400" y1="216" x2="540" y2="144" />
                <line x1="400" y1="216" x2="260" y2="144" />
                <line x1="400" y1="216" x2="400" y2="360" stroke-dasharray="6 5" />
                <circle cx="400" cy="216" r="42" stroke="#38bdf8" stroke-opacity="0.65" />
              </g>

              <!-- CFD / FEA mesh & streamlines -->
              <g v-else-if="normalizedKind === 'cfd' || normalizedKind === 'fea'" stroke="currentColor" stroke-width="1.5" stroke-opacity="0.42">
                <path d="M80,140 C220,140 280,100 400,120 C520,140 600,100 720,115" stroke="#38bdf8" stroke-opacity="0.65" />
                <path d="M80,210 C220,210 280,155 400,185 C520,215 600,175 720,190" stroke="#818cf8" stroke-opacity="0.6" />
                <path d="M80,280 C220,280 280,310 400,290 C520,270 600,305 720,285" stroke="#38bdf8" stroke-opacity="0.55" />
                <ellipse cx="395" cy="210" rx="88" ry="34" fill="currentColor" fill-opacity="0.08" />
              </g>

              <!-- Default: Acausal schematic + simulation waveform -->
              <g v-else stroke="currentColor" stroke-width="1.6" stroke-opacity="0.45">
                <rect x="130" y="135" width="120" height="72" rx="8" fill="currentColor" fill-opacity="0.05" />
                <rect x="340" y="135" width="120" height="72" rx="8" fill="currentColor" fill-opacity="0.05" stroke="#38bdf8" stroke-opacity="0.7" />
                <rect x="550" y="135" width="120" height="72" rx="8" fill="currentColor" fill-opacity="0.05" />
                <line x1="250" y1="171" x2="340" y2="171" stroke="#38bdf8" stroke-opacity="0.7" />
                <line x1="460" y1="171" x2="550" y2="171" stroke="#38bdf8" stroke-opacity="0.7" />
                <path d="M130,315 Q210,245 290,295 T450,275 T670,260" stroke="#38bdf8" stroke-width="2.2" stroke-opacity="0.75" fill="none" />
                <line x1="130" y1="330" x2="670" y2="330" stroke-dasharray="4 4" stroke-opacity="0.3" />
              </g>
            </svg>
          </div>

          <!-- Interactive Launch Overlay -->
          <div class="ms-artifact-overlay">
            <button type="button" class="ms-launch-cta" @click.stop="activateArtifact">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
              <span>Interact Live</span>
            </button>
            <span class="ms-launch-hint">
              Click to load interactive Ansatz {{ isHostedArtifact ? "artifact" : "WebAssembly sandbox" }} inline
            </span>
          </div>
        </div>

        <!-- Active Interactive State -->
        <template v-else>
          <div v-if="!isLoaded" class="ms-artifact-loading" aria-live="polite">
            <div class="ms-spinner" aria-hidden="true" />
            <span>Initializing interactive Ansatz artifact…</span>
          </div>
          <iframe
            ref="iframeRef"
            :src="iframeSrc"
            class="ms-artifact-iframe"
            frameborder="0"
            allow="clipboard-read; clipboard-write; fullscreen; xr-spatial-tracking"
            allowfullscreen
            :title="displayTitle"
            @load="isLoaded = true"
          />
        </template>
      </div>
    </div>

    <figcaption v-if="caption || figure" class="ms-artifact-caption">
      <strong v-if="figure">{{ figure }}:</strong>
      {{ caption }}
    </figcaption>
  </figure>
</template>

<style scoped>
.ms-artifact-figure {
  margin: 28px 0;
  width: 100%;
}

.ms-artifact-figure.is-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 9999;
  margin: 0;
  padding: 20px;
  background: rgba(2, 6, 23, 0.82);
  backdrop-filter: blur(8px);
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.ms-artifact-figure.is-fullscreen .ms-artifact-card {
  height: 100%;
  max-height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;
}

.ms-artifact-figure.is-fullscreen .ms-artifact-viewport {
  flex: 1;
  height: 100%;
}

.ms-artifact-card {
  width: 100%;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
  box-shadow: 0 12px 32px -12px rgba(2, 6, 23, 0.25);
}

.ms-artifact-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
  font-size: 12.5px;
  flex-wrap: wrap;
}

.ms-artifact-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ms-artifact-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--vp-c-text-3);
  flex-shrink: 0;
  transition: background 0.2s ease, box-shadow 0.2s ease;
}

.ms-artifact-dot.active {
  background: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.75);
}

.ms-artifact-title {
  font-weight: 600;
  color: var(--vp-c-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ms-artifact-badge {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 5px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 26%, transparent);
}

.ms-artifact-badge.subtle {
  background: var(--vp-c-bg-elv);
  color: var(--vp-c-text-2);
  border-color: var(--vp-c-divider);
}

.ms-artifact-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ms-artifact-btn {
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ms-artifact-btn:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-text-1);
}

.ms-artifact-ext-link {
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
  white-space: nowrap;
}

.ms-artifact-ext-link:hover {
  text-decoration: underline;
}

.ms-artifact-code-drawer {
  max-height: 240px;
  overflow: auto;
  background: var(--vp-code-block-bg);
  border-bottom: 1px solid var(--vp-c-divider);
  padding: 12px 16px;
}

.ms-artifact-code-drawer pre {
  margin: 0;
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--vp-c-text-1);
}

.ms-artifact-viewport {
  position: relative;
  width: 100%;
  min-height: 280px;
  background: var(--vp-c-bg);
}

.ms-artifact-placeholder {
  position: relative;
  width: 100%;
  height: 100%;
  cursor: pointer;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--vp-c-brand-1) 10%, var(--vp-c-bg-alt)), var(--vp-c-bg-alt));
}

.ms-artifact-poster {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  filter: brightness(0.86);
  transition: transform 0.35s ease, filter 0.25s ease;
}

.ms-artifact-placeholder:hover .ms-artifact-poster {
  transform: scale(1.015);
  filter: brightness(0.95);
}

.ms-artifact-blueprint {
  position: absolute;
  inset: 0;
  color: var(--vp-c-text-2);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ms-blueprint-svg {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ms-artifact-overlay {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 20px 26px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--vp-c-bg) 82%, transparent);
  backdrop-filter: blur(10px);
  border: 1px solid var(--vp-c-divider);
  box-shadow: 0 12px 32px rgba(2, 6, 23, 0.22);
  text-align: center;
}

.ms-launch-cta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 999px;
  border: none;
  background: var(--vp-c-brand-1);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 6px 18px color-mix(in srgb, var(--vp-c-brand-1) 38%, transparent);
  transition: transform 0.15s ease, filter 0.15s ease;
}

.ms-launch-cta:hover {
  transform: translateY(-1px);
  filter: brightness(1.08);
}

.ms-launch-hint {
  font-size: 12px;
  color: var(--vp-c-text-2);
}

.ms-artifact-loading {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-2);
  font-size: 13px;
  font-family: var(--vp-font-family-mono);
}

.ms-spinner {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 3px solid var(--vp-c-divider);
  border-top-color: var(--vp-c-brand-1);
  animation: ms-spin 0.85s linear infinite;
}

@keyframes ms-spin {
  to {
    transform: rotate(360deg);
  }
}

.ms-artifact-iframe {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}

.ms-artifact-caption {
  margin-top: 10px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
  text-align: center;
}

.ms-artifact-figure.is-fullscreen .ms-artifact-caption {
  color: #cbd5e1;
}
</style>
