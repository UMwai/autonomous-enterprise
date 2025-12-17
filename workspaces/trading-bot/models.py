"""Data models for the trading bot.

The project is intentionally lightweight (plain dataclasses + type hints) so it can
run as a single-folder script without packaging overhead.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Mode = Literal["paper", "live"]
TradeSide = Literal["buy", "sell"]
SignalAction = Literal["buy", "sell", "hold"]


class ConfigError(ValueError):
    """Raised when configuration is missing or invalid."""


@dataclass(frozen=True, slots=True)
class Candle:
    """Single OHLCV candle."""

    timestamp_ms: int
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True, slots=True)
class Signal:
    """Strategy output for a symbol."""

    action: SignalAction
    reason: str


@dataclass(frozen=True, slots=True)
class Position:
    """Represents an open spot position (long-only)."""

    symbol: str
    amount: float
    entry_price: float
    entry_timestamp_ms: int
    stop_loss_price: float
    take_profit_price: float
    entry_fee: float = 0.0


@dataclass(frozen=True, slots=True)
class TradeRecord:
    """Represents a filled trade (real or paper)."""

    timestamp_ms: int
    symbol: str
    side: TradeSide
    amount: float
    price: float
    fee: float
    pnl: float
    reason: str
    mode: Mode
    order_id: str | None = None


@dataclass(frozen=True, slots=True)
class ExchangeConfig:
    """Exchange configuration."""

    name: str
    api_key: str
    api_secret: str
    testnet: bool
    enable_rate_limit: bool
    timeout_ms: int


@dataclass(frozen=True, slots=True)
class StrategyConfig:
    """Strategy parameters."""

    timeframe: str
    ohlcv_limit: int
    rsi_period: int
    rsi_oversold: float
    rsi_overbought: float
    macd_fast: int
    macd_slow: int
    macd_signal: int
    volume_ma_period: int
    volume_spike_mult: float


@dataclass(frozen=True, slots=True)
class RiskConfig:
    """Risk parameters."""

    max_position_pct: float
    stop_loss_pct: float
    take_profit_pct: float
    daily_drawdown_limit_pct: float


@dataclass(frozen=True, slots=True)
class PaperConfig:
    """Paper trading settings."""

    starting_cash_usdt: float
    fee_pct: float


@dataclass(frozen=True, slots=True)
class RedisConfig:
    """Redis caching settings."""

    enabled: bool
    url: str
    prefix: str
    ttl_seconds: int


@dataclass(frozen=True, slots=True)
class SqliteConfig:
    """SQLite persistence settings."""

    path: str


@dataclass(frozen=True, slots=True)
class DiscordConfig:
    """Discord notification settings."""

    webhook_url: str | None


@dataclass(frozen=True, slots=True)
class RuntimeConfig:
    """Runtime settings."""

    poll_interval_seconds: float
    log_level: str


@dataclass(frozen=True, slots=True)
class AppConfig:
    """Full application configuration."""

    mode: Mode
    symbols: list[str]
    exchange: ExchangeConfig
    strategy: StrategyConfig
    risk: RiskConfig
    paper: PaperConfig
    redis: RedisConfig
    sqlite: SqliteConfig
    discord: DiscordConfig
    runtime: RuntimeConfig
