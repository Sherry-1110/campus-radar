-- Add a Play category (games, escape rooms, attractions, hands-on events) to the classifier.

create or replace function private.classify_categories(p_title text, p_description text, p_primary public.event_category)
returns public.event_category[]
language plpgsql immutable set search_path = ''
as $$
declare
  t text := lower(coalesce(p_title, ''));
  d text := lower(left(coalesce(p_description, ''), 300));
  found public.event_category[] := case when p_primary is null or p_primary = 'other' then '{}' else array[p_primary] end;
  -- Talks and seminars are about a topic: "market research" is not a market.
  talk boolean := t ~ '\m(lecture|seminar|colloquium|symposium|conference|grand rounds|didactic|journal club|thesis|dissertation|defense|research|book talk|talk|panel|workshop|webinar|m&m)\M';
begin
  if talk then
    found := private.add_category(found, 'academic');
  end if;
  if not talk and t ~ '\m(market|markets|bazaar|flea|swap meet|pop-?up shop|craft fair|artisan fair|maker fair|vendor fair|holiday fair|christkindlmarket)\M' then
    found := private.add_category(found, 'market');
  end if;
  if t ~ '\m(food tour|tasting|brunch|breakfast|lunch|dinner|buffet|pizza|cooking|baking|wine|beer|food truck|taco|burger|ramen|dessert|bbq|restaurant week)\M'
     and t !~ '\m(comedy|improv)\M' then
    -- A lunch or dinner that hosts a talk series is an academic event.
    found := private.add_category(found,
      (case when d ~ '\m(lecture|talk series|research|faculty|seminar)\M' then 'academic' else 'food' end)::public.event_category);
  end if;
  if t ~ '\m(concert|orchestra|symphony|jazz|recital|choir|chorus|quartet|quintet|band|dj|music|musical|opera|karaoke|open mic|singer|songwriter|taiko|a cappella|acapella)\M'
     and t !~ 'improvised musical' then found := private.add_category(found, 'music'); end if;
  if not talk and t ~ '\m(exhibit|exhibition|exhibitions|gallery|museum)\M' then found := private.add_category(found, 'exhibition'); end if;
  -- The description can say what the title does not: "the new public art exhibit ...".
  -- Only explicit phrases count, since "exhibition match" or a theatre venue are not exhibitions.
  if not talk and d ~ '(\m(new|special|permanent|traveling|public|art|photography|museum|gallery|opening)\s+(art\s+)?exhibit(ion|s)?\M|\mexhibit(ion)?\s+(opens|opening|runs|features|explores|celebrates|showcases|examines|presents|on view)\M)' then
    found := private.add_category(found, 'exhibition');
  end if;
  if t ~ '\m(comedy|improv|improvised|sketch|stand-?up|theat(er|re)|revue|art|arts|film|cinema|screening|dance|ballet|poetry|storytelling|cabaret|magic|circus|variety|mainstage|show|craft|sculpture|photograph\w*|architecture|culture|cultural)\M' then found := private.add_category(found, 'arts'); end if;
  if not talk and t ~ '\m(yoga|pilates|zumba|fitness|workout|run|5k|10k|marathon|tournament|basketball|football|soccer|volleyball|tennis|swim\w*|intramural|cycling|spin|hike|climbing|sailing|kayak\w*|athletic\w*|rec|recreation|hockey|baseball|softball|lacrosse|rugby|fencing|boxing|martial arts)\M' then found := private.add_category(found, 'sports'); end if;
  if not talk and t ~ '\m(wellness|meditation|mindful\w*|mental health|counseling|massage|self-care|healing|therapy|stress|sleep)\M' then found := private.add_category(found, 'wellness'); end if;
  if not talk and t ~ '\m(career|internship|recruit\w*|job|jobs|resume|r[eé]sum[eé]|networking|employer\w*|hiring|interview\w*|career fair|job fair|entrepreneur\w*|startup\w*|founder\w*|pitch)\M' then found := private.add_category(found, 'career'); end if;
  if t ~ '\m(mixer|party|social|hangout|reception|mingle|game night|trivia|open house|coffee hour|celebration|gala|meetup|meet-up|potluck|bonfire|picnic|retreat|fundrais\w*|festival|parade)\M' then found := private.add_category(found, 'social'); end if;

  -- Shows and games: performances, concerts, matches and tournaments to attend.
  if not talk and t ~ '\m(concert|orchestra|symphony|jazz|recital|choir|chorus|quartet|quintet|opera|musical|a cappella|acapella|taiko|open mic|show|showcase|performance|performances|comedy|stand-?up|improv|sketch|theat(er|re)|cabaret|circus|revue|ballet|game|games|match|vs|versus|tournament|championship|playoffs?)\M'
     and t !~ '\m(game night|board game|video game|game design|game theory)\M' then
    found := private.add_category(found, 'performance');
  end if;

  -- Play: things to join in with rather than watch or attend (games, escape rooms, attractions, hands-on nights).
  if not talk and t ~ '\m(game night|board games?|video games?|game show|arcade|escape rooms?|trivia|bingo|scavenger hunt|laser tag|bowling|mini golf|billiards|karaoke|paint(ing)? (and|&|n) sip|craft night|diy|make your own|hands-on|interactive|immersive|playground|playdate|play date|open play|carnival|amusement|haunted (house|trail)|corn maze|pumpkin patch|hayride|zoo|aquarium|ice skating|skating|rink|trampoline|puzzle|lego|virtual reality|vr|esports|e-sports)\M' then
    found := private.add_category(found, 'play');
  end if;

  -- Weaker signals only when nothing else matched.
  if cardinality(found) = 0 then
    if t ~ '\m(class|course|training|orientation|info session|information session|office hours|presentation|lab|study|studies|science|institute|forum|series|discussion|book club|rounds|consultation\w*|drop-in support)\M' then
      found := private.add_category(found, 'academic');
    elsif d ~ '\m(exhibit\w*|museum|gallery)\M' then found := private.add_category(found, 'exhibition');
    elsif d ~ '\m(restaurant week|culinary|cuisine|food and wine|wine pairings?|tasting menus?)\M' then found := private.add_category(found, 'food');
    elsif d ~ '\m(comedy|improv|theat(er|re))\M' then found := private.add_category(found, 'arts');
    elsif d ~ '\m(concert|orchestra|symphony|jazz)\M' then found := private.add_category(found, 'music');
    elsif d ~ '\m(lecture|seminar|colloquium|symposium|workshop|research)\M' then found := private.add_category(found, 'academic');
    elsif d ~ '\m(yoga|fitness|workout|tournament)\M' then found := private.add_category(found, 'sports');
    end if;
  end if;
  return case when cardinality(found) = 0 then array['other']::public.event_category[] else found end;
end;
$$;

update public.events set category = category;
