"""Risk management utilities (position sizing, stops, drawdown)."""

from __future__ import annotations

import logging
from datetime import date, datetime

from models import Position, RiskConfig

logger = logging.getLogger(__name__)


class RiskManager:
    """Applies portfolio-level and trade-level risk rules."""

    def __init__(self, cfg: RiskConfig):
        self._cfg = cfg
        self._day: date | None = None
        self._day_start_equity: float | None = None
        self._halted: bool = False

    @property
    def halted(self) -> bool:
        """Whether new positions are blocked due to daily drawdown."""

        return self._halted

    def update_daily_equity(self, now: datetime, equity: float) -> None:
        """Update daily equity tracking and enforce drawdown limit."""

        day = now.date()
        if self._day != day:
            self._day = day
            self._day_start_equity = equity
            self._halted = False
            logger.info("New day detected; equity baseline set to %.2f", equity)
            return

        if self._day_start_equity is None:
            self._day_start_equity = equity
            return

        limit = self._cfg.daily_drawdown_limit_pct
        if limit <= 0:
            return
        if equity <= self._day_start_equity * (1 - limit):
            if not self._halted:
                dd = 1 - (equity / self._day_start_equity)
                logger.warning("Daily drawdown limit hit (%.2f%%); halting new entries.", dd * 100)
            self._halted = True

    def max_quote_allocation(self, equity: float, free_quote: float | None = None) -> float:
        """Max quote (e.g., USDT) to allocate to a new position."""

        allocation = equity * self._cfg.max_position_pct
        if free_quote is None:
            return max(0.0, allocation)
        return max(0.0, min(allocation, free_quote))

    def build_position(
        self, symbol: str, amount: float, entry_price: float, entry_timestamp_ms: int, *, entry_fee: float = 0.0
    ) -> Position:
        """Create a position with attached stop-loss and take-profit levels."""

        stop_loss = entry_price * (1 - self._cfg.stop_loss_pct)
        take_profit = entry_price * (1 + self._cfg.take_profit_pct)
        return Position(
            symbol=symbol,
            amount=amount,
            entry_price=entry_price,
            entry_timestamp_ms=entry_timestamp_ms,
            stop_loss_price=stop_loss,
            take_profit_price=take_profit,
            entry_fee=entry_fee,
        )

    def stop_take_reason(self, position: Position, last_price: float) -> str | None:
        """Return an exit reason if stop-loss or take-profit is hit."""

        if last_price <= position.stop_loss_price:
            return "stop-loss"
        if last_price >= position.take_profit_price:
            return "take-profit"
        return None
