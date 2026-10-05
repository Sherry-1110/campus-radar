import unittest
from translate import cjk_punctuation, split_keep_links


class Helpers(unittest.TestCase):
    def test_links_are_kept_apart_from_text(self):
        parts = split_keep_links('Join us at https://zoom.us/j/123 or mail a@b.org today')
        self.assertEqual([p for p, link in parts if link], ['https://zoom.us/j/123', 'a@b.org'])

    def test_full_width_punctuation_only_next_to_chinese(self):
        self.assertEqual(cjk_punctuation('葡萄牙的味道, 芝加哥.'), '葡萄牙的味道，芝加哥。')
        self.assertEqual(cjk_punctuation('Room 12, Floor 3.'), 'Room 12, Floor 3.')


if __name__ == '__main__':
    unittest.main()
