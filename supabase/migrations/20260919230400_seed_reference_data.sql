-- Reference data: the launch school and the initial event sources.

insert into public.schools (slug, name, email_domain)
values ('northwestern', 'Northwestern University', 'northwestern.edu')
on conflict (slug) do nothing;

insert into public.sources (name, type, url) values
  ('PlanItPurple', 'calendar_scrape', 'https://planitpurple.northwestern.edu/'),
  ('Bienen School of Music', 'calendar_scrape', 'https://www.music.northwestern.edu/events/calendar'),
  ('Wirtz Center', 'calendar_scrape', 'https://wirtz.northwestern.edu/'),
  ('NU Recreation GroupX', 'calendar_scrape', 'https://nurecreation.com/sports/groupx/schedule'),
  ('Eventbrite', 'eventbrite_api', 'https://www.eventbrite.com/'),
  ('Instagram (curated)', 'social_manual', null),
  ('Xiaohongshu (curated)', 'social_manual', null),
  ('Chicago roundups (curated)', 'social_manual', 'https://www.choosechicago.com/'),
  ('User submission', 'user_upload', null)
on conflict (name) do nothing;
