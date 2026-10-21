"""Cloud setup launcher; keep runtime state outside the checkout and preserve source."""
import argparse
import asyncio
import os
from pathlib import Path
import runpy
import secrets
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
STATE = Path(os.environ.get("UPSCALE_STATE_DIR", "/workspace/.state/upscale_bot"))


def prepare_state():
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    STATE.chmod(0o700)
    import telegram_channel
    telegram_channel.PRIVATE = STATE
    return telegram_channel


async def check_feed():
    from monitor import NativeFeed
    from signals import SYMBOLS
    feed = NativeFeed()
    try:
        received, markets = await feed.fetch()
        assert set(markets) == set(SYMBOLS), "Missing markets"
        for symbol, bars in markets.items():
            assert len(bars) >= 5, f"Insufficient candles: {symbol}"
            assert bars[-1].time + 300 <= received, f"Unclosed candle: {symbol}"
        print({"feed": "ok", "closed_bars": {s: len(b) for s, b in markets.items()}})
    finally:
        await feed.close()


def configure(telegram_channel):
    target = STATE / "telegram.json"
    if target.exists():
        print("Existing Telegram configuration preserved.")
        return
    bot_token = os.environ.get("UPSCALE_TELEGRAM_BOT_TOKEN") or os.environ.get("TELEGRAM_BOT_TOKEN")
    if not bot_token:
        raise SystemExit("UPSCALE_TELEGRAM_BOT_TOKEN is missing. Add its value securely in environment settings.")
    # Validate an injected token without writing it or sending a message.
    client = object.__new__(telegram_channel.Telegram)
    client.path = target
    client.config = {"bot_token": bot_token}
    bot = client.call("getMe")
    if not bot.get("is_bot") or not bot.get("username"):
        raise SystemExit("Telegram getMe did not identify a bot.")
    if bot["username"].lower() != "aiagentupscale_bot":
        raise SystemExit("Configured Telegram bot differs from @aiagentupscale_bot. Add the intended bot's token as UPSCALE_TELEGRAM_BOT_TOKEN in environment settings.")
    client.config.update(bot_username=bot["username"], chat_id=None,
                         start_payload="upscale_" + secrets.token_hex(16))
    telegram_channel.atomic_json(target, client.config)
    print("Telegram configuration created privately. Chat binding is still required.")
    print("Use the repository's documented private /start binding flow; do not commit the binding code.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["feed", "configure", "binding-link", "status", "once", "run", "supervisor"])
    args = parser.parse_args()
    os.chdir(ROOT)
    telegram_channel = prepare_state()
    if args.action == "configure":
        configure(telegram_channel)
    elif args.action == "binding-link":
        client = telegram_channel.Telegram()
        print("https://t.me/" + client.config["bot_username"] + "?start=" + client.config["start_payload"])
    elif args.action == "feed":
        asyncio.run(check_feed())
    elif args.action == "supervisor":
        # supervisor launches the original monitor.py; this child hook applies the
        # same supported state location without copying or editing application code.
        hook = STATE / "python-hook"
        hook.mkdir(exist_ok=True, mode=0o700)
        content = ("from pathlib import Path\nimport sys\n"
                   f"sys.path.insert(0, {str(ROOT)!r})\n"
                   "import telegram_channel\n"
                   f"telegram_channel.PRIVATE = Path({str(STATE)!r})\n")
        path = hook / "sitecustomize.py"
        if path.exists() and path.read_text() != content:
            raise SystemExit("Existing runtime Python hook differs; inspect it before replacing.")
        if not path.exists():
            path.write_text(content)
        inherited = os.environ.get("PYTHONPATH")
        os.environ["PYTHONPATH"] = str(hook) + (os.pathsep + inherited if inherited else "")
        runpy.run_path(str(ROOT / "supervisor.py"), run_name="__main__")
    else:
        import monitor
        monitor.PRIVATE = STATE
        asyncio.run(monitor.main(args.action))


if __name__ == "__main__":
    main()
