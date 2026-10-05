-- Curated: the category model tagged the Night of 1,000 Jack-o'-Lanterns as Arts only; it is an outing too (Activities).
-- The correction lives in the category cache, so imports keep it until the event's text changes.
update private.event_category_cache set categories = array['arts', 'play']::public.event_category[]
where title = 'The Night of 1,000 Jack-o’-Lanterns';

update public.events set category = category where title = 'The Night of 1,000 Jack-o’-Lanterns';
