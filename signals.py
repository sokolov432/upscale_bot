"""Pure, causal signal checks. This module never sends orders or messages."""
from dataclasses import dataclass
from decimal import Decimal
import math

SYMBOLS = {"AUD/USD": "AUD", "EUR/USD": "EUR", "GBP/USD": "GBP",
           "USD/JPY": "USDJPY", "USD/CHF": "USDCHF"}
INTERVAL = 300
PATTERN_VERSION = "ha_body_breaks_previous_wick_v2"


@dataclass(frozen=True)
class Bar:
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float | None = None


def closed_bars(data, now):
    if data.get("s") != "ok":
        raise ValueError("history_not_ok")
    fields = [data.get(k) for k in ("t", "o", "h", "l", "c")]
    if not all(isinstance(v, list) for v in fields):
        raise ValueError("missing_ohlc")
    if len({len(v) for v in fields}) != 1:
        raise ValueError("mismatched_ohlc_lengths")
    result, previous = [], None
    volumes = data.get("v", [])
    for i, (stamp, op, hi, lo, cl) in enumerate(zip(*fields)):
        if not isinstance(stamp, (int, float)) or not math.isfinite(stamp) or int(stamp) != stamp:
            raise ValueError("invalid_timestamp")
        stamp = int(stamp)
        if stamp % INTERVAL or previous is not None and stamp <= previous:
            raise ValueError("unordered_or_unaligned_history")
        previous = stamp
        prices = (op, hi, lo, cl)
        if not all(isinstance(v, (int, float)) and math.isfinite(v) and v > 0 for v in prices):
            raise ValueError("invalid_price")
        if lo > min(op, cl) or hi < max(op, cl) or lo > hi:
            raise ValueError("invalid_price_envelope")
        vol = volumes[i] if isinstance(volumes, list) and i < len(volumes) else None
        if not isinstance(vol, (int, float)) or not math.isfinite(vol) or vol < 0:
            vol = None
        if stamp + INTERVAL <= now:
            result.append(Bar(stamp, op, hi, lo, cl, vol))
    return result


def heikin_ashi(bars):
    result = []
    for bar in bars:
        close = (bar.open + bar.high + bar.low + bar.close) / 4
        op = (result[-1].open + result[-1].close) / 2 if result else (bar.open + bar.close) / 2
        result.append(Bar(bar.time, op, max(bar.high, op, close),
                          min(bar.low, op, close), close, bar.volume))
    return result


def price_pattern(ha):
    if len(ha) < 5:
        return None
    window = ha[-5:]
    if any(b.time - a.time != INTERVAL for a, b in zip(window, window[1:])):
        return None
    red = [b.close < b.open for b in window]
    green = [b.close > b.open for b in window]
    signal = window[-3:]
    # A higher wick alone is insufficient: each later HA body must CLOSE
    # beyond the previous candle's full wick. Equality is not a breakout.
    if (all(red[:2]) and all(green[2:])
            and signal[1].close > signal[0].high
            and signal[2].close > signal[1].high):
        return "long"
    if (all(green[:2]) and all(red[2:])
            and signal[1].close < signal[0].low
            and signal[2].close < signal[1].low):
        return "short"
    return None


def volume_blockers(bars, decision):
    if decision == "disabled_by_user":
        return []
    if decision != "native_volume":
        return ["volume_source_decision_pending"]
    if not any(b.volume is not None and b.volume > 0 for b in bars):
        return ["native_volume_unusable"]
    volumes = [b.volume for b in bars[-3:]]
    if len(volumes) != 3 or any(v is None for v in volumes):
        return ["signal_volume_missing"]
    return ["volumes_strictly_increasing"] if volumes[0] < volumes[1] < volumes[2] else []


def evaluate(bars, volume_decision, now, minimum_history=100, maximum_delay=5):
    if len(bars) < minimum_history:
        return {"signal": None, "price_pattern": None, "blockers": ["insufficient_warmup"]}
    ha = heikin_ashi(bars)
    direction = price_pattern(ha)
    blockers = volume_blockers(bars, volume_decision)
    closed_at = bars[-1].time + INTERVAL
    delay = now - closed_at
    if delay < 0 or delay > maximum_delay:
        blockers.append("outside_close_check_window")
    return {"signal": direction if not blockers else None, "price_pattern": direction,
            "pattern_version": PATTERN_VERSION,
            "ha_signal_candles": [dict(time=b.time, open=b.open, high=b.high,
                                       low=b.low, close=b.close) for b in ha[-3:]],
            "blockers": blockers, "bar_open_time": bars[-1].time,
            "bar_closed_time": closed_at, "check_delay_seconds": round(delay, 3),
            "real_close": bars[-1].close, "ha_close": ha[-1].close,
            "ha_open": ha[-1].open, "volumes": [b.volume for b in bars[-3:]]}


def stop_price(entry, side):
    entry = Decimal(str(entry))
    if entry <= 0 or side not in ("long", "short"):
        raise ValueError("invalid_entry_or_side")
    return entry * (Decimal("0.9995") if side == "long" else Decimal("1.0005"))


def next_check_time(now, offset=2):
    return (math.floor((now - offset) / INTERVAL) + 1) * INTERVAL + offset
