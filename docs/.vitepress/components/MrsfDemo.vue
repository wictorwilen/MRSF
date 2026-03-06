<script setup>
import { ref, nextTick, onMounted, onUnmounted, watch } from "vue";

const rendered = ref("");
const showResolved = ref(true);
const gutterPosition = ref("right");
const interactive = ref(true);
const lineHighlight = ref(false);
const outputRef = ref(null);

let currentController = null;
let MrsfControllerClass = null;

const sampleMarkdown = `# Architecture Overview

## Introduction
This document outlines the **architecture decisions** for the system.

> Product: System X
> Author: John Doe
> Date: 2026-02-19
> Status: Draft

## Components
- API Gateway handles ingress traffic and routing.
- Worker processes jobs asynchronously.
- Database stores transactional data.
  - Primary (write) cluster
  - Read replicas

## Service Matrix

| Service        | Port | Protocol | Status      |
|----------------|------|----------|-------------|
| API Gateway    | 443  | HTTPS    | Production  |
| Worker         | 8080 | gRPC     | Production  |
| Database       | 5432 | TCP      | Production  |
| Cache          | 6379 | TCP      | Staging     |

## Configuration

The main entry point is configured in \`config.yaml\`:

\`\`\`yaml
server:
  host: 0.0.0.0
  port: 8080
  workers: 4

database:
  url: postgres://localhost:5432/app
  pool_size: 20
\`\`\`

For the API layer, use the following handler:

\`\`\`typescript
export async function handleRequest(req: Request): Promise<Response> {
  const data = await db.query(req.params.id);
  return Response.json(data);
}
\`\`\`

## Deployment

1. Build the container image.
2. Push to the registry.
3. Update the deployment manifest.
   1. Set the new image tag.
   2. Adjust replica count if needed.
4. Apply with \`kubectl apply -f deploy.yaml\`.

---

## Notes

Further details will be expanded in subsequent sections.

See the [contributing guide](https://example.com/contributing) for *workflow conventions* and **branch naming**.`;

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
      id: "bq-status",
      author: "Diana (diana)",
      timestamp: "2026-03-02T19:10:00Z",
      text: "Should this still say Draft? We're past that stage.",
      resolved: false,
      line: 9,
      type: "question",
      selected_text: "Status: Draft",
    },
    {
      id: "3eeccbd3",
      author: "Bob (bob)",
      timestamp: "2026-03-02T18:24:51Z",
      text: "Is this phrasing accurate? Workers also handle scheduled tasks.",
      type: "question",
      resolved: false,
      line: 13,
      end_line: 13,
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
      id: "tbl-cache",
      author: "Eve (eve)",
      timestamp: "2026-03-03T08:15:00Z",
      text: "Cache should be promoted to Production before the next release.",
      resolved: false,
      line: 25,
      severity: "high",
      type: "action-item",
      selected_text: "Staging",
    },
    {
      id: "cfg-pool",
      author: "Bob (bob)",
      timestamp: "2026-03-03T09:00:00Z",
      text: "Pool size of 20 seems low for production load. Recommend 50+.",
      resolved: false,
      line: 39,
      severity: "medium",
      type: "suggestion",
      selected_text: "pool_size: 20",
    },
    {
      id: "code-handler",
      author: "Alice (alice)",
      timestamp: "2026-03-03T09:30:00Z",
      text: "This handler is missing error handling and input validation.",
      resolved: false,
      line: 45,
      end_line: 48,
      severity: "high",
      type: "issue",
    },
    {
      id: "deploy-step",
      author: "Charlie (charlie)",
      timestamp: "2026-03-03T10:00:00Z",
      text: "Add a rollback step in case the deployment fails.",
      resolved: true,
      line: 55,
      severity: "medium",
      type: "suggestion",
    },
    {
      id: "resolved1",
      author: "Charlie (charlie)",
      timestamp: "2026-03-01T10:00:00Z",
      text: "Typo fixed in previous commit.",
      resolved: true,
      line: 11,
      severity: "low",
    },
  ],
};

async function renderDemo() {
  // Tear down previous controller
  if (currentController) {
    currentController.destroy();
    currentController = null;
  }

  const [{ default: MarkdownIt }, { mrsfPlugin }] = await Promise.all([
    import("markdown-it"),
    import("../../../plugins/markdown-it/dist/browser.js"),
  ]);

  // Lazy-load the controller class once
  if (!MrsfControllerClass) {
    const mod = await import("../../../plugins/markdown-it/dist/controller.js");
    MrsfControllerClass = mod.MrsfController;
  }

  const md = new MarkdownIt({ html: true, breaks: true });
  md.use(mrsfPlugin, {
    comments: sampleSidecar,
    showResolved: showResolved.value,
    lineHighlight: lineHighlight.value,
  });
  rendered.value = md.render(sampleMarkdown);

  // Wait for DOM update, then initialise the controller
  await nextTick();
  const el = outputRef.value;
  if (el) {
    currentController = new MrsfControllerClass(el, {
      gutterPosition: gutterPosition.value,
      interactive: interactive.value,
    });
  }
}

onMounted(renderDemo);
watch([showResolved, gutterPosition, interactive, lineHighlight], renderDemo);

const handler = (e) => {
  try {
    alert(JSON.stringify(e.detail, null, 2));
  } catch {
    // ignore
  }
};

const events = [
  "mrsf:add",
  "mrsf:reply",
  "mrsf:edit",
  "mrsf:resolve",
  "mrsf:unresolve",
  "mrsf:delete",
  "mrsf:submit",
];

onMounted(() => {
  for (const evt of events) {
    document.addEventListener(evt, handler);
  }
});

onUnmounted(() => {
  if (currentController) {
    currentController.destroy();
    currentController = null;
  }
  for (const evt of events) {
    document.removeEventListener(evt, handler);
  }
});
</script>

<template>
  <div class="mrsf-demo">
    <div class="mrsf-demo-controls">
      <label>
        <input type="checkbox" v-model="showResolved" />
        Show resolved comments
      </label>
      <label>
        Gutter position:
        <select v-model="gutterPosition">
          <option value="right">Right</option>
          <option value="left">Left (margin gutter)</option>
        </select>
      </label>
      <label>
        <input type="checkbox" v-model="interactive" />
        Interactive (alerts event payloads)
      </label>
      <label>
        <input type="checkbox" v-model="lineHighlight" />
        Line highlight
      </label>
    </div>
    <div ref="outputRef" class="mrsf-demo-output" v-html="rendered" />
  </div>
</template>

<style>
@import "../../../plugins/markdown-it/dist/style.css";

.mrsf-demo-controls {
  margin-bottom: 16px;
  padding: 8px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  font-size: 14px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}

.mrsf-demo-controls label {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}

.mrsf-demo-controls select {
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 13px;
}

.mrsf-demo-output {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 24px;
  background: var(--vp-c-bg);
  overflow: visible;
}

/* Override some custom properties to match VitePress theme */
.mrsf-demo-output {
  --mrsf-tooltip-bg: var(--vp-c-bg-soft);
  --mrsf-tooltip-fg: var(--vp-c-text-1);
  --mrsf-tooltip-border: var(--vp-c-divider);
  --mrsf-font-family: var(--vp-font-family-base);
}
</style>
