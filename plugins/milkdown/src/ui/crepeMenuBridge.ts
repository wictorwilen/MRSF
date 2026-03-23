import type { EditorView } from "@milkdown/prose/view";
import type { MilkdownMrsfController } from "../MilkdownMrsfController.js";
import type { MilkdownMrsfControllerOptions } from "../types.js";
import { commentIcon, runCrepeAddComment } from "./crepeCommentAction.js";

export class CrepeMrsfMenuBridge {
  private view: EditorView;
  private readonly observer: MutationObserver | null;
  private refreshFrameIds = new Set<number>();

  constructor(
    view: EditorView,
    private readonly getController: () => MilkdownMrsfController | null,
    private readonly options: Pick<MilkdownMrsfControllerOptions, "interactive" | "onCommentSelect" | "composeAdd">,
  ) {
    this.view = view;

    if (this.options.interactive === false || typeof MutationObserver === "undefined") {
      this.observer = null;
      return;
    }

    this.observer = new MutationObserver(() => {
      this.refreshMenus();
    });
    this.observer.observe(this.view.dom.ownerDocument.body, { childList: true, subtree: true });
    this.scheduleRefreshBurst();
  }

  setView(view: EditorView): void {
    this.view = view;
    this.scheduleRefreshBurst();
  }

  destroy(): void {
    for (const frameId of this.refreshFrameIds) {
      cancelAnimationFrame(frameId);
    }
    this.refreshFrameIds.clear();
    this.observer?.disconnect();
  }

  private scheduleRefreshBurst(): void {
    this.refreshMenus();

    for (let index = 0; index < 4; index += 1) {
      const frameId = requestAnimationFrame(() => {
        this.refreshFrameIds.delete(frameId);
        this.refreshMenus();
      });
      this.refreshFrameIds.add(frameId);
    }
  }

  private refreshMenus(): void {
    const menus = this.view.dom.ownerDocument.querySelectorAll<HTMLElement>(".milkdown-slash-menu");
    for (const menu of menus) {
      this.ensureMenuItem(menu);
    }
  }

  private ensureMenuItem(menu: HTMLElement): void {
    if (menu.querySelector("[data-mrsf-crepe-menu-item]")) {
      return;
    }

    const firstGroupList = menu.querySelector<HTMLElement>(".menu-group ul");
    if (!firstGroupList) {
      return;
    }

    const item = menu.ownerDocument.createElement("li");
    item.dataset.mrsfCrepeMenuItem = "true";
    item.tabIndex = 0;
    const icon = menu.ownerDocument.createElement("span");
    icon.innerHTML = commentIcon;
    const label = menu.ownerDocument.createElement("span");
    label.textContent = "Add comment";
    item.appendChild(icon);
    item.appendChild(label);
    item.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      item.classList.add("active");
    });
    item.addEventListener("pointerup", (event) => {
      event.preventDefault();
      event.stopPropagation();
      item.classList.remove("active");
      void this.handleAddComment();
    });
    item.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void this.handleAddComment();
    });
    firstGroupList.insertBefore(item, firstGroupList.firstChild);
  }

  private async handleAddComment(): Promise<void> {
    await runCrepeAddComment(this.view, this.getController(), this.options);
  }
}