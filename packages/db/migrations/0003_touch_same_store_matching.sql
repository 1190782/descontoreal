-- Listings seen without a price stay active, and two SKUs of one store are two products unless an EAN joins them.
-- Runs on top of 0002_rrp_partial_matching.sql, production data included; running it again changes nothing.

-- The same locks as 0002, in the same order: every writer locks listings first, so a scrape running meanwhile
-- only waits for this migration, and it for the scrape.
lock table listings, match_candidates, products in exclusive mode;
lock table price_points in access exclusive mode;

-- Listings a run saw but recorded no price for (product page failed, price jump not confirmed): no missed runs and
-- active again. last_seen_at keeps the last reading with a price, so mark_missing_listings, called next, leaves them
-- one missed run and their old price is never quoted as a current offer. Prices are never touched. Returns the
-- listings updated.
create or replace function touch_listings(p_store_slug text, p_skus text[])
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_store_id bigint;
  v_touched integer;
begin
  select s.id into v_store_id from stores s where s.slug = p_store_slug;
  if v_store_id is null then
    raise exception 'touch_listings: unknown store %', p_store_slug;
  end if;

  update listings l
  set missed_runs = 0, active = true
  where l.store_id = v_store_id and l.store_sku = any (p_skus);
  get diagnostics v_touched = row_count;
  return v_touched;
end;
$$;

-- Two SKUs of one store are two products unless they share an EAN: true when another listing of the listing's
-- store has the product.
create or replace function listed_by_same_store(p_product_id bigint, p_listing_id bigint)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select exists (
    select 1
    from listings matched
    join listings l on l.store_id = matched.store_id
    where matched.id = p_listing_id and l.product_id = p_product_id and l.id <> p_listing_id
  );
$$;

-- p_input: ListingDetailsInput (packages/db/src/contract.ts). Returns a MatchOutcome.
create or replace function save_listing_details(
  p_input jsonb,
  p_checked_at timestamptz,
  p_similarity_threshold real default 0.45,
  p_max_candidates integer default 3
)
returns text
language plpgsql
set search_path = public, extensions
as $$
declare
  v_listing_id bigint := (p_input ->> 'listingId')::bigint;
  v_ean text := nullif(p_input ->> 'ean', '');
  v_brand_norm text := nullif(p_input ->> 'brandNorm', '');
  v_model_norm text := nullif(p_input ->> 'modelNorm', '');
  v_name text := nullif(p_input ->> 'name', '');
  v_facts jsonb := p_input - 'listingId' - 'rawEan';
  v_product_id bigint;
  v_category_id bigint;
  v_same_model bigint[];
begin
  if v_listing_id is null or v_name is null or nullif(p_input ->> 'slugBase', '') is null then
    raise exception 'save_listing_details: listingId, name and slugBase are required';
  end if;
  if v_ean !~ '^[0-9]{13}$' then
    raise exception 'save_listing_details: ean must have 13 digits, got %', v_ean;
  end if;

  update listings l
  set raw_ean = nullif(p_input ->> 'rawEan', ''),
      details = v_facts,
      product_page_checked_at = coalesce(p_checked_at, l.product_page_checked_at)
  where l.id = v_listing_id
  returning l.product_id into v_product_id;
  if not found then
    raise exception 'save_listing_details: listing % does not exist', v_listing_id;
  end if;

  -- 1. A valid EAN decides alone: never brand/model or title for a listing that has one.
  if v_ean is not null then
    return link_listing_by_ean(v_listing_id, v_ean, v_facts);
  end if;

  if v_product_id is not null then
    perform fill_product_facts(v_product_id, v_facts);
    return 'already_linked';
  end if;

  -- 2. Same normalized brand and model. A product a reviewer rejected for this listing, or one this store already
  -- lists, never counts.
  if v_brand_norm is not null and v_model_norm is not null then
    select array_agg(p.id order by similarity(p.name, v_name) desc, p.id) into v_same_model
    from products p
    where p.brand_norm = v_brand_norm and p.model_norm = v_model_norm
      and not listed_by_same_store(p.id, v_listing_id)
      and not exists (
        select 1 from match_candidates mc
        where mc.listing_id = v_listing_id and mc.candidate_product_id = p.id and mc.status = 'rejected'
      );

    if cardinality(v_same_model) = 1 then
      update listings set product_id = v_same_model[1] where id = v_listing_id;
      perform fill_product_facts(v_same_model[1], v_facts);
      perform supersede_match_candidates(v_listing_id);
      return 'linked_brand_model';
    end if;

    if cardinality(v_same_model) > 1 then
      insert into match_candidates (listing_id, candidate_product_id, confidence)
      select v_listing_id, p.id, similarity(p.name, v_name)
      from products p
      where p.id = any (v_same_model[1:p_max_candidates])
      on conflict (listing_id, candidate_product_id) do nothing;
    end if;
  end if;

  -- 3. Similar title, same category when both are known, not another model of the same brand, and never a
  -- product this store already lists.
  if not exists (select 1 from match_candidates mc where mc.listing_id = v_listing_id and mc.status = 'pending') then
    select c.id into v_category_id from categories c where c.slug = p_input ->> 'categorySlug';
    -- % compares a real similarity with a double threshold, so it gets a lower bar and the exact test follows.
    perform set_config('pg_trgm.similarity_threshold', greatest(p_similarity_threshold - 0.01, 0)::text, true);
    insert into match_candidates (listing_id, candidate_product_id, confidence)
    select v_listing_id, s.id, s.score
    from (
      select p.id, similarity(p.name, v_name) as score
      from products p
      where p.name % v_name
        and (v_category_id is null or p.category_id is null or p.category_id = v_category_id)
        and not same_brand_other_model(v_brand_norm, v_model_norm, p.brand_norm, p.model_norm)
        and not listed_by_same_store(p.id, v_listing_id)
        and not exists (
          select 1 from match_candidates mc
          where mc.listing_id = v_listing_id and mc.candidate_product_id = p.id and mc.status = 'rejected'
        )
    ) s
    where s.score >= p_similarity_threshold
    order by s.score desc, s.id
    limit p_max_candidates
    on conflict (listing_id, candidate_product_id) do nothing;
  end if;

  if exists (select 1 from match_candidates mc where mc.listing_id = v_listing_id and mc.status = 'pending') then
    return 'candidate';
  end if;

  -- 4. Nothing similar: a new product without EAN.
  select c.product_id into v_product_id from create_product(v_facts, null) c;
  update listings set product_id = v_product_id where id = v_listing_id;
  return 'created';
end;
$$;

-- A listing with facts, no product and no pending candidate gets the product of its EAN, the single product
-- of its brand and model that its store does not list yet, or a new product built from its facts. Returns the
-- listing's product id (null while it still waits for review).
create or replace function link_unmatched_listing(p_listing_id bigint)
returns bigint
language plpgsql
set search_path = public, extensions
as $$
declare
  v_product_id bigint;
  v_details jsonb;
  v_same_model bigint[];
begin
  select l.product_id, l.details into v_product_id, v_details from listings l where l.id = p_listing_id for update;
  if v_product_id is null and v_details is not null and not exists (
    select 1 from match_candidates mc where mc.listing_id = p_listing_id and mc.status = 'pending'
  ) then
    if nullif(v_details ->> 'ean', '') is not null then
      perform link_listing_by_ean(p_listing_id, v_details ->> 'ean', v_details);
    else
      -- Step 2 of save_listing_details, so queued listings of one model in different stores share one product.
      select array_agg(p.id order by p.id) into v_same_model
      from products p
      where p.brand_norm = nullif(v_details ->> 'brandNorm', '')
        and p.model_norm = nullif(v_details ->> 'modelNorm', '')
        and not listed_by_same_store(p.id, p_listing_id)
        and not exists (
          select 1 from match_candidates mc
          where mc.listing_id = p_listing_id and mc.candidate_product_id = p.id and mc.status = 'rejected'
        );
      if cardinality(v_same_model) = 1 then
        update listings set product_id = v_same_model[1] where id = p_listing_id;
        perform fill_product_facts(v_same_model[1], v_details);
      elsif cardinality(v_same_model) > 1 then
        insert into match_candidates (listing_id, candidate_product_id, confidence)
        select p_listing_id, p.id, similarity(p.name, v_details ->> 'name')
        from products p
        where p.id = any (v_same_model[1:3])
        on conflict (listing_id, candidate_product_id) do update
          set status = 'pending', reviewed_at = null, reviewed_by = null
          where match_candidates.status = 'superseded';
      else
        select c.product_id into v_product_id from create_product(v_details, null) c;
        update listings set product_id = v_product_id where id = p_listing_id;
      end if;
    end if;
    select l.product_id into v_product_id from listings l where l.id = p_listing_id;
  end if;
  return v_product_id;
end;
$$;

-- Supabase exposes public functions over its REST API: only service_role (and postgres) may run these.
revoke execute on function
  touch_listings(text, text[]),
  listed_by_same_store(bigint, bigint),
  save_listing_details(jsonb, timestamptz, real, integer),
  link_unmatched_listing(bigint)
  from public, anon, authenticated;
grant execute on function
  touch_listings(text, text[]),
  listed_by_same_store(bigint, bigint),
  save_listing_details(jsonb, timestamptz, real, integer),
  link_unmatched_listing(bigint)
  to service_role;

-- One-off, for the review queue built before the rule: supersede the candidates the listing's store already lists,
-- by title or by brand and model, then a listing left without candidates gets its product as if a reviewer had
-- rejected the last one. Repeats until nothing changes: a listing linked here can make another listing's
-- candidate one of its store's products.
do $$
declare
  v_listing_ids bigint[];
  v_listing_id bigint;
begin
  loop
    with superseded as (
      update match_candidates mc
      set status = 'superseded', reviewed_at = now()
      where mc.status = 'pending' and listed_by_same_store(mc.candidate_product_id, mc.listing_id)
      returning mc.listing_id
    )
    select array_agg(distinct s.listing_id order by s.listing_id) into v_listing_ids from superseded s;
    exit when v_listing_ids is null;

    foreach v_listing_id in array v_listing_ids loop
      perform link_unmatched_listing(v_listing_id);
    end loop;
  end loop;
end
$$;
