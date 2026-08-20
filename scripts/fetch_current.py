from __future__ import annotations

import argparse
import time
from datetime import date, timedelta
from pathlib import Path

import duckdb
import pandas as pd
from pybaseball import statcast


def fetch(start: date, end: date, output: Path) -> None:
    frames = []
    cursor = start
    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=13), end)
        for attempt in range(3):
            try:
                frame = statcast(cursor.isoformat(), chunk_end.isoformat())
                if not frame.empty:
                    frames.append(frame)
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2 ** (attempt + 1))
        cursor = chunk_end + timedelta(days=1)
    result = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    output.parent.mkdir(parents=True, exist_ok=True)
    with duckdb.connect() as con:
        con.register("current_statcast", result)
        con.execute(f"COPY current_statcast TO '{output.as_posix()}' (FORMAT PARQUET, COMPRESSION ZSTD)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=date.fromisoformat, default=date(date.today().year, 3, 1))
    parser.add_argument("--end", type=date.fromisoformat, default=date.today() - timedelta(days=1))
    parser.add_argument("--output", type=Path, default=Path("data/current-season.parquet"))
    args = parser.parse_args()
    fetch(args.start, args.end, args.output)
