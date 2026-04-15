#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Alternative entrypoint for the polyData API service."""

from __future__ import annotations

import sys
from pathlib import Path


SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from api_server import create_app, main  # noqa: E402


app = create_app()


if __name__ == "__main__":
    main()
