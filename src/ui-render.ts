/** Focus the control in `container` whose `attribute` equals `key`. */
export function focusControlByKey(
  container: HTMLElement,
  attribute: string,
  key: string,
): void {
  Array.from(container.querySelectorAll<HTMLElement>(`[${attribute}]`))
    .find((control) => control.getAttribute(attribute) === key)
    ?.focus();
}

/**
 * Re-renders a container only when its content changes. Callers skip unchanged
 * signatures, patch values in place while the structure holds, so typing keeps
 * its element, and otherwise rebuild with focus returned to the same control.
 */
export class StableRender {
  private signature = "";
  private structure = "";
  constructor(
    private container: HTMLElement,
    /** The `data-*` attribute that names each focusable control. */
    private attribute: string,
  ) {}
  /** Records `signature` and reports whether it differs from the last one. */
  changed(signature: string): boolean {
    if (signature === this.signature) return false;
    this.signature = signature;
    return true;
  }
  /**
   * Reports whether the last build has this `structure`, so values can be
   * patched in place. Otherwise records it for the rebuild that follows.
   */
  keeps(structure: string): boolean {
    if (structure === this.structure) return true;
    this.structure = structure;
    return false;
  }
  /** Forces the next render to rebuild. */
  invalidate(): void {
    this.structure = "";
  }
  /** Empties the container; call the result after rebuilding to restore focus. */
  clear(): () => void {
    const active = this.container.doc.activeElement;
    const focused = this.container.contains(active)
      ? (active as HTMLElement).getAttribute(this.attribute)
      : null;
    this.container.empty();
    return () => {
      if (focused) focusControlByKey(this.container, this.attribute, focused);
    };
  }
}
