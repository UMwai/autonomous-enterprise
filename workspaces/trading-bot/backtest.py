"""Historical backtesting script for the RSI+MACD+Volume strategy.

This script:
  1) Downloads historical OHLCV candles from Binance (via ccxt)
  2) Runs the existing strategy (strategy.py) on the candle history
  3) Simulates paper trades using the existing risk rules (risk_manager.py)
  4) Reports basic performance metrics and can optionally save a JSON summary
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import ccxt
import numpy as np

from config import load_config
from models import Candle, Position
from risk_manager import RiskManager
from strategy import RsiMacdVolumeStrategy
from utils import setup_logging

try:
    from ccxt.base.errors import ExchangeNotAvailable
except Exception:  # pragma: no cover - defensive for older ccxt
    ExchangeNotAvailable = Exception  # type: ignore[misc,assignment]


SECONDS_PER_YEAR = 365 * 24 * 60 * 60


@dataclass(frozen=True, slots=True)
class ClosedTrade:
    symbol: str
    entry_timestamp_ms: int
    exit_timestamp_ms: int
    entry_price: float
    exit_price: float
    amount: float
    pnl: float
    reason: str

    @property
    def is_win(self) -> bool:
        return self.pnl > 0


def _timeframe_to_seconds(timeframe: str) -> int:
    tf = timeframe.strip()
    if not tf:
        raise ValueError("timeframe cannot be empty")
    num_part = ""
    unit_part = ""
    for ch in tf:
        if ch.isdigit():
            if unit_part:
                raise ValueError(f"Invalid timeframe '{timeframe}'")
            num_part += ch
        else:
            unit_part += ch
    if not num_part or not unit_part:
        raise ValueError(f"Invalid timeframe '{timeframe}'")

    n = int(num_part)
    unit = unit_part.lower()
    if unit == "m":
        return n * 60
    if unit == "h":
        return n * 60 * 60
    if unit == "d":
        return n * 60 * 60 * 24
    if unit == "w":
        return n * 60 * 60 * 24 * 7
    raise ValueError(f"Unsupported timeframe unit '{unit_part}' (expected m/h/d/w)")


def _parse_datetime_utc(value: str, *, is_end: bool) -> datetime:
    raw = value.strip()
    if not raw:
        raise ValueError("Empty datetime value")

    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"

    # Date-only: YYYY-MM-DD
    if len(raw) == 10 and raw[4] == "-" and raw[7] == "-":
        dt = datetime.fromisoformat(raw).replace(tzinfo=UTC)
        if is_end:
            return dt + timedelta(days=1) - timedelta(milliseconds=1)
        return dt

    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    else:
        dt = dt.astimezone(UTC)
    return dt


def _to_ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def _from_ms(ts_ms: int) -> datetime:
    return datetime.fromtimestamp(ts_ms / 1000, tz=UTC)


def _fetch_ohlcv_history(
    exchange: ccxt.Exchange,
    symbol: str,
    timeframe: str,
    start_ms: int,
    end_ms: int,
    *,
    limit: int = 1000,
    verbose: bool = False,
) -> list[Candle]:
    """Fetch OHLCV candles inclusive of [start_ms, end_ms]."""

    timeframe_ms = _timeframe_to_seconds(timeframe) * 1000
    since = max(0, start_ms)
    out: list[Candle] = []
    last_ts: int | None = None

    while True:
        rows = exchange.fetch_ohlcv(symbol, timeframe=timeframe, since=since, limit=limit)
        if not rows:
            break

        for ts, o, h, l, c, v in rows:
            ts_i = int(ts)
            if last_ts is not None and ts_i <= last_ts:
                continue
            last_ts = ts_i
            if ts_i < start_ms:
                continue
            if ts_i > end_ms:
                break
            out.append(Candle(ts_i, float(o), float(h), float(l), float(c), float(v)))

        if verbose:
            if out:
                sys.stderr.write(
                    f"\rFetched {symbol} {len(out)} candles "
                    f"({datetime.fromtimestamp(out[0].timestamp_ms/1000, tz=UTC).date()} -> "
                    f"{datetime.fromtimestamp(out[-1].timestamp_ms/1000, tz=UTC).date()})"
                )
                sys.stderr.flush()

        next_since = int(rows[-1][0]) + timeframe_ms
        if next_since <= since:
            next_since = since + timeframe_ms
        since = next_since
        if since > end_ms:
            break

        # Respect rate limits even if enableRateLimit is disabled.
        if getattr(exchange, "rateLimit", None):
            time.sleep(max(0.0, float(exchange.rateLimit) / 1000.0))

    if verbose:
        sys.stderr.write("\n")

    return out


def _init_exchange(exchange_id: str, *, timeout_ms: int) -> tuple[ccxt.Exchange, str]:
    """Create a ccxt exchange instance and load markets.

    Binance's global API (`binance`) is not available in some regions (HTTP 451).
    When that happens, this helper falls back to `binanceus` automatically.
    """

    exchange_id = exchange_id.strip().lower()
    if not exchange_id:
        raise ValueError("exchange_id cannot be empty")

    def _build(ex_id: str) -> ccxt.Exchange:
        ex_class = getattr(ccxt, ex_id)
        return ex_class(
            {
                "enableRateLimit": True,
                "timeout": timeout_ms,
                "options": {"defaultType": "spot"},
            }
        )

    exchange = _build(exchange_id)
    try:
        exchange.load_markets()
        return exchange, exchange_id
    except ExchangeNotAvailable as e:
        message = str(e)
        if exchange_id == "binance" and ("451" in message or "restricted location" in message.lower()):
            exchange = _build("binanceus")
            exchange.load_markets()
            return exchange, "binanceus"
        raise


def _portfolio_snapshot(cash_usdt: float, positions: dict[str, Position], prices: dict[str, float]) -> float:
    equity = cash_usdt
    for sym, pos in positions.items():
        equity += pos.amount * float(prices.get(sym, pos.entry_price))
    return float(equity)


def _paper_buy(cash_usdt: float, quote_to_spend: float, price: float, fee_pct: float) -> tuple[float, float, float]:
    """Return (new_cash_usdt, base_amount, fee_quote)."""

    quote_to_spend = min(quote_to_spend, cash_usdt)
    if quote_to_spend <= 0:
        raise ValueError("quote_to_spend must be > 0")

    quote_to_spend = min(quote_to_spend, cash_usdt / (1 + fee_pct))
    base_amount = quote_to_spend / price
    fee_quote = quote_to_spend * fee_pct
    new_cash = cash_usdt - quote_to_spend - fee_quote
    return float(new_cash), float(base_amount), float(fee_quote)


def _paper_sell(cash_usdt: float, base_amount: float, price: float, fee_pct: float) -> tuple[float, float]:
    """Return (new_cash_usdt, fee_quote)."""

    gross = base_amount * price
    fee_quote = gross * fee_pct
    net = gross - fee_quote
    return float(cash_usdt + net), float(fee_quote)


def _compute_metrics(
    *,
    starting_equity: float,
    equity_curve: list[float],
    closed_trades: list[ClosedTrade],
    timeframe_seconds: int,
) -> dict[str, Any]:
    final_equity = float(equity_curve[-1]) if equity_curve else float(starting_equity)
    total_return_pct = ((final_equity - starting_equity) / starting_equity) * 100 if starting_equity else 0.0

    num_trades = len(closed_trades)
    wins = sum(1 for t in closed_trades if t.is_win)
    win_rate_pct = (wins / num_trades) * 100 if num_trades else 0.0

    gross_profit = sum(t.pnl for t in closed_trades if t.pnl > 0)
    gross_loss = -sum(t.pnl for t in closed_trades if t.pnl < 0)
    if gross_loss > 0:
        profit_factor = gross_profit / gross_loss
    else:
        profit_factor = math.inf if gross_profit > 0 else 0.0

    max_dd = 0.0
    if equity_curve:
        peak = equity_curve[0]
        for e in equity_curve:
            if e > peak:
                peak = e
            if peak > 0:
                dd = (peak - e) / peak
                if dd > max_dd:
                    max_dd = dd

    sharpe = 0.0
    if len(equity_curve) >= 2 and timeframe_seconds > 0:
        eq = np.asarray(equity_curve, dtype=np.float64)
        rets = np.diff(eq) / eq[:-1]
        if rets.size >= 2:
            mean = float(np.mean(rets))
            std = float(np.std(rets, ddof=1))
            if std > 0:
                periods_per_year = SECONDS_PER_YEAR / timeframe_seconds
                sharpe = (mean / std) * math.sqrt(periods_per_year)

    return {
        "starting_equity": float(starting_equity),
        "final_equity": float(final_equity),
        "total_return_pct": float(total_return_pct),
        "num_trades": int(num_trades),
        "win_rate_pct": float(win_rate_pct),
        "max_drawdown_pct": float(max_dd * 100),
        "sharpe_ratio_annualized": float(sharpe),
        "profit_factor": float(profit_factor) if math.isfinite(profit_factor) else "inf",
        "gross_profit": float(gross_profit),
        "gross_loss": float(gross_loss),
    }


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Backtest the RSI+MACD+Volume strategy on Binance OHLCV data.")
    p.add_argument("--config", default="config.yaml", help="Path to YAML config file (strategy/risk/paper settings).")
    p.add_argument(
        "--exchange",
        default="binance",
        help="ccxt exchange id to use (default: binance; auto-fallback to binanceus on HTTP 451).",
    )
    p.add_argument(
        "--symbols",
        default="BTC/USDT,ETH/USDT",
        help="Comma-separated symbols to backtest (default: BTC/USDT,ETH/USDT).",
    )
    p.add_argument("--start", help="Start datetime (UTC). Examples: 2024-01-01 or 2024-01-01T00:00:00Z")
    p.add_argument("--end", help="End datetime (UTC). Examples: 2024-02-01 or 2024-02-01T00:00:00Z")
    p.add_argument(
        "--timeframe",
        help="OHLCV timeframe (overrides config.strategy.timeframe). Example: 5m",
    )
    p.add_argument("--output-json", help="Optional path to write a JSON summary.")
    p.add_argument("--verbose", action="store_true", help="Print download progress to stderr.")
    return p.parse_args()


def main() -> None:
    args = _parse_args()
    cfg = load_config(args.config)
    setup_logging(cfg.runtime.log_level)

    timeframe = str(args.timeframe or cfg.strategy.timeframe).strip()
    timeframe_seconds = _timeframe_to_seconds(timeframe)
    timeframe_ms = timeframe_seconds * 1000

    now = datetime.now(tz=UTC)
    start_dt = _parse_datetime_utc(args.start, is_end=False) if args.start else (now - timedelta(days=30))
    end_dt = _parse_datetime_utc(args.end, is_end=True) if args.end else now
    if end_dt <= start_dt:
        raise SystemExit("--end must be after --start")

    trade_start_ms = _to_ms(start_dt)
    trade_end_ms = _to_ms(end_dt)

    warmup_candles = max(cfg.strategy.ohlcv_limit, 50)
    fetch_start_ms = max(0, trade_start_ms - warmup_candles * timeframe_ms)

    symbols = [s.strip().upper() for s in str(args.symbols).split(",") if s.strip()]
    if not symbols:
        raise SystemExit("--symbols cannot be empty")

    exchange, exchange_id = _init_exchange(args.exchange, timeout_ms=cfg.exchange.timeout_ms)
    try:
        if exchange_id != args.exchange.strip().lower():
            print(f"Note: Falling back to ccxt exchange '{exchange_id}' due to API restrictions.", file=sys.stderr)

        candles_by_symbol: dict[str, list[Candle]] = {}
        for sym in symbols:
            if args.verbose:
                print(f"Downloading {sym} {timeframe} candles...", file=sys.stderr)
            candles = _fetch_ohlcv_history(
                exchange,
                sym,
                timeframe,
                fetch_start_ms,
                trade_end_ms,
                verbose=args.verbose,
            )
            if not candles:
                raise SystemExit(f"No candles returned for {sym}.")
            candles_by_symbol[sym] = candles
    finally:
        try:
            exchange.close()
        except Exception:
            pass

    strategy = RsiMacdVolumeStrategy(cfg.strategy)
    risk = RiskManager(cfg.risk)

    cash_usdt = float(cfg.paper.starting_cash_usdt)
    fee_pct = float(cfg.paper.fee_pct)
    positions: dict[str, Position] = {}
    closed_trades: list[ClosedTrade] = []

    indices = {sym: 0 for sym in symbols}
    histories: dict[str, list[Candle]] = {sym: [] for sym in symbols}
    last_prices: dict[str, float] = {}

    # Use a multi-way merge of candle timestamps across symbols.
    next_ts: dict[str, int | None] = {}
    for sym in symbols:
        c_list = candles_by_symbol[sym]
        next_ts[sym] = c_list[0].timestamp_ms if c_list else None

    equity_curve: list[float] = []
    last_processed_ts: int | None = None

    while True:
        available = [ts for ts in next_ts.values() if ts is not None]
        if not available:
            break
        ts = min(available)
        last_processed_ts = ts
        now_dt = _from_ms(ts)

        active_symbols: list[str] = []
        for sym in symbols:
            if next_ts[sym] != ts:
                continue
            idx = indices[sym]
            candle = candles_by_symbol[sym][idx]
            histories[sym].append(candle)
            if len(histories[sym]) > cfg.strategy.ohlcv_limit:
                histories[sym] = histories[sym][-cfg.strategy.ohlcv_limit :]
            last_prices[sym] = float(candle.close)
            active_symbols.append(sym)

            indices[sym] = idx + 1
            if indices[sym] < len(candles_by_symbol[sym]):
                next_ts[sym] = candles_by_symbol[sym][indices[sym]].timestamp_ms
            else:
                next_ts[sym] = None

        prices_snapshot: dict[str, float] = dict(last_prices)
        equity_before = _portfolio_snapshot(cash_usdt, positions, prices_snapshot)
        free_quote_before = cash_usdt
        risk.update_daily_equity(now_dt, equity_before)

        if ts >= trade_start_ms:
            for sym in symbols:
                if sym not in active_symbols:
                    continue
                candles_window = histories[sym]
                last_price = float(last_prices[sym])
                position = positions.get(sym)

                if position:
                    st_reason = risk.stop_take_reason(position, last_price)
                    if st_reason:
                        cash_usdt, exit_fee = _paper_sell(cash_usdt, position.amount, last_price, fee_pct)
                        pnl = (last_price - position.entry_price) * position.amount - position.entry_fee - exit_fee
                        positions.pop(sym, None)
                        closed_trades.append(
                            ClosedTrade(
                                symbol=sym,
                                entry_timestamp_ms=position.entry_timestamp_ms,
                                exit_timestamp_ms=ts,
                                entry_price=position.entry_price,
                                exit_price=last_price,
                                amount=position.amount,
                                pnl=float(pnl),
                                reason=st_reason,
                            )
                        )
                        continue

                signal = strategy.generate_signal(candles_window, position)
                if signal.action == "buy":
                    if position is not None or risk.halted:
                        continue
                    quote_alloc = risk.max_quote_allocation(equity_before, free_quote_before)
                    if quote_alloc <= 0:
                        continue
                    cash_usdt, amount, entry_fee = _paper_buy(cash_usdt, quote_alloc, last_price, fee_pct)
                    positions[sym] = risk.build_position(
                        sym,
                        amount,
                        last_price,
                        ts,
                        entry_fee=entry_fee,
                    )
                elif signal.action == "sell":
                    if position is None:
                        continue
                    cash_usdt, exit_fee = _paper_sell(cash_usdt, position.amount, last_price, fee_pct)
                    pnl = (last_price - position.entry_price) * position.amount - position.entry_fee - exit_fee
                    positions.pop(sym, None)
                    closed_trades.append(
                        ClosedTrade(
                            symbol=sym,
                            entry_timestamp_ms=position.entry_timestamp_ms,
                            exit_timestamp_ms=ts,
                            entry_price=position.entry_price,
                            exit_price=last_price,
                            amount=position.amount,
                            pnl=float(pnl),
                            reason=signal.reason,
                        )
                    )

        if ts >= trade_start_ms:
            equity_after = _portfolio_snapshot(cash_usdt, positions, prices_snapshot)
            equity_curve.append(equity_after)

        if ts >= trade_end_ms:
            break

    if last_processed_ts is None:
        raise SystemExit("No candles processed.")

    # Liquidate open positions at the end of the backtest window (if possible).
    liquidation_ts = min(trade_end_ms, last_processed_ts)
    if positions:
        for sym, position in list(positions.items()):
            last_price = float(last_prices.get(sym, position.entry_price))
            cash_usdt, exit_fee = _paper_sell(cash_usdt, position.amount, last_price, fee_pct)
            pnl = (last_price - position.entry_price) * position.amount - position.entry_fee - exit_fee
            positions.pop(sym, None)
            closed_trades.append(
                ClosedTrade(
                    symbol=sym,
                    entry_timestamp_ms=position.entry_timestamp_ms,
                    exit_timestamp_ms=liquidation_ts,
                    entry_price=position.entry_price,
                    exit_price=last_price,
                    amount=position.amount,
                    pnl=float(pnl),
                    reason="end-of-backtest",
                )
            )

        equity_after = _portfolio_snapshot(cash_usdt, positions, dict(last_prices))
        if equity_curve:
            equity_curve[-1] = equity_after
        else:
            equity_curve.append(equity_after)

    metrics = _compute_metrics(
        starting_equity=float(cfg.paper.starting_cash_usdt),
        equity_curve=equity_curve,
        closed_trades=closed_trades,
        timeframe_seconds=timeframe_seconds,
    )

    print("Backtest results")
    print(f"- Symbols: {', '.join(symbols)}")
    print(f"- Timeframe: {timeframe}")
    print(f"- Range (UTC): {start_dt.isoformat()} -> {end_dt.isoformat()}")
    print(f"- Starting equity: ${metrics['starting_equity']:,.2f}")
    print(f"- Final equity:    ${metrics['final_equity']:,.2f}")
    print(f"- Total return:    {metrics['total_return_pct']:.2f}%")
    print(f"- Trades:          {metrics['num_trades']}")
    print(f"- Win rate:        {metrics['win_rate_pct']:.2f}%")
    print(f"- Max drawdown:    {metrics['max_drawdown_pct']:.2f}%")
    print(f"- Sharpe (ann.):   {metrics['sharpe_ratio_annualized']:.3f}")
    print(f"- Profit factor:   {metrics['profit_factor']}")

    if args.output_json:
        payload: dict[str, Any] = {
            "symbols": symbols,
            "timeframe": timeframe,
            "start_utc": start_dt.isoformat(),
            "end_utc": end_dt.isoformat(),
            "config_path": str(Path(args.config)),
            "metrics": metrics,
            "closed_trades": [asdict(t) for t in closed_trades],
        }
        out_path = Path(args.output_json)
        out_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        print(f"\nSaved JSON summary to {out_path}")


if __name__ == "__main__":
    main()
