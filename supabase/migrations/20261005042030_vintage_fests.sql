-- "Vintage" alone names concerts and shows too; only vintage markets, fairs and sales are fests.

create or replace function private.classify_categories(p_title text, p_description text, p_primary public.event_category)
returns public.event_category[]
language plpgsql immutable set search_path = ''
as $$
declare
  t text := lower(coalesce(p_title, ''));
  d text := lower(left(coalesce(p_description, ''), 300));
  -- Keep only what a source itself said (music, arts, sports, wellness, career, academic). Everything else is
  -- worked out from the text again; a source's "social" label covers receptions and open houses, not parties.
  found public.event_category[] := case when p_primary in ('music', 'arts', 'sports', 'wellness', 'career', 'academic') then array[p_primary] else '{}' end;
  -- Talks, seminars and info sessions are about a topic: "market research" is not a market.
  talk boolean := t ~ '\m(lecture|seminar|colloquium|symposium|conference|grand rounds|didactic|journal club|thesis|dissertation|defense|research|book talk|talk|panel|workshop|webinar|m&m|info session|information session|orientation)\M';
  fest boolean;
begin
  if talk then
    found := private.add_category(found, 'academic');
  end if;

  -- Fests: markets, fairs and festivals with many stalls or a neighbourhood crowd (not career or college fairs).
  fest := not talk
    and (t ~ '\m(market|markets|marketplace|bazaar|flea|swap meet|pop-?up shop|vintage (market|fair|sale|pop-?up|show)|thrift|fair|fairs|fest|fests|festival|festivals|christkindlmarket|block party|parade|art walk)\M' or t ~ '[a-z]fest\M')
    and t !~ '\m(career|job|jobs|internship|graduate|college|resource|research|study abroad|benefits|health|wellness|volunteer) (fair|fairs|expo)\M';
  if fest then
    found := private.add_category(found, 'market');
  end if;

  if t ~ '\m(food tour|tasting|tastings|brunch|breakfast|lunch|dinner|buffet|pizza|cooking|baking|wine|beer|food truck|taco|burger|ramen|dessert|bbq|restaurant week)\M'
     and t !~ '\m(comedy|improv)\M' then
    -- A lunch or dinner that hosts a talk series is an academic event.
    found := private.add_category(found,
      (case when d ~ '\m(lecture|talk series|research|faculty|seminar)\M' then 'academic' else 'food' end)::public.event_category);
  end if;

  if t ~ '\m(concert|concerts|orchestra|symphony|jazz|recital|choir|chorus|quartet|quintet|band|music|musical|opera|karaoke|open mic|singer|songwriter|taiko|a cappella|acapella|ensemble|philharmonic)\M'
     and t !~ 'improvised musical' then found := private.add_category(found, 'music'); end if;

  if not talk and t ~ '\m(exhibit|exhibition|exhibitions|gallery|museum)\M' then found := private.add_category(found, 'exhibition'); end if;
  -- The description can say what the title does not: "the new public art exhibit ...".
  if not talk and d ~ '(\m(new|special|permanent|traveling|public|art|photography|museum|gallery|opening)\s+(art\s+)?exhibit(ion|s)?\M|\mexhibit(ion)?\s+(opens|opening|runs|features|explores|celebrates|showcases|examines|presents|on view)\M)' then
    found := private.add_category(found, 'exhibition');
  end if;
  if t ~ '\m(comedy|improv|improvised|sketch|stand-?up|theat(er|re)|revue|art|arts|film|films|cinema|screening|movie|dance|ballet|poetry|storytelling|cabaret|burlesque|magic|circus|variety|mainstage|show|play|plays|drama|craft|sculpture|photograph\w*|architecture|culture|cultural)\M'
     and t !~ '\m(open play|playground|play date|playdate|world of play)\M' then found := private.add_category(found, 'arts'); end if;

  if not talk and t ~ '\m(yoga|pilates|zumba|fitness|workout|run|5k|10k|marathon|tournament|basketball|football|soccer|volleyball|tennis|swim\w*|intramural|cycling|spin|hike|hiking|climbing|sailing|kayak\w*|athletic\w*|rec|recreation|hockey|baseball|softball|lacrosse|rugby|fencing|boxing|martial arts|wrestling|golf|vs|versus|game day|tailgate|walk for)\M' then found := private.add_category(found, 'sports'); end if;
  if not talk and t ~ '\m(wellness|meditation|mindful\w*|massage|self-care|healing|sound bath|breathwork)\M' then found := private.add_category(found, 'wellness'); end if;
  if not talk and t ~ '\m(career|internship|recruit\w*|job|jobs|resume|r[eé]sum[eé]|networking|employer\w*|hiring|interview\w*|entrepreneur\w*|startup\w*|founder\w*|pitch)\M' then found := private.add_category(found, 'career'); end if;

  -- Activities: things to go and do (games, tours, cruises, attractions, hands-on nights, tastings and brunches).
  if not talk and (
       t ~ '\m(game night|board games?|video games?|game show|arcade|escape rooms?|trivia|bingo|scavenger hunt|laser tag|bowling|mini golf|billiards|karaoke|paint(ing)? (and|&|n) sip|craft night|diy|make your own|hands-on|interactive|immersive|playground|playdate|play date|open play|world of play|carnival|amusement|haunted|corn maze|pumpkin patch|hayride|zoo|aquarium|ice skating|skating|rink|trampoline|puzzle|lego|virtual reality|vr|esports|e-sports|cruise|cruises|boat ride|sightseeing|greeter|pottery|cooking class|candle making)\M'
       or t ~ '\m(walking|boat|bus|bike|architecture|river|food|ghost|haunted|city|neighborhood|history|historic|garden|night|trolley|kayak|lake|guided|pub|brewery) tours?\M'
       or (not fest and t ~ '\m(food tour|tasting|tastings|brunch|tea experience|wine flight|cocktail class)\M'))
     and t !~ '\m(course|courses|teaching|curriculum|tools|materials|virtual tour of)\M' then
    found := private.add_category(found, 'play');
  end if;

  -- Parties: going out and meeting people.
  if not talk and t ~ '\m(party|parties|mixer|mixers|social|socials|mingle|hangout|dj|dance night|dance party|rave|ball|gala|prom|bar crawl|pub crawl|crawl|happy hour|nightlife|after ?party|silent disco|disco|club night|homecoming)\M'
     and t !~ '\m(social (work|justice|science|sciences|media|policy|impact|determinants|security|psychology))\M' then
    found := private.add_category(found, 'social');
  end if;

  -- Weaker signals only when nothing else matched.
  if cardinality(found) = 0 then
    if t ~ '\m(class|course|training|orientation|info session|information session|office hours|presentation|lab|study|studies|science|institute|forum|series|discussion|book club|rounds|consultation\w*|drop-in support)\M' then
      found := private.add_category(found, 'academic');
    elsif d ~ '\m(exhibit\w*|museum|gallery)\M' then found := private.add_category(found, 'exhibition');
    elsif d ~ '\m(restaurant week|culinary|cuisine|food and wine|wine pairings?|tasting menus?)\M' then found := private.add_category(found, 'food');
    elsif d ~ '\m(comedy|improv|theat(er|re)|play by|playwright|stage)\M' then found := private.add_category(found, 'arts');
    elsif d ~ '\m(concert|orchestra|symphony|jazz)\M' then found := private.add_category(found, 'music');
    elsif d ~ '\m(lecture|seminar|colloquium|symposium|workshop|research)\M' then found := private.add_category(found, 'academic');
    elsif d ~ '\m(yoga|fitness|workout|tournament)\M' then found := private.add_category(found, 'sports');
    end if;
  end if;
  return case when cardinality(found) = 0 then array['other']::public.event_category[] else found end;
end;
$$;

update public.events set category = category where lower(title) ~ 'vintage';
