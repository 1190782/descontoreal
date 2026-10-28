-- PVPr on price intervals, and no title candidates for another model of the same brand.
-- Runs on top of 0001_init.sql, production data included; running it again changes nothing.

-- Every writer (scrapers, reviews) locks listings before these tables. Locking in the same order, all at once,
-- means a scrape running meanwhile only waits for this migration, and it for the scrape: no deadlock.
lock table listings, match_candidates, products in exclusive mode;
lock table price_points in access exclusive mode;

-- Manufacturer's recommended price (PVPr). Information only: never a reference price, never a discount.
alter table price_points add column if not exists rrp_cents integer check (rrp_cents > 0);

-- Two known, different model codes of the same brand are two products, however similar their titles.
create or replace function same_brand_other_model(
  p_brand_norm text,
  p_model_norm text,
  p_other_brand_norm text,
  p_other_model_norm text
)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select coalesce(p_brand_norm = p_other_brand_norm and p_model_norm <> p_other_model_norm, false);
$$;

-- A listing with facts, no product and no pending candidate gets the product of its EAN, the single product
-- of its brand and model, or a new product built from its facts. Returns the listing's product id (null while
-- it still waits for review).
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
      -- Step 2 of save_listing_details, so two queued listings of one model never get two products.
      select array_agg(p.id order by p.id) into v_same_model
      from products p
      where p.brand_norm = nullif(v_details ->> 'brandNorm', '')
        and p.model_norm = nullif(v_details ->> 'modelNorm', '')
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

-- p_items: JSON array of ObservationInput (packages/db/src/contract.ts). Returns one row per item, in order.
create or replace function ingest_observations(p_store_slug text, p_observed_at timestamptz, p_items jsonb)
returns table (store_sku text, listing_id bigint, product_id bigint, product_slug text, status text)
language plpgsql
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_store_id bigint;
  v_item jsonb;
  v_sku text;
  v_url text;
  v_title text;
  v_sold boolean;
  v_price integer;
  v_reference integer;
  v_rrp integer;
  v_in_stock boolean;
  v_listing listings%rowtype;
  v_open price_points%rowtype;
  v_status text;
begin
  if p_observed_at is null then
    raise exception 'ingest_observations: p_observed_at is required';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'ingest_observations: p_items must be a JSON array';
  end if;
  select s.id into v_store_id from stores s where s.slug = p_store_slug;
  if v_store_id is null then
    raise exception 'ingest_observations: unknown store %', p_store_slug;
  end if;

  for v_item in
    select e.value from jsonb_array_elements(p_items) with ordinality as e (value, ord) order by e.ord
  loop
    v_sku := nullif(v_item ->> 'storeSku', '');
    v_url := v_item ->> 'url';
    v_title := v_item ->> 'rawTitle';
    v_sold := (v_item ->> 'soldByStore')::boolean;
    v_price := (v_item ->> 'priceCents')::integer;
    v_reference := (v_item ->> 'referencePriceCents')::integer;
    v_rrp := (v_item ->> 'rrpCents')::integer;
    v_in_stock := (v_item ->> 'inStock')::boolean;
    if v_sku is null or v_url is null or v_title is null or v_sold is null
      or (v_sold and (v_price is null or v_in_stock is null)) then
      raise exception 'ingest_observations: incomplete item %', v_item;
    end if;

    select * into v_listing from listings l where l.store_id = v_store_id and l.store_sku = v_sku for update;

    if v_listing.id is null then
      insert into listings (store_id, store_sku, url, raw_title, sold_by_store, first_seen_at, last_seen_at)
      values (v_store_id, v_sku, v_url, v_title, v_sold, p_observed_at, p_observed_at)
      returning * into v_listing;
      if v_sold then
        insert into price_points (listing_id, price_cents, reference_price_cents, rrp_cents, in_stock, valid_from)
        values (v_listing.id, v_price, v_reference, v_rrp, v_in_stock, p_observed_at);
      end if;
      v_status := 'new';
    else
      select * into v_open from price_points pp where pp.listing_id = v_listing.id and pp.valid_to is null for update;
      v_status := 'unchanged';

      -- An older observation (a late retry) never rewrites what a newer one recorded.
      if p_observed_at >= v_listing.last_seen_at and (v_open.id is null or p_observed_at >= v_open.valid_from) then
        update listings l
        set url = v_url, raw_title = v_title, sold_by_store = v_sold,
            last_seen_at = p_observed_at, active = true, missed_runs = 0
        where l.id = v_listing.id;

        if v_open.id is not null and not v_sold then
          if p_observed_at > v_open.valid_from then
            update price_points pp set valid_to = p_observed_at where pp.id = v_open.id;
          else
            delete from price_points pp where pp.id = v_open.id;
          end if;
          v_status := 'changed';
        elsif v_open.id is null and v_sold then
          insert into price_points (listing_id, price_cents, reference_price_cents, rrp_cents, in_stock, valid_from)
          values (v_listing.id, v_price, v_reference, v_rrp, v_in_stock, p_observed_at);
          v_status := 'changed';
        elsif v_sold and (v_open.price_cents, v_open.reference_price_cents, v_open.in_stock)
          is distinct from (v_price, v_reference, v_in_stock) then
          -- Two readings at the same instant (an item listed twice) keep one interval: the last reading wins.
          if p_observed_at > v_open.valid_from then
            update price_points pp set valid_to = p_observed_at where pp.id = v_open.id;
            insert into price_points (listing_id, price_cents, reference_price_cents, rrp_cents, in_stock, valid_from)
            values (v_listing.id, v_price, v_reference, v_rrp, v_in_stock, p_observed_at);
          else
            update price_points pp
            set price_cents = v_price, reference_price_cents = v_reference, rrp_cents = v_rrp, in_stock = v_in_stock
            where pp.id = v_open.id;
          end if;
          v_status := 'changed';
        elsif v_sold and v_open.rrp_cents is distinct from v_rrp then
          -- The PVPr is information only: the open interval keeps the latest one, and no interval opens for it.
          update price_points pp set rrp_cents = v_rrp where pp.id = v_open.id;
        end if;
      end if;
    end if;

    store_sku := v_sku;
    listing_id := v_listing.id;
    product_id := v_listing.product_id;
    product_slug := (select p.slug from products p where p.id = v_listing.product_id);
    status := v_status;
    return next;
  end loop;
end;
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

  -- 2. Same normalized brand and model. A product a reviewer rejected for this listing never counts.
  if v_brand_norm is not null and v_model_norm is not null then
    select array_agg(p.id order by similarity(p.name, v_name) desc, p.id) into v_same_model
    from products p
    where p.brand_norm = v_brand_norm and p.model_norm = v_model_norm
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

  -- 3. Similar title, same category when both are known, and not another model of the same brand.
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

create or replace function reject_match_candidate(p_candidate_id bigint, p_reviewer uuid)
returns bigint
language plpgsql
set search_path = public, extensions
as $$
declare
  v_listing_id bigint;
  v_status text;
begin
  select mc.listing_id into v_listing_id from match_candidates mc where mc.id = p_candidate_id;
  if v_listing_id is null then
    raise exception 'reject_match_candidate: candidate % does not exist', p_candidate_id;
  end if;
  -- Listing first, like save_listing_details, so the two never deadlock.
  perform 1 from listings l where l.id = v_listing_id for update;
  select mc.status into v_status from match_candidates mc where mc.id = p_candidate_id for update;
  if v_status <> 'pending' then
    raise exception 'reject_match_candidate: candidate % is %', p_candidate_id, v_status;
  end if;

  update match_candidates
  set status = 'rejected', reviewed_at = now(), reviewed_by = p_reviewer
  where id = p_candidate_id;
  return link_unmatched_listing(v_listing_id);
end;
$$;

-- Supabase exposes public functions over its REST API: only service_role (and postgres) may run these.
revoke execute on function
  same_brand_other_model(text, text, text, text),
  link_unmatched_listing(bigint),
  ingest_observations(text, timestamptz, jsonb),
  save_listing_details(jsonb, timestamptz, real, integer),
  reject_match_candidate(bigint, uuid)
  from public, anon, authenticated;
grant execute on function
  same_brand_other_model(text, text, text, text),
  link_unmatched_listing(bigint),
  ingest_observations(text, timestamptz, jsonb),
  save_listing_details(jsonb, timestamptz, real, integer),
  reject_match_candidate(bigint, uuid)
  to service_role;

-- One-off, for the review queue built before the rule: supersede the candidates it excludes, then a listing
-- left without candidates gets its product as if a reviewer had rejected the last one.
do $$
declare
  v_listing_ids bigint[];
  v_listing_id bigint;
begin
  with superseded as (
    update match_candidates mc
    set status = 'superseded', reviewed_at = now()
    from listings l, products p
    where mc.status = 'pending' and l.id = mc.listing_id and p.id = mc.candidate_product_id
      and same_brand_other_model(
        nullif(l.details ->> 'brandNorm', ''), nullif(l.details ->> 'modelNorm', ''), p.brand_norm, p.model_norm
      )
    returning mc.listing_id
  )
  select array_agg(distinct s.listing_id order by s.listing_id) into v_listing_ids from superseded s;

  foreach v_listing_id in array coalesce(v_listing_ids, '{}') loop
    perform link_unmatched_listing(v_listing_id);
  end loop;
end
$$;
