"""Trading strategy implementation (RSI + MACD + volume confirmation).

This module produces discrete signals ("buy", "sell", "hold") and leaves order
execution + risk enforcement to the bot loop.
"""

from __future__ import annotations

from collections.abc import Sequence

import pandas as pd

from models import Candle, Position, Signal, StrategyConfig


def _rsi(close: pd.Series, period: int) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def _macd(close: pd.Series, fast: int, slow: int, signal: int) -> tuple[pd.Series, pd.Series, pd.Series]:
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    hist = macd_line - signal_line
    return macd_line, signal_line, hist


class RsiMacdVolumeStrategy:
    """RSI for mean-reversion entries + MACD confirmation + volume validation."""

    def __init__(self, cfg: StrategyConfig):
        self._cfg = cfg

    def generate_signal(self, candles: Sequence[Candle], position: Position | None) -> Signal:
        """Generate a trading signal for the provided candles."""

        if len(candles) < max(self._cfg.ohlcv_limit, 50):
            return Signal(action="hold", reason="insufficient candle history")

        df = pd.DataFrame(
            {
                "timestamp_ms": [c.timestamp_ms for c in candles],
                "close": [c.close for c in candles],
                "volume": [c.volume for c in candles],
            }
        )

        rsi = _rsi(df["close"], self._cfg.rsi_period)
        _, _, hist = _macd(df["close"], self._cfg.macd_fast, self._cfg.macd_slow, self._cfg.macd_signal)
        vol_ma = df["volume"].rolling(window=self._cfg.volume_ma_period).mean()

        rsi_curr = float(rsi.iloc[-1]) if pd.notna(rsi.iloc[-1]) else float("nan")
        hist_prev = float(hist.iloc[-2]) if pd.notna(hist.iloc[-2]) else float("nan")
        hist_curr = float(hist.iloc[-1]) if pd.notna(hist.iloc[-1]) else float("nan")
        vol_curr = float(df["volume"].iloc[-1])
        vol_ma_curr = float(vol_ma.iloc[-1]) if pd.notna(vol_ma.iloc[-1]) else float("nan")

        if any(pd.isna(x) for x in [rsi_curr, hist_prev, hist_curr, vol_ma_curr]):
            return Signal(action="hold", reason="indicators not ready")

        bullish_cross = hist_prev <= 0 < hist_curr
        bearish_cross = hist_prev >= 0 > hist_curr
        vol_spike = vol_curr > (vol_ma_curr * self._cfg.volume_spike_mult)

        if position is None:
            if rsi_curr <= self._cfg.rsi_oversold and bullish_cross and vol_spike:
                return Signal(
                    action="buy",
                    reason=f"RSI {rsi_curr:.1f}<=oversold {self._cfg.rsi_oversold}, MACD bullish, volume spike",
                )
            return Signal(action="hold", reason="no entry")

        if rsi_curr >= self._cfg.rsi_overbought and bearish_cross and vol_spike:
            return Signal(
                action="sell",
                reason=f"RSI {rsi_curr:.1f}>=overbought {self._cfg.rsi_overbought}, MACD bearish, volume spike",
            )
        return Signal(action="hold", reason="hold position")
