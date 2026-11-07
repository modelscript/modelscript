<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { useData } from "vitepress";
import { computed, ref, watch } from "vue";
import { useAnsatzOrigin } from "../util/ansatz";
import ModelScriptViewer from "./ModelScriptViewer.vue";
import MsIcon from "./MsIcon.vue";

const props = defineProps<{
  slug?: string;
}>();

const { ansatzOrigin } = useAnsatzOrigin();

const { page, frontmatter, isDark } = useData();

interface LanguageExampleItem {
  slug: string;
  name: string;
  ext: string;
  filename: string;
  title: string;
  description: string;
  viewLabel: string;
  code: string;
  lineCount: number;
  permalinkToken: string;
  svgDark: string;
  svgLight: string;
}

const currentSlug = computed<string>(() => {
  if (props.slug) return props.slug;
  const rel = page.value.relativePath ?? "";
  if (!rel.startsWith("languages/")) return "";
  const base = rel.replace(/^languages\//, "").replace(/\.md$/, "");
  return base === "overview" ? "" : base;
});

const example = computed<LanguageExampleItem | undefined>(() => {
  if (!currentSlug.value) return undefined;
  const injected = (frontmatter.value as { _example?: LanguageExampleItem })?._example;
  if (injected && injected.slug === currentSlug.value) return injected;
  return undefined;
});

type ViewMode = "split" | "code" | "diagram" | "live";
const viewMode = ref<ViewMode>("split");
const copied = ref(false);

const zoom = ref(1);
const panX = ref(0);
const panY = ref(0);
const isPanning = ref(false);
let dragStartX = 0;
let dragStartY = 0;

watch(currentSlug, () => {
  viewMode.value = "split";
  zoom.value = 1;
  panX.value = 0;
  panY.value = 0;
  copied.value = false;
});

const codeLines = computed<string[]>(() => {
  if (!example.value) return [];
  return example.value.code.split("\n");
});

const activeSvg = computed<string>(() => {
  if (!example.value) return "";
  return isDark.value ? example.value.svgDark : example.value.svgLight;
});

const morselHref = computed<string>(() => {
  if (!example.value) return `${ansatzOrigin.value}/morsel`;
  return `${ansatzOrigin.value}/morsel#m=${example.value.permalinkToken}`;
});
const sketchHref = morselHref;

const canvasTransform = computed<string>(() => {
  return `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`;
});

async function copyCode() {
  if (!example.value || typeof navigator === "undefined" || !navigator.clipboard) return;
  try {
    await navigator.clipboard.writeText(example.value.code);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 1800);
  } catch {
    copied.value = false;
  }
}

function zoomIn() {
  zoom.value = Math.min(2.5, Number((zoom.value + 0.2).toFixed(2)));
}

function zoomOut() {
  zoom.value = Math.max(0.5, Number((zoom.value - 0.2).toFixed(2)));
}

function resetViewport() {
  zoom.value = 1;
  panX.value = 0;
  panY.value = 0;
}

function onWheel(e: WheelEvent) {
  const delta = -e.deltaY * 0.0012;
  zoom.value = Math.min(2.5, Math.max(0.5, Number((zoom.value + delta).toFixed(2))));
}

const TOKEN_RE =
  /(\/\/.*$|#.*$|--.*$|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|\b(model|package|block|connector|record|function|equation|algorithm|parameter|constant|input|output|flow|stream|discrete|extends|import|within|connect|der|initial|when|then|elsewhen|else|if|for|loop|in|while|return|end|part|attribute|port|item|action|state|transition|requirement|constraint|satisfy|verify|calc|def|module|endmodule|electrical|ground|branch|subckt|ends|ac|dc|tran)\b|\b(Real|Integer|Boolean|String|StateSelect|Voltage|Current|Temperature|Pressure|Mass|Length|Time|Velocity|Force|Torque|Frequency|Resistance|Capacitance|Inductance)\b|(:=|=|\+|-|\*|\/|\^|==|<>|<=|>=|<|>)/gm;

function escapeHtml(raw: string): string {
  return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightLine(line: string): string {
  if (!line) return " ";
  let out = "";
  let lastIndex = 0;
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(line)) !== null) {
    if (match.index > lastIndex) {
      out += escapeHtml(line.slice(lastIndex, match.index));
    }
    const [full, comment, str, num, kw, typeTok, op] = match;
    const escaped = escapeHtml(full);
    if (comment !== undefined) out += `<span class="tok-comment">${escaped}</span>`;
    else if (str !== undefined) out += `<span class="tok-string">${escaped}</span>`;
    else if (num !== undefined) out += `<span class="tok-number">${escaped}</span>`;
    else if (kw !== undefined) out += `<span class="tok-keyword">${escaped}</span>`;
    else if (typeTok !== undefined) out += `<span class="tok-type">${escaped}</span>`;
    else if (op !== undefined) out += `<span class="tok-op">${escaped}</span>`;
    else out += escaped;
    lastIndex = TOKEN_RE.lastIndex;
  }
  if (lastIndex < line.length) {
    out += escapeHtml(line.slice(lastIndex));
  }
  return out;
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  e.preventDefault();
  isPanning.value = true;
  dragStartX = e.clientX - panX.value;
  dragStartY = e.clientY - panY.value;
  try {
    (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
  } catch {
    /* ignore */
  }
}

function onPointerMove(e: PointerEvent) {
  if (!isPanning.value) return;
  if (typeof e.buttons === "number" && (e.buttons & 1) === 0) {
    isPanning.value = false;
    return;
  }
  panX.value = e.clientX - dragStartX;
  panY.value = e.clientY - dragStartY;
}

function onPointerUp(e: PointerEvent) {
  if (!isPanning.value) return;
  isPanning.value = false;
  try {
    (e.currentTarget as HTMLElement | null)?.releasePointerCapture?.(e.pointerId);
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <section
    v-if="example"
    class="lang-example-card"
    role="region"
    :aria-label="`${example.name} interactive code and diagram example`"
  >
    <header class="lang-example-header">
      <div class="lang-example-meta">
        <div class="lang-example-title-row">
          <span class="lang-example-pill">Live Example</span>
          <code class="lang-example-filename">{{ example.filename }}</code>
          <h3 class="lang-example-title">{{ example.title }}</h3>
        </div>
        <p class="lang-example-desc">{{ example.description }}</p>
      </div>

      <div class="lang-example-controls">
        <div class="lang-example-tabs" role="tablist" aria-label="Example view mode">
          <button
            type="button"
            role="tab"
            :aria-selected="viewMode === 'split'"
            class="mode-tab"
            :class="{ 'is-active': viewMode === 'split' }"
            @click="viewMode = 'split'"
          >
            <MsIcon name="layers" :size="13" />
            <span>Split</span>
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="viewMode === 'code'"
            class="mode-tab"
            :class="{ 'is-active': viewMode === 'code' }"
            @click="viewMode = 'code'"
          >
            <MsIcon name="code" :size="13" />
            <span>Code</span>
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="viewMode === 'diagram'"
            class="mode-tab"
            :class="{ 'is-active': viewMode === 'diagram' }"
            @click="viewMode = 'diagram'"
          >
            <MsIcon name="workflow" :size="13" />
            <span>Diagram</span>
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="viewMode === 'live'"
            class="mode-tab mode-tab-live"
            :class="{ 'is-active': viewMode === 'live' }"
            title="Mount interactive WebAssembly workbench inline"
            @click="viewMode = 'live'"
          >
            <MsIcon name="play" :size="13" />
            <span>Run Live</span>
          </button>
        </div>

        <a
          :href="morselHref"
          target="_blank"
          rel="noopener noreferrer"
          class="open-playground-link"
          title="Open this model in Ansatz Morsel"
        >
          <span>Morsel</span>
          <MsIcon name="arrow-up-right" :size="13" />
        </a>
      </div>
    </header>

    <div v-if="viewMode === 'live'" class="lang-example-live-pane">
      <div class="live-pane-banner">
        <span class="live-pane-status">
          <span class="live-dot" />
          Interactive WebAssembly Workbench — {{ example.filename }}
        </span>
        <button type="button" class="live-close-btn" @click="viewMode = 'split'">
          Return to Split View
        </button>
      </div>
      <ClientOnly>
        <ModelScriptViewer
          :code="example.code"
          :dialect="example.slug"
          :token="example.permalinkToken"
          :title="`${example.name} — ${example.title}`"
          height="520px"
        />
      </ClientOnly>
    </div>

    <div
      v-else
      class="lang-example-body"
      :class="{
        'is-split': viewMode === 'split',
        'is-code-only': viewMode === 'code',
        'is-diagram-only': viewMode === 'diagram',
      }"
    >
      <div v-if="viewMode === 'split' || viewMode === 'code'" class="example-code-pane">
        <div class="pane-toolbar">
          <span class="pane-label">
            <MsIcon name="terminal" :size="12" />
            <span>Source ({{ example.lineCount }} lines)</span>
          </span>
          <button type="button" class="pane-action-btn" @click="copyCode">
            <MsIcon :name="copied ? 'check' : 'copy'" :size="12" />
            <span>{{ copied ? "Copied" : "Copy" }}</span>
          </button>
        </div>

        <div class="code-scroll-container">
          <pre class="code-pre"><code><span
            v-for="(line, idx) in codeLines"
            :key="idx"
            class="code-line"
          ><span class="line-num">{{ idx + 1 }}</span><span class="line-text" v-html="highlightLine(line)" />
</span></code></pre>
        </div>
      </div>

      <div v-if="viewMode === 'split' || viewMode === 'diagram'" class="example-diagram-pane">
        <div class="pane-toolbar">
          <span class="pane-label">
            <MsIcon name="cpu" :size="12" />
            <span>{{ example.viewLabel }}</span>
          </span>
          <div class="diagram-zoom-controls">
            <button type="button" class="zoom-btn" title="Zoom out" aria-label="Zoom out" @click="zoomOut">
              −
            </button>
            <button
              type="button"
              class="zoom-readout"
              title="Reset zoom and pan"
              @click="resetViewport"
            >
              {{ Math.round(zoom * 100) }}%
            </button>
            <button type="button" class="zoom-btn" title="Zoom in" aria-label="Zoom in" @click="zoomIn">
              +
            </button>
          </div>
        </div>

        <div
          class="diagram-viewport"
          :class="{ 'is-dragging': isPanning }"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @lostpointercapture="onPointerUp"
          @wheel.prevent="onWheel"
          @dblclick="resetViewport"
          @dragstart.prevent
        >
          <div
            class="diagram-svg-stage"
            :style="{ transform: canvasTransform }"
            v-html="activeSvg"
          />
          <span class="diagram-pan-hint">Drag to pan · Scroll to zoom · Double-click to reset</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lang-example-card {
  margin: 0 0 32px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  overflow: hidden;
  transition: border-color 0.2s ease;
}

.lang-example-card:hover {
  border-color: var(--ms-border-strong);
}

.lang-example-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 18px;
  background: var(--vp-c-bg-elv);
  border-bottom: 1px solid var(--vp-c-divider);
}

.lang-example-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 240px;
  flex: 1;
}

.lang-example-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.lang-example-pill {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 2px 8px;
  border-radius: 9999px;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  border: 1px solid rgba(6, 182, 212, 0.28);
}

.lang-example-filename {
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  padding: 2px 7px;
  border-radius: 5px;
}

.lang-example-title {
  margin: 0 !important;
  padding: 0 !important;
  border: none !important;
  font-size: 14px !important;
  font-weight: 600 !important;
  line-height: 1.35 !important;
  color: var(--vp-c-text-1);
}

.lang-example-desc {
  margin: 0 !important;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--vp-c-text-2);
}

.lang-example-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.lang-example-tabs {
  display: inline-flex;
  align-items: center;
  padding: 3px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  gap: 2px;
}

.mode-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mode-tab:hover {
  color: var(--vp-c-text-1);
}

.mode-tab.is-active {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-elv);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

.mode-tab-live.is-active {
  color: #10b981;
}

.open-playground-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  text-decoration: none !important;
  transition: all 0.15s ease;
}

.open-playground-link:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.lang-example-body {
  display: grid;
  min-height: 360px;
  max-height: 460px;
}

.lang-example-body.is-split {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
}

.lang-example-body.is-code-only,
.lang-example-body.is-diagram-only {
  grid-template-columns: minmax(0, 1fr);
}

.example-code-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--vp-c-divider);
  background: var(--vp-code-block-bg);
}

.lang-example-body.is-code-only .example-code-pane {
  border-right: none;
}

.example-diagram-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--vp-c-bg);
}

.pane-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
  font-size: 11px;
  color: var(--vp-c-text-2);
}

.pane-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.pane-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 5px;
  cursor: pointer;
}

.pane-action-btn:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-border);
}

.code-scroll-container {
  flex: 1;
  overflow: auto;
  padding: 10px 0;
}

.code-pre {
  margin: 0 !important;
  padding: 0 12px !important;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  line-height: 1.55;
  background: transparent !important;
}

.code-line {
  display: table-row;
}

.line-num {
  display: table-cell;
  user-select: none;
  text-align: right;
  padding-right: 12px;
  min-width: 28px;
  color: var(--vp-c-text-3);
  font-size: 11px;
}

.line-text {
  display: table-cell;
  white-space: pre;
  color: var(--vp-c-text-1);
}

.line-text :deep(.tok-comment) {
  color: #64748b;
  font-style: italic;
}

.line-text :deep(.tok-string) {
  color: #059669;
}

.line-text :deep(.tok-number) {
  color: #d97706;
}

.line-text :deep(.tok-keyword) {
  color: #0284c7;
  font-weight: 600;
}

.line-text :deep(.tok-type) {
  color: #7c3aed;
  font-weight: 600;
}

.line-text :deep(.tok-op) {
  color: var(--vp-c-text-2);
}

:global(.dark) .line-text :deep(.tok-comment) {
  color: #64748b;
}

:global(.dark) .line-text :deep(.tok-string) {
  color: #34d399;
}

:global(.dark) .line-text :deep(.tok-number) {
  color: #fbbf24;
}

:global(.dark) .line-text :deep(.tok-keyword) {
  color: #38bdf8;
}

:global(.dark) .line-text :deep(.tok-type) {
  color: #c084fc;
}

.diagram-zoom-controls {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 5px;
  padding: 1px;
}

.zoom-btn {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  background: transparent;
  border: none;
  cursor: pointer;
  border-radius: 4px;
}

.zoom-btn:hover {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
}

.zoom-readout {
  padding: 0 6px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  background: transparent;
  border: none;
  cursor: pointer;
}

.zoom-readout:hover {
  color: var(--vp-c-brand-1);
}

.diagram-viewport {
  position: relative;
  flex: 1;
  min-height: 310px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  user-select: none;
  padding: 12px;
}

.diagram-viewport.is-dragging {
  cursor: grabbing;
}

.diagram-svg-stage {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  transform-origin: center center;
  transition: transform 0.06s linear;
}

.diagram-svg-stage :deep(svg) {
  max-width: 100%;
  max-height: 380px;
  width: auto;
  height: auto;
  display: block;
  border-radius: 6px;
}

.diagram-pan-hint {
  position: absolute;
  right: 10px;
  bottom: 8px;
  font-size: 10px;
  color: var(--vp-c-text-3);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  padding: 2px 7px;
  border-radius: 9999px;
  pointer-events: none;
  opacity: 0.85;
}

.lang-example-live-pane {
  padding: 12px 16px 16px;
  background: var(--vp-c-bg);
}

.live-pane-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--vp-c-text-2);
}

.live-pane-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-weight: 600;
}

.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 6px #10b981;
}

.live-close-btn {
  padding: 3px 10px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  cursor: pointer;
}

.live-close-btn:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-border);
}

@media (max-width: 860px) {
  .lang-example-body.is-split {
    grid-template-columns: 1fr;
    max-height: none;
  }

  .example-code-pane {
    border-right: none;
    border-bottom: 1px solid var(--vp-c-divider);
    max-height: 280px;
  }
}
</style>
