"""Print the OpenAPI document (stable key order) so docs/api/openapi.json can be checked in CI.

    docker compose -f compose.yaml -f compose.dev.yaml run --rm --no-deps migrate \
        python scripts/export_openapi.py > docs/api/openapi.json
"""

import json
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))  # run from anywhere
os.environ.setdefault("JWT_SECRET", "openapi-export-only-not-a-real-secret")

from app.main import create_app  # noqa: E402

spec = create_app(with_worker_pool=False).openapi()
json.dump(spec, sys.stdout, indent=2, sort_keys=True, ensure_ascii=False)
sys.stdout.write("\n")
