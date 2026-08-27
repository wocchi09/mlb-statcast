"""Fetch compact MLB standings and official season player statistics."""
from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timedelta, timezone
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


def player_rows(group: str, season: int, start: str | None = None, end: str | None = None) -> list[dict]:
    params = {
        "stats": "byDateRange" if start and end else "season", "group": group,
        "playerPool": "ALL", "season": season, "sportIds": 1,
        "limit": 5000, "hydrate": "team",
    }
    if start and end:
        params.update(startDate=start, endDate=end)
    payload = get("stats", **params)
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
            ["gamesPlayed", "plateAppearances", "atBats", "runs", "hits", "doubles", "triples", "homeRuns", "rbi", "baseOnBalls", "intentionalWalks", "hitByPitch", "sacFlies", "strikeOuts", "stolenBases", "avg", "obp", "slg", "ops", "babip"]
            if group == "hitting" else
            ["gamesPlayed", "gamesStarted", "wins", "losses", "era", "inningsPitched", "hits", "runs", "earnedRuns", "homeRuns", "baseOnBalls", "intentionalWalks", "hitBatsmen", "strikeOuts", "whip", "strikeoutsPer9Inn", "walksPer9Inn", "hitsPer9Inn", "homeRunsPer9", "saves", "saveOpportunities", "holds", "battersFaced"]
        )
        common.update({key: number(stat.get(key)) for key in keys})
        rows.append(common)
    return rows


def advanced_rows(group: str, season: int) -> dict[int, dict]:
    payload = get(
        "stats", stats="seasonAdvanced", group=group, playerPool="ALL",
        season=season, sportIds=1, limit=5000, hydrate="team",
    )
    result = {}
    for split in (payload.get("stats") or [{}])[0].get("splits", []):
        player_id = (split.get("player") or {}).get("id")
        stat = split.get("stat", {})
        if player_id:
            result[player_id] = {key: number(value) for key, value in stat.items()}
    return result


def innings_outs(value) -> int:
    if value is None:
        return 0
    raw = f"{float(value):.1f}"
    whole, fraction = raw.split(".")
    return int(whole) * 3 + min(int(fraction), 2)


def add_sabermetrics(hitters: list[dict], pitchers: list[dict], season: int) -> dict:
    hitting_advanced = advanced_rows("hitting", season)
    pitching_advanced = advanced_rows("pitching", season)
    woba_weights = {"bb": 0.69, "hbp": 0.72, "single": 0.88, "double": 1.247, "triple": 1.578, "hr": 2.031}
    league_num = league_den = 0.0
    for row in hitters:
        adv = hitting_advanced.get(row["id"], {})
        pa = row.get("plateAppearances") or 0
        hits = row.get("hits") or 0
        doubles = row.get("doubles") or 0
        triples = row.get("triples") or 0
        homers = row.get("homeRuns") or 0
        walks = row.get("baseOnBalls") or 0
        ibb = row.get("intentionalWalks") or 0
        hbp = row.get("hitByPitch") or 0
        denominator = (row.get("atBats") or 0) + walks - ibb + (row.get("sacFlies") or 0) + hbp
        numerator = (
            woba_weights["bb"] * (walks - ibb) + woba_weights["hbp"] * hbp
            + woba_weights["single"] * (hits - doubles - triples - homers)
            + woba_weights["double"] * doubles + woba_weights["triple"] * triples
            + woba_weights["hr"] * homers
        )
        row.update({
            "iso": number(adv.get("iso")) if adv.get("iso") is not None else round((row.get("slg") or 0) - (row.get("avg") or 0), 3),
            "bb_pct": round(100 * walks / pa, 1) if pa else None,
            "k_pct": round(100 * (row.get("strikeOuts") or 0) / pa, 1) if pa else None,
            "whiff_pct": round(100 * (adv.get("swingAndMisses") or 0) / adv["totalSwings"], 1) if adv.get("totalSwings") else None,
            "woba": round(numerator / denominator, 3) if denominator else None,
        })
        league_num += numerator
        league_den += denominator
    league_woba = league_num / league_den if league_den else 0.32
    for row in hitters:
        pa = row.get("plateAppearances") or 0
        row["wraa"] = round(((row["woba"] - league_woba) / 1.25) * pa, 1) if row.get("woba") is not None else None

    total_outs = total_er = total_component = 0.0
    for row in pitchers:
        adv = pitching_advanced.get(row["id"], {})
        bf = row.get("battersFaced") or 0
        outs = innings_outs(row.get("inningsPitched"))
        ip = outs / 3
        component = 13 * (row.get("homeRuns") or 0) + 3 * ((row.get("baseOnBalls") or 0) + (row.get("hitBatsmen") or 0)) - 2 * (row.get("strikeOuts") or 0)
        row.update({
            "k_pct": round(100 * (row.get("strikeOuts") or 0) / bf, 1) if bf else None,
            "bb_pct": round(100 * (row.get("baseOnBalls") or 0) / bf, 1) if bf else None,
            "k_bb_pct": round(100 * ((row.get("strikeOuts") or 0) - (row.get("baseOnBalls") or 0)) / bf, 1) if bf else None,
            "babip": number(adv.get("babip")),
            "whiff_pct": round(100 * adv["whiffPercentage"], 1) if adv.get("whiffPercentage") is not None else None,
            "fip_component": component / ip if ip else None,
        })
        total_outs += outs
        total_er += row.get("earnedRuns") or 0
        total_component += component
    league_ip = total_outs / 3
    league_era = 9 * total_er / league_ip if league_ip else 4.2
    fip_constant = league_era - total_component / league_ip if league_ip else 3.2
    fips = []
    for row in pitchers:
        component = row.pop("fip_component")
        row["fip"] = round(component + fip_constant, 2) if component is not None else None
        if row["fip"] is not None:
            fips.append((row["fip"], innings_outs(row.get("inningsPitched"))))
    league_fip = sum(value * outs for value, outs in fips) / sum(outs for _, outs in fips) if sum(outs for _, outs in fips) else league_era
    for row in pitchers:
        row["fip_index"] = round(100 * row["fip"] / league_fip) if row.get("fip") is not None else None
    return {
        "league_woba": round(league_woba, 3), "league_era": round(league_era, 2),
        "league_fip": round(league_fip, 2), "fip_constant": round(fip_constant, 3),
        "woba_scale": 1.25, "woba_weights": woba_weights,
    }


def standings(season: int) -> list[dict]:
    payload = get("standings", leagueId="103,104", season=season, standingsTypes="regularSeason", hydrate="team")
    rows = []
    for division in payload.get("records", []):
        for record in division.get("teamRecords", []):
            team = record.get("team", {})
            rows.append({
                "team_id": team.get("id"), "team": team.get("abbreviation"), "name": team.get("name"),
                "league": ((team.get("league") or {}).get("abbreviation") or
                           ("AL" if "American League" in (team.get("division") or {}).get("name", "") else "NL")),
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
    week_end = date.today()
    week_start = week_end - timedelta(days=6)
    hitters = player_rows("hitting", args.season)
    pitchers = player_rows("pitching", args.season)
    sabermetrics = add_sabermetrics(hitters, pitchers, args.season)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "season": args.season,
        "standings": standings(args.season),
        "hitters": hitters,
        "pitchers": pitchers,
        "sabermetrics": sabermetrics,
        "weekly": {
            "start_date": week_start.isoformat(), "end_date": week_end.isoformat(),
            "hitters": player_rows("hitting", args.season, week_start.isoformat(), week_end.isoformat()),
            "pitchers": player_rows("pitching", args.season, week_start.isoformat(), week_end.isoformat()),
        },
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(payload['standings'])} teams, {len(payload['hitters'])} hitters, {len(payload['pitchers'])} pitchers and weekly splits")


if __name__ == "__main__":
    main()
