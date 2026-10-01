<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from "vue";
import { useData } from "vitepress";

const props = defineProps<{
  code: string;
}>();

const { isDark } = useData();
const containerRef = ref<HTMLElement | null>(null);
const svg = ref<string>("");
const error = ref<string | null>(null);
const loading = ref(true);

let renderCounter = 0;

async function renderDiagram() {
  if (typeof window === "undefined") return;

  const currentCounter = ++renderCounter;
  loading.value = true;
  error.value = null;

  try {
    const mermaidModule = await import("mermaid");
    const mermaid = mermaidModule.default || mermaidModule;

    const dark = isDark.value;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      fontFamily: "var(--vp-font-family-base, system-ui, -apple-system, sans-serif)",
      theme: dark ? "dark" : "default",
      themeVariables: dark
        ? {
            darkMode: true,
            background: "#161b22",
            primaryColor: "#21262d",
            primaryTextColor: "#f0f6fc",
            primaryBorderColor: "#388bfd",
            lineColor: "#58a6ff",
            secondaryColor: "#1f242c",
            tertiaryColor: "#161b22",
            nodeBorder: "#388bfd",
            clusterBkg: "#0d1117",
            clusterBorder: "#30363d",
            defaultLinkColor: "#58a6ff",
            titleColor: "#f0f6fc",
            edgeLabelBackground: "#161b22",
          }
        : {
            darkMode: false,
            background: "#f6f8fa",
            primaryColor: "#e6edfa",
            primaryTextColor: "#1f2328",
            primaryBorderColor: "#0969da",
            lineColor: "#0969da",
            secondaryColor: "#ffffff",
            tertiaryColor: "#f6f8fa",
            nodeBorder: "#0969da",
            clusterBkg: "#f6f8fa",
            clusterBorder: "#d0d7de",
            defaultLinkColor: "#0969da",
            titleColor: "#1f2328",
            edgeLabelBackground: "#ffffff",
          },
      flowchart: {
        htmlLabels: true,
        curve: "basis",
        padding: 16,
      },
    });

    const decoded = decodeURIComponent(props.code);
    const id = "mermaid-" + Math.random().toString(36).substring(2, 9) + "-" + Date.now();

    const { svg: outSvg } = await mermaid.render(id, decoded);

    if (currentCounter === renderCounter) {
      svg.value = outSvg;
      loading.value = false;
    }
  } catch (err: unknown) {
    if (currentCounter === renderCounter) {
      console.warn("Mermaid rendering warning:", err);
      error.value = err instanceof Error ? err.message : String(err);
      loading.value = false;
    }
  }
}

onMounted(() => {
  renderDiagram();
});

watch(isDark, () => {
  nextTick(() => {
    renderDiagram();
  });
});
</script>

<template>
  <div class="mermaid-diagram-card" ref="containerRef">
    <div v-if="svg" class="mermaid-svg-container" v-html="svg"></div>
    <div v-else-if="loading" class="mermaid-loading-placeholder">
      <div class="mermaid-spinner"></div>
      <span>Rendering diagram...</span>
    </div>
    <div v-else-if="error" class="mermaid-error-fallback">
      <div class="mermaid-error-title">Diagram render error: {{ error }}</div>
      <pre><code>{{ decodeURIComponent(props.code) }}</code></pre>
    </div>
  </div>
</template>

<style scoped>
.mermaid-diagram-card {
  margin: 1.5rem 0;
  padding: 1.5rem;
  border-radius: 8px;
  background-color: var(--vp-c-bg-soft, #161b22);
  border: 1px solid var(--vp-c-divider, #30363d);
  display: flex;
  justify-content: center;
  align-items: center;
  overflow-x: auto;
  min-height: 80px;
}

.mermaid-svg-container {
  width: 100%;
  display: flex;
  justify-content: center;
}

.mermaid-svg-container :deep(svg) {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 0 auto;
}

.mermaid-loading-placeholder {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--vp-c-text-2, #8b949e);
  font-size: 0.9rem;
  padding: 1rem 0;
}

.mermaid-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--vp-c-divider, #30363d);
  border-top-color: var(--vp-c-brand-1, #388bfd);
  border-radius: 50%;
  animation: mermaid-spin 0.8s linear infinite;
}

@keyframes mermaid-spin {
  to {
    transform: rotate(360deg);
  }
}

.mermaid-error-fallback {
  width: 100%;
  color: var(--vp-c-danger-1, #f85149);
}

.mermaid-error-title {
  font-size: 0.85rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.mermaid-error-fallback pre {
  margin: 0;
  padding: 0.75rem;
  border-radius: 6px;
  background-color: var(--vp-c-bg, #0d1117);
  overflow-x: auto;
  font-size: 0.85rem;
}
</style>
