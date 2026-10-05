#!/usr/bin/env python3
"""Fill title_zh and location_zh for upcoming events with DeepL's free API, so event lists read in Chinese.

  SUPABASE_URL=... SUPABASE_SECRET_KEY=... DEEPL_API_KEY=... python3 translate.py [--days 90] [--max-chars 100000] [--dry-run]

Each distinct title or location is translated once and saved to every event that shares it (all dates of a
recurring event, every event at the same venue). DeepL Free allows 500,000 characters a month: a run stops at
--max-chars and never spends the last 20,000 characters of the account's monthly quota.
"""
import argparse
import datetime
import json
import os
import re
import sys
import urllib.parse
import urllib.request

RESERVE = 20_000  # characters left untouched at the end of the month
BATCH = 50  # DeepL takes up to 50 texts per request


def deepl_url(key):
    """Free-plan keys end in ':fx' and use their own host."""
    return 'https://api-free.deepl.com/v2' if key.endswith(':fx') else 'https://api.deepl.com/v2'


def pending_texts(rows):
    """Distinct titles and locations that still lack Chinese, nearest events first."""
    titles, locations = {}, {}
    for row in rows:
        if row['title_zh'] is None and re.search('[A-Za-z]', row['title']):
            titles.setdefault(row['title'], None)
        if row['location'] and row['location_zh'] is None and re.search('[A-Za-z]', row['location']):
            locations.setdefault(row['location'], None)
    return list(titles), list(locations)


def within_budget(texts, budget):
    """The texts, in order, that fit in the character budget."""
    chosen = []
    for text in texts:
        if len(text) > budget:
            break
        chosen.append(text)
        budget -= len(text)
    return chosen


def request(url, headers, body=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={**headers, **({'Content-Type': 'application/json'} if data else {})})
    with urllib.request.urlopen(req, timeout=60) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


class DeepL:
    def __init__(self, key):
        self.url, self.headers = deepl_url(key), {'Authorization': f'DeepL-Auth-Key {key}'}

    def remaining(self):
        usage = request(f'{self.url}/usage', self.headers)
        return usage['character_limit'] - usage['character_count']

    def translate(self, texts):
        out = []
        for i in range(0, len(texts), BATCH):
            body = {'text': texts[i:i + BATCH], 'source_lang': 'EN', 'target_lang': 'ZH-HANS'}
            out += [t['text'] for t in request(f'{self.url}/translate', self.headers, body)['translations']]
        return out


class Events:
    def __init__(self, url, key):
        self.url, self.headers = url.rstrip('/') + '/rest/v1/events', {'apikey': key, 'Authorization': 'Bearer ' + key}

    def upcoming(self, days):
        now = datetime.datetime.now(datetime.timezone.utc)
        start, end = now - datetime.timedelta(hours=6), now + datetime.timedelta(days=days)
        rows, offset = [], 0
        while True:
            query = urllib.parse.urlencode({
                'select': 'title,location,title_zh,location_zh', 'status': 'eq.published', 'is_hidden': 'eq.false',
                # Events still running count too: a month-long exhibition started weeks ago.
                'and': f'(or(title_zh.is.null,location_zh.is.null),or(start_time.gte.{start:%Y-%m-%dT%H:%M:%SZ},end_time.gte.{now:%Y-%m-%dT%H:%M:%SZ}),start_time.lt.{end:%Y-%m-%dT%H:%M:%SZ})',
                'order': 'start_time', 'limit': 1000, 'offset': offset})
            page = request(f'{self.url}?{query}', self.headers)
            rows += page
            if len(page) < 1000:
                return rows
            offset += 1000

    def save(self, column, text, chinese):
        """Every event with this exact English text that has no Chinese for it yet."""
        query = f'{column}=eq.{urllib.parse.quote(text, safe="")}&{column}_zh=is.null'
        request(f'{self.url}?{query}', {**self.headers, 'Prefer': 'return=minimal'}, {f'{column}_zh': chinese}, 'PATCH')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--days', type=int, default=90)
    parser.add_argument('--max-chars', type=int, default=100_000)
    parser.add_argument('--dry-run', action='store_true', help='print translations instead of saving them')
    args = parser.parse_args()
    deepl = DeepL(os.environ['DEEPL_API_KEY'])
    events = Events(os.environ['SUPABASE_URL'], os.environ.get('SUPABASE_SECRET_KEY') or os.environ['SUPABASE_SERVICE_ROLE_KEY'])

    titles, locations = pending_texts(events.upcoming(args.days))
    budget = min(args.max_chars, deepl.remaining() - RESERVE)
    print(f'{len(titles)} titles and {len(locations)} locations need Chinese; budget {max(budget, 0)} characters', flush=True)
    for column, texts in (('title', titles), ('location', locations)):
        chosen = within_budget(texts, budget)
        budget -= sum(map(len, chosen))
        if not chosen:
            continue
        for text, chinese in zip(chosen, deepl.translate(chosen)):
            if args.dry_run:
                print(json.dumps({column: text, f'{column}_zh': chinese}, ensure_ascii=False))
            else:
                events.save(column, text, chinese)
        print(f'{column}: translated {len(chosen)} of {len(texts)}', flush=True)
    print('done')


if __name__ == '__main__':
    sys.exit(main())
