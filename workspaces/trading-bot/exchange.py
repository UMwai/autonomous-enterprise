"""Exchange connector (Binance via ccxt).

This wrapper keeps all ccxt calls in one place to simplify error handling and
testing (paper trading mode uses the same market data calls).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable, TypeVar

import ccxt.async_support as ccxt

from models import Candle, ExchangeConfig

logger = logging.getLogger(__name__)

T = TypeVar("T")


class ExchangeError(RuntimeError):
    """Raised when the exchange connector cannot complete an action."""


class BinanceConnector:
    """Async Binance spot connector using ccxt."""

    def __init__(self, cfg: ExchangeConfig):
        if cfg.name != "binance":
            raise ValueError("BinanceConnector requires exchange.name == 'binance'")
        self._cfg = cfg
        self._exchange = ccxt.binance(
            {
                "apiKey": cfg.api_key,
                "secret": cfg.api_secret,
                "enableRateLimit": cfg.enable_rate_limit,
                "timeout": cfg.timeout_ms,
                "options": {"defaultType": "spot"},
            }
        )
        if cfg.testnet:
            self._exchange.set_sandbox_mode(True)
        self._markets_loaded = False

    @property
    def client(self) -> Any:
        """Expose underlying ccxt client (avoid using directly if possible)."""

        return self._exchange

    async def close(self) -> None:
        """Close the underlying HTTP session."""

        await self._exchange.close()

    async def load_markets(self) -> None:
        """Load markets metadata (precision/limits)."""

        if self._markets_loaded:
            return
        await self._call(self._exchange.load_markets, "load_markets")
        self._markets_loaded = True

    def amount_to_precision(self, symbol: str, amount: float) -> float:
        """Round an amount to the exchange's precision for the given market."""

        return float(self._exchange.amount_to_precision(symbol, amount))

    async def fetch_ohlcv(self, symbol: str, timeframe: str, limit: int) -> list[Candle]:
        """Fetch recent candles."""

        rows = await self._call(
            lambda: self._exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit),
            f"fetch_ohlcv({symbol},{timeframe},{limit})",
        )
        candles: list[Candle] = []
        for row in rows:
            ts, o, h, l, c, v = row
            candles.append(Candle(int(ts), float(o), float(h), float(l), float(c), float(v)))
        return candles

    async def fetch_balance(self) -> dict[str, Any]:
        """Fetch account balances (requires API credentials)."""

        return await self._call(self._exchange.fetch_balance, "fetch_balance")

    async def fetch_free_balance(self, asset: str) -> float:
        """Return free balance for an asset (e.g., USDT, BTC)."""

        bal = await self.fetch_balance()
        free = bal.get("free") or {}
        return float(free.get(asset, 0.0) or 0.0)

    async def create_market_buy(self, symbol: str, amount: float) -> dict[str, Any]:
        """Place a market buy (amount in base currency)."""

        await self.load_markets()
        precise_amount = self.amount_to_precision(symbol, amount)
        return await self._call(
            lambda: self._exchange.create_market_buy_order(symbol, precise_amount),
            f"create_market_buy({symbol},{precise_amount})",
        )

    async def create_market_sell(self, symbol: str, amount: float) -> dict[str, Any]:
        """Place a market sell (amount in base currency)."""

        await self.load_markets()
        precise_amount = self.amount_to_precision(symbol, amount)
        return await self._call(
            lambda: self._exchange.create_market_sell_order(symbol, precise_amount),
            f"create_market_sell({symbol},{precise_amount})",
        )

    async def _call(self, op: Callable[[], Awaitable[T]] | Callable[..., Awaitable[T]], label: str) -> T:
        """Execute an exchange API call with basic retry for transient errors."""

        delay_s = 1.0
        last_exc: Exception | None = None
        for attempt in range(1, 4):
            try:
                return await op()  # type: ignore[misc]
            except (ccxt.NetworkError, ccxt.ExchangeNotAvailable, asyncio.TimeoutError) as e:
                last_exc = e
                if attempt == 3:
                    break
                logger.warning("%s failed (attempt %s/3): %s", label, attempt, str(e))
                await asyncio.sleep(delay_s)
                delay_s *= 2
            except ccxt.ExchangeError as e:
                raise ExchangeError(f"{label} failed: {e}") from e
            except Exception as e:
                raise ExchangeError(f"{label} failed: {e}") from e
        raise ExchangeError(f"{label} failed after retries: {last_exc}") from last_exc
