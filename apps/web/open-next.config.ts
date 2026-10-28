import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";
import d1NextTagCache from "@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache";

// Rendered pages live in R2, with a copy in each data centre's cache; revalidatePath marks them stale in the D1 tag
// cache, which every cache hit still checks (bypassTagCacheOnCacheHit stays off: on Next 16 it serves stale pages).
// No queue: pages are only ever revalidated on demand, never by time.
export default defineCloudflareConfig({
  incrementalCache: withRegionalCache(r2IncrementalCache, { mode: "long-lived" }),
  tagCache: d1NextTagCache,
  enableCacheInterception: true,
});
