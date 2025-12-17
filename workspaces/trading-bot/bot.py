"""Async cryptocurrency trading bot entry point.

Safety defaults:
  - Runs in paper trading mode by default (see config.yaml).
  - Requires explicit `mode: live` + API keys for real orders.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import signal
from dataclasses import dataclass
from typing import Any

from config import load_config
from exchange import BinanceConnector, ExchangeError
from models import AppConfig, Candle, Position, Signal, TradeRecord
from risk_manager import RiskManager
from strategy import RsiMacdVolumeStrategy
from utils import MarketDataCache, TradeHistory, send_discord_webhook, setup_logging, utc_now

logger = logging.getLogger(__name__)


def _now_ms() -> int:
    return int(utc_now().timestamp() * 1000)


def _base_asset(symbol: str) -> str:
    return symbol.split("/")[0]


def _quote_asset(symbol: str) -> str:
    return symbol.split("/")[1]


@dataclass(slots=True)
class _Fill:
    amount: float
    price: float
    fee_quote: float
    order_id: str | None


class TradingBot:
    """Main orchestrator for strategy + risk + execution."""

    def __init__(self, cfg: AppConfig):
        self.cfg = cfg
        self.exchange = BinanceConnector(cfg.exchange)
        self.cache = MarketDataCache(cfg.redis)
        self.trade_history = TradeHistory(cfg.sqlite.path)
        self.strategy = RsiMacdVolumeStrategy(cfg.strategy)
        self.risk = RiskManager(cfg.risk)

        self.positions: dict[str, Position] = {}
        self._paper_cash_usdt: float = cfg.paper.starting_cash_usdt
        self._stop = asyncio.Event()
        self._halt_notified = False

    async def start(self) -> None:
        await self.cache.connect()
        await self.trade_history.connect()
        await self.exchange.load_markets()
        await send_discord_webhook(self.cfg.discord.webhook_url, f"Trading bot started ({self.cfg.mode}).")

    async def close(self) -> None:
        await self.cache.close()
        await self.trade_history.close()
        await self.exchange.close()

    def request_stop(self) -> None:
        self._stop.set()

    async def run(self, *, once: bool = False) -> None:
        while not self._stop.is_set():
            await self._tick()
            if once:
                break
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self.cfg.runtime.poll_interval_seconds)
            except TimeoutError:
                pass

    async def _tick(self) -> None:
        candles_by_symbol: dict[str, list[Candle]] = {}
        for symbol in self.cfg.symbols:
            candles = await self._get_candles(symbol)
            if candles:
                candles_by_symbol[symbol] = candles

        if not candles_by_symbol:
            return

        prices = {sym: candles[-1].close for sym, candles in candles_by_symbol.items()}

        try:
            equity, free_quote = await self._portfolio_snapshot(prices)
        except Exception as e:
            logger.warning("Failed fetching portfolio snapshot: %s", e, exc_info=True)
            return
        self.risk.update_daily_equity(utc_now(), equity)
        if self.risk.halted and not self._halt_notified:
            self._halt_notified = True
            await send_discord_webhook(
                self.cfg.discord.webhook_url,
                f"Daily drawdown limit reached; halting new entries. Equity=${equity:,.2f}",
            )
        if not self.risk.halted:
            self._halt_notified = False

        for symbol, candles in candles_by_symbol.items():
            last_price = float(candles[-1].close)
            await self._process_symbol(symbol, candles, last_price, equity, free_quote)

    async def _get_candles(self, symbol: str) -> list[Candle] | None:
        cached = await self.cache.get_ohlcv(symbol, self.cfg.strategy.timeframe, self.cfg.strategy.ohlcv_limit)
        try:
            candles = await self.exchange.fetch_ohlcv(symbol, self.cfg.strategy.timeframe, self.cfg.strategy.ohlcv_limit)
            await self.cache.set_ohlcv(symbol, self.cfg.strategy.timeframe, self.cfg.strategy.ohlcv_limit, candles)
            return candles
        except Exception as e:
            if cached:
                logger.warning("Using cached candles for %s due to fetch error: %s", symbol, e)
                return cached
            logger.warning("Failed fetching candles for %s: %s", symbol, e, exc_info=True)
            return None

    async def _portfolio_snapshot(self, prices: dict[str, float]) -> tuple[float, float]:
        """Return (equity_usdt, free_quote_usdt)."""

        if self.cfg.mode == "paper":
            equity = self._paper_cash_usdt
            for symbol, position in self.positions.items():
                equity += position.amount * prices.get(symbol, position.entry_price)
            return equity, self._paper_cash_usdt

        balance = await self.exchange.fetch_balance()
        free = balance.get("free") or {}
        total = balance.get("total") or {}
        quote = _quote_asset(self.cfg.symbols[0])
        free_quote = float(free.get(quote, 0.0) or 0.0)
        equity = float(total.get(quote, 0.0) or 0.0)
        for symbol, price in prices.items():
            base = _base_asset(symbol)
            base_total = float(total.get(base, 0.0) or 0.0)
            equity += base_total * price
        return equity, free_quote

    async def _process_symbol(
        self, symbol: str, candles: list[Candle], last_price: float, equity: float, free_quote: float
    ) -> None:
        position = self.positions.get(symbol)
        if position:
            st_reason = self.risk.stop_take_reason(position, last_price)
            if st_reason:
                await self._close_position(symbol, position, last_price, st_reason)
                return

        signal: Signal = self.strategy.generate_signal(candles, position)

        if signal.action == "buy":
            if position is not None:
                return
            if self.risk.halted:
                logger.info("Skipping buy for %s (halted).", symbol)
                return
            await self._open_position(symbol, last_price, equity, free_quote, signal.reason)
            return

        if signal.action == "sell":
            if position is None:
                return
            await self._close_position(symbol, position, last_price, signal.reason)

    async def _open_position(self, symbol: str, last_price: float, equity: float, free_quote: float, reason: str) -> None:
        quote_alloc = self.risk.max_quote_allocation(equity, free_quote)
        if quote_alloc <= 0:
            return

        if self.cfg.mode == "paper":
            fill = self._paper_buy(symbol, quote_alloc, last_price)
        else:
            base_amount = quote_alloc / last_price
            try:
                order = await self.exchange.create_market_buy(symbol, base_amount)
            except ExchangeError as e:
                logger.warning("Buy order failed for %s: %s", symbol, e, exc_info=True)
                await send_discord_webhook(self.cfg.discord.webhook_url, f"BUY failed for {symbol}: {e}")
                return
            fill = self._parse_fill(symbol, order, base_amount, last_price)

        position = self.risk.build_position(
            symbol, fill.amount, fill.price, _now_ms(), entry_fee=fill.fee_quote
        )
        self.positions[symbol] = position

        trade = TradeRecord(
            timestamp_ms=_now_ms(),
            symbol=symbol,
            side="buy",
            amount=fill.amount,
            price=fill.price,
            fee=fill.fee_quote,
            pnl=0.0,
            reason=reason,
            mode=self.cfg.mode,
            order_id=fill.order_id,
        )
        await self.trade_history.record_trade(trade)

        await send_discord_webhook(
            self.cfg.discord.webhook_url,
            f"BUY {symbol} qty={fill.amount:.6f} price={fill.price:.2f} fee={fill.fee_quote:.2f} ({reason})",
        )

    async def _close_position(self, symbol: str, position: Position, last_price: float, reason: str) -> None:
        if self.cfg.mode == "paper":
            fill = self._paper_sell(symbol, position.amount, last_price)
        else:
            try:
                order = await self.exchange.create_market_sell(symbol, position.amount)
            except ExchangeError as e:
                logger.warning("Sell order failed for %s: %s", symbol, e, exc_info=True)
                await send_discord_webhook(self.cfg.discord.webhook_url, f"SELL failed for {symbol}: {e}")
                return
            fill = self._parse_fill(symbol, order, position.amount, last_price)

        sold_amount = min(fill.amount, position.amount)
        entry_fee_alloc = position.entry_fee * (sold_amount / position.amount) if position.amount else 0.0
        pnl = (fill.price - position.entry_price) * sold_amount - entry_fee_alloc - fill.fee_quote

        if sold_amount >= position.amount:
            self.positions.pop(symbol, None)
        else:
            remaining = position.amount - sold_amount
            self.positions[symbol] = Position(
                symbol=position.symbol,
                amount=remaining,
                entry_price=position.entry_price,
                entry_timestamp_ms=position.entry_timestamp_ms,
                stop_loss_price=position.stop_loss_price,
                take_profit_price=position.take_profit_price,
                entry_fee=position.entry_fee - entry_fee_alloc,
            )

        trade = TradeRecord(
            timestamp_ms=_now_ms(),
            symbol=symbol,
            side="sell",
            amount=sold_amount,
            price=fill.price,
            fee=fill.fee_quote,
            pnl=pnl,
            reason=reason,
            mode=self.cfg.mode,
            order_id=fill.order_id,
        )
        await self.trade_history.record_trade(trade)

        await send_discord_webhook(
            self.cfg.discord.webhook_url,
            f"SELL {symbol} qty={sold_amount:.6f} price={fill.price:.2f} pnl={pnl:.2f} fee={fill.fee_quote:.2f} ({reason})",
        )

    def _paper_buy(self, symbol: str, quote_to_spend: float, price: float) -> _Fill:
        fee_pct = self.cfg.paper.fee_pct
        max_quote = self._paper_cash_usdt
        quote_to_spend = min(quote_to_spend, max_quote)
        if quote_to_spend <= 0:
            raise ValueError("quote_to_spend must be > 0")

        # Ensure we can cover fee.
        quote_to_spend = min(quote_to_spend, self._paper_cash_usdt / (1 + fee_pct))
        amount = quote_to_spend / price
        fee = quote_to_spend * fee_pct
        self._paper_cash_usdt -= quote_to_spend + fee
        return _Fill(amount=amount, price=price, fee_quote=fee, order_id=None)

    def _paper_sell(self, symbol: str, amount: float, price: float) -> _Fill:
        fee_pct = self.cfg.paper.fee_pct
        gross = amount * price
        fee = gross * fee_pct
        net = gross - fee
        self._paper_cash_usdt += net
        return _Fill(amount=amount, price=price, fee_quote=fee, order_id=None)

    def _parse_fill(self, symbol: str, order: dict[str, Any], fallback_amount: float, fallback_price: float) -> _Fill:
        """Extract amount/price/fee from a ccxt order response (best-effort)."""

        filled = float(order.get("filled") or 0.0) or fallback_amount
        average = float(order.get("average") or 0.0) or float(order.get("price") or 0.0) or fallback_price

        fee_quote = 0.0
        quote = _quote_asset(symbol)
        fee = order.get("fee") or None
        if isinstance(fee, dict):
            cost = float(fee.get("cost") or 0.0)
            currency = str(fee.get("currency") or "")
            if currency == quote:
                fee_quote = cost
        fees = order.get("fees") or []
        if isinstance(fees, list) and fees:
            total = 0.0
            for f in fees:
                if not isinstance(f, dict):
                    continue
                cost = float(f.get("cost") or 0.0)
                currency = str(f.get("currency") or "")
                if currency == quote:
                    total += cost
            if total > 0:
                fee_quote = total

        order_id = str(order.get("id")) if order.get("id") is not None else None
        return _Fill(amount=filled, price=average, fee_quote=fee_quote, order_id=order_id)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Async crypto trading bot (RSI+MACD+Volume).")
    p.add_argument("--config", default="config.yaml", help="Path to YAML config file.")
    p.add_argument("--once", action="store_true", help="Run one loop iteration and exit.")
    return p.parse_args()


async def _async_main() -> None:
    args = _parse_args()
    cfg = load_config(args.config)
    setup_logging(cfg.runtime.log_level)

    bot = TradingBot(cfg)

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, bot.request_stop)
        except NotImplementedError:
            signal.signal(sig, lambda *_: bot.request_stop())

    try:
        await bot.start()
        await bot.run(once=args.once)
    finally:
        await bot.close()


def main() -> None:
    asyncio.run(_async_main())


if __name__ == "__main__":
    main()
