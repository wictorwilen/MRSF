<script setup>
import { ref, onMounted, watch } from "vue";

const rendered = ref("");
const showResolved = ref(true);

const sampleMarkdown = `# Architecture Overview

## Introduction
This document outlines the architecture decisions for the system.

## Components
- API Gateway handles ingress traffic and routing.
- Worker processes jobs asynchronously.
- Database stores transactional data.

## Notes
Further details will be expanded in subsequent sections.`;

const sampleSidecar = {
  mrsf_version: "1.0",
  document: "architecture.md",
  comments: [
    {
      id: "1d3c72b0",
      author: "Alice (alice)",
      timestamp: "2026-03-02T18:22:59Z",
      text: "This section needs more detail about our specific architecture choices.",
      resolved: false,
      line: 3,
      severity: "medium",
      type: "suggestion",
    },
    {
      id: "3eeccbd3",
      author: "Bob (bob)",
      timestamp: "2026-03-02T18:24:51Z",
      text: "Is this phrasing accurate? Workers also handle scheduled tasks.",
      type: "question",
      resolved: false,
      line: 8,
      end_line: 8,
      start_column: 2,
      end_column: 21,
      selected_text: "Worker processes jobs",
    },
    {
      id: "r1-reply",
      author: "Alice (alice)",
      timestamp: "2026-03-02T19:00:00Z",
      text: "Good point — let's update this to mention scheduled tasks too.",
      resolved: false,
      reply_to: "3eeccbd3",
    },
    {
      id: "resolved1",
      author: "Charlie (charlie)",
      timestamp: "2026-03-01T10:00:00Z",
      text: "Typo fixed in previous commit.",
      resolved: true,
      line: 12,
      severity: "low",
    },
  ],
};

async function renderDemo() {
  const [{ default: MarkdownIt }, { mrsfPlugin }] = await Promise.all([
    import("markdown-it"),
    import("@mrsf/markdown-it-mrsf"),
  ]);

  const md = new MarkdownIt({ html: true });
  md.use(mrsfPlugin, {
    comments: sampleSidecar,
    showResolved: showResolved.value,
  });
  rendered.value = md.render(sampleMarkdown);
}

onMounted(renderDemo);
watch(showResolved, renderDemo);
</script>

<template>
  <div class="mrsf-demo">
    <div class="mrsf-demo-controls">
      <label>
        <input type="checkbox" v-model="showResolved" />
        Show resolved comments
      </label>
    </div>
    <div class="mrsf-demo-output" v-html="rendered" />
  </div>
</template>

<style>
@import "@mrsf/markdown-it-mrsf/style.css";

.mrsf-demo-controls {
  margin-bottom: 16px;
  padding: 8px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  font-size: 14px;
}

.mrsf-demo-controls label {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}

.mrsf-demo-output {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 24px;
  background: var(--vp-c-bg);
}

/* Override some custom properties to match VitePress theme */
.mrsf-demo-output {
  --mrsf-tooltip-bg: var(--vp-c-bg-soft);
  --mrsf-tooltip-fg: var(--vp-c-text-1);
  --mrsf-tooltip-border: var(--vp-c-divider);
  --mrsf-font-family: var(--vp-font-family-base);
}
</style>
