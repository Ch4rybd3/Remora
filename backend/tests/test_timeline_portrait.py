"""
The case timeline as a portrait figure.

`{{timeline_table}}` lists the events and answers "what happened". It answers
"when, relative to everything else" not at all - forty rows of equal height hide
the difference between six events in ninety seconds and a gap of three weeks,
which is usually the shape of the incident.

The figure draws them against time instead. These tests are about the layout
rather than the picture: where events land, where the spine breaks and what a
break is labelled are the decisions, and they are testable without rendering
anything.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

import pytest

from app.services import timeline_chart as chart

START = datetime(2026, 3, 14, 9, 0)


def at(*minutes: float) -> list[datetime]:
    return [START + timedelta(minutes=m) for m in minutes]


# ─── Durations ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("seconds,expected", [
    (0,                 "0 s"),
    (45,                "45 s"),
    (60,                "1 min"),
    (90,                "1 min"),
    (3600,              "1 h"),
    (3600 * 4 + 720,    "4 h 12 min"),
    (86400 * 3,         "3 d"),
    (86400 * 3 + 3600 * 4, "3 d 4 h"),
    (86400 * 65,        "2 mo 5 d"),
])
def test_a_gap_reads_as_one_duration_with_one_subdivision(seconds, expected):
    """
    "3 d 4 h", never "3 days 4 hours 17 minutes". The number on a break says how
    much was skipped, and it has to fit beside a 1 pt line.
    """
    assert chart.format_duration(seconds) == expected


# ─── Nothing to draw ──────────────────────────────────────────────────────────

def test_no_events_lays_out_to_nothing():
    layout = chart.lay_out([])

    assert layout.placed == []
    assert layout.height > 0, "a zero-height figure cannot be embedded"


def test_one_event_still_gets_a_position():
    assert len(chart.lay_out(at(0)).placed) == 1


# ─── The spine alternates ─────────────────────────────────────────────────────

def test_events_alternate_either_side_of_the_spine():
    sides = [position.left for position in chart.lay_out(at(0, 5, 10, 15)).placed]

    assert sides == [True, False, True, False]


def test_events_keep_the_order_they_were_given():
    placed = chart.lay_out(at(0, 5, 10)).placed

    assert [position.index for position in placed] == [0, 1, 2]
    assert [position.y for position in placed] == sorted(p.y for p in placed)


# ─── Distance is real ─────────────────────────────────────────────────────────

def test_a_longer_interval_is_drawn_taller():
    """The whole point. Equal spacing is what the annex table already does."""
    placed = chart.lay_out(at(0, 10, 11)).placed
    first_gap  = placed[1].y - placed[0].y
    second_gap = placed[2].y - placed[1].y

    assert first_gap > second_gap


def test_an_interval_is_drawn_roughly_in_proportion():
    """Twice the time, about twice the distance - within the scale's clamps."""
    placed = chart.lay_out(at(0, 10, 30)).placed
    short = placed[1].y - placed[0].y
    long  = placed[2].y - placed[1].y

    assert 1.6 < long / short < 2.4


def test_events_at_the_same_instant_are_still_apart():
    """
    Three events sharing a timestamp is normal in a triage - they came out of
    one log. Drawing them on one line would hide two of them.
    """
    placed = chart.lay_out(at(0, 0, 0)).placed

    assert len({round(position.y, 3) for position in placed}) == 3


def test_a_burst_never_collapses_below_the_minimum_step():
    """Two events a second apart must not overlap each other's cards."""
    placed = chart.lay_out(at(0, 1 / 60, 2 / 60, 1000)).placed

    assert placed[1].y - placed[0].y >= chart.MIN_STEP


def test_same_side_neighbours_clear_a_whole_card():
    """
    Consecutive events sit on opposite sides, so the one that can collide is
    two along - and two minimum steps have to leave a card's height between them.
    """
    assert 2 * chart.MIN_STEP > chart.CARD_H


# ─── Gaps are compressed, not dropped ─────────────────────────────────────────

def test_a_long_gap_becomes_a_marked_break():
    """
    Six months of dwell drawn to scale puts the whole first afternoon on one
    invisible line. The break keeps the afternoon readable and still says how
    long the silence was.
    """
    layout = chart.lay_out(at(0, 5, 10, 60 * 24 * 40, 60 * 24 * 40 + 5))

    assert len(layout.gaps) == 1
    assert "d" in layout.gaps[0].label or "mo" in layout.gaps[0].label


def test_a_break_is_labelled_with_the_duration_it_stands_for():
    layout = chart.lay_out(at(0, 10, 20, 20 + 60 * 24 * 3))

    assert layout.gaps[0].label == "3 d"


def test_a_steady_series_has_no_breaks():
    """
    The threshold is relative to this case, so a regular cadence - whatever the
    cadence - is never interrupted.
    """
    assert chart.lay_out(at(0, 60, 120, 180, 240)).gaps == []


def test_the_threshold_follows_the_case_rather_than_the_clock():
    """
    A twenty-minute attack and a six-month intrusion both read correctly, which
    a fixed threshold in hours cannot do.
    """
    fast = chart.lay_out(at(0, 1, 2, 30, 31))             # minutes
    slow = chart.lay_out(at(0, 1440, 2880, 43200, 44640))  # days

    assert len(fast.gaps) == 1
    assert len(slow.gaps) == 1


def test_a_break_sits_between_two_cards_not_on_one():
    """
    It sat on the card above it. A step is measured from a card's top edge, so
    half of it lands inside the card, and the marker with its label was drawn
    over the title.
    """
    layout = chart.lay_out(at(0, 10, 20, 20 + 60 * 24 * 3, 20 + 60 * 24 * 3 + 10))
    gap = layout.gaps[0]
    before = next(p for p in layout.placed if p.index == 2)
    after  = next(p for p in layout.placed if p.index == 3)

    assert before.y + chart.CARD_H <= gap.y <= after.y


# ─── It has to fit a page ─────────────────────────────────────────────────────

def test_a_long_case_is_squeezed_rather_than_run_off_the_page():
    layout = chart.lay_out(at(*[i * 60 for i in range(18)]))

    assert layout.height <= chart.MAX_H + 0.01
    assert layout.omitted == 0


def test_too_many_events_are_named_rather_than_quietly_cut():
    """
    Past a point no compression helps. Saying "+ 40 later events" and pointing at
    the annex is honest; a figure that silently stops at the twentieth is not.
    """
    layout = chart.lay_out(at(*[i * 60 for i in range(60)]))

    assert layout.omitted > 0
    assert len(layout.placed) + layout.omitted == 60
    assert layout.height <= chart.MAX_H + chart.CARD_H


# ─── The picture itself ───────────────────────────────────────────────────────

@dataclass
class Event:
    event_ts: datetime
    title:    str


def test_rendering_produces_an_image_and_a_width():
    events = [Event(ts, f"Event {i}") for i, ts in enumerate(at(0, 5, 10, 400))]

    result = chart.render_timeline_portrait(events)

    assert result is not None
    png, width = result
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    assert 0 < width <= 6.5


def test_nothing_to_draw_returns_nothing():
    """So the exporter can say so in words rather than embed an empty frame."""
    assert chart.render_timeline_portrait([]) is None


def test_an_event_with_no_timestamp_is_skipped_not_fatal():
    events = [Event(START, "Real"), Event(None, "Broken")]  # type: ignore[arg-type]

    assert chart.render_timeline_portrait(events) is not None


def test_a_title_too_long_for_its_card_is_cut_to_fit():
    """
    Measured against the card, not counted in characters: a title is as likely
    to be "Ransomware deployed" as "svchost.exe -> 185.199.108.153:443", and the
    estimate was wrong often enough that titles ran out of the figure.
    """
    events = [Event(ts, "x" * 400) for ts in at(0, 60)]

    result = chart.render_timeline_portrait(events)

    assert result is not None
