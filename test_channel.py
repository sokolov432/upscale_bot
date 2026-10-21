import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from telegram_channel import Telegram, TelegramError, atomic_json, load_json
from monitor import Observer


class ChannelTests(unittest.TestCase):
    def test_binding_requires_private_chat_and_exact_link_nonce(self):
        with tempfile.TemporaryDirectory() as folder, patch("telegram_channel.PRIVATE", Path(folder)):
            atomic_json(Path(folder)/"telegram.json", {"bot_token":"test-only", "chat_id":None,
                                                       "start_payload":"upscale_test_nonce"})
            client = Telegram()
            client.send = Mock()
            self.assertFalse(client.bind_if_matching({"chat":{"type":"private","id":123}, "text":"/start"}))
            self.assertFalse(client.bind_if_matching({"chat":{"type":"group","id":-123}, "text":"/start upscale_test_nonce"}))
            self.assertFalse(client.bind_if_matching({"chat":{"type":"private","id":456}, "text":"/start wrong"}))
            client.send.assert_not_called()
            self.assertTrue(client.bind_if_matching({"chat":{"type":"private","id":123}, "text":"/start upscale_test_nonce"}))
            self.assertEqual(load_json(Path(folder)/"telegram.json")["chat_id"], 123)
            self.assertEqual((Path(folder)/"telegram.json").stat().st_mode & 0o777, 0o600)
            client.send.assert_called_once()
            self.assertFalse(client.bind_if_matching({"chat":{"type":"private","id":456}, "text":"/start upscale_test_nonce"}))
            self.assertEqual(client.config["chat_id"], 123)

    def test_ambiguous_delivery_is_not_blindly_repeated(self):
        observer = object.__new__(Observer)
        observer.telegram = Mock()
        observer.telegram.config = {"chat_id":123}
        observer.telegram.send.side_effect = TelegramError("telegram_transport_TimeoutError")
        observer.state = {"message_attempts":[]}
        observer.status = {}
        observer.save = Mock()
        observer.log = Mock()
        self.assertFalse(asyncio.run(observer.send_once("AUD:123:long", "test")))
        self.assertFalse(asyncio.run(observer.send_once("AUD:123:long", "test")))
        observer.telegram.send.assert_called_once()
        self.assertEqual(observer.state["message_attempts"][0]["status"], "delivery_unknown_or_failed")


if __name__ == "__main__":
    unittest.main()
