"""Fetch compact MLB standings and official season player statistics."""
from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timezone
from pathlib import Path

import requests

BASE = "https://statsapi.mlb.com/api/v1"


def get(path: str, **params) -> dict:
    response = requests.get(f"{BASE}/{path}", params=params, timeout=90)
    response.raise_for_status()
    return response.json()


def number(value):
    if value in (None, "", "-.--", ".---", "-", "--"):
        return None
    try:
        return float(value) if "." in str(value) else int(value)
    except (TypeError, ValueError):
        return value


def player_rows(group: str, season: int) -> list[dict]:
    payload = get(
        "stats",
        stats="season",
        group=group,
        playerPool="ALL",
        season=season,
        sportIds=1,
        limit=5000,
        hydrate="team",
    )
    rows = []
    for split in (payload.get("stats") or [{}])[0].get("splits", []):
        stat, player, team = split.get("stat", {}), split.get("player", {}), split.get("team", {})
        common = {
            "id": player.get("id"), "name": player.get("fullName"),
            "team_id": team.get("id"), "team": team.get("abbreviation"),
            "team_name": team.get("name"),
            "position": (split.get("position") or {}).get("abbreviation"),
        }
        keys = (
            ["gamesPlayed", "plateAppearances", "atBats", "runs", "hits", "doubles", "triples", "homeRuns", "rbi", "baseOnBalls", "strikeOuts", "stolenBases", "avg", "obp", "slg", "ops", "babip"]
            if group == "hitting" else
            ["gamesPlayed", "gamesStarted", "wins", "losses", "era", "inningsPitched", "hits", "runs", "earnedRuns", "homeRuns", "baseOnBalls", "strikeOuts", "whip", "strikeoutsPer9Inn", "walksPer9Inn", "hitsPer9Inn", "homeRunsPer9", "saves", "saveOpportunities", "holds", "battersFaced"]
        )
        common.update({key: number(stat.get(key)) for key in keys})
        rows.append(common)
    return rows


def standings(season: int) -> list[dict]:
    payload = get("standings", leagueId="103,104", season=season, standingsTypes="regularSeason", hydrate="team")
    rows = []
    for division in payload.get("records", []):
        for record in division.get("teamRecords", []):
            team = record.get("team", {})
            rows.append({
                "team_id": team.get("id"), "team": team.get("abbreviation"), "name": team.get("name"),
                "league": (team.get("league") or {}).get("abbreviation"),
                "division": (team.get("division") or {}).get("name"),
                "rank": number(record.get("divisionRank")), "games": record.get("gamesPlayed"),
                "wins": record.get("wins"), "losses": record.get("losses"),
                "pct": number(record.get("winningPercentage")), "gb": record.get("divisionGamesBack"),
                "runs": record.get("runsScored"), "runs_allowed": record.get("runsAllowed"),
                "run_diff": record.get("runDifferential"), "streak": (record.get("streak") or {}).get("streakCode"),
            })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, default=date.today().year)
    parser.add_argument("--output", default="site/data/league.json")
    args = parser.parse_args()
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "season": args.season,
        "standings": standings(args.season),
        "hitters": player_rows("hitting", args.season),
        "pitchers": player_rows("pitching", args.season),
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(payload['standings'])} teams, {len(payload['hitters'])} hitters and {len(payload['pitchers'])} pitchers")


if __name__ == "__main__":
    main()
