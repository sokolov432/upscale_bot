"""Five-minute Upscale observer. NO order execution is implemented here."""
import argparse
import asyncio
import fcntl
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import signal
import time
from zoneinfo import ZoneInfo
from datetime import datetime

from playwright.async_api import async_playwright
from signals import PATTERN_VERSION, SYMBOLS, closed_bars, evaluate, heikin_ashi, next_check_time, stop_price
from telegram_channel import PRIVATE, Telegram, TelegramError, atomic_json, load_json

ROOT = Path(__file__).resolve().parent
TZ = ZoneInfo("Europe/Minsk")


def local_time(stamp):
    return datetime.fromtimestamp(stamp, TZ).strftime("%d.%m %H:%M:%S UTC+3")


class NativeFeed:
    def __init__(self):
        self.driver = self.browser = self.page = None

    async def close(self):
        if self.browser:
            try:
                await self.browser.close()
            except Exception:
                pass
        if self.driver:
            await self.driver.stop()
        self.driver = self.browser = self.page = None

    async def open(self):
        await self.close()
        self.driver = await async_playwright().start()
        options = {"executable_path": "/usr/bin/chromium", "headless": True,
                   "args": ["--no-sandbox", "--disable-dev-shm-usage", "--disk-cache-size=1048576"]}
        if os.environ.get("HTTPS_PROXY"):
            options["proxy"] = {"server": os.environ["HTTPS_PROXY"]}
        self.browser = await self.driver.chromium.launch(**options)
        self.page = await self.browser.new_page()
        response = await self.page.goto("https://app.upscale.trade/trade/AUD_USD",
                                        wait_until="domcontentloaded", timeout=45000)
        if not response or response.status != 200:
            raise RuntimeError("public_feed_page_not_ready")

    async def fetch(self):
        if self.page is None or self.page.is_closed():
            await self.open()
        now = int(time.time())
        try:
            data = await self.page.evaluate("""async ({now, symbols}) => await Promise.all(
                symbols.map(async symbol => {
                    const q = new URLSearchParams({symbol, resolution:'5',
                        from:String(now-90000), to:String(now), countback:'300'});
                    const r = await fetch('/api/datafeed-api/history?'+q,
                        {signal:AbortSignal.timeout(12000)});
                    if (!r.ok) throw new Error('history_http_'+r.status);
                    return {symbol, data:await r.json()};
                }))""", {"now": now, "symbols": list(SYMBOLS.values())})
        except Exception:
            await self.close()
            raise RuntimeError("public_history_fetch_failed") from None
        received = time.time()
        by_ticker = {v["symbol"]: v["data"] for v in data}
        return received, {symbol: closed_bars(by_ticker[ticker], received)
                          for symbol, ticker in SYMBOLS.items()}


class Observer:
    def __init__(self):
        self.telegram = Telegram()
        self.feed = NativeFeed()
        self.stop = asyncio.Event()
        self.state_path = PRIVATE / "observer-state.json"
        self.status_path = PRIVATE / "status.json"
        self.state = load_json(self.state_path, {})
        self.cursor = load_json(PRIVATE / "telegram-cursor.json", {"offset": 0})
        self.status = {"pid": os.getpid(), "started_at": time.time(), "phase": "starting",
                       "pattern_version": PATTERN_VERSION,
                       "execution_enabled": False, "next_check": None}
        self.last_seen = self.state.setdefault("last_seen", {})
        self.state.setdefault("paused", False)
        self.state.setdefault("message_attempts", [])
        self.state.setdefault("tracked_signal_sides", {})
        self.log = logging.getLogger("upscale-demo")
        self.log.setLevel(logging.INFO)
        handler = RotatingFileHandler(PRIVATE / "monitor.log", maxBytes=500000, backupCount=2)
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        self.log.addHandler(handler)

    def save(self):
        atomic_json(self.state_path, self.state)
        self.status["heartbeat_at"] = time.time()
        self.status["paused"] = self.state["paused"]
        self.status["chat_bound"] = bool(self.telegram.config.get("chat_id"))
        atomic_json(self.status_path, self.status)

    def config(self):
        config = load_json(ROOT / "strategy.json")
        if config.get("mode") != "demo_only":
            raise RuntimeError("demo_only_configuration_required")
        if config.get("execution_enabled"):
            raise RuntimeError("automatic_order_execution_is_not_implemented")
        return config

    async def send_once(self, key, text):
        if not self.telegram.config.get("chat_id"):
            return False
        attempts = self.state["message_attempts"]
        if any(v["key"] == key for v in attempts):
            return False
        record = {"key": key, "status": "sending", "time": time.time()}
        attempts.append(record)
        self.state["message_attempts"] = attempts[-500:]
        self.save()
        try:
            sent = await asyncio.to_thread(self.telegram.send, text)
            record["status"] = "sent"
            record["message_id"] = sent.get("message_id") if sent else None
            self.status["last_notification_at"] = time.time()
            return bool(sent)
        except TelegramError as error:
            # A timeout may mean delivery succeeded. Do not resend blindly.
            record["status"] = "delivery_unknown_or_failed"
            record["error"] = str(error)
            self.status["telegram_error"] = str(error)
            self.log.warning("Telegram delivery not confirmed: %s", error)
            return False
        finally:
            self.save()

    def status_text(self):
        last = self.status.get("last_scan_at")
        upcoming = self.status.get("next_check")
        config = self.config()
        decision = config["volume_filter"]["user_decision"]
        volume = ("отключён пользователем" if decision == "disabled_by_user"
                  else "обязателен; нативные данные объёма непригодны")
        return ("Наблюдатель Upscale: " + ("пауза" if self.state["paused"] else self.status["phase"]) +
                ".\nПары: AUD/USD, EUR/USD, GBP/USD, USD/JPY, USD/CHF.\n"
                "Свечи: Heikin Ashi 5м, расчёт из данных Upscale.\n"
                "Вход: два последовательных закрытия телом за фитилём предыдущей свечи.\n"
                "Объём: " + volume + ".\n"
                "Последняя проверка: " + (local_time(last) if last else "ещё не выполнена") +
                ".\nСледующая: " + (local_time(upcoming) if upcoming else "ожидается") +
                ".\nАвтоматическое открытие сделок отключено.\nChat ID: " +
                str(self.telegram.config.get("chat_id")))

    async def telegram_loop(self):
        while not self.stop.is_set():
            try:
                updates = await asyncio.to_thread(self.telegram.updates, self.cursor["offset"])
                for update in updates:
                    message = update.get("message", {})
                    newly_bound = await asyncio.to_thread(self.telegram.bind_if_matching, message)
                    command = message.get("text", "").split(" ", 1)[0].split("@", 1)[0]
                    chat_id = message.get("chat", {}).get("id")
                    if (not newly_bound and self.telegram.config.get("chat_id") is not None
                            and chat_id == self.telegram.config["chat_id"]):
                        if command == "/pause":
                            self.state["paused"] = True
                            await asyncio.to_thread(self.telegram.send, "Проверки приостановлены. /resume — продолжить.")
                        elif command == "/resume":
                            self.state["paused"] = False
                            await asyncio.to_thread(self.telegram.send, "Наблюдение продолжено. Автосделки остаются отключены.")
                        elif command in ("/status", "/start"):
                            await asyncio.to_thread(self.telegram.send, self.status_text())
                        elif command == "/stop":
                            self.state["intentional_stop"] = True
                            await asyncio.to_thread(self.telegram.send, "Наблюдатель остановлен. Проверки и уведомления прекращены.")
                            self.stop.set()
                    self.cursor["offset"] = max(self.cursor["offset"], update["update_id"] + 1)
                    atomic_json(PRIVATE / "telegram-cursor.json", self.cursor)
                self.save()
            except TelegramError as error:
                self.status["telegram_error"] = str(error)
                self.save()
            try:
                await asyncio.wait_for(self.stop.wait(), timeout=3)
            except asyncio.TimeoutError:
                pass

    async def scan(self, prime=False):
        config = self.config()
        started = time.time()
        received, histories = await self.feed.fetch()
        decision = config["volume_filter"]["user_decision"]
        reports = {}
        for symbol, bars in histories.items():
            report = evaluate(bars, decision, received)
            reports[symbol] = {**report, "closed_bars": len(bars),
                               "positive_volume_bars": sum(b.volume is not None and b.volume > 0 for b in bars)}
            if not bars:
                continue
            stamp = bars[-1].time
            old = self.last_seen.get(symbol)
            self.last_seen[symbol] = stamp
            if prime or old is None or stamp <= old:
                continue
            tracked = self.state["tracked_signal_sides"].get(symbol)
            last_ha = heikin_ashi(bars)[-1]
            if tracked:
                opposite = (last_ha.close < last_ha.open if tracked == "long"
                            else last_ha.close > last_ha.open)
                if opposite:
                    del self.state["tracked_signal_sides"][symbol]
                    await self.send_once(f"{symbol}:{stamp}:exit:{tracked}",
                        "УСЛОВИЕ ВЫХОДА " + tracked.upper() + " " + symbol +
                        "\nЗакрылась первая противоположная свеча Heikin Ashi 5м: " +
                        local_time(stamp + 300) + ".\nЭто уведомление по ранее отправленному сигналу; "
                        "бот не проверяет и не закрывает фактические позиции.")
                continue
            if report.get("signal"):
                side = report["signal"]
                reference = report["real_close"]
                text = ("СИГНАЛ " + side.upper() + " " + symbol +
                        "\nЗакрытие свечи Heikin Ashi 5м: " + local_time(stamp + 300) +
                        "\nПроверено через " + str(report["check_delay_seconds"]) + " сек."
                        "\nДва пробоя телом: " +
                        ("C2 > H1 и C3 > H2" if side == "long" else "C2 < L1 и C3 < L2") +
                        "\nПоследняя реальная цена закрытия: " + str(reference) +
                        "\nОриентир SL от этой цены (0,05%): " + str(stop_price(reference, side)) +
                        "\nДля сделки стоп надо считать от фактической цены исполнения."
                        "\nМаржа 6000 USD, плечо x30. Сделка автоматически НЕ открыта."
                        "\nФильтр объёма: " + ("отключён пользователем" if decision == "disabled_by_user" else "пройден"))
                if await self.send_once(f"{symbol}:{stamp}:entry:{side}", text):
                    self.state["tracked_signal_sides"][symbol] = side
        self.status.update({"phase": "observing", "last_scan_at": received,
                            "last_scan_started_at": started, "fetch_seconds": round(received-started, 3),
                            "markets": reports, "volume_decision": decision,
                            "volume_status": "unusable" if all(v["positive_volume_bars"] == 0 for v in reports.values()) else "available"})
        self.save()
        self.log.info("Checked five FX pairs; fetch=%.3fs; volume=%s; prime=%s",
                      received-started, self.status["volume_status"], prime)

    async def run(self):
        self.state["intentional_stop"] = False
        self.save()
        poller = asyncio.create_task(self.telegram_loop())
        try:
            try:
                await self.scan(prime=True)
            except Exception as error:
                self.status.update({"phase": "feed_error", "feed_error": type(error).__name__})
                self.save()
            while not self.stop.is_set():
                due = next_check_time(time.time())
                self.status["next_check"] = due
                self.save()
                try:
                    await asyncio.wait_for(self.stop.wait(), timeout=max(0, due-time.time()))
                    break
                except asyncio.TimeoutError:
                    pass
                if self.state["paused"]:
                    continue
                try:
                    await self.scan()
                except Exception as error:
                    self.status.update({"phase": "feed_error", "feed_error": type(error).__name__})
                    self.save()
                    self.log.warning("Market scan failed: %s", type(error).__name__)
        finally:
            self.stop.set()
            await poller
            await self.feed.close()
            self.status["phase"] = "stopped"
            self.save()


async def main(action):
    if action == "status":
        print(json.dumps(load_json(PRIVATE / "status.json"), ensure_ascii=False))
        return
    PRIVATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = open(PRIVATE / "worker.lock", "a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit(99)
    observer = Observer()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, observer.stop.set)
    if action == "once":
        try:
            await observer.scan(prime=True)
            print(json.dumps(observer.status, ensure_ascii=False))
        finally:
            await observer.feed.close()
    else:
        await observer.run()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["run", "once", "status"], default="status", nargs="?")
    asyncio.run(main(parser.parse_args().action))
