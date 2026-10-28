-- Initial schema for Supabase Postgres 15–17. Runs in PGlite after src/local/supabase-shim.sql.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- Tables

create table stores (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (name <> ''),
  base_url text not null,
  affiliate_url_template text,
  active boolean not null default true
);

create table categories (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (name <> ''),
  parent_id bigint references categories (id) on delete restrict,
  singular text
);

create table products (
  id bigint generated always as identity primary key,
  -- This unique constraint is also the plan's products (ean) index.
  ean text unique check (ean ~ '^[0-9]{13}$'),
  brand text,
  brand_norm text,
  model text,
  model_norm text,
  name text not null check (name <> ''),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  category_id bigint references categories (id) on delete set null,
  image_url text,
  specs jsonb not null default '{}'::jsonb check (jsonb_typeof(specs) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table listings (
  id bigint generated always as identity primary key,
  store_id bigint not null references stores (id) on delete restrict,
  store_sku text not null check (store_sku <> ''),
  product_id bigint references products (id) on delete set null,
  url text not null,
  raw_title text not null,
  raw_ean text,
  sold_by_store boolean not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  active boolean not null default true,
  missed_runs integer not null default 0 check (missed_runs >= 0),
  product_page_checked_at timestamptz,
  details jsonb,
  unique (store_id, store_sku),
  check (last_seen_at >= first_seen_at)
);

create table price_points (
  id bigint generated always as identity primary key,
  listing_id bigint not null references listings (id) on delete cascade,
  price_cents integer not null check (price_cents > 0),
  reference_price_cents integer check (reference_price_cents > 0),
  in_stock boolean not null,
  valid_from timestamptz not null,
  valid_to timestamptz,
  check (valid_to > valid_from)
);

create table listing_stats (
  listing_id bigint primary key references listings (id) on delete cascade,
  computed_at timestamptz not null,
  current_price_cents integer not null check (current_price_cents > 0),
  min30_cents integer check (min30_cents > 0),
  min90_cents integer check (min90_cents > 0),
  min180_cents integer check (min180_cents > 0),
  med90_cents integer check (med90_cents > 0),
  max90_cents integer check (max90_cents > 0),
  label text not null,
  warnings text[] not null default '{}',
  details jsonb not null default '{}'::jsonb,
  real_discount_pct numeric
);

create table match_candidates (
  id bigint generated always as identity primary key,
  listing_id bigint not null references listings (id) on delete cascade,
  candidate_product_id bigint not null references products (id) on delete cascade,
  confidence real not null check (confidence >= 0 and confidence <= 1),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'superseded')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  unique (listing_id, candidate_product_id)
);

create table watchlist (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id bigint not null references products (id) on delete cascade,
  target_price_cents integer check (target_price_cents > 0),
  notify_any_drop boolean not null default true,
  unique (user_id, product_id)
);

create table alerts_sent (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  listing_id bigint not null references listings (id) on delete cascade,
  price_cents integer not null check (price_cents > 0),
  sent_at timestamptz not null default now()
);

create table scrape_runs (
  id bigint generated always as identity primary key,
  store_id bigint not null references stores (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'failed', 'blocked')),
  partial boolean not null default false,
  pages_fetched integer not null default 0 check (pages_fetched >= 0),
  listings_seen integer not null default 0 check (listings_seen >= 0),
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array')
);

-- Indexes

create index price_points_listing_id_valid_from_idx on price_points (listing_id, valid_from desc);
create unique index price_points_one_open_interval_idx on price_points (listing_id) where valid_to is null;
create index listings_product_id_idx on listings (product_id);
create index listings_store_id_last_seen_at_idx on listings (store_id, last_seen_at);
create index products_name_trgm_idx on products using gin (name extensions.gin_trgm_ops);
create index products_brand_norm_model_norm_idx on products (brand_norm, model_norm);
create index products_category_id_idx on products (category_id);
create index match_candidates_status_idx on match_candidates (status);
create index match_candidates_candidate_product_id_idx on match_candidates (candidate_product_id);
create index scrape_runs_store_id_started_at_idx on scrape_runs (store_id, started_at desc);
create index watchlist_product_id_idx on watchlist (product_id);
create index alerts_sent_user_id_listing_id_sent_at_idx on alerts_sent (user_id, listing_id, sent_at desc);
create index alerts_sent_listing_id_idx on alerts_sent (listing_id);

-- Row Level Security: public price data is read-only; account data belongs to its user.
-- Writes go through the postgres role (scrapers, daily jobs) or service_role (admin pages).

alter table stores enable row level security;
alter table categories enable row level security;
alter table products enable row level security;
alter table listings enable row level security;
alter table price_points enable row level security;
alter table listing_stats enable row level security;
alter table match_candidates enable row level security;
alter table watchlist enable row level security;
alter table alerts_sent enable row level security;
alter table scrape_runs enable row level security;

create policy "Public read" on stores for select to anon, authenticated using (true);
create policy "Public read" on categories for select to anon, authenticated using (true);
create policy "Public read" on products for select to anon, authenticated using (true);
create policy "Public read of listings sold by the store" on listings
  for select to anon, authenticated using (sold_by_store);
create policy "Public read" on price_points for select to anon, authenticated using (true);
create policy "Public read" on listing_stats for select to anon, authenticated using (true);

create policy "Users read their watchlist" on watchlist
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users add to their watchlist" on watchlist
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users change their watchlist" on watchlist
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Users remove from their watchlist" on watchlist
  for delete to authenticated using (user_id = (select auth.uid()));
create policy "Users read their alerts" on alerts_sent
  for select to authenticated using (user_id = (select auth.uid()));

-- Supabase grants everything in public to anon and authenticated by default; keep only what the policies need.
revoke all on table
  stores, categories, products, listings, price_points, listing_stats,
  match_candidates, watchlist, alerts_sent, scrape_runs
  from anon, authenticated;
grant select on table stores, categories, products, listings, price_points, listing_stats to anon, authenticated;
grant select, insert, update, delete on table watchlist to authenticated;
grant select on table alerts_sent to authenticated;
grant select, insert, update, delete on table
  stores, categories, products, listings, price_points, listing_stats,
  match_candidates, watchlist, alerts_sent, scrape_runs
  to service_role;

-- Write functions: one call = one transaction. Every *_at argument is a UTC instant.

-- Facts (p_facts) use the keys of ListingDetailsInput (packages/db/src/contract.ts), minus listingId and rawEan.
create function create_product(p_facts jsonb, p_ean text, out product_id bigint, out created boolean)
language plpgsql
set search_path = public, extensions
as $$
declare
  v_base text := p_facts ->> 'slugBase';
  v_slug text := v_base;
  v_suffix integer := 1;
begin
  loop
    if not exists (select 1 from products p where p.slug = v_slug) then
      insert into products (ean, brand, brand_norm, model, model_norm, name, slug, category_id, image_url, specs)
      values (
        p_ean,
        nullif(p_facts ->> 'brand', ''),
        nullif(p_facts ->> 'brandNorm', ''),
        nullif(p_facts ->> 'model', ''),
        nullif(p_facts ->> 'modelNorm', ''),
        p_facts ->> 'name',
        v_slug,
        (select c.id from categories c where c.slug = p_facts ->> 'categorySlug'),
        nullif(p_facts ->> 'imageUrl', ''),
        case when jsonb_typeof(p_facts -> 'specs') = 'object' then p_facts -> 'specs' else '{}'::jsonb end
      )
      on conflict do nothing
      returning id into product_id;
      if product_id is not null then
        created := true;
        return;
      end if;
      -- A concurrent call took the slug or the EAN; with the EAN taken, that product is ours.
      if p_ean is not null then
        select p.id into product_id from products p where p.ean = p_ean;
        if product_id is not null then
          created := false;
          return;
        end if;
      end if;
    end if;
    v_suffix := v_suffix + 1;
    v_slug := v_base || '-' || v_suffix;
  end loop;
end;
$$;

create function fill_product_facts(p_product_id bigint, p_facts jsonb)
returns void
language sql
set search_path = public, extensions
as $$
  update products p
  set brand = n.brand,
      brand_norm = n.brand_norm,
      model = n.model,
      model_norm = n.model_norm,
      image_url = n.image_url,
      specs = n.specs,
      category_id = n.category_id,
      updated_at = now()
  from (
    select
      coalesce(existing.brand, nullif(p_facts ->> 'brand', '')) as brand,
      coalesce(existing.brand_norm, nullif(p_facts ->> 'brandNorm', '')) as brand_norm,
      coalesce(existing.model, nullif(p_facts ->> 'model', '')) as model,
      coalesce(existing.model_norm, nullif(p_facts ->> 'modelNorm', '')) as model_norm,
      coalesce(existing.image_url, nullif(p_facts ->> 'imageUrl', '')) as image_url,
      case
        when existing.specs = '{}'::jsonb and jsonb_typeof(p_facts -> 'specs') = 'object' then p_facts -> 'specs'
        else existing.specs
      end as specs,
      coalesce(existing.category_id, (select c.id from categories c where c.slug = p_facts ->> 'categorySlug'))
        as category_id
    from products existing
    where existing.id = p_product_id
  ) n
  where p.id = p_product_id
    and (p.brand, p.brand_norm, p.model, p.model_norm, p.image_url, p.specs, p.category_id)
      is distinct from (n.brand, n.brand_norm, n.model, n.model_norm, n.image_url, n.specs, n.category_id);
$$;

create function supersede_match_candidates(p_listing_id bigint, p_reviewer uuid default null)
returns void
language sql
set search_path = public, extensions
as $$
  update match_candidates
  set status = 'superseded', reviewed_at = now(), reviewed_by = p_reviewer
  where listing_id = p_listing_id and status = 'pending';
$$;

-- Products with different EANs are never merged: each EAN keeps its own product.
create function link_listing_by_ean(p_listing_id bigint, p_ean text, p_facts jsonb)
returns text
language plpgsql
set search_path = public, extensions
as $$
declare
  v_current_id bigint;
  v_current_ean text;
  v_ean_product_id bigint;
  v_created boolean := false;
begin
  select l.product_id into v_current_id from listings l where l.id = p_listing_id;
  select p.id into v_ean_product_id from products p where p.ean = p_ean;

  if v_current_id = v_ean_product_id then
    perform fill_product_facts(v_current_id, p_facts);
    return 'already_linked';
  end if;

  if v_current_id is not null and v_ean_product_id is null then
    select p.ean into v_current_ean from products p where p.id = v_current_id for update;
    if v_current_ean is null then
      update products set ean = p_ean, updated_at = now() where id = v_current_id;
      perform fill_product_facts(v_current_id, p_facts);
      perform supersede_match_candidates(p_listing_id);
      return 'linked_ean';
    end if;
  end if;

  if v_ean_product_id is null then
    select c.product_id, c.created into v_ean_product_id, v_created from create_product(p_facts, p_ean) c;
  end if;
  if not v_created then
    perform fill_product_facts(v_ean_product_id, p_facts);
  end if;
  update listings set product_id = v_ean_product_id where id = p_listing_id;
  perform supersede_match_candidates(p_listing_id);
  return case when v_created then 'created_ean' else 'linked_ean' end;
end;
$$;

-- p_items: JSON array of ObservationInput (packages/db/src/contract.ts). Returns one row per item, in order.
create function ingest_observations(p_store_slug text, p_observed_at timestamptz, p_items jsonb)
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
        insert into price_points (listing_id, price_cents, reference_price_cents, in_stock, valid_from)
        values (v_listing.id, v_price, v_reference, v_in_stock, p_observed_at);
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
          insert into price_points (listing_id, price_cents, reference_price_cents, in_stock, valid_from)
          values (v_listing.id, v_price, v_reference, v_in_stock, p_observed_at);
          v_status := 'changed';
        elsif v_sold and (v_open.price_cents, v_open.reference_price_cents, v_open.in_stock)
          is distinct from (v_price, v_reference, v_in_stock) then
          -- Two readings at the same instant (an item listed twice) keep one interval: the last reading wins.
          if p_observed_at > v_open.valid_from then
            update price_points pp set valid_to = p_observed_at where pp.id = v_open.id;
            insert into price_points (listing_id, price_cents, reference_price_cents, in_stock, valid_from)
            values (v_listing.id, v_price, v_reference, v_in_stock, p_observed_at);
          else
            update price_points pp
            set price_cents = v_price, reference_price_cents = v_reference, in_stock = v_in_stock
            where pp.id = v_open.id;
          end if;
          v_status := 'changed';
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
create function save_listing_details(
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

  -- 3. Similar title, same category when both are known.
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

-- Call after a complete run, with the time the run started.
create function mark_missing_listings(p_store_slug text, p_seen_since timestamptz, p_max_missed integer default 3)
returns table (missed integer, deactivated integer)
language plpgsql
set search_path = public, extensions
as $$
declare
  v_store_id bigint;
begin
  select s.id into v_store_id from stores s where s.slug = p_store_slug;
  if v_store_id is null then
    raise exception 'mark_missing_listings: unknown store %', p_store_slug;
  end if;

  return query
  with missing as (
    update listings l
    set missed_runs = l.missed_runs + 1, active = l.missed_runs + 1 < p_max_missed
    where l.store_id = v_store_id and l.active and l.last_seen_at < p_seen_since
    returning l.id, l.active
  ),
  closed as (
    update price_points pp
    set valid_to = p_seen_since
    from missing m
    where pp.listing_id = m.id and not m.active and pp.valid_to is null
    returning pp.id
  )
  select count(*)::integer, (count(*) filter (where not m.active))::integer from missing m;
end;
$$;

-- For /admin/correspondencias. Both return the listing's product id afterwards (null while it has none).
create function approve_match_candidate(p_candidate_id bigint, p_reviewer uuid)
returns bigint
language plpgsql
set search_path = public, extensions
as $$
declare
  v_listing_id bigint;
  v_candidate match_candidates%rowtype;
  v_details jsonb;
begin
  select mc.listing_id into v_listing_id from match_candidates mc where mc.id = p_candidate_id;
  if v_listing_id is null then
    raise exception 'approve_match_candidate: candidate % does not exist', p_candidate_id;
  end if;
  -- Listing first, like save_listing_details, so the two never deadlock.
  perform 1 from listings l where l.id = v_listing_id for update;
  select * into v_candidate from match_candidates mc where mc.id = p_candidate_id for update;
  if v_candidate.status <> 'pending' then
    raise exception 'approve_match_candidate: candidate % is %', p_candidate_id, v_candidate.status;
  end if;

  update match_candidates
  set status = 'approved', reviewed_at = now(), reviewed_by = p_reviewer
  where id = p_candidate_id;
  update listings l
  set product_id = v_candidate.candidate_product_id
  where l.id = v_listing_id
  returning l.details into v_details;
  if v_details is not null then
    perform fill_product_facts(v_candidate.candidate_product_id, v_details);
  end if;
  perform supersede_match_candidates(v_listing_id, p_reviewer);
  return v_candidate.candidate_product_id;
end;
$$;

create function reject_match_candidate(p_candidate_id bigint, p_reviewer uuid)
returns bigint
language plpgsql
set search_path = public, extensions
as $$
declare
  v_listing_id bigint;
  v_status text;
  v_product_id bigint;
  v_details jsonb;
begin
  select mc.listing_id into v_listing_id from match_candidates mc where mc.id = p_candidate_id;
  if v_listing_id is null then
    raise exception 'reject_match_candidate: candidate % does not exist', p_candidate_id;
  end if;
  select l.product_id, l.details into v_product_id, v_details from listings l where l.id = v_listing_id for update;
  select mc.status into v_status from match_candidates mc where mc.id = p_candidate_id for update;
  if v_status <> 'pending' then
    raise exception 'reject_match_candidate: candidate % is %', p_candidate_id, v_status;
  end if;

  update match_candidates
  set status = 'rejected', reviewed_at = now(), reviewed_by = p_reviewer
  where id = p_candidate_id;

  if v_product_id is null and v_details is not null and not exists (
    select 1 from match_candidates mc where mc.listing_id = v_listing_id and mc.status = 'pending'
  ) then
    if nullif(v_details ->> 'ean', '') is not null then
      perform link_listing_by_ean(v_listing_id, v_details ->> 'ean', v_details);
    else
      select c.product_id into v_product_id from create_product(v_details, null) c;
      update listings set product_id = v_product_id where id = v_listing_id;
    end if;
    select l.product_id into v_product_id from listings l where l.id = v_listing_id;
  end if;
  return v_product_id;
end;
$$;

-- Supabase exposes public functions over its REST API: only service_role (and postgres) may run these.
revoke execute on function
  create_product(jsonb, text),
  fill_product_facts(bigint, jsonb),
  supersede_match_candidates(bigint, uuid),
  link_listing_by_ean(bigint, text, jsonb),
  ingest_observations(text, timestamptz, jsonb),
  save_listing_details(jsonb, timestamptz, real, integer),
  mark_missing_listings(text, timestamptz, integer),
  approve_match_candidate(bigint, uuid),
  reject_match_candidate(bigint, uuid)
  from public, anon, authenticated;
grant execute on function
  create_product(jsonb, text),
  fill_product_facts(bigint, jsonb),
  supersede_match_candidates(bigint, uuid),
  link_listing_by_ean(bigint, text, jsonb),
  ingest_observations(text, timestamptz, jsonb),
  save_listing_details(jsonb, timestamptz, real, integer),
  mark_missing_listings(text, timestamptz, integer),
  approve_match_candidate(bigint, uuid),
  reject_match_candidate(bigint, uuid)
  to service_role;
