"""Private Telegram channel binding. Secrets stay outside the project directory."""
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

PRIVATE = Path.home() / ".local/state/upscale-demo"


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_name(path.name + ".tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump(value, handle, ensure_ascii=False)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, path)


def load_json(path, default=None):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return {} if default is None else default


class TelegramError(Exception):
    pass


class Telegram:
    def __init__(self):
        self.path = PRIVATE / "telegram.json"
        self.config = load_json(self.path)
        if not self.config.get("bot_token"):
            raise TelegramError("bot_token_not_configured")

    def call(self, method, payload=None):
        url = "https://api.telegram.org/bot" + self.config["bot_token"] + "/" + method
        request = urllib.request.Request(url, data=json.dumps(payload or {}).encode(),
                                         headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                data = json.load(response)
        except urllib.error.HTTPError as error:
            raise TelegramError("telegram_http_" + str(error.code)) from None
        except Exception as error:
            raise TelegramError("telegram_transport_" + type(error).__name__) from None
        if not data.get("ok"):
            raise TelegramError("telegram_api_" + str(data.get("error_code", "unknown")))
        return data["result"]

    def send(self, text):
        if not self.config.get("chat_id"):
            return None
        return self.call("sendMessage", {"chat_id": self.config["chat_id"], "text": text,
                                         "link_preview_options": {"is_disabled": True}})

    def updates(self, offset):
        return self.call("getUpdates", {"offset": offset, "timeout": 0,
                                         "allowed_updates": ["message"]})

    def bind_if_matching(self, message):
        if self.config.get("chat_id"):
            return False
        chat = message.get("chat", {})
        expected = "/start " + self.config["start_payload"]
        if chat.get("type") != "private" or message.get("text", "").strip() != expected:
            return False
        self.config["chat_id"] = chat["id"]
        atomic_json(self.path, self.config)
        strategy = load_json(Path(__file__).with_name("strategy.json"), {})
        volume_decision = strategy.get("volume_filter", {}).get("user_decision")
        volume_text = ("Фильтр объёма отключён по твоему указанию."
                       if volume_decision == "disabled_by_user" else
                       "Фильтр объёма пока блокирует сигналы: Upscale возвращает нули.")
        self.send("Бот подключён. Твой chat ID: " + str(chat["id"]) +
                  ".\nНаблюдатель настроен на пять валютных пар. Автосделки отключены. " +
                  volume_text + "\nКоманды: /status, /pause, /resume, /stop.")
        return True


if __name__ == "__main__":
    client = Telegram()
    cursor_path = PRIVATE / "telegram-cursor.json"
    cursor = load_json(cursor_path, {"offset": 0})
    bound = False
    for update in client.updates(cursor["offset"]):
        bound = client.bind_if_matching(update.get("message", {})) or bound
        cursor["offset"] = max(cursor["offset"], update["update_id"] + 1)
    atomic_json(cursor_path, cursor)
    print(json.dumps({"bot_username": client.config.get("bot_username"),
                      "chat_bound": bool(client.config.get("chat_id")),
                      "chat_id": client.config.get("chat_id"), "new_binding": bound}))
