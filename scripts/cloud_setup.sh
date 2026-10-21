#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
python3 -c 'import sys; assert sys.version_info >= (3,11), "Python 3.11+ is required"'
test -x /usr/bin/chromium || { echo 'Install Chromium at /usr/bin/chromium using the system package manager.' >&2; exit 1; }
python3 -m venv /workspace/.venvs/upscale_bot
export PIP_CACHE_DIR=/workspace/.cache/pip
/workspace/.venvs/upscale_bot/bin/python -m pip install --disable-pip-version-check -r requirements.txt
/workspace/.venvs/upscale_bot/bin/python -m pip check
/workspace/.venvs/upscale_bot/bin/python -m unittest -v
