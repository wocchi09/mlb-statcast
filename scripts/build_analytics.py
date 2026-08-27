from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

import duckdb
import requests

EXCLUDED_AB = "'walk','intent_walk','hit_by_pitch','sac_fly','sac_bunt','catcher_interf'"
HITS = "'single','double','triple','home_run'"
SWINGS = "'swinging_strike','swinging_strike_blocked','foul','foul_tip','hit_into_play','foul_bunt','missed_bunt'"
WHIFFS = "'swinging_strike','swinging_strike_blocked','missed_bunt'"
CSW = "'called_strike','swinging_strike','swinging_strike_blocked','missed_bunt'"


def rows(con: duckdb.DuckDBPyConnection, sql: str) -> list[dict]:
    frame = con.sql(sql).df()
    return json.loads(frame.to_json(orient="records", date_format="iso"))


def player_names(ids: set[int], cache_path: Path) -> dict[str, str]:
    cached = json.loads(cache_path.read_text("utf-8")) if cache_path.exists() else {}
    missing = sorted(ids - {int(key) for key in cached})
    session = requests.Session()
    for offset in range(0, len(missing), 100):
        batch = missing[offset : offset + 100]
        response = session.get(
            "https://statsapi.mlb.com/api/v1/people",
            params={"personIds": ",".join(map(str, batch))},
            timeout=30,
        )
        response.raise_for_status()
        for person in response.json().get("people", []):
            cached[str(person["id"])] = person.get("fullName", str(person["id"]))
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cached, ensure_ascii=False, indent=2), "utf-8")
    return cached


def build(source: str, output: Path, name_cache: Path, merge_existing: bool = False) -> None:
    escaped_source = source.replace("'", "''")
    scan = f"read_parquet('{escaped_source}', union_by_name=true)"
    con = duckdb.connect()
    con.execute("SET threads=4")
    seasons = rows(con, f"""
        SELECT game_year season, count(*) pitches, count(DISTINCT game_pk) games,
          count(DISTINCT pitcher) pitchers, count(DISTINCT batter) batters,
          round(avg(release_speed),2) avg_velo, round(avg(release_spin_rate),0) avg_spin,
          round(avg(launch_speed),2) avg_ev, round(avg(launch_angle),2) avg_la,
          round(100*avg(CASE WHEN launch_speed IS NOT NULL THEN (launch_speed>=95)::INT END),2) hard_hit_pct,
          round(100*avg(CASE WHEN launch_speed_angle IS NOT NULL THEN (launch_speed_angle=6)::INT END),2) barrel_pct,
          round(100*sum(description IN ({WHIFFS}))/nullif(sum(description IN ({SWINGS})),0),2) whiff_pct,
          round(100*avg((description IN ({CSW}))::INT),2) csw_pct
        FROM {scan} GROUP BY game_year ORDER BY game_year
    """)
    batters = rows(con, f"""
        WITH a AS (SELECT game_year season,batter,events,launch_speed,launch_angle,
          launch_speed_angle,estimated_woba_using_speedangle FROM {scan}),
        s AS (SELECT season,batter,count(*) FILTER(events IS NOT NULL) pa,
          count(*) FILTER(events IS NOT NULL AND events NOT IN ({EXCLUDED_AB})) ab,
          sum(events IN ({HITS})) h,sum(events='double') doubles,sum(events='triple') triples,
          sum(events='home_run') hr,sum(events IN ('walk','intent_walk')) bb,
          sum(events IN ('strikeout','strikeout_double_play')) so,sum(events='hit_by_pitch') hbp,
          sum(events='sac_fly') sf,avg(launch_speed) ev,avg(launch_angle) la,
          avg(CASE WHEN launch_speed IS NOT NULL THEN (launch_speed>=95)::INT END) hardhit,
          avg(CASE WHEN launch_speed_angle IS NOT NULL THEN (launch_speed_angle=6)::INT END) barrel,
          avg(estimated_woba_using_speedangle) xwoba FROM a GROUP BY season,batter)
        SELECT *,round(h/nullif(ab,0),3) avg,
          round((h+bb+hbp)/nullif(ab+bb+hbp+sf,0),3) obp,
          round((h+doubles+2*triples+3*hr)/nullif(ab,0),3) slg,
          round(100*hardhit,1) hard_hit_pct,round(100*barrel,1) barrel_pct,
          round(ev,1) avg_ev,round(la,1) avg_la
        FROM s WHERE pa>=30 ORDER BY season DESC,pa DESC
    """)
    pitchers = rows(con, f"""
        SELECT game_year season,pitcher,any_value(player_name) AS "name",count(*) pitches,
          count(*) FILTER(events IS NOT NULL) bf,
          sum(events IN ('strikeout','strikeout_double_play')) so,
          sum(events IN ('walk','intent_walk')) bb,sum(events='home_run') hr,
          round(100*sum(events IN ('strikeout','strikeout_double_play'))/nullif(count(*) FILTER(events IS NOT NULL),0),1) k_pct,
          round(100*sum(events IN ('walk','intent_walk'))/nullif(count(*) FILTER(events IS NOT NULL),0),1) bb_pct,
          round(avg(release_speed),1) velo,round(avg(release_spin_rate),0) spin,
          round(100*sum(description IN ({WHIFFS}))/nullif(sum(description IN ({SWINGS})),0),1) whiff_pct,
          round(100*avg((description IN ({CSW}))::INT),1) csw_pct,
          round(avg(estimated_woba_using_speedangle),3) xwoba
        FROM {scan} GROUP BY game_year,pitcher HAVING count(*)>=100
        ORDER BY season DESC,pitches DESC
    """)
    pitches = rows(con, f"""
        SELECT game_year season,pitch_type,any_value(pitch_name) pitch_name,count(*) pitches,
          round(100*count(*)/sum(count(*)) OVER(PARTITION BY game_year),2) usage_pct,
          round(avg(release_speed),1) velo,round(avg(release_spin_rate),0) spin,
          round(avg(pfx_x)*12,1) hbreak,round(avg(pfx_z)*12,1) vbreak,
          round(100*sum(description IN ({WHIFFS}))/nullif(sum(description IN ({SWINGS})),0),1) whiff_pct
        FROM {scan} WHERE pitch_type IS NOT NULL GROUP BY game_year,pitch_type ORDER BY game_year,pitches DESC
    """)
    daily = rows(con, f"""
        SELECT game_date::DATE date,count(*) pitches,count(DISTINCT game_pk) games,
          round(avg(release_speed),2) velo,round(avg(launch_speed),2) ev,
          round(100*avg(CASE WHEN launch_speed>=95 THEN 1 ELSE 0 END),2) hard_hit_pct
        FROM {scan} WHERE game_date::DATE >= current_date-INTERVAL 400 DAY GROUP BY game_date::DATE ORDER BY game_date::DATE
    """)
    quality = rows(con, f"""
        SELECT game_year season,count(*) row_count,
          round(100*avg((pitch_type IS NULL)::INT),2) pitch_type_missing,
          round(100*avg((release_speed IS NULL)::INT),2) velo_missing,
          round(100*avg((plate_x IS NULL OR plate_z IS NULL)::INT),2) location_missing,
          round(100*avg(CASE WHEN description='hit_into_play' THEN (launch_speed IS NULL)::INT END),2) ev_missing_on_contact
        FROM {scan} GROUP BY game_year ORDER BY game_year
    """)
    ids = {int(item["batter"]) for item in batters if item.get("batter")}
    names = player_names(ids, name_cache)
    for item in batters:
        item["name"] = names.get(str(item["batter"]), str(item["batter"]))
    payload = {"generated_at": date.today().isoformat(), "seasons": seasons, "batters": batters,
               "pitchers": pitchers, "pitch_types": pitches, "daily": daily, "quality": quality}
    if merge_existing and output.exists():
        previous = json.loads(output.read_text("utf-8"))
        new_seasons = {item["season"] for item in seasons}
        for key in ("seasons", "batters", "pitchers", "pitch_types", "quality"):
            payload[key] = [item for item in previous.get(key, []) if item.get("season") not in new_seasons] + payload[key]
        new_dates = {item["date"] for item in daily}
        payload["daily"] = [item for item in previous.get("daily", []) if item.get("date") not in new_dates] + daily
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), "utf-8")
    summary = {"generated_at": payload["generated_at"], "seasons": payload["seasons"]}
    output.with_name("analytics-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, separators=(",", ":")), "utf-8"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="../data/export/drive-quarters/*.parquet")
    parser.add_argument("--output", default="site/data/analytics.json", type=Path)
    parser.add_argument("--name-cache", default="data/player_names.json", type=Path)
    parser.add_argument("--merge-existing", action="store_true")
    args = parser.parse_args()
    build(args.source, args.output, args.name_cache, args.merge_existing)
