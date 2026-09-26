"""Export regular-season pitch data in compressed monthly shards for the browser."""
import argparse
import gzip
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import duckdb

FIELDS = ('game_date game_pk at_bat_number pitch_number pitcher batter pitch_type stand p_throws balls strikes '
          'release_speed pfx_x pfx_z release_pos_x release_pos_z plate_x plate_z sz_bot sz_top '
          'events description launch_speed estimated_ba_using_speedangle estimated_slg_using_speedangle '
          'estimated_woba_using_speedangle woba_value woba_denom home_team away_team inning_topbot').split()


def build(source, output):
    output.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.read_parquet(str(source)).create_view('raw')
    available = {r[0] for r in con.execute('DESCRIBE raw').fetchall()}
    required = {'game_date', 'game_pk', 'at_bat_number', 'pitch_number', 'game_type'}
    if not required <= available:
        raise ValueError(f'Missing required columns: {required - available}')
    expressions = []
    for field in FIELDS:
        if field not in available:
            expressions.append(f'NULL AS {field}')
        elif field == 'game_date':
            expressions.append("strftime(CAST(game_date AS DATE), '%Y-%m-%d') AS game_date")
        else:
            expressions.append(field)
    con.execute('CREATE VIEW pitches AS SELECT ' + ','.join(expressions) + " FROM raw WHERE game_type='R' QUALIFY row_number() OVER (PARTITION BY game_pk,at_bat_number,pitch_number ORDER BY game_date)=1")
    names_path = source.parent / 'player_names.json'
    names = json.loads(names_path.read_text('utf-8')) if names_path.exists() else {}
    manifest = {'version': 1, 'generated_at': datetime.now(timezone.utc).isoformat(),
                'source': 'Baseball Savant Statcast CSV', 'fields': FIELDS,
                'unavailable_fields': sorted(set(FIELDS) - available), 'shards': [], 'players': {}, 'pitch_types': [], 'teams': []}
    for role in ['pitcher', 'batter']:
        manifest['players'][role] = [{'id': r[0], 'name': names.get(str(r[0]), str(r[0]))} for r in con.execute(f'SELECT DISTINCT {role} FROM pitches WHERE {role} IS NOT NULL ORDER BY {role}').fetchall()]
    manifest['pitch_types'] = [r[0] for r in con.execute('SELECT DISTINCT pitch_type FROM pitches WHERE pitch_type IS NOT NULL ORDER BY pitch_type').fetchall()]
    manifest['teams'] = [r[0] for r in con.execute('SELECT DISTINCT home_team FROM pitches ORDER BY home_team').fetchall()]
    for (month,) in con.execute('SELECT DISTINCT substr(game_date,1,7) FROM pitches ORDER BY 1').fetchall():
        rows = con.execute('SELECT * FROM pitches WHERE starts_with(game_date,?) ORDER BY game_date,game_pk,at_bat_number,pitch_number', [month]).fetchall()
        payload = json.dumps(rows, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
        compressed = gzip.compress(payload, mtime=0)
        digest = hashlib.sha256(compressed).hexdigest()
        filename = f'{month}.json.gz'
        (output / filename).write_bytes(compressed)
        games = sorted({r[1] for r in rows})
        manifest['shards'].append({'file': filename, 'sha256': digest, 'start': rows[0][0], 'end': rows[-1][0], 'rows': len(rows), 'bytes': len(compressed), 'games': games})
    if not manifest['shards']:
        raise ValueError('No regular-season data')
    manifest['start'] = manifest['shards'][0]['start']
    manifest['end'] = manifest['shards'][-1]['end']
    manifest['rows'] = sum(x['rows'] for x in manifest['shards'])
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')), 'utf-8')
    print(f"Exported {manifest['rows']} pitches, {len(manifest['shards'])} shards, through {manifest['end']}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=Path('data/current-season.parquet'))
    parser.add_argument('--output', type=Path, default=Path('site/data/workbench'))
    args = parser.parse_args()
    build(args.source, args.output)
