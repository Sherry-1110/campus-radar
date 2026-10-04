-- Markets get their own category. Titles are matched after the academic rules,
-- so "market research seminar" stays academic. Only events still marked 'other'
-- or 'food' (farmers markets used to be filed as food) are moved.

create or replace function private.classify_category(p_title text, p_description text)
returns public.event_category
language plpgsql
immutable
set search_path = ''
as $$
declare
  t text := lower(coalesce(p_title, ''));
  d text := lower(left(coalesce(p_description, ''), 300));
begin
  if t ~ '\m(lecture|seminar|colloquium|symposium|conference|grand rounds|didactic|journal club|thesis|dissertation|defense|research|book talk|talk|panel|workshop|webinar|m&m)\M' then
    return 'academic';
  end if;
  if t ~ '\m(market|markets|bazaar|flea|swap meet|pop-?up shop|craft fair|artisan fair|maker fair|vendor fair|holiday fair|christkindlmarket)\M' then
    return 'market';
  end if;
  if t ~ '\m(food tour|tasting|brunch|breakfast|lunch|dinner|buffet|pizza|cooking|baking|wine|beer|food truck|taco|burger|ramen|dessert|bbq|restaurant week)\M'
     and t !~ '\m(comedy|improv)\M' then
    -- A lunch or dinner that hosts a talk series is an academic event.
    return case when d ~ '\m(lecture|talk series|research|faculty|seminar)\M' then 'academic' else 'food' end;
  end if;
  if t ~ '\m(concert|orchestra|symphony|jazz|recital|choir|chorus|quartet|quintet|band|dj|music|musical|opera|karaoke|open mic|singer|songwriter|taiko|a cappella|acapella)\M'
     and t !~ 'improvised musical' then return 'music'; end if;
  if t ~ '\m(comedy|improv|improvised|sketch|stand-?up|theat(er|re)|revue|exhibit|exhibition|gallery|museum|art|arts|film|cinema|screening|dance|ballet|poetry|storytelling|cabaret|magic|circus|variety|mainstage|show|craft|sculpture|photograph\w*|architecture|culture|cultural)\M' then return 'arts'; end if;
  if t ~ '\m(yoga|pilates|zumba|fitness|workout|run|5k|10k|marathon|tournament|basketball|football|soccer|volleyball|tennis|swim\w*|intramural|cycling|spin|hike|climbing|sailing|kayak\w*|athletic\w*|rec|recreation|hockey|baseball|softball|lacrosse|rugby|fencing|boxing|martial arts)\M' then return 'sports'; end if;
  if t ~ '\m(wellness|meditation|mindful\w*|mental health|counseling|massage|self-care|healing|therapy|stress|sleep)\M' then return 'wellness'; end if;
  if t ~ '\m(career|internship|recruit\w*|job|jobs|resume|r[eé]sum[eé]|networking|employer\w*|hiring|interview\w*|career fair|job fair|entrepreneur\w*|startup\w*|founder\w*|pitch)\M' then return 'career'; end if;
  if t ~ '\m(mixer|party|social|hangout|reception|mingle|game night|trivia|open house|coffee hour|celebration|gala|meetup|meet-up|potluck|bonfire|picnic|retreat|fundrais\w*|festival|parade)\M' then return 'social'; end if;
  if t ~ '\m(class|course|training|orientation|info session|information session|office hours|presentation|lab|study|studies|science|institute|forum|series|discussion|book club|rounds|consultation\w*|drop-in support)\M' then return 'academic'; end if;
  if d ~ '\m(comedy|improv|exhibit\w*|museum|theat(er|re)|gallery)\M' then return 'arts'; end if;
  if d ~ '\m(concert|orchestra|symphony|jazz)\M' then return 'music'; end if;
  if d ~ '\m(lecture|seminar|colloquium|symposium|workshop|research)\M' then return 'academic'; end if;
  if d ~ '\m(yoga|fitness|workout|tournament)\M' then return 'sports'; end if;
  return 'other';
end;
$$;

update public.events
set category = 'market'
where category in ('other', 'food')
  and private.classify_category(title, description) = 'market';
