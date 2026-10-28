const LIST_FORMAT = new Intl.ListFormat("pt-PT", { style: "long", type: "conjunction" });

/** "a", "a e b", "a, b e c". */
export function formatList(items: readonly string[]): string {
  return LIST_FORMAT.format(items);
}
