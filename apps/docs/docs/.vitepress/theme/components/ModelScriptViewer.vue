<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    code: string;
    dialect?: string;
    view?: string;
    anchor?: string;
    height?: string;
    title?: string;
    isMultiFile?: boolean;
    artifactId?: string;
  }>(),
  {
    dialect: "modelica",
    view: "diagram",
    height: "480px",
    isMultiFile: false,
  },
);

const encodedPayload = computed(() => {
  // Safe minimal client-side encode for docs preview
  try {
    const jsonStr = JSON.stringify({
      v: 1,
      lang: props.dialect,
      code: props.code.trim(),
      view: props.view,
      anchor: props.anchor ? { elementId: props.anchor } : undefined,
      isMultiFile: props.isMultiFile,
      artifactId: props.artifactId,
    });
    // Fallback URL-safe btoa encoding
    return btoa(unescape(encodeURI(jsonStr)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  } catch {
    return "";
  }
});

const iframeSrc = computed(() => {
  return `/embed/playground#m=${encodedPayload.value}`;
});
</script>

<template>
  <div class="modelscript-embed-container" :style="{ height }">
    <iframe
      :src="iframeSrc"
      width="100%"
      height="100%"
      frameborder="0"
      allow="clipboard-read; clipboard-write"
      :title="title || 'ModelScript Artifact Viewer'"
    />
  </div>
</template>

<style scoped>
.modelscript-embed-container {
  width: 100%;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
  margin: 16px 0;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}
</style>
