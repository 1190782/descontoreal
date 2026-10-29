-- Review of product matches on the site (/admin/correspondencias), for signed-in admins only: a user whose
-- Supabase Auth JWT carries app_metadata.role = 'admin', which only the service role or the dashboard can set.
-- The site calls these through Supabase's API with the user's session, so it never holds the service key.
-- The security definer functions search pg_temp last, as the PostgreSQL manual advises for them.
-- Runs on top of 0003_touch_same_store_matching.sql; running it again changes nothing.

create or replace function is_admin()
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role' = 'admin', false);
$$;

-- The listing's EAN is the product's own: the rule keeps such SKUs together, so they are never split.
create or replace function shares_product_ean(p_details jsonb, p_product_ean text)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select coalesce(p_product_ean is not null and p_details ->> 'ean' = p_product_ean, false);
$$;

-- Pending candidates, best first and at most p_limit, with the listing and the candidate product side by side;
-- candidateCount is the whole queue. sameStore: products that one store lists more than once.
create or replace function admin_review_queue(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not is_admin() then
    raise exception 'admin_review_queue: admins only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'candidateCount', (select count(*) from match_candidates mc where mc.status = 'pending'),
    'candidates', coalesce((
      select jsonb_agg(c.item order by c.confidence desc, c.id)
      from (
        select mc.id, mc.confidence, jsonb_build_object(
          'candidateId', mc.id,
          'confidence', mc.confidence,
          'listing', jsonb_build_object(
            'id', l.id, 'storeName', s.name, 'sku', l.store_sku, 'title', l.raw_title, 'url', l.url,
            'imageUrl', nullif(l.details ->> 'imageUrl', ''), 'ean', nullif(l.details ->> 'ean', ''),
            'brand', nullif(l.details ->> 'brand', ''), 'model', nullif(l.details ->> 'model', ''),
            'priceCents', lp.price_cents, 'inStock', lp.in_stock
          ),
          'product', jsonb_build_object(
            'id', p.id, 'slug', p.slug, 'name', p.name, 'imageUrl', p.image_url, 'ean', p.ean,
            'brand', p.brand, 'model', p.model,
            'priceCents', (
              select min(pp.price_cents)
              from listings pl
              join price_points pp on pp.listing_id = pl.id and pp.valid_to is null
              where pl.product_id = p.id and pl.sold_by_store and pl.active
            ),
            'stores', coalesce((
              select jsonb_agg(distinct ps.name)
              from listings pl
              join stores ps on ps.id = pl.store_id
              where pl.product_id = p.id
            ), '[]'::jsonb)
          )
        ) as item
        from match_candidates mc
        join listings l on l.id = mc.listing_id
        join stores s on s.id = l.store_id
        join products p on p.id = mc.candidate_product_id
        left join price_points lp on lp.listing_id = l.id and lp.valid_to is null
        where mc.status = 'pending'
        order by mc.confidence desc, mc.id
        limit p_limit
      ) c
    ), '[]'::jsonb),
    'sameStore', coalesce((
      select jsonb_agg(g.item order by g.product_name, g.store_name)
      from (
        select p.name as product_name, s.name as store_name, jsonb_build_object(
          'productId', p.id, 'slug', p.slug, 'name', p.name, 'ean', p.ean, 'storeName', s.name,
          'sharesEan', bool_and(shares_product_ean(l.details, p.ean)),
          'listings', jsonb_agg(jsonb_build_object(
            'id', l.id, 'sku', l.store_sku, 'title', l.raw_title, 'url', l.url,
            'ean', nullif(l.details ->> 'ean', ''), 'priceCents', lp.price_cents,
            'canSplit', l.details is not null and not shares_product_ean(l.details, p.ean)
          ) order by l.id)
        ) as item
        from listings l
        join products p on p.id = l.product_id
        join stores s on s.id = l.store_id
        left join price_points lp on lp.listing_id = l.id and lp.valid_to is null
        group by p.id, s.id
        having count(*) > 1
      ) g
    ), '[]'::jsonb)
  );
end;
$$;

-- Slugs of the products whose pages a review changed, for the site to render again.
create or replace function product_slugs(p_product_ids bigint[])
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(p.slug order by p.slug), '[]'::jsonb) from products p where p.id = any (p_product_ids);
$$;

create or replace function admin_approve_match(p_candidate_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not is_admin() then
    raise exception 'admin_approve_match: admins only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'slugs', product_slugs(array[approve_match_candidate(p_candidate_id, auth.uid())])
  );
end;
$$;

create or replace function admin_reject_match(p_candidate_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not is_admin() then
    raise exception 'admin_reject_match: admins only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'slugs', product_slugs(array[reject_match_candidate(p_candidate_id, auth.uid())])
  );
end;
$$;

-- Takes a listing out of a product another listing of its store also has, and links it again by the 0003 rule: the
-- product of its EAN, the single product of its brand and model its store does not list, candidates, or a new
-- product. Refuses a listing without product page facts and one whose EAN is the product's.
create or replace function admin_split_listing(p_listing_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_product_id bigint;
  v_details jsonb;
  v_new_product_id bigint;
begin
  if not is_admin() then
    raise exception 'admin_split_listing: admins only' using errcode = '42501';
  end if;
  select l.product_id, l.details into v_product_id, v_details from listings l where l.id = p_listing_id for update;
  if v_details is null then
    raise exception 'admin_split_listing: listing % has no product page facts yet', p_listing_id;
  end if;
  if shares_product_ean(v_details, (select p.ean from products p where p.id = v_product_id)) then
    raise exception 'admin_split_listing: listing % has its product''s EAN', p_listing_id;
  end if;
  if not listed_by_same_store(v_product_id, p_listing_id) then
    raise exception 'admin_split_listing: no other listing of its store has the product of listing %', p_listing_id;
  end if;

  update listings set product_id = null where id = p_listing_id;
  v_new_product_id := link_unmatched_listing(p_listing_id);
  return jsonb_build_object('slugs', product_slugs(array[v_product_id, v_new_product_id]));
end;
$$;

-- Supabase exposes public functions over its REST API: the admin_* ones to signed-in users, who must be admins.
revoke execute on function
  is_admin(),
  shares_product_ean(jsonb, text),
  admin_review_queue(integer),
  product_slugs(bigint[]),
  admin_approve_match(bigint),
  admin_reject_match(bigint),
  admin_split_listing(bigint)
  from public, anon;
revoke execute on function shares_product_ean(jsonb, text), product_slugs(bigint[]) from authenticated;
grant execute on function
  is_admin(),
  admin_review_queue(integer),
  admin_approve_match(bigint),
  admin_reject_match(bigint),
  admin_split_listing(bigint)
  to authenticated, service_role;
grant execute on function shares_product_ean(jsonb, text), product_slugs(bigint[]) to service_role;
