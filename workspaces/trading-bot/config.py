"""Configuration management (YAML + env overrides)."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml

from models import (
    AppConfig,
    ConfigError,
    DiscordConfig,
    ExchangeConfig,
    PaperConfig,
    RedisConfig,
    RiskConfig,
    RuntimeConfig,
    SqliteConfig,
    StrategyConfig,
)


def load_config(path: str | os.PathLike[str]) -> AppConfig:
    """Load and validate configuration from YAML with environment overrides.

    Environment overrides:
      - BINANCE_API_KEY
      - BINANCE_API_SECRET
      - DISCORD_WEBHOOK_URL
    """

    config_path = Path(path)
    if not config_path.exists():
        raise ConfigError(f"Config file not found: {config_path}")

    with config_path.open("r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}

    mode = str(raw.get("mode", "paper")).strip().lower()
    if mode not in {"paper", "live"}:
        raise ConfigError("config.mode must be 'paper' or 'live'")

    symbols_raw = raw.get("symbols", ["BTC/USDT", "ETH/USDT"])
    if not isinstance(symbols_raw, list) or not all(isinstance(s, str) for s in symbols_raw):
        raise ConfigError("config.symbols must be a list of strings")
    symbols = [s.strip().upper() for s in symbols_raw if s.strip()]
    if not symbols:
        raise ConfigError("config.symbols cannot be empty")
    quotes: set[str] = set()
    for s in symbols:
        if "/" not in s:
            raise ConfigError(f"Invalid symbol '{s}'. Expected format like 'BTC/USDT'.")
        base, quote = s.split("/", 1)
        if not base or not quote:
            raise ConfigError(f"Invalid symbol '{s}'. Expected format like 'BTC/USDT'.")
        quotes.add(quote)
    if len(quotes) != 1:
        raise ConfigError("All symbols must share the same quote currency (e.g., USDT).")

    exchange_raw = _as_dict(raw.get("exchange", {}), "exchange")
    exchange_name = str(exchange_raw.get("name", "binance")).strip().lower()
    if exchange_name != "binance":
        raise ConfigError("Only Binance is supported (exchange.name: 'binance').")

    api_key = os.getenv("BINANCE_API_KEY") or str(exchange_raw.get("api_key", "")).strip()
    api_secret = os.getenv("BINANCE_API_SECRET") or str(exchange_raw.get("api_secret", "")).strip()
    testnet = bool(exchange_raw.get("testnet", False))
    enable_rate_limit = bool(exchange_raw.get("enable_rate_limit", True))
    timeout_ms = int(exchange_raw.get("timeout_ms", 30_000))

    if mode == "live" and (not api_key or not api_secret):
        raise ConfigError(
            "Live mode requires BINANCE_API_KEY and BINANCE_API_SECRET (or exchange.api_key/api_secret)."
        )

    strategy_raw = _as_dict(raw.get("strategy", {}), "strategy")
    strategy = StrategyConfig(
        timeframe=str(strategy_raw.get("timeframe", "5m")),
        ohlcv_limit=int(strategy_raw.get("ohlcv_limit", 200)),
        rsi_period=int(strategy_raw.get("rsi_period", 14)),
        rsi_oversold=float(strategy_raw.get("rsi_oversold", 30)),
        rsi_overbought=float(strategy_raw.get("rsi_overbought", 70)),
        macd_fast=int(strategy_raw.get("macd_fast", 12)),
        macd_slow=int(strategy_raw.get("macd_slow", 26)),
        macd_signal=int(strategy_raw.get("macd_signal", 9)),
        volume_ma_period=int(strategy_raw.get("volume_ma_period", 20)),
        volume_spike_mult=float(strategy_raw.get("volume_spike_mult", 1.2)),
    )

    if strategy.ohlcv_limit < 50:
        raise ConfigError("strategy.ohlcv_limit must be >= 50")

    risk_raw = _as_dict(raw.get("risk", {}), "risk")
    risk = RiskConfig(
        max_position_pct=float(risk_raw.get("max_position_pct", 0.02)),
        stop_loss_pct=float(risk_raw.get("stop_loss_pct", 0.03)),
        take_profit_pct=float(risk_raw.get("take_profit_pct", 0.05)),
        daily_drawdown_limit_pct=float(risk_raw.get("daily_drawdown_limit_pct", 0.05)),
    )
    _validate_pct("risk.max_position_pct", risk.max_position_pct)
    _validate_pct("risk.stop_loss_pct", risk.stop_loss_pct, allow_zero=False)
    _validate_pct("risk.take_profit_pct", risk.take_profit_pct, allow_zero=False)
    _validate_pct("risk.daily_drawdown_limit_pct", risk.daily_drawdown_limit_pct, allow_zero=False)

    paper_raw = _as_dict(raw.get("paper", {}), "paper")
    paper = PaperConfig(
        starting_cash_usdt=float(paper_raw.get("starting_cash_usdt", 10_000)),
        fee_pct=float(paper_raw.get("fee_pct", 0.001)),
    )
    if paper.starting_cash_usdt <= 0:
        raise ConfigError("paper.starting_cash_usdt must be > 0")
    if paper.fee_pct < 0 or paper.fee_pct > 0.01:
        raise ConfigError("paper.fee_pct should be between 0 and 0.01")

    redis_raw = _as_dict(raw.get("redis", {}), "redis")
    redis_cfg = RedisConfig(
        enabled=bool(redis_raw.get("enabled", True)),
        url=str(redis_raw.get("url", "redis://localhost:6379/0")),
        prefix=str(redis_raw.get("prefix", "trading-bot:")),
        ttl_seconds=int(redis_raw.get("ttl_seconds", 45)),
    )
    if redis_cfg.enabled and not redis_cfg.url:
        raise ConfigError("redis.url is required when redis.enabled is true")

    sqlite_raw = _as_dict(raw.get("sqlite", {}), "sqlite")
    sqlite_cfg = SqliteConfig(path=str(sqlite_raw.get("path", "trade_history.sqlite3")))

    discord_raw = _as_dict(raw.get("discord", {}), "discord")
    webhook_url = os.getenv("DISCORD_WEBHOOK_URL") or str(discord_raw.get("webhook_url", "")).strip()
    discord_cfg = DiscordConfig(webhook_url=webhook_url or None)

    runtime_raw = _as_dict(raw.get("runtime", {}), "runtime")
    runtime = RuntimeConfig(
        poll_interval_seconds=float(runtime_raw.get("poll_interval_seconds", 60)),
        log_level=str(runtime_raw.get("log_level", "INFO")).strip().upper(),
    )
    if runtime.poll_interval_seconds <= 0:
        raise ConfigError("runtime.poll_interval_seconds must be > 0")

    exchange = ExchangeConfig(
        name=exchange_name,
        api_key=api_key,
        api_secret=api_secret,
        testnet=testnet,
        enable_rate_limit=enable_rate_limit,
        timeout_ms=timeout_ms,
    )

    return AppConfig(
        mode=mode,  # type: ignore[arg-type]
        symbols=symbols,
        exchange=exchange,
        strategy=strategy,
        risk=risk,
        paper=paper,
        redis=redis_cfg,
        sqlite=sqlite_cfg,
        discord=discord_cfg,
        runtime=runtime,
    )


def _as_dict(value: Any, name: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ConfigError(f"config.{name} must be a mapping/object")
    return value


def _validate_pct(field: str, value: float, *, allow_zero: bool = True) -> None:
    if value < 0 or value > 1:
        raise ConfigError(f"{field} must be between 0 and 1")
    if not allow_zero and value == 0:
        raise ConfigError(f"{field} must be > 0")
