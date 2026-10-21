"""Interactive Telegram setup for a NEW Linux host; no order execution."""
import getpass
import secrets
from telegram_channel import PRIVATE, Telegram, TelegramError, atomic_json


def main():
    PRIVATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = PRIVATE / "telegram.json"
    if path.exists():
        raise SystemExit("Конфигурация уже существует; она не изменена.")
    token = getpass.getpass("Токен Telegram-бота (скрытый ввод): ").strip()
    if not token:
        raise SystemExit("Пустой токен; конфигурация не создана.")
    config = {"bot_token": token, "chat_id": None,
              "start_payload": "upscale_" + secrets.token_hex(16)}
    atomic_json(path, config)
    try:
        client = Telegram()
        bot = client.call("getMe")
        if not bot.get("is_bot") or not bot.get("username"):
            raise TelegramError("invalid_bot_response")
    except TelegramError as error:
        path.unlink()
        raise SystemExit("Не удалось проверить бота: " + str(error)) from None
    config["bot_username"] = bot["username"]
    atomic_json(path, config)
    print("Конфигурация сохранена. Запусти supervisor.py и открой ссылку:")
    print("https://t.me/" + bot["username"] + "?start=" + config["start_payload"])
    print("Нажми Start для привязки своего приватного чата.")


if __name__ == "__main__":
    main()
