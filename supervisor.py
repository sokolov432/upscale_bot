"""Restart the observer on failure; do not restart an intentional /stop."""
import fcntl
import json
from pathlib import Path
import os
import subprocess
import sys
import time
from telegram_channel import PRIVATE, atomic_json

if __name__ == "__main__":
    PRIVATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = open(PRIVATE / "supervisor.lock", "a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit(99)
    delay = 5
    while True:
        child = subprocess.Popen([sys.executable, str(Path(__file__).with_name("monitor.py")), "run"],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        started = time.time()
        atomic_json(PRIVATE / "supervisor.json", {"pid": os.getpid(), "worker_pid": child.pid,
                                                  "worker_started_at": started, "phase": "running"})
        code = child.wait()
        if code in (0, 99):
            atomic_json(PRIVATE / "supervisor.json", {"pid": os.getpid(), "worker_pid": child.pid,
                                                      "phase": "stopped", "exit_code": code})
            break
        atomic_json(PRIVATE / "supervisor.json", {"pid": os.getpid(), "phase": "restarting",
                                                  "exit_code": code, "retry_seconds": delay})
        time.sleep(delay)
        delay = 5 if time.time()-started > 600 else min(delay*2, 60)
