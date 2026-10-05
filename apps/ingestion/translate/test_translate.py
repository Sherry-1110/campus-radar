import unittest
from translate import deepl_url, pending_texts, unwrap, within_budget


class Helpers(unittest.TestCase):
    def test_free_keys_use_the_free_host(self):
        self.assertEqual(deepl_url('abc:fx'), 'https://api-free.deepl.com/v2')
        self.assertEqual(deepl_url('abc'), 'https://api.deepl.com/v2')

    def test_each_missing_title_and_location_is_asked_for_once(self):
        rows = [
            {'title': 'Jazz Night', 'title_zh': None, 'location': 'Galvin Recital Hall', 'location_zh': None},
            {'title': 'Jazz Night', 'title_zh': None, 'location': 'Galvin Recital Hall', 'location_zh': None},
            {'title': 'Art Fair', 'title_zh': '艺术博览会', 'location': None, 'location_zh': None},
            {'title': '2026', 'title_zh': None, 'location': '1999 Campus Dr', 'location_zh': '1999 校园路'},
        ]
        self.assertEqual(pending_texts(rows), (['Jazz Night'], ['Galvin Recital Hall']))

    def test_budget_keeps_order_and_stops_at_the_first_text_that_does_not_fit(self):
        self.assertEqual(within_budget(['aaaa', 'bb', 'cccc', 'd'], 7), ['aaaa', 'bb'])
        self.assertEqual(within_budget(['aaaa'], 0), [])

    def test_quotes_around_a_whole_name_are_dropped_unless_the_english_had_them(self):
        self.assertEqual(unwrap('The Night of 1,000 Jack-o’-Lanterns', '“千盏南瓜灯之夜”'), '千盏南瓜灯之夜')
        self.assertEqual(unwrap('“Dead Girl’s Quinceañera”', '“死去女孩的成人礼”'), '“死去女孩的成人礼”')
        self.assertEqual(unwrap('Stars & Garters', '“星与吊带”剧院'), '“星与吊带”剧院')


if __name__ == '__main__':
    unittest.main()
