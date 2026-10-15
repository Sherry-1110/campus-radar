-- Curated tags for two of this week's picks the category model had not judged yet:
-- Chicago Fashion Week is Arts; the Roscoe Village Halloween Block Party is a Fest with things to do.
insert into private.event_category_cache (input_hash, title, description, categories, scores, version, model)
select private.category_input_hash(e.title, e.description), e.title, coalesce(e.description, ''), v.categories, '{}'::jsonb, 'fun-v1', 'curated'
from public.events e
join (values
  ('Chicago Fashion Week', array['arts']::public.event_category[]),
  ('Roscoe Village Halloween Block Party', array['market', 'play']::public.event_category[])
) v(title, categories) on v.title = e.title
group by e.title, e.description, v.categories
on conflict (input_hash) do update set categories = excluded.categories, model = excluded.model, version = excluded.version, created_at = now();

update public.events set category = category where title in ('Chicago Fashion Week', 'Roscoe Village Halloween Block Party');
