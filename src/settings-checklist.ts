import { Notice, Scope, type Keymap } from "obsidian";

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  badge?: string;
}
export interface ChecklistOptions {
  title: string;
  items: ChecklistItem[];
  searchable?: boolean;
  loadItems?: () => Promise<ChecklistItem[]>;
  keyboard?: { keymap: Keymap; parent: Scope };
  onChange: (id: string, checked: boolean) => Promise<void>;
}

// A non-modal checklist: selections stay open, while Escape, leaving focus,
// scrolling, and clicking outside dismiss it. All global listeners are scoped
// to the open chooser and removed when its settings row is removed.
export function openChecklist(
  anchor: HTMLButtonElement,
  options: ChecklistOptions,
): () => void {
  const doc = anchor.ownerDocument;
  const win = doc.defaultView!;
  const panel = doc.body.createDiv({
    cls: "stratum-tab-chooser",
    attr: { role: "dialog", "aria-label": options.title },
  });
  const rect = anchor.getBoundingClientRect();
  const width = options.searchable ? 560 : 240;
  panel.style.maxWidth = `${Math.max(0, win.innerWidth - 16)}px`;
  panel.style.left = `${Math.max(8, Math.min(rect.right - width, win.innerWidth - width - 8))}px`;
  if (options.searchable) panel.addClass("stratum-style-checklist");
  const availableBelow = win.innerHeight - rect.bottom - 16;
  if (availableBelow >= 240 || rect.top < 240) {
    panel.style.top = `${rect.bottom + 8}px`;
    panel.style.maxHeight = `${Math.max(80, availableBelow)}px`;
  } else {
    panel.style.bottom = `${win.innerHeight - rect.top + 8}px`;
    panel.style.maxHeight = `${rect.top - 16}px`;
  }
  anchor.setAttribute("aria-expanded", "true");
  const scope = options.keyboard ? new Scope(options.keyboard.parent) : null;
  let closed = false;
  const close = (restoreFocus = false) => {
    if (closed) return;
    closed = true;
    doc.removeEventListener("pointerdown", onPointerDown, true);
    doc.removeEventListener("keydown", onKeyDown, true);
    doc.removeEventListener("scroll", onScroll, true);
    win.removeEventListener("resize", onResize);
    observer.disconnect();
    if (scope) options.keyboard!.keymap.popScope(scope);
    panel.remove();
    anchor.setAttribute("aria-expanded", "false");
    if (restoreFocus && anchor.isConnected) anchor.focus();
  };
  const onPointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (!panel.contains(target) && !anchor.contains(target)) close();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      // Return to the trigger before the browser advances focus in settings.
      const inputs = Array.from(panel.querySelectorAll("input:not(:disabled)"));
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
  let items = options.items;
  if (options.searchable)
    items.sort(
      (a, b) =>
        Number(b.checked) - Number(a.checked) || a.label.localeCompare(b.label),
    );
  let pending = false;
  const search = options.searchable
    ? panel.createEl("input", {
        type: "search",
        placeholder: "Search styles or journals",
        attr: { "aria-label": "Search citation styles" },
      })
    : null;
  const status = options.searchable
    ? panel.createEl("p", {
        cls: "stratum-meta",
        attr: { role: "status" },
      })
    : null;
  const list = panel.createDiv();
  const renderItems = () => {
    const focusedId = list.contains(doc.activeElement)
      ? (doc.activeElement as HTMLInputElement).dataset.choiceId
      : undefined;
    if (focusedId) search?.focus();
    list.empty();
    const query = search?.value.trim().toLowerCase() ?? "";
    const matches = items.filter((item) =>
      query
        .split(/\s+/)
        .every((word) =>
          `${item.label} ${item.id}`.toLowerCase().includes(word),
        ),
    );
    const visible = options.searchable ? matches.slice(0, 100) : matches;
    if (status)
      status.setText(
        matches.length > 100
          ? `${matches.length} styles. Refine your search to see more.`
          : matches.length
            ? `${matches.length} styles`
            : "No styles found.",
      );
    for (const item of visible) {
      const label = list.createEl("label", {
        cls: "stratum-tab-chooser-option",
      });
      const input = label.createEl("input", { type: "checkbox" });
      input.checked = item.checked;
      input.disabled = Boolean(item.disabled);
      if (item.disabled) label.addClass("is-disabled");
      input.setAttribute(
        "aria-disabled",
        String(Boolean(item.disabled) || pending),
      );
      label.createSpan({ text: item.label });
      if (item.badge)
        label.createSpan({ text: item.badge, cls: "stratum-checklist-badge" });
      if (item.disabled)
        label.title = "Choose another default before hiding this style.";
      input.addEventListener("change", () => {
        if (pending || item.disabled) {
          input.checked = item.checked;
          return;
        }
        const checked = input.checked;
        let failed = false;
        pending = true;
        for (const checkbox of Array.from(
          list.querySelectorAll<HTMLInputElement>("input"),
        ))
          checkbox.setAttribute("aria-disabled", "true");
        label.setAttribute("aria-busy", "true");
        if (status) status.setText(checked ? "Saving style…" : "Hiding style…");
        void options
          .onChange(item.id, checked)
          .then(() => {
            item.checked = checked;
          })
          .catch((error: unknown) => {
            failed = true;
            input.checked = item.checked;
            new Notice(
              error instanceof Error
                ? error.message
                : "Could not save choices. Try again.",
            );
          })
          .finally(() => {
            pending = false;
            if (closed) return;
            label.removeAttribute("aria-busy");
            for (const checkbox of Array.from(
              list.querySelectorAll<HTMLInputElement>("input"),
            )) {
              const choice = items.find(
                (candidate) => candidate.id === checkbox.dataset.choiceId,
              );
              checkbox.disabled = Boolean(choice?.disabled);
              checkbox.setAttribute(
                "aria-disabled",
                String(Boolean(choice?.disabled)),
              );
              checkbox.checked = Boolean(choice?.checked);
            }
            if (status)
              status.setText(
                failed
                  ? "Could not save this choice. Try again."
                  : "Changes saved automatically.",
              );
          });
      });
      input.dataset.choiceId = item.id;
      if (item.id === focusedId) input.focus();
    }
  };
  renderItems();
  search?.addEventListener("input", renderItems);
  if (options.loadItems) {
    status?.setText("Loading styles…");
    void options
      .loadItems()
      .then((loaded) => {
        if (closed) return;
        // Keep choices made while the catalog was loading.
        const current = new Map(items.map((item) => [item.id, item]));
        items = loaded.map((item) => current.get(item.id) ?? item);
        items.sort(
          (a, b) =>
            Number(b.checked) - Number(a.checked) ||
            a.label.localeCompare(b.label),
        );
        renderItems();
      })
      .catch(() => {
        if (!closed)
          status?.setText(
            "Could not load the catalog. Saved styles are available. Reopen to try again.",
          );
      });
  }
  panel.addEventListener("focusout", (event) => {
    const target = event.relatedTarget as Node | null;
    // Let the trigger's click toggle the chooser after pointer focus moves.
    if (!panel.contains(target) && !anchor.contains(target)) close();
  });
  doc.addEventListener("pointerdown", onPointerDown, true);
  // Obsidian handles modal shortcuts before DOM key listeners. Give this
  // chooser its own scope so Escape does not also dismiss the parent modal.
  if (scope) {
    scope.register([], "Escape", () => {
      close(true);
      return false;
    });
    options.keyboard!.keymap.pushScope(scope);
  }
  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("scroll", onScroll, true);
  win.addEventListener("resize", onResize);
  (
    search ?? panel.querySelector<HTMLInputElement>("input:not(:disabled)")
  )?.focus();
  return () => close();
}
