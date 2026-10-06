// src/pages.js
import { CliError } from "./errors.js";
export async function fetchAll(callPage, { schema, maxPages = 20 }) {
  if (!schema.properties?.page) throw new CliError(2, "--all is not supported by this tool (cursor or nested pages): pass the cursor / page yourself");
  const items = []; let pages = 0; let total = null; let hasMore = true;
  while (hasMore && pages < maxPages) {
    const res = await callPage(pages + 1);
    if (!Array.isArray(res?.items) || typeof res?.has_more !== "boolean") throw new CliError(2, "--all is not supported by this tool (no top-level items/has_more)");
    if (pages === 0) total = res.total ?? null;
    items.push(...res.items); pages++; hasMore = res.has_more;
  }
  return { items, pages, count: items.length, total, has_more: hasMore, truncated: hasMore };
}
