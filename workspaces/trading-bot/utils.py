"""Utility helpers (logging, persistence, caching, notifications)."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any, Iterable, Sequence

import aiohttp
import aiosqlite

from models import Candle, RedisConfig, TradeRecord

logger = logging.getLogger(__name__)


def utc_now() -> datetime:
    """Return timezone-aware current UTC time."""

    return datetime.now(tz=UTC)


def setup_logging(level: str) -> None:
    """Configure standard library logging."""

    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


class MarketDataCache:
    """Redis-backed cache for OHLCV market data."""

    def __init__(self, cfg: RedisConfig):
        self._cfg = cfg
        self._enabled = cfg.enabled
        self._redis: Any | None = None

    async def connect(self) -> None:
        if not self._enabled:
            return
        try:
            import redis.asyncio as redis  # type: ignore

            self._redis = redis.from_url(self._cfg.url, decode_responses=True)
            await self._redis.ping()
            logger.info("Redis cache enabled: %s", self._cfg.url)
        except Exception:
            logger.warning("Redis unavailable; continuing without caching.", exc_info=True)
            self._enabled = False
            self._redis = None

    async def close(self) -> None:
        if not self._redis:
            return
        try:
            await self._redis.close()
        except Exception:
            logger.debug("Failed closing redis client.", exc_info=True)

    def _key(self, kind: str, parts: Sequence[str]) -> str:
        joined = ":".join(parts)
        return f"{self._cfg.prefix}{kind}:{joined}"

    async def get_ohlcv(self, symbol: str, timeframe: str, limit: int) -> list[Candle] | None:
        """Get cached candles, if present."""

        if not self._enabled or not self._redis:
            return None
        key = self._key("ohlcv", [symbol, timeframe, str(limit)])
        try:
            raw = await self._redis.get(key)
            if not raw:
                return None
            data = json.loads(raw)
            return [Candle(*row) for row in data]
        except Exception:
            logger.debug("Redis get failed for %s", key, exc_info=True)
            return None

    async def set_ohlcv(self, symbol: str, timeframe: str, limit: int, candles: Sequence[Candle]) -> None:
        """Cache candles for a short TTL."""

        if not self._enabled or not self._redis:
            return
        key = self._key("ohlcv", [symbol, timeframe, str(limit)])
        try:
            payload = json.dumps(
                [[c.timestamp_ms, c.open, c.high, c.low, c.close, c.volume] for c in candles], separators=(",", ":")
            )
            await self._redis.set(key, payload, ex=self._cfg.ttl_seconds)
        except Exception:
            logger.debug("Redis set failed for %s", key, exc_info=True)


class TradeHistory:
    """SQLite-backed trade history."""

    def __init__(self, db_path: str):
        self._db_path = db_path
        self._conn: aiosqlite.Connection | None = None

    async def connect(self) -> None:
        self._conn = await aiosqlite.connect(self._db_path)
        await self._conn.execute("PRAGMA journal_mode=WAL;")
        await self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS trades (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp_ms INTEGER NOT NULL,
              symbol TEXT NOT NULL,
              side TEXT NOT NULL,
              amount REAL NOT NULL,
              price REAL NOT NULL,
              fee REAL NOT NULL,
              pnl REAL NOT NULL,
              reason TEXT NOT NULL,
              mode TEXT NOT NULL,
              order_id TEXT
            )
            """
        )
        await self._conn.execute("CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(timestamp_ms)")
        await self._conn.commit()

    async def close(self) -> None:
        if not self._conn:
            return
        await self._conn.close()
        self._conn = None

    async def record_trade(self, trade: TradeRecord) -> int:
        """Insert a trade record and return the new row id."""

        if not self._conn:
            raise RuntimeError("TradeHistory is not connected")
        cur = await self._conn.execute(
            """
            INSERT INTO trades (
              timestamp_ms, symbol, side, amount, price, fee, pnl, reason, mode, order_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trade.timestamp_ms,
                trade.symbol,
                trade.side,
                trade.amount,
                trade.price,
                trade.fee,
                trade.pnl,
                trade.reason,
                trade.mode,
                trade.order_id,
            ),
        )
        await self._conn.commit()
        return int(cur.lastrowid)


async def send_discord_webhook(webhook_url: str | None, content: str) -> None:
    """Send a Discord webhook message (best-effort)."""

    if not webhook_url:
        return
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(webhook_url, json={"content": content}, timeout=aiohttp.ClientTimeout(total=10)) as r:
                if r.status >= 400:
                    body = await r.text()
                    logger.warning("Discord webhook failed (%s): %s", r.status, body[:500])
    except Exception:
        logger.warning("Discord webhook error.", exc_info=True)


def chunks(seq: Sequence[Any], size: int) -> Iterable[Sequence[Any]]:
    """Yield fixed-size chunks from a sequence."""

    for i in range(0, len(seq), size):
        yield seq[i : i + size]
