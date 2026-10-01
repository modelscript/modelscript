<script setup lang="ts">
import { ref } from "vue";

const dockerSnippet = `# Pull the pre-built multi-arch images
docker pull ghcr.io/modelscript/api:latest
docker pull ghcr.io/modelscript/morsel:latest

# Launch backend simulation server & interactive web UI
docker compose up -d`;

const copied = ref(false);

async function copyDocker() {
  try {
    await navigator.clipboard.writeText(dockerSnippet);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    // fallback
  }
}
</script>

<template>
  <section class="home-section docker-section">
    <div class="section-container">
      <div class="section-header">
        <span class="section-badge">Containerized Deployment</span>
        <h2 class="section-title">Run with Docker</h2>
        <p class="section-subtitle">
          Spin up the complete simulation API and Morsel environment locally with zero dependencies.
        </p>
      </div>

      <div class="docker-card">
        <div class="terminal-bar">
          <div class="terminal-dots">
            <span class="dot red"></span>
            <span class="dot yellow"></span>
            <span class="dot green"></span>
          </div>
          <span class="terminal-label">docker-compose</span>
          <button type="button" class="copy-btn" aria-label="Copy Docker command snippet" @click="copyDocker">
            <span v-if="copied" class="copied-text">✓ Copied</span>
            <span v-else class="copy-text">Copy</span>
          </button>
        </div>
        <pre class="terminal-code"><code>{{ dockerSnippet }}</code></pre>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-section {
  padding: 64px 24px;
}

.docker-section {
  background: var(--vp-c-bg-alt);
}

.section-container {
  max-width: 800px;
  margin: 0 auto;
}

.section-header {
  text-align: center;
  margin-bottom: 40px;
}

.section-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  margin-bottom: 12px;
}

.section-title {
  font-size: clamp(1.8rem, 3.5vw, 2.4rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--vp-c-text-1);
}

.section-subtitle {
  color: var(--vp-c-text-2);
  font-size: 1.05rem;
  margin-top: 8px;
  line-height: 1.6;
}

.docker-card {
  background: #0d1117;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
}

.terminal-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.terminal-dots {
  display: flex;
  gap: 6px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.dot.red { background: #ff5f56; }
.dot.yellow { background: #ffbd2e; }
.dot.green { background: #27c93f; }

.terminal-label {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.45);
  font-family: var(--vp-font-family-mono);
}

.copy-btn {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.75rem;
  padding: 3px 10px;
  cursor: pointer;
  transition: all 0.2s;
}

.copy-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.copied-text {
  color: #3fb950;
  font-weight: 600;
}

.terminal-code {
  padding: 16px 20px;
  margin: 0;
  font-family: var(--vp-font-family-mono);
  font-size: 0.9rem;
  color: #e6edf3;
  line-height: 1.6;
  overflow-x: auto;
}
</style>
