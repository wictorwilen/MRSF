import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const extensionRoot = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "sidemark-host-"));
const workspace = path.join(temporaryRoot, "workspace");
await mkdir(workspace);
await writeFile(path.join(workspace, "preview.md"), "# Preview\n\nHello world\n");
await writeFile(path.join(workspace, "other.md"), "# Other document\n");
await writeFile(path.join(workspace, "preview.md.review.json"), JSON.stringify({
  mrsf_version: "1.0",
  document: "preview.md",
  comments: [{ id: "host-comment", author: "Smoke test", text: "Initial review", timestamp: "2026-09-17T00:00:00Z", line: 3, selected_text: "Hello" }],
}));

try {
  const debugPort = await new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
  await runTests({
    version: process.argv[2] || process.env.VSCODE_TEST_VERSION || "1.137.0",
    vscodeExecutablePath: process.env.VSCODE_TEST_EXECUTABLE,
    extensionDevelopmentPath: extensionRoot,
    extensionTestsPath: path.join(extensionRoot, "test", "suite.cjs"),
    extensionTestsEnv: { MRSF_TEST_CDP_PORT: String(debugPort), MRSF_TEST_FOCUS: process.env.MRSF_TEST_FOCUS || "" },
    launchArgs: [workspace, "--disable-extensions", "--skip-welcome", "--skip-release-notes",
      "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${debugPort}`,
      "--user-data-dir", path.join(temporaryRoot, "user-data"), "--extensions-dir", path.join(temporaryRoot, "extensions")],
  });
} finally {
  await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}