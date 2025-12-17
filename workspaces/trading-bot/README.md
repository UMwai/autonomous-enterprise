# Crypto Trading Bot (Async, Binance, RSI+MACD+Volume)

This is a minimal, production-minded starter bot that:
- Trades `BTC/USDT` and `ETH/USDT`
- Uses RSI (overbought/oversold) + MACD (trend confirmation) + volume spike validation
- Enforces risk rules: max 2% portfolio per trade, 3% stop-loss, 5% take-profit, 5% daily drawdown limit
- Uses Redis to cache market data, SQLite to store trade history, and Discord webhooks for alerts

Important: This project cannot guarantee profits (including any $5,000 MRR target). Automated trading is risky and you can lose money.

## Project structure
- `bot.py` - Main entry point
- `strategy.py` - Strategy (RSI+MACD+Volume)
- `exchange.py` - Binance connector via `ccxt`
- `risk_manager.py` - Position sizing / stop-loss / take-profit / daily drawdown
- `config.py` - YAML config loader (+ env overrides)
- `models.py` - Dataclasses and typed models
- `utils.py` - Redis caching, SQLite trade history, Discord notifications
- `config.yaml` - Sample configuration
- `requirements.txt` - Dependencies

## Quick start (paper trading)
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Optional (recommended): run Redis
docker run --rm -p 6379:6379 redis:7

python3 bot.py --config config.yaml
```

Trade fills are simulated locally in `paper` mode; trades are recorded to `trade_history.sqlite3`.

## Live trading (real orders)
1. Set `mode: live` in `config.yaml`
2. Export credentials:
```bash
export BINANCE_API_KEY="..."
export BINANCE_API_SECRET="..."
export DISCORD_WEBHOOK_URL="..."  # optional
```
3. Run:
```bash
python3 bot.py --config config.yaml
```

## Notes and limitations
- Spot, long-only (no shorts).
- Uses market orders (slippage can be significant in fast markets).
- Manages stop-loss/take-profit in the polling loop (not native exchange OCO orders).
- In live mode, the bot tracks only positions opened during its runtime.

## Backtesting
Run a historical backtest of the same RSI+MACD+Volume strategy + risk rules:
```bash
python3 backtest.py --start 2024-01-01 --end 2024-03-01

# Optional: write a JSON summary
python3 backtest.py --start 2024-01-01 --end 2024-03-01 --output-json backtest_summary.json
```
