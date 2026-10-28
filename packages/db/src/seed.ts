import { CATEGORIES, STORES } from "@descontoreal/core";
import type { SqlExecutor } from "./executor";

export interface UpsertCounts {
  inserted: number;
  updated: number;
}

export interface SeedResult {
  stores: UpsertCounts;
  categories: UpsertCounts;
}

const UPSERT_STORES = `
  insert into stores (slug, name, base_url, active)
  select s.slug, s.name, s."baseUrl", s.active
  from jsonb_to_recordset($1::text::jsonb) as s (slug text, name text, "baseUrl" text, active boolean)
  on conflict (slug) do update
  set name = excluded.name, base_url = excluded.base_url, active = excluded.active
  where (stores.name, stores.base_url, stores.active)
    is distinct from (excluded.name, excluded.base_url, excluded.active)
  returning slug, (xmax = 0) as inserted
`;

const UPSERT_CATEGORIES = `
  insert into categories (slug, name, singular)
  select c.slug, c.name, c.singular
  from jsonb_to_recordset($1::text::jsonb) as c (slug text, name text, singular text)
  on conflict (slug) do update
  set name = excluded.name, singular = excluded.singular
  where (categories.name, categories.singular) is distinct from (excluded.name, excluded.singular)
  returning slug, (xmax = 0) as inserted
`;

// Second pass: every parent exists by now, whatever the order of the list.
const UPDATE_CATEGORY_PARENTS = `
  update categories c
  set parent_id = parent.id
  from jsonb_to_recordset($1::text::jsonb) as r (slug text, parent text)
  left join categories parent on parent.slug = r.parent
  where c.slug = r.slug and c.parent_id is distinct from parent.id
  returning c.slug
`;

interface UpsertRow {
  slug: string;
  inserted: boolean;
}

/** Upserts core STORES and CATEGORIES (with parent and singular). Running it again changes nothing. */
export async function seedReferenceData(executor: SqlExecutor): Promise<SeedResult> {
  const result: SeedResult = { stores: { inserted: 0, updated: 0 }, categories: { inserted: 0, updated: 0 } };
  await executor.transaction(async (tx) => {
    const stores = await tx.query<UpsertRow>(UPSERT_STORES, [JSON.stringify(STORES)]);
    result.stores = countUpserts(stores, []);

    const categoriesJson = JSON.stringify(CATEGORIES);
    const categories = await tx.query<UpsertRow>(UPSERT_CATEGORIES, [categoriesJson]);
    const reparented = await tx.query<{ slug: string }>(UPDATE_CATEGORY_PARENTS, [categoriesJson]);
    result.categories = countUpserts(
      categories,
      reparented.map((row) => row.slug),
    );
  });
  return result;
}

function countUpserts(rows: readonly UpsertRow[], otherUpdatedSlugs: readonly string[]): UpsertCounts {
  const inserted = new Set(rows.filter((row) => row.inserted).map((row) => row.slug));
  const updated = new Set(
    [...rows.filter((row) => !row.inserted).map((row) => row.slug), ...otherUpdatedSlugs].filter(
      (slug) => !inserted.has(slug),
    ),
  );
  return { inserted: inserted.size, updated: updated.size };
}

export function formatSeedResult(result: SeedResult): string {
  const { stores, categories } = result;
  return (
    `Seed: stores ${stores.inserted} inserted, ${stores.updated} updated; ` +
    `categories ${categories.inserted} inserted, ${categories.updated} updated.`
  );
}
