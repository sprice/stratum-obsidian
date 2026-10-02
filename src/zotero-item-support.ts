import { ZOTERO_SCHEMA } from "./zotero-schema-data";
import type { ZoteroItemDetail } from "./zotero-item-detail-normalizer";

export interface UnsupportedZoteroItem {
  itemKey: string;
  title: string;
  itemType: string | null;
}

export function supportsZoteroItemType(itemType: string | null): boolean {
  return (
    itemType !== null &&
    Object.prototype.hasOwnProperty.call(ZOTERO_SCHEMA, itemType) &&
    !["attachment", "note", "annotation"].includes(itemType)
  );
}

export class UnsupportedZoteroItemError extends Error {
  readonly item: UnsupportedZoteroItem;
  constructor(detail: ZoteroItemDetail) {
    super(
      `Skipped “${detail.item.title}”: Zotero item type “${detail.item.itemType ?? "missing"}” is not supported. Any existing note was left unchanged.`,
    );
    this.name = "UnsupportedZoteroItemError";
    this.item = {
      itemKey: detail.item.key,
      title: detail.item.title,
      itemType: detail.item.itemType,
    };
  }
}

export function assertSupportedZoteroItem(detail: ZoteroItemDetail): void {
  if (!supportsZoteroItemType(detail.item.itemType))
    throw new UnsupportedZoteroItemError(detail);
}
