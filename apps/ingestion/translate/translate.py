#!/usr/bin/env python3
"""Fill title_zh / location_zh / description_zh for upcoming events with Argos Translate,
a free offline English-to-Chinese model, so the site can show a fully Chinese page.

  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python3 translate.py --days 7 [--dry-run]

Only events that still lack a translation are touched. Rows that share the same title,
location and description (every date of a recurring event) are translated once and updated together.
"""
import argparse
import datetime
import json
import os
import re
import sys
import urllib.parse
import urllib.request

URL_OR_EMAIL = re.compile(r'(https?://\S+|www\.\S+|\S+@\S+\.\S+)')
CJK = '一-鿿'


def split_keep_links(text):
    """Text and links alternately; links are never translated."""
    return [(part, bool(URL_OR_EMAIL.fullmatch(part))) for part in URL_OR_EMAIL.split(text) if part]


def cjk_punctuation(text):
    """The model emits ASCII punctuation; use the full-width forms next to Chinese characters."""
    text = re.sub(f'(?<=[{CJK}]),\\s*', '，', text)
    text = re.sub(f'(?<=[{CJK}])\\.(?=\\s|$)', '。', text)
    text = re.sub(f'(?<=[{CJK}]);\\s*', '；', text)
    text = re.sub(f'(?<=[{CJK}]):\\s*', '：', text)
    text = re.sub(f'(?<=[{CJK}])\\?', '？', text)
    text = re.sub(f'(?<=[{CJK}])!', '！', text)
    text = re.sub(f'(?<=[{CJK}])\\s+(?=[{CJK}])', '', text)
    return text


def make_translator():
    import argostranslate.package as package
    import argostranslate.translate as translate
    installed = {(lang.code, t.to_lang.code) for lang in translate.get_installed_languages() for t in lang.translations_from}
    if not any(a == 'en' and b.startswith('zh') for a, b in installed):
        package.update_package_index()
        wanted = next(p for p in package.get_available_packages() if p.from_code == 'en' and p.to_code.startswith('zh'))
        package.install_from_path(wanted.download())
    cache = {}

    def run(text):
        text = text.strip()
        if not text or not re.search('[A-Za-z]', text):
            return text
        if text not in cache:
            cache[text] = translate.translate(text, 'en', 'zh')
        return cache[text]
    return run


def translate_text(run, text):
    """Line by line, with links left exactly as they were."""
    lines = []
    for line in text.split('\n'):
        out = ''.join(part if is_link else run(part) if part.strip() else part for part, is_link in split_keep_links(line))
        lines.append(cjk_punctuation(out))
    return '\n'.join(lines)


class Api:
    def __init__(self, url, key):
        self.url, self.headers = url.rstrip('/') + '/rest/v1/events', {'apikey': key, 'Authorization': 'Bearer ' + key}

    def call(self, query, method='GET', body=None):
        headers = {**self.headers, **({'Content-Type': 'application/json', 'Prefer': 'return=minimal'} if body else {})}
        request = urllib.request.Request(f'{self.url}?{query}', method=method, headers=headers,
                                         data=json.dumps(body).encode() if body is not None else None)
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response) if method == 'GET' else None

    def pending(self, days):
        now = datetime.datetime.now(datetime.timezone.utc)
        start, end = now - datetime.timedelta(hours=6), now + datetime.timedelta(days=days)
        rows, offset = [], 0
        while True:
            query = urllib.parse.urlencode({
                'select': 'title,location,description,title_zh,location_zh,description_zh', 'status': 'eq.published',
                'and': f'(start_time.gte.{start:%Y-%m-%dT%H:%M:%SZ},start_time.lt.{end:%Y-%m-%dT%H:%M:%SZ})',
                'order': 'start_time', 'limit': 1000, 'offset': offset})
            page = self.call(query)
            rows += page
            if len(page) < 1000:
                return [r for r in rows if r['title_zh'] is None or (r['location'] and r['location_zh'] is None)
                        or (r['description'] and r['description_zh'] is None)]
            offset += 1000

    def save(self, row, zh):
        def match(column):
            return f'{column}=is.null' if row[column] is None else f'{column}=eq.{urllib.parse.quote(row[column], safe="")}'
        self.call('&'.join(match(c) for c in ('title', 'location', 'description')), 'PATCH', zh)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--days', type=int, default=7)
    parser.add_argument('--dry-run', action='store_true', help='print translations instead of saving them')
    args = parser.parse_args()
    api = Api(os.environ['SUPABASE_URL'], os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ['SUPABASE_SECRET_KEY'])
    unique = {}
    for row in api.pending(args.days):
        unique.setdefault((row['title'], row['location'], row['description']), row)
    print(f'{len(unique)} events to translate', flush=True)
    run = make_translator()
    for i, row in enumerate(unique.values(), 1):
        zh = {'title_zh': translate_text(run, row['title'])}
        if row['location']:
            zh['location_zh'] = translate_text(run, row['location'])
        if row['description']:
            zh['description_zh'] = translate_text(run, row['description'])
        if args.dry_run:
            print(json.dumps(zh, ensure_ascii=False))
        else:
            api.save(row, zh)
        if i % 25 == 0:
            print(f'{i}/{len(unique)}', flush=True)
    print('done')


if __name__ == '__main__':
    sys.exit(main())
