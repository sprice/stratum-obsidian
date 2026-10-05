import { Notice } from "obsidian";
import type { EnabledTabs, StratumTab } from "./stratum-tabs";

interface TabChooserOptions {
  tabs: readonly { id: StratumTab; label: string }[];
  enabled: EnabledTabs;
  onChange: (id: StratumTab, enabled: boolean) => Promise<void>;
}

// A non-modal checklist: selections stay open, while Escape, leaving focus,
// scrolling, and clicking outside dismiss it. All global listeners are scoped
// to the open chooser and removed when its settings row is removed.
export function openTabChooser(
  anchor: HTMLButtonElement,
  options: TabChooserOptions,
): () => void {
  const doc = anchor.ownerDocument;
  const win = doc.defaultView!;
  const panel = doc.body.createDiv({
    cls: "stratum-tab-chooser",
    attr: { role: "dialog", "aria-label": "Choose visible tabs" },
  });
  const rect = anchor.getBoundingClientRect();
  panel.style.maxWidth = `${Math.max(0, win.innerWidth - 16)}px`;
  panel.style.left = `${Math.max(8, Math.min(rect.right - 240, win.innerWidth - 248))}px`;
  const availableBelow = win.innerHeight - rect.bottom - 16;
  if (availableBelow >= 240 || rect.top < 240) {
    panel.style.top = `${rect.bottom + 8}px`;
    panel.style.maxHeight = `${Math.max(80, availableBelow)}px`;
  } else {
    panel.style.bottom = `${win.innerHeight - rect.top + 8}px`;
    panel.style.maxHeight = `${rect.top - 16}px`;
  }
  anchor.setAttribute("aria-expanded", "true");
  let closed = false;
  const close = (restoreFocus = false) => {
    if (closed) return;
    closed = true;
    doc.removeEventListener("pointerdown", onPointerDown, true);
    doc.removeEventListener("keydown", onKeyDown, true);
    doc.removeEventListener("scroll", onScroll, true);
    win.removeEventListener("resize", onResize);
    observer.disconnect();
    panel.remove();
    anchor.setAttribute("aria-expanded", "false");
    if (restoreFocus && anchor.isConnected) anchor.focus();
  };
  const onPointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (!panel.contains(target)) close();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      // Return to the trigger before the browser advances focus in settings.
      const inputs = Array.from(panel.querySelectorAll("input"));
      if (
        (event.shiftKey && doc.activeElement === inputs[0]) ||
        (!event.shiftKey && doc.activeElement === inputs.at(-1))
      ) {
        close(true);
      }
    }
  };
  const onScroll = (event: Event) => {
    if (!panel.contains(event.target as Node | null)) close();
  };
  const onResize = () => close();
  const observer = new win.MutationObserver(() => {
    if (!anchor.isConnected) close();
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  for (const tab of options.tabs) {
    const label = panel.createEl("label", {
      cls: "stratum-tab-chooser-option",
    });
    const input = label.createEl("input", { type: "checkbox" });
    input.checked = options.enabled[tab.id];
    label.createSpan({ text: tab.label });
    input.addEventListener("change", () => {
      void options.onChange(tab.id, input.checked).catch(() => {
        new Notice("Could not save visible tabs. Try again.");
      });
    });
  }
  panel.addEventListener("focusout", (event) => {
    if (!panel.contains(event.relatedTarget as Node | null)) close();
  });
  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("scroll", onScroll, true);
  win.addEventListener("resize", onResize);
  panel.querySelector("input")?.focus();
  return () => close();
}
