<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { useData } from "vitepress";
import { computed, ref, watch } from "vue";
import { useAnsatzOrigin } from "../util/ansatz";

const props = withDefaults(
  defineProps<{
    code?: string;
    dialect?: string;
    view?: string;
    anchor?: string;
    height?: string;
    title?: string;
    isMultiFile?: boolean;
    artifactId?: string;
    token?: string;
  }>(),
  {
    code: "",
    dialect: "modelica",
    view: "diagram",
    height: "480px",
    isMultiFile: false,
  },
);

const { isDark } = useData();
const { ansatzOrigin } = useAnsatzOrigin();
const iframeRef = ref<HTMLIFrameElement | null>(null);
const loaded = ref(false);

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
  const params = new URLSearchParams();
  if (props.view) params.set("view", props.view);
  if (props.anchor) params.set("anchor", props.anchor);
  if (props.isMultiFile) params.set("isMultiFile", "1");
  if (props.artifactId) params.set("artifactId", props.artifactId);
  params.set("theme", isDark.value ? "dark" : "light");
  const qs = params.toString();
  return `${origin}/embed/morsel${qs ? `?${qs}` : ""}#${hashPayload.value}`;
});

const studioUrl = computed(() => {
  const origin = ansatzOrigin.value.replace(/\/$/, "");
  return `${origin}/studio#${hashPayload.value}`;
});

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
</script>

<template>
  <div class="modelscript-embed-container">
    <div class="embed-header">
      <div class="embed-header-left">
        <span class="embed-dot" />
        <span class="embed-title">{{ title || "Interactive ModelScript Morsel" }}</span>
        <span class="embed-badge">{{ dialect.toUpperCase() }}</span>
        <span v-if="view" class="embed-badge subtle">{{ view }}</span>
      </div>
      <a
        :href="studioUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="embed-studio-link"
      >
        Open in Full Studio <span aria-hidden="true">↗</span>
      </a>
    </div>
    <div class="embed-body" :style="{ height }">
      <div v-if="!loaded" class="embed-skeleton" aria-hidden="true">
        <div class="skeleton-shimmer" />
        <span class="skeleton-label">Loading interactive WebAssembly morsel…</span>
      </div>
      <iframe
        ref="iframeRef"
        :src="iframeSrc"
        width="100%"
        height="100%"
        frameborder="0"
        loading="lazy"
        allow="clipboard-read; clipboard-write"
        :title="title || 'ModelScript Artifact Viewer'"
        @load="loaded = true"
      />
    </div>
  </div>
</template>

<style scoped>
.modelscript-embed-container {
  width: 100%;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
  margin: 20px 0;
  box-shadow: 0 8px 24px -8px rgba(2, 6, 23, 0.2);
}

.embed-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
  font-size: 12px;
}

.embed-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.embed-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ms-brand, #06b6d4);
  box-shadow: 0 0 8px var(--ms-brand, #06b6d4);
  flex-shrink: 0;
}

.embed-title {
  font-weight: 650;
  color: var(--vp-c-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.embed-badge {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--ms-brand-soft);
  color: var(--vp-c-brand-1);
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 28%, transparent);
}

.embed-badge.subtle {
  background: var(--vp-c-bg-elv);
  color: var(--vp-c-text-2);
  border-color: var(--vp-c-divider);
}

.embed-studio-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
  white-space: nowrap;
  transition: color 0.15s ease;
}

.embed-studio-link:hover {
  color: var(--vp-c-brand-2);
  text-decoration: underline;
}

.embed-body {
  position: relative;
  width: 100%;
  background: var(--vp-c-bg);
}

.embed-skeleton {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: var(--vp-c-bg-alt);
  z-index: 1;
}

.skeleton-shimmer {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  border: 2px solid color-mix(in srgb, var(--vp-c-brand-1) 35%, transparent);
  border-top-color: var(--vp-c-brand-1);
  animation: ms-embed-spin 0.9s linear infinite;
}

.skeleton-label {
  font-size: 12px;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-3);
}

@keyframes ms-embed-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

