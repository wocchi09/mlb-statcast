"""Fetch and compact the current MLB season schedule for the static dashboard."""
from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

API = "https://statsapi.mlb.com/api/v1/schedule"


def person_name(value: dict | None) -> str | None:
    return (value or {}).get("fullName")


def normalize_game(game: dict) -> dict:
    teams = game.get("teams", {})
    linescore = game.get("linescore", {})
    decisions = game.get("decisions", {})

    def side(name: str) -> dict:
        entry = teams.get(name, {})
        team = entry.get("team", {})
        return {
            "id": team.get("id"),
            "name": team.get("name"),
            "score": entry.get("score"),
            "winner": entry.get("isWinner"),
            "probable_pitcher": person_name(entry.get("probablePitcher")),
        }

    innings = []
    for inning in linescore.get("innings", []):
        innings.append({
            "num": inning.get("num"),
            "away": (inning.get("away") or {}).get("runs"),
            "home": (inning.get("home") or {}).get("runs"),
        })

    return {
        "game_pk": game.get("gamePk"),
        "game_date": game.get("gameDate"),
        "status": game.get("status", {}).get("abstractGameState"),
        "detailed_state": game.get("status", {}).get("detailedState"),
        "inning": linescore.get("currentInning"),
        "inning_half": linescore.get("inningHalf"),
        "venue": (game.get("venue") or {}).get("name"),
        "away": side("away"),
        "home": side("home"),
        "innings": innings,
        "decisions": {
            "winner": person_name(decisions.get("winner")),
            "loser": person_name(decisions.get("loser")),
            "save": person_name(decisions.get("save")),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="site/data/schedule.json")
    parser.add_argument("--start")
    parser.add_argument("--end")
    args = parser.parse_args()

    today = date.today()
    start = args.start or f"{today.year}-03-01"
    end = args.end or (today + timedelta(days=7)).isoformat()
    response = requests.get(
        API,
        params={
            "sportId": 1,
            "startDate": start,
            "endDate": end,
            "hydrate": "linescore,team,probablePitcher,decisions,venue",
        },
        timeout=90,
    )
    response.raise_for_status()
    raw = response.json()
    dates = {
        item["date"]: [normalize_game(game) for game in item.get("games", [])]
        for item in raw.get("dates", [])
    }
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "start_date": start,
        "end_date": end,
        "dates": dates,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {sum(map(len, dates.values()))} games across {len(dates)} dates to {output}")


if __name__ == "__main__":
    main()
