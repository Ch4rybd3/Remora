"""
The case timeline as a portrait figure, for a report.

`{{timeline_table}}` already lists every event in a table, and a table answers
"what happened" well. It answers "when, relative to everything else" not at all:
forty rows of equal height hide the difference between a burst of six events in
ninety seconds and a gap of three weeks, and that difference is usually the shape
of the incident.

So this draws the same events against time. A central vertical spine, events
alternating left and right of it, each one carrying its date, its time and its
title - nothing else, because a figure that tries to carry the detail stops being
readable at about the fourth event.

**Gaps are compressed, not dropped.** Spacing is proportional to the real
interval, which is the whole point, but an intrusion that dwells for six months
would put every event of the first afternoon on one invisible line. So an
interval beyond a threshold becomes a marked break on the spine, labelled with
the duration it stands for. The threshold is relative - four times the median
interval of this case - so a twenty-minute attack and a six-month dwell both read
correctly without anybody configuring anything.

The layout is separated from the drawing on purpose: where the events land and
where the breaks go is the part with decisions in it, and it is tested without
matplotlib in the way.
"""
from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import datetime

# ── Geometry, all in inches ───────────────────────────────────────────────────

#: Vertical room one event's card needs.
CARD_H = 0.34
#: Closest two consecutive events are ever drawn. They sit on opposite sides of
#: the spine, so same-side neighbours stay two steps - and a full card - apart.
MIN_STEP = 0.30
#: What the median interval of the case is drawn as. Everything scales from it.
MEDIAN_STEP = 0.52
#: Longest a single interval is drawn as before it becomes a break.
MAX_STEP = MEDIAN_STEP * 4
#: Height of a compressed gap, whatever duration it stands for.
BREAK_STEP = 0.62
#: Beyond this multiple of the median interval, a gap is compressed.
BREAK_FACTOR = 4.0

FIG_W    = 6.0
MARGIN_Y = 0.22
#: Tallest figure that still reads when Word fits it to a page.
MAX_H    = 8.4


@dataclass(frozen=True)
class Placed:
    """One event, positioned."""
    index: int
    #: Inches from the top of the drawing area.
    y:     float
    #: Which side of the spine the card sits on.
    left:  bool


@dataclass(frozen=True)
class Gap:
    """A compressed interval, drawn as a break on the spine."""
    y:     float
    label: str


@dataclass(frozen=True)
class Layout:
    placed:  list[Placed]
    gaps:    list[Gap]
    height:  float
    #: Events that did not fit and are not drawn. Said out loud in the figure.
    omitted: int


def format_duration(seconds: float) -> str:
    """
    A gap's duration, short enough to sit on a break marker.

    One unit and at most one subdivision: "3 d 4 h" rather than
    "3 days 4 hours 17 minutes". The number on a break says how much time was
    skipped, not when something happened.
    """
    seconds = max(int(seconds), 0)
    if seconds < 60:
        return f"{seconds} s"
    minutes, sec = divmod(seconds, 60)
    if minutes < 60:
        return f"{minutes} min"
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f"{hours} h {minutes} min" if minutes else f"{hours} h"
    days, hours = divmod(hours, 24)
    if days < 31:
        return f"{days} d {hours} h" if hours else f"{days} d"
    months, days = divmod(days, 30)
    return f"{months} mo {days} d" if days else f"{months} mo"


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def lay_out(timestamps: list[datetime]) -> Layout:
    """
    Where each event sits, and where the spine breaks.

    Expects `timestamps` sorted. The scale is derived from the case rather than
    fixed: the median interval is drawn at `MEDIAN_STEP`, so every other interval
    reads relative to what is normal *for this incident*.
    """
    count = len(timestamps)
    if count == 0:
        return Layout(placed=[], gaps=[], height=2 * MARGIN_Y + CARD_H, omitted=0)
    if count == 1:
        return Layout(placed=[Placed(0, MARGIN_Y, True)], gaps=[],
                      height=2 * MARGIN_Y + CARD_H, omitted=0)

    deltas = [
        max((timestamps[i + 1] - timestamps[i]).total_seconds(), 0.0)
        for i in range(count - 1)
    ]
    positive = [d for d in deltas if d > 0]
    median = _median(positive)

    if median <= 0:
        # Every event shares a timestamp, or there is only one distinct interval
        # repeated at zero. There is no distance to show, so show none.
        unit, threshold = 0.0, 0.0
    else:
        unit      = MEDIAN_STEP / median
        threshold = median * BREAK_FACTOR

    budget = MAX_H - 2 * MARGIN_Y - CARD_H

    def steps_for(scale: float) -> list[tuple[float, str | None]]:
        out: list[tuple[float, str | None]] = []
        for delta in deltas:
            if threshold and delta > threshold:
                out.append((BREAK_STEP, format_duration(delta)))
            else:
                out.append((min(max(delta * scale, MIN_STEP), MAX_STEP), None))
        return out

    # Shrink the scale until the figure fits a page. Breaks keep their height -
    # they already stand for a duration rather than measuring one - so it is the
    # proportional intervals that give way, which is the right order: a tight
    # burst drawn tighter still reads as a burst.
    steps = steps_for(unit)
    for _ in range(8):
        total = sum(step for step, _ in steps)
        if total <= budget or total <= 0:
            break
        unit *= max(0.25, budget / total)
        steps = steps_for(unit)

    placed: list[Placed] = []
    gaps:   list[Gap] = []
    y = MARGIN_Y
    omitted = 0

    for index in range(count):
        if y > MARGIN_Y + budget and index > 0:
            # Out of page. Everything after this is named as omitted rather than
            # quietly cut, and the annex table has all of it.
            omitted = count - index
            break
        placed.append(Placed(index=index, y=y, left=index % 2 == 0))
        if index < count - 1:
            step, label = steps[index]
            if label:
                # Centred on the empty band *below* this card, not on the step:
                # a step is measured from one card's top edge, so half of it
                # lands inside the card and the marker sat on the text.
                band = max(step - CARD_H, 0.0)
                gaps.append(Gap(y=y + CARD_H + band / 2, label=label))
            y += step

    height = y + CARD_H + MARGIN_Y
    return Layout(placed=placed, gaps=gaps, height=max(height, 1.0), omitted=omitted)


# ── Drawing ───────────────────────────────────────────────────────────────────

#: Print-friendly, and deliberately not the interface's palette: this ends up on
#: a client's page beside their own typography, so it stays quiet.
SPINE   = "#334155"   # slate-700
DOT     = "#0F2942"   # the deep navy the other report figures use
CARD_BG = "#F8FAFC"   # slate-50
CARD_ED = "#CBD5E1"   # slate-300
TXT_WHEN = "#475569"  # slate-600 - date and time
TXT_WHAT = "#0F172A"  # slate-900 - the title
TXT_GAP  = "#94A3B8"  # slate-400 - a break's duration

#: Where a card starts, measured from the spine.
CARD_OFFSET = 0.26
#: Never cut a title shorter than this - below it the figure says nothing.
TITLE_FLOOR = 8


def _fit_text(fig, ax, x: float, y: float, text: str, room: float, **style):
    """
    Draw `text`, cut to what actually fits in `room` inches.

    Measured rather than estimated from a character count. A count has to assume
    an average advance, and an incident title is as likely to be
    "Ransomware deployed across 14 hosts" as "svchost.exe -> 185.199.108.153:443";
    the estimate was wrong often enough that titles ran past their card and out
    of the figure.
    """
    drawn = ax.text(x, y, text, **style)
    if not text:
        return drawn

    renderer = fig.canvas.get_renderer()
    def width_of(label: str) -> float:
        drawn.set_text(label)
        return drawn.get_window_extent(renderer=renderer).width / fig.dpi

    if width_of(text) <= room:
        return drawn

    # Binary search the longest prefix that fits, with room for the ellipsis.
    low, high = TITLE_FLOOR, len(text)
    while low < high:
        middle = (low + high + 1) // 2
        if width_of(text[:middle].rstrip() + "…") <= room:
            low = middle
        else:
            high = middle - 1
    drawn.set_text(text[:low].rstrip() + "…")
    return drawn


def render_timeline_portrait(events: list) -> tuple[bytes, float] | None:
    """
    The figure, as PNG bytes and the width to embed it at.

    `events` need `event_ts` and `title`; anything else on them is ignored,
    because the figure carries when and what and nothing more. Returns None when
    there is nothing to draw, so the exporter can say so in words instead.
    """
    try:
        import matplotlib  # type: ignore
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt  # type: ignore
        from matplotlib.patches import FancyBboxPatch  # type: ignore

        ordered = sorted(
            [event for event in (events or []) if getattr(event, "event_ts", None)],
            key=lambda event: event.event_ts,
        )
        if not ordered:
            return None

        layout = lay_out([event.event_ts for event in ordered])

        fig, ax = plt.subplots(figsize=(FIG_W, layout.height))
        # The axes fills the figure, so one data unit is one inch. Without this
        # it fills matplotlib's default subplot box - about three quarters of
        # the figure - and every measurement in this module is off by that
        # factor: the page-height budget, the card widths, and the fitted titles
        # against the cards holding them.
        ax.set_position((0, 0, 1, 1))
        fig.canvas.draw()                    # a renderer, so text can be measured
        fig.patch.set_facecolor("#FFFFFF")
        ax.set_facecolor("#FFFFFF")
        ax.set_xlim(0, FIG_W)
        ax.set_ylim(layout.height, 0)        # y grows downward, like a timeline
        ax.axis("off")

        spine_x = FIG_W / 2
        # Dot to dot: a spine running past the first and last events would read
        # as a timeline that continues, which is the opposite of what it is.
        top     = (layout.placed[0].y if layout.placed else MARGIN_Y) + CARD_H / 2
        bottom  = (layout.placed[-1].y if layout.placed else MARGIN_Y) + CARD_H / 2
        ax.plot([spine_x, spine_x], [top, bottom],
                color=SPINE, linewidth=1.1, zorder=1, solid_capstyle="round")

        for gap in layout.gaps:
            # Two slashes across the spine: the break notation a reader already
            # knows from a cut axis, rather than a symbol they have to learn.
            for offset in (-0.045, 0.045):
                ax.plot([spine_x - 0.07, spine_x + 0.07],
                        [gap.y + offset + 0.035, gap.y + offset - 0.035],
                        color="#FFFFFF", linewidth=3.2, zorder=2)
                ax.plot([spine_x - 0.07, spine_x + 0.07],
                        [gap.y + offset + 0.035, gap.y + offset - 0.035],
                        color=SPINE, linewidth=1.0, zorder=3)
            ax.text(spine_x + 0.13, gap.y, gap.label,
                    color=TXT_GAP, fontsize=5.4, style="italic",
                    ha="left", va="center", zorder=4)

        for position in layout.placed:
            event = ordered[position.index]
            mid   = position.y + CARD_H / 2

            ax.plot([spine_x], [mid], marker="o", markersize=3.6,
                    color=DOT, zorder=4)

            direction = -1 if position.left else 1
            connector_from = spine_x + direction * 0.05
            connector_to   = spine_x + direction * CARD_OFFSET
            ax.plot([connector_from, connector_to], [mid, mid],
                    color=CARD_ED, linewidth=0.8, zorder=2)

            card_w = spine_x - CARD_OFFSET - 0.12
            card_x = (spine_x - CARD_OFFSET - card_w) if position.left \
                else (spine_x + CARD_OFFSET)
            ax.add_patch(FancyBboxPatch(
                (card_x, position.y), card_w, CARD_H,
                boxstyle="round,pad=0,rounding_size=0.03",
                facecolor=CARD_BG, edgecolor=CARD_ED, linewidth=0.5, zorder=3))

            align  = "right" if position.left else "left"
            text_x = (card_x + card_w - 0.07) if position.left else (card_x + 0.07)

            stamp = event.event_ts.strftime("%Y-%m-%d  %H:%M")
            title = str(getattr(event, "title", "") or "").strip()
            room  = card_w - 0.20

            ax.text(text_x, position.y + 0.11, stamp, color=TXT_WHEN,
                    fontsize=5.0, ha=align, va="center", zorder=4,
                    fontfamily="monospace")
            _fit_text(fig, ax, text_x, position.y + 0.235, title, room,
                      color=TXT_WHAT, fontsize=6.0, fontweight="bold",
                      ha=align, va="center", zorder=4)

        if layout.omitted:
            ax.text(spine_x, layout.height - MARGIN_Y / 2,
                    f"+ {layout.omitted} later event"
                    f"{'s' if layout.omitted > 1 else ''} - see the timeline annex",
                    color=TXT_GAP, fontsize=5.4, style="italic",
                    ha="center", va="center", zorder=4)

        buf = io.BytesIO()
        # No `bbox_inches="tight"`: it grows the canvas to fit anything that
        # overflows, which turns a too-long title into a wider figure instead of
        # a visible bug. The figure is the size it says it is.
        plt.savefig(buf, format="png", dpi=220, facecolor="#FFFFFF")
        plt.close(fig)
        buf.seek(0)
        return buf.read(), min(FIG_W, 6.0)

    except Exception:
        return None
