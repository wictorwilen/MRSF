const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { setTimeout: delay } = require("node:timers/promises");
const vscode = require("vscode");
const { chromium } = require("playwright-core");
const path = require("node:path");

async function verifyTooltipLayout(preview, page, artifacts) {
  const owner = await preview.frameElement();
  const originalStyle = await owner.getAttribute("style");
  const originalData = await preview.locator("#mrsf-comment-data").getAttribute("data-comments");
  const originalGutter = await preview.locator("#mrsf-comment-data").getAttribute("data-gutter-position");
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
  }
}

async function verifyInteractions(target) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.MRSF_TEST_CDP_PORT}`);
  const page = browser.contexts()[0].pages().find((candidate) => candidate.url().includes("workbench"));
  assert.ok(page, "VS Code workbench must be available for UI checks");
  await page.bringToFront();
  page.on("console", (message) => {
    if (message.type() === "error" || message.text().includes("postMessage")) console.log("Browser console:", message.text());
  });
  page.on("pageerror", (error) => console.log("Browser error:", error.message));
  page.setDefaultTimeout(15000);
  const artifacts = path.join(__dirname, "..", ".vscode-test", "screenshots", vscode.version);
  await fs.mkdir(artifacts, { recursive: true });
  try {
    await page.getByRole("tab", { name: /preview\.md/ }).click();
    let preview;
    if (process.env.MRSF_TEST_FOCUS === "tooltip") {
      await eventually(async () => {
        for (const frame of page.frames()) {
          if (await frame.locator(".mrsf-badge").count().catch(() => 0)) {
            preview = frame;
            return true;
          }
        }
        return false;
      }, "Preview must render a tooltip anchor");
      await verifyTooltipLayout(preview, page, artifacts);
      return;
    }
    let hoverVerified = false;
    for (const [selector, keyboard] of [[".mrsf-badge", false], [".mrsf-badge", false], [".mrsf-inline-highlight", false], [".mrsf-inline-highlight", true], [".mrsf-badge", false]]) {
      await eventually(async () => {
        for (const frame of page.frames()) {
          try {
            if (await frame.locator(selector).count()) {
              const target = await frame.locator(selector).first().elementHandle();
              const bounds = await target?.boundingBox();
              if (!target || !bounds || !bounds.width || !bounds.height) continue;
              await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
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
              if (keyboard) await frame.locator(selector).first().press("Enter");
              else await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
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
            const animated = await frame.evaluate(() => {
              const thread = document.querySelector('[data-id="host-comment"]')?.closest('.thread.highlighted');
              return thread?.getAnimations().some((animation) => animation.playState === "running");
            });
            if (animated) {
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

    await preview.locator('.mrsf-add-button[data-line="1"]').click();
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
  } catch (error) {
    for (const frame of page.frames()) {
      try {
        const owner = frame.parentFrame() ? await frame.frameElement() : undefined;
        console.log("UI frame", await owner?.getAttribute("id"), frame.url(),
          await frame.locator(".mrsf-badge").count(), await frame.locator(".mrsf-badge").first().boundingBox({ timeout: 500 }).catch(() => null));
      } catch {}
    }
    await page.screenshot({ path: path.join(artifacts, "failure.png") });
    throw error;
  } finally {
    await browser.close();
  }
}

async function eventually(predicate, message) {
  for (let attempt = 0; attempt < 1200; attempt++) {
    if (await predicate()) return;
    await delay(50);
  }
  assert.fail(message);
}

exports.run = async function run() {
  const root = vscode.workspace.workspaceFolders[0].uri;
  await vscode.workspace.getConfiguration("sidemark", root).update("previewGutterPosition", "right", vscode.ConfigurationTarget.Workspace);
  await vscode.workspace.getConfiguration("sidemark", root).update("author", "UI test", vscode.ConfigurationTarget.Workspace);
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

  if (process.env.MRSF_TEST_FOCUS === "tooltip") {
    await verifyInteractions(target);
    console.log("Sidemark tooltip host checks passed");
    return;
  }

  const sidecar = vscode.Uri.joinPath(root, "preview.md.review.json");
  const review = JSON.parse(await fs.readFile(sidecar.fsPath, "utf8"));
  review.comments[0].text = "External update";
  await fs.writeFile(sidecar.fsPath, JSON.stringify(review));
  await eventually(() => render().includes("External update"), "Watcher must load an external JSON update");

  await verifyInteractions(target);

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
};