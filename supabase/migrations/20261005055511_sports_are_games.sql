-- 1. Northwestern Athletics (nusports.com) becomes an automated source: home games and Chicago-area games.
insert into public.sources (name, type, url, adapter_key, authority)
values ('NU Athletics', 'calendar_scrape', 'https://nusports.com/all-sports-schedule', 'nusports', 30)
on conflict (name) do update set adapter_key = excluded.adapter_key, url = excluded.url, authority = excluded.authority;

-- 2. Sports means games and competitions. Gym classes, meditation and health events are wellness, which is not
--    one of the site's categories, so from Northwestern calendars they are hidden like talks (still searchable).
--    A source's own "sports"/"wellness" label is no longer trusted: PlanItPurple files gym classes under it.
do $$
declare
  def text := pg_get_functiondef('private.classify_categories'::regproc);
  fixed text := def;
begin
  fixed := replace(fixed, $s$case when p_primary in ('music', 'arts', 'sports', 'wellness', 'career', 'academic') then array[p_primary] else '{}' end$s$, $s$case when p_primary in ('music', 'arts', 'career', 'academic') then array[p_primary] else '{}' end$s$);
  fixed := replace(fixed, $s$  if not talk and t ~ '\m(yoga|pilates|zumba|fitness|workout|run|5k|10k|marathon|tournament|basketball|football|soccer|volleyball|tennis|swim\w*|intramural|cycling|spin|hike|hiking|climbing|sailing|kayak\w*|athletic\w*|rec|recreation|hockey|baseball|softball|lacrosse|rugby|fencing|boxing|martial arts|wrestling|golf|vs|versus|game day|tailgate|walk for)\M' then found := private.add_category(found, 'sports'); end if;$s$, $s$  -- Sports: games and competitions to watch or enter. Gym classes are fitness (wellness), not sports.
  if not talk and (t ~ '\m(tournament|championships?|playoffs?|invitational|regatta|swim meet|track meet|marathon|half marathon|5k|10k|fun run|basketball|football|soccer|volleyball|tennis|hockey|baseball|softball|lacrosse|rugby|fencing|boxing|wrestling|golf|cross country|track and field|swimming and diving|gymnastics|intramural|athletics|athletic|game day|tailgate|walk for)\M'
       or (t ~ '\m(vs|versus)\M' and t !~ '\m(comedy|improv|stand-?up|standup|debate|trivia)\M')) then found := private.add_category(found, 'sports'); end if;$s$);
  fixed := replace(fixed, $s$  if not talk and t ~ '\m(wellness|meditation|mindful\w*|massage|self-care|healing|sound bath|breathwork)\M' then found := private.add_category(found, 'wellness'); end if;$s$, $s$  if not talk and t ~ '\m(yoga|vinyasa|hatha|ashtanga|pilates|barre|zumba|bodypump|body pump|cycle|cycling|spin|aqua fitness|functional fitness|fitness|workout|hiit|boot ?camp|kickboxing|tai chi|stretch|lap swim|meditation|mindful\w*|massage|self-care|healing|sound bath|breathwork|wellness)\M' then found := private.add_category(found, 'wellness'); end if;$s$);
  fixed := replace(fixed, $s$    elsif d ~ '\m(yoga|fitness|workout|tournament)\M' then found := private.add_category(found, 'sports');$s$, $s$    elsif d ~ '\m(tournament|championship)\M' then found := private.add_category(found, 'sports');
    elsif d ~ '\m(yoga|fitness|workout)\M' then found := private.add_category(found, 'wellness');$s$);
  fixed := replace(fixed, $s$|pottery|cooking class|candle making)\M'$s$, $s$|pottery|cooking class|candle making|hike|hiking|climbing|sailing|kayak\w*)\M'$s$);
  if position('swim\w*|intramural' in fixed) > 0 or position('bodypump' in fixed) = 0 or position('hiking' in fixed) = 0
     or position($q$'sports', 'wellness', 'career'$q$ in fixed) > 0 or position('swim meet' in fixed) = 0 then
    raise exception 'classify_categories did not have the expected shape';
  end if;
  execute fixed;

  def := pg_get_functiondef('private.is_hidden_event'::regproc);
  fixed := replace(def, $s$array['music', 'arts', 'exhibition', 'sports', 'wellness', 'play', 'market', 'social']$s$, $s$array['music', 'arts', 'exhibition', 'sports', 'play', 'market', 'social']$s$);
  if fixed = def then raise exception 'is_hidden_event did not have the expected shape'; end if;
  execute fixed;
end;
$$;

update public.events set category = category;
