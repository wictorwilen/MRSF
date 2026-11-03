const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { setTimeout: delay } = require("node:timers/promises");
const vscode = require("vscode");
const { chromium } = require("playwright-core");
const path = require("node:path");
const unicodeFixture = require("./fixtures.cjs");
const verifyEditorModes = require("./editor-modes.cjs");

function isReplacedFrame(frame, error) {
  return frame.isDetached() || /Frame was detached|not attached to the DOM|Execution context was destroyed/.test(error.message);
}

async function isVisibleWebviewFrame(frame) {
  if (!frame.parentFrame()) return false;
  const owner = await frame.frameElement();
  return owner.evaluate((element) => getComputedStyle(element).visibility === "visible");
}

async function waitForFileWatcher(root) {
  const probe = vscode.Uri.joinPath(root, ".mrsf-watcher-ready");
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, ".mrsf-watcher-ready"));
  let ready = false;
  const subscription = watcher.onDidCreate(() => { ready = true; });
  try {
    await eventually(async () => {
      await fs.writeFile(probe.fsPath, "ready");
      await delay(50);
      await fs.rm(probe.fsPath, { force: true });
      return ready;
    }, "VS Code's workspace file watcher must be ready before testing external edits");
  } finally {
    subscription.dispose();
    watcher.dispose();
    await fs.rm(probe.fsPath, { force: true });
  }
}

async function findFrame(page, selector, message, check = async () => true) {
  let result;
  await eventually(async () => {
    for (const frame of page.frames()) {
      try {
        if (await frame.locator(selector).count() && await isVisibleWebviewFrame(frame) && await check(frame)) {
          result = frame;
          return true;
        }
      } catch (error) {
        if (!isReplacedFrame(frame, error)) throw error;
      }
    }
    return false;
  }, message);
  return result;
}

async function verifyUnicodeReview(page, artifacts) {
  const root = vscode.workspace.workspaceFolders[0].uri;
  const target = vscode.Uri.joinPath(root, "unicode.md");
  const sidecarPath = `${target.fsPath}.review.json`;
  const originalMarkdown = await fs.readFile(target.fsPath, "utf8");
  const originalLines = originalMarkdown.split("\n");
  assert.ok(originalLines.length > 150, "Unicode fixture must exercise a long, scrolling document");
  const anchors = unicodeFixture.review.comments.filter((comment) => comment.line != null);
  for (const comment of anchors) {
    assert.equal(originalLines[comment.line - 1].slice(comment.start_column, comment.end_column), comment.selected_text,
      `${comment.id} fixture must use UTF-16 code-unit offsets`);
  }
  await vscode.commands.executeCommand("vscode.openWith", target, "vscode.markdown.preview.editor");
  let preview = await findFrame(page, '.mrsf-inline-highlight[data-comment-id="emoji-prefix"]', "Unicode preview must hydrate",
    async (frame) => await frame.locator(".mrsf-inline-highlight").count() === anchors.length);
  for (const comment of anchors) {
    const selector = `.mrsf-inline-highlight[data-comment-id="${comment.id}"]`;
    await eventually(async () => {
      preview = await findFrame(page, selector, `Unicode ${comment.id} selection must be available`);
      try {
        assert.equal(await preview.locator(selector).textContent(), comment.selected_text, `${comment.id} highlight must preserve Unicode`);
        assert.equal(await preview.locator(`.mrsf-comment[data-comment-id="${comment.id}"] .mrsf-comment-body`).textContent(), comment.text);
        await clickPreviewControl(preview, selector, comment.id === "zwj");
        const sidebar = await findFrame(page, `.thread.highlighted [data-id="${comment.id}"]`, `Native ${comment.id} click must reveal its thread`);
        assert.equal(await sidebar.locator(`[data-id="${comment.id}"] .comment-text`).textContent(), comment.text);
        assert.equal(await sidebar.locator(`[data-id="${comment.id}"] .author`).textContent(), unicodeFixture.author);
        assert.equal(await preview.locator(".markdown-body").isVisible(), true);
        return true;
      } catch (error) {
        if (!isReplacedFrame(preview, error)) throw error;
        return false;
      }
    }, `Unicode ${comment.id} interaction must survive a preview frame replacement`);
  }
  await page.screenshot({ path: path.join(artifacts, "unicode-preview.png"), animations: "disabled" });

  let sidebar = await findFrame(page, '[data-id="emoji-prefix"]', "Unicode sidebar must remain available");
  let first = sidebar.locator('[data-id="emoji-prefix"]');
  const replyText = "新しい返信 👩‍💻 🇯🇵 👍🏽 𠮷 Cafe\u0301";
  await first.locator(".comment-actions").getByTitle("Reply", { exact: true }).click();
  await first.getByPlaceholder("Reply...").fill(replyText);
  await first.getByPlaceholder("Reply...").press("ControlOrMeta+Enter");
  await eventually(async () => {
    const saved = JSON.parse(await fs.readFile(sidecarPath, "utf8"));
    return saved.comments.some((comment) => comment.reply_to === "emoji-prefix" && comment.text === replyText && comment.author === unicodeFixture.author);
  }, "Unicode reply must persist with the correct author and parent");
  sidebar = await findFrame(page, ".comment.reply .comment-text", "Persisted Unicode reply must render in its thread",
    async (frame) => (await frame.locator(".comment.reply .comment-text").allTextContents()).includes(replyText));
  first = sidebar.locator('[data-id="emoji-prefix"]');
  assert.equal(await sidebar.locator('[data-id="unicode-existing-reply"] .comment-text').textContent(),
    unicodeFixture.review.comments.at(-1).text);

  const editedText = "編集済みのコメント 😀 👩‍💻 🇯🇵 𠮷野家 Cafe\u0301 <確認> & \"保存\"";
  await first.getByTitle("Edit", { exact: true }).click();
  await first.getByPlaceholder("Edit comment...").fill(editedText);
  await first.getByPlaceholder("Edit comment...").press("ControlOrMeta+Enter");
  await eventually(async () => JSON.parse(await fs.readFile(sidecarPath, "utf8")).comments
    .find((comment) => comment.id === "emoji-prefix")?.text === editedText, "Unicode edit must persist exactly");
  sidebar = await findFrame(page, '[data-id="emoji-prefix"] .comment-text', "Sidebar must display the Unicode edit",
    async (frame) => await frame.locator('[data-id="emoji-prefix"] .comment-text').textContent() === editedText);
  first = sidebar.locator('[data-id="emoji-prefix"]');
  await first.getByTitle("Resolve", { exact: true }).click();
  await eventually(async () => JSON.parse(await fs.readFile(sidecarPath, "utf8")).comments
    .find((comment) => comment.id === "emoji-prefix")?.resolved === true, "Resolve must persist for the Unicode thread");
  sidebar = await findFrame(page, '[data-id="emoji-prefix"] button[title="Unresolve"]', "Resolved thread must offer Unresolve");
  await sidebar.locator('[data-id="emoji-prefix"]').getByTitle("Unresolve", { exact: true }).click();
  await eventually(async () => JSON.parse(await fs.readFile(sidecarPath, "utf8")).comments
    .find((comment) => comment.id === "emoji-prefix")?.resolved === false, "Unresolve must persist for the Unicode thread");
  for (const expected of anchors) {
    const saved = JSON.parse(await fs.readFile(sidecarPath, "utf8")).comments.find((comment) => comment.id === expected.id);
    for (const key of ["line", "start_column", "end_column", "selected_text"]) {
      assert.equal(saved[key], expected[key], `${expected.id}: sidebar actions must preserve ${key}`);
    }
  }
  const refreshedPreview = await findFrame(page, '.mrsf-comment[data-comment-id="emoji-prefix"] .mrsf-comment-body',
    "Preview must refresh the Unicode edit without losing its selected text",
    async (frame) => await frame.locator('.mrsf-comment[data-comment-id="emoji-prefix"] .mrsf-comment-body').textContent() === editedText);
  assert.equal(await refreshedPreview.locator('.mrsf-inline-highlight[data-comment-id="emoji-prefix"]').textContent(), "日本語");
  await page.screenshot({ path: path.join(artifacts, "unicode-sidebar.png"), animations: "disabled" });
  assert.equal(await fs.readFile(target.fsPath, "utf8"), originalMarkdown, "Review actions must not modify Markdown source");

  const original = vscode.Uri.joinPath(root, "preview.md");
  await vscode.commands.executeCommand("vscode.openWith", original, "vscode.markdown.preview.editor");
  await findFrame(page, '[data-id="host-comment"]', "Switching documents must restore the original sidebar");
  await vscode.commands.executeCommand("vscode.openWith", target, "vscode.markdown.preview.editor");
  await findFrame(page, '[data-id="emoji-prefix"]', "Switching back must restore Unicode threads");
  console.log(`Unicode E2E passed: ${originalLines.length} lines, ${anchors.length} UTF-16 selections, replies, edits, resolve/unresolve, source preservation and document switching`);
}

async function clickPreviewControl(preview, selector, keyboard = false) {
  const href = await preview.locator(selector).first().getAttribute("href");
  await preview.evaluate((selector) => {
    window.mrsfTrustedClick = null;
    document.addEventListener("click", (event) => {
      window.mrsfTrustedClick = {
        trusted: event.isTrusted,
        matches: event.target instanceof Element && !!event.target.closest(selector),
        hasDocumentView: !!event.view?.document,
        bubbled: false,
        href: event.target.closest("a")?.getAttribute("href"),
      };
    }, { capture: true, once: true });
    window.addEventListener("click", () => {
      if (window.mrsfTrustedClick) window.mrsfTrustedClick.bubbled = true;
    }, { once: true });
  }, selector);
  if (keyboard) await preview.locator(selector).first().press("Enter");
  else await preview.locator(selector).first().click();
  assert.deepEqual(await preview.evaluate(() => window.mrsfTrustedClick),
    { trusted: true, matches: true, hasDocumentView: true, bubbled: true, href },
    `Preview must receive a trusted ${selector} click, keyboard=${keyboard}`);
}

async function verifyTooltipLayout(preview, page, artifacts) {
  const owner = await preview.frameElement();
  const originalStyle = await owner.getAttribute("style");
  const originalData = await preview.locator("#mrsf-comment-data").getAttribute("data-comments");
  const originalGutter = await preview.locator("#mrsf-comment-data").getAttribute("data-gutter-position");
  const originalViewport = await preview.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const originalText = await preview.locator(".mrsf-comment-body").first().textContent();
  try {
    for (const width of [650, 260]) {
      for (const gutter of ["left", "right"]) {
        await owner.evaluate((element, width) => {
          element.style.setProperty("width", `${width}px`, "important");
          element.style.setProperty("height", "220px", "important");
        }, width);
        await preview.evaluate(({ gutter, originalData }) => {
          const data = document.getElementById("mrsf-comment-data");
          const comments = JSON.parse(originalData);
          comments[0].text = "LongCommentText".repeat(80);
          data.setAttribute("data-comments", JSON.stringify(comments));
          data.setAttribute("data-gutter-position", gutter);
        }, { gutter, originalData });
        await preview.waitForFunction(({ width, gutter }) => innerWidth === width
          && document.querySelector(".mrsf-badge")?.dataset.gutterPosition === gutter
          && document.querySelector(".mrsf-comment-body")?.textContent.startsWith("LongCommentText"), { width, gutter });
        await preview.evaluate(() => {
          if (!document.querySelector(".mrsf-tooltip-visible")) document.querySelector(".mrsf-badge").click();
        });
        await preview.locator(".mrsf-tooltip-visible").evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {}))));
        const bounds = await preview.evaluate(() => {
          const tooltip = document.querySelector(".mrsf-tooltip-visible");
          const rect = tooltip.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
            width: document.documentElement.clientWidth, height: document.documentElement.clientHeight,
            overflow: tooltip.scrollWidth - tooltip.clientWidth };
        });
        assert.ok(bounds.left >= 7 && bounds.top >= 7 && bounds.right <= bounds.width - 7 && bounds.bottom <= bounds.height - 7
          && bounds.overflow <= 1, `Tooltip must fit ${gutter} gutter at ${width}px: ${JSON.stringify(bounds)}`);
        await page.screenshot({ path: path.join(artifacts, `tooltip-${gutter}-${width}.png`), animations: "disabled" });
      }
    }
    console.log("Tooltip bounds passed for both gutters at 260px and 650px, including long text and a short viewport");
  } finally {
    await owner.evaluate((element, style) => {
      if (style === null) element.removeAttribute("style");
      else element.setAttribute("style", style);
    }, originalStyle);
    await preview.evaluate(({ originalData, originalGutter }) => {
      const data = document.getElementById("mrsf-comment-data");
      data.setAttribute("data-comments", originalData);
      data.setAttribute("data-gutter-position", originalGutter);
    }, { originalData, originalGutter });
    await preview.waitForFunction(({ width, height, gutter, text }) => innerWidth === width && innerHeight === height
      && document.querySelector(".mrsf-badge")?.dataset.gutterPosition === gutter
      && document.querySelector(".mrsf-comment-body")?.textContent === text,
    { ...originalViewport, gutter: originalGutter, text: originalText });
    await preview.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
}

async function verifyInteractions(target, browser) {
  const page = browser.contexts()[0].pages().find((candidate) => candidate.url().includes("workbench"));
  assert.ok(page, "VS Code workbench must be available for UI checks");
  await page.bringToFront();
  page.on("console", (message) => {
    if (message.type() === "error" || message.text().includes("postMessage")) console.log("Browser console:", message.text());
  });
  page.on("pageerror", (error) => console.log("Browser error:", error.stack));
  page.setDefaultTimeout(15000);
  const artifacts = path.join(__dirname, "..", ".vscode-test", "screenshots", vscode.version);
  await fs.mkdir(artifacts, { recursive: true });
  try {
    if (process.env.MRSF_TEST_FOCUS === "editor") {
      await verifyEditorModes(page, artifacts, { eventually, findFrame });
      return;
    }
    await page.getByRole("tab", { name: /preview\.md/ }).click();
    let preview;
    if (process.env.MRSF_TEST_FOCUS === "tooltip") {
      preview = await findFrame(page, ".mrsf-badge", "Preview must render a tooltip anchor");
      await verifyTooltipLayout(preview, page, artifacts);
      return;
    }
    let hoverVerified = false;
    let highlightRequestId = 0;
    for (const [selector, keyboard] of [[".mrsf-badge", false], [".mrsf-badge", false], [".mrsf-inline-highlight", false], [".mrsf-inline-highlight", true], [".mrsf-badge", false]]) {
      await eventually(async () => {
        for (const frame of page.frames()) {
          try {
            if (await frame.locator(selector).count() && await isVisibleWebviewFrame(frame)) {
              const target = await frame.locator(selector).first().elementHandle();
              const bounds = await target?.boundingBox();
              if (!target || !bounds || !bounds.width || !bounds.height) continue;
              await target.hover();
              if (!await target.evaluate(async (element) => {
                await new Promise(requestAnimationFrame);
                return element.isConnected && element.matches(":hover");
              })) continue;
              if (selector === ".mrsf-badge" && !hoverVerified) {
                const badge = await frame.locator(selector).first().elementHandle();
                if (!badge) continue;
                const before = await badge.boundingBox();
                if (!before || before.width === 0 || before.height === 0) continue;
                const beforeRight = await badge.evaluate((element) => getComputedStyle(element).right);
                if (!beforeRight) continue;
                await badge.hover();
                const samples = await badge.evaluate(async (element) => {
                  const frames = [];
                  for (let index = 0; index < 20; index++) {
                    await new Promise(requestAnimationFrame);
                    if (!element.isConnected) return null;
                    const style = getComputedStyle(element);
                    frames.push({ position: style.position, right: style.right, transform: style.transform, hovered: element.matches(":hover") });
                  }
                  return frames;
                });
                if (!samples) continue;
                assert.ok(samples.some((sample) => sample.hovered), "Real pointer must reach the badge");
                assert.ok(samples.every((sample) => sample.position === "relative" && sample.right === beforeRight && sample.transform === "none"),
                  `Hover must preserve gutter positioning: ${JSON.stringify(samples)}`);
                const after = await badge.boundingBox();
                assert.ok(after && Math.abs(before.x - after.x) < 0.5 && Math.abs(before.y - after.y) < 0.5
                  && Math.abs(before.width - after.width) < 0.5 && Math.abs(before.height - after.height) < 0.5,
                "Hover must not move or resize the badge's click target");
                await page.screenshot({ path: path.join(artifacts, "badge-hover.png") });
                hoverVerified = true;
              }
              await clickPreviewControl(frame, selector, keyboard);
              preview = frame;
              return true;
            }
          } catch (error) {
            if (!frame.isDetached() && !/not attached to the DOM|Execution context was destroyed/.test(error.message)) throw error;
          }
        }
        return false;
      }, "Actual preview must allow a trusted comment click");
      let sidebar;
      await eventually(async () => {
        for (const frame of page.frames()) {
          try {
            const highlighted = await frame.evaluate((previousRequestId) => {
              const thread = document.querySelector('[data-id="host-comment"]')?.closest('.thread.highlighted');
              const requestId = Number(document.body?.dataset.highlightRequestId);
              return thread && requestId > previousRequestId && getComputedStyle(thread).animationName === "highlight-pulse"
                ? requestId : 0;
            }, highlightRequestId);
            if (highlighted) {
              highlightRequestId = highlighted;
              sidebar = frame;
              return true;
            }
          } catch (error) {
            if (!frame.isDetached() && !/Execution context was destroyed/.test(error.message)) throw error;
          }
        }
        return false;
      }, `Each ${selector} click must start a fresh sidebar highlight`);
      await sidebar.locator('.thread.highlighted').evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {}))));
      console.log(`Fresh sidebar highlight passed: ${selector}, keyboard=${keyboard}`);
      assert.ok(await preview.locator(".markdown-body").isVisible(), "Preview must remain visible after clicking a comment");
      assert.equal(await preview.locator(".mrsf-inline-highlight").textContent(), "Hello");
      const tooltipBounds = await preview.evaluate(() => {
        const tooltip = document.querySelector(".mrsf-tooltip-visible");
        if (!tooltip) return null;
        const bounds = tooltip.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, width: document.documentElement.clientWidth };
      });
      if (tooltipBounds) {
        assert.ok(tooltipBounds.left >= 0 && tooltipBounds.right <= tooltipBounds.width,
          `Comment tooltip must remain inside the preview: ${JSON.stringify(tooltipBounds)}`);
      }
    }
    await page.screenshot({ path: path.join(artifacts, "preview-click.png") });
    await verifyTooltipLayout(preview, page, artifacts);

    await clickPreviewControl(preview, '.mrsf-add-button[data-line="1"]');
    const commentInput = page.getByPlaceholder("Enter your comment...", { exact: true });
    await commentInput.fill("Added from preview plus");
    await commentInput.press("Enter");
    const typeInput = page.getByPlaceholder("Select comment type (optional)", { exact: true });
    await typeInput.fill("(none)");
    await typeInput.press("Enter");
    const severityInput = page.getByPlaceholder("Select severity (optional)", { exact: true });
    await severityInput.fill("(none)");
    await severityInput.press("Enter");
    await eventually(async () => {
      const saved = JSON.parse(await fs.readFile(`${target.fsPath}.review.json`, "utf8"));
      return saved.comments.some((comment) => comment.text === "Added from preview plus" && comment.line === 1);
    }, "Preview (+) must persist a new comment on its source line");
    console.log("Preview (+) saved a new line-1 comment");

    const document = await vscode.workspace.openTextDocument(target);
    const editor = await vscode.window.showTextDocument(document);
    const selections = editor.selections;
    const line = page.locator(".monaco-editor .view-line").filter({ hasText: "Hello world" }).last();
    await line.hover({ position: { x: 15, y: 10 } });
    const hover = page.locator(".monaco-hover");
    const resolve = hover.locator('a[data-href^="command:mrsf.resolveComment"], a[href^="command:mrsf.resolveComment"]');
    const unresolve = hover.locator('a[data-href^="command:mrsf.unresolveComment"], a[href^="command:mrsf.unresolveComment"]');
    await resolve.click();
    await unresolve.waitFor({ state: "visible" });
    await unresolve.click();
    await resolve.waitFor({ state: "visible" });
    assert.deepEqual(editor.selections, selections, "Hover refresh must preserve the original cursor and selections");
    await page.screenshot({ path: path.join(artifacts, "hover-refresh.png") });
    console.log("Trusted preview clicks and live hover actions passed");
    await verifyUnicodeReview(page, artifacts);
    await verifyEditorModes(page, artifacts, { eventually, findFrame });
  } catch (error) {
    const diagnostics = [];
    for (const frame of page.frames()) {
      try {
        const owner = frame.parentFrame() ? await frame.frameElement() : undefined;
        const state = await frame.evaluate(() => ({
          focused: document.hasFocus(),
          visibility: document.visibilityState,
          viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio },
          iframes: [...document.querySelectorAll("iframe")].map((element) => ({
            id: element.id, src: element.src, visibility: getComputedStyle(element).visibility,
            bounds: element.getBoundingClientRect().toJSON(),
          })),
          click: window.mrsfTrustedClick,
          highlightRequestId: document.body?.dataset.highlightRequestId,
          threads: [...document.querySelectorAll(".thread.highlighted")].map((thread) => ({
            commentId: thread.querySelector("[data-id]")?.getAttribute("data-id"),
            animations: thread.getAnimations().map((animation) => ({
              name: animation.animationName,
              state: animation.playState,
              time: animation.currentTime,
            })),
          })),
        }));
        const diagnostic = { frame: await owner?.getAttribute("id"), url: frame.url(), ...state,
          badges: await frame.locator(".mrsf-badge").count(),
          badgeBounds: await frame.locator(".mrsf-badge").first().boundingBox({ timeout: 500 }).catch(() => null) };
        diagnostics.push(diagnostic);
        console.log("UI frame", JSON.stringify(diagnostic));
      } catch {}
    }
    await fs.writeFile(path.join(artifacts, "failure.json"), JSON.stringify({ error: error.stack, frames: diagnostics }, null, 2));
    await page.screenshot({ path: path.join(artifacts, "failure.png") });
    throw error;
  }
}

async function eventually(predicate, message) {
  const deadline = performance.now() + 60000;
  while (performance.now() < deadline) {
    if (await predicate()) return;
    await delay(50);
  }
  assert.fail(message);
}

async function run(browser) {
  const root = vscode.workspace.workspaceFolders[0].uri;
  const target = vscode.Uri.joinPath(root, "preview.md");
  const other = vscode.Uri.joinPath(root, "other.md");
  await vscode.commands.executeCommand("vscode.openWith", target, "vscode.markdown.preview.editor");
  const modern = vscode.window.tabGroups.activeTabGroup.activeTab.input;
  assert.ok(modern instanceof vscode.TabInputCustom, "Markdown Preview must expose a custom tab");
  assert.equal(modern.uri.toString(), target.toString());

  const extension = vscode.extensions.getExtension("wictor.mrsf-vscode");
  assert.ok(extension, "Development extension must be installed");
  await eventually(() => extension.isActive, "Sidemark must activate on preview-only open");
  const markdown = { core: { ruler: { push() {} } }, renderer: { rules: {} } };
  extension.exports.extendMarkdownIt(markdown);
  const render = () => markdown.renderer.rules.mrsf_comment_data([], 0, {}, { currentDocument: target });
  await eventually(() => render().includes("Initial review"), "Cold preview must hydrate its JSON sidecar");
  assert.ok(render().includes("data-version=\"1\""));
  const page = browser.contexts()[0].pages().find((candidate) => candidate.url().includes("workbench"));
  assert.ok(page, "VS Code workbench must be available for cold-preview checks");
  await findFrame(page, '#mrsf-comment-data[data-load-state="loaded"]',
    "Cold preview must display its sidecar in the actual webview before external edits",
    async (frame) => await frame.locator(".mrsf-comment-body").textContent() === "Initial review");

  if (process.env.MRSF_TEST_FOCUS === "tooltip") {
    await verifyInteractions(target, browser);
    console.log("Sidemark tooltip host checks passed");
    return;
  }

  const sidecar = vscode.Uri.joinPath(root, "preview.md.review.json");
  await waitForFileWatcher(root);
  const review = JSON.parse(await fs.readFile(sidecar.fsPath, "utf8"));
  review.comments[0].text = "External update";
  await fs.writeFile(sidecar.fsPath, JSON.stringify(review));
  try {
    await eventually(() => render().includes("External update"), "Watcher must load an external JSON update");
  } catch (error) {
    console.error("Watcher state", { sidecar: sidecar.fsPath, disk: await fs.readFile(sidecar.fsPath, "utf8"), rendered: render() });
    throw error;
  }
  await findFrame(page, ".mrsf-comment-body", "External JSON updates must reach the actual preview",
    async (frame) => await frame.locator(".mrsf-comment-body").textContent() === "External update");
  if (process.env.MRSF_TEST_FOCUS === "watcher") {
    console.log("Sidemark watcher host checks passed");
    return;
  }

  await verifyInteractions(target, browser);

  await vscode.commands.executeCommand("markdown.showPreviewToSide", other);
  await eventually(() => vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) =>
    tab.input instanceof vscode.TabInputWebview)), "Legacy preview must open as a webview tab");
  const legacy = vscode.window.tabGroups.all.flatMap((group) => group.tabs)
    .find((tab) => tab.input instanceof vscode.TabInputWebview).input;
  assert.equal(legacy.viewType, "mainThreadWebview-markdown.preview");
  console.log(`HOST ${vscode.version}: modern=${modern.viewType}, legacy=${legacy.viewType}, legacyHasUri=${"uri" in legacy}`);

  const document = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(document);
  assert.equal(vscode.window.activeTextEditor.document.uri.toString(), target.toString());
  console.log("Sidemark host smoke checks passed");
}

exports.run = async function () {
  // Attach before any preview is created so CDP observes the webview frame swaps.
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.MRSF_TEST_CDP_PORT}`);
  try {
    await run(browser);
  } finally {
    await browser.close();
  }
};