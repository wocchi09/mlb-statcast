import gzip
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import duckdb
from build_workbench import build


class ExportTests(unittest.TestCase):
    def test_dates_duplicates_and_optional_columns(self):
        for date_type in ['VARCHAR', 'TIMESTAMP']:
            with self.subTest(date_type=date_type), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                con = duckdb.connect()
                con.execute(f"CREATE TABLE sample(game_date {date_type},game_pk INTEGER,at_bat_number INTEGER,pitch_number INTEGER,game_type VARCHAR)")
                con.execute("INSERT INTO sample VALUES ('2026-06-01',1,1,1,'R'),('2026-06-01',1,1,1,'R'),('2026-06-02',2,1,1,'S')")
                con.sql('SELECT * FROM sample').write_parquet(str(root / 'sample.parquet'))
                build(root / 'sample.parquet', root / 'out')
                manifest = json.loads((root / 'out/manifest.json').read_text('utf-8'))
                self.assertEqual(manifest['rows'], 1)
                self.assertIn('estimated_slg_using_speedangle', manifest['unavailable_fields'])
                chunk = manifest['shards'][0]
                payload = (root / 'out' / chunk['file']).read_bytes()
                self.assertEqual(hashlib.sha256(payload).hexdigest(), chunk['sha256'])
                rows = json.loads(gzip.decompress(payload))
                self.assertEqual(rows[0][0], '2026-06-01')
                self.assertIsNone(rows[0][manifest['fields'].index('release_speed')])


if __name__ == '__main__':
    unittest.main()
