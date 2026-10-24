#!/usr/bin/env python3
"""Validate the Vulpes specifications and test fixtures.
Run from any directory: python docs/spec/v0.1.0/scripts/validate_spec_package.py
No network access, third-party dependencies, live model calls or credentials.
"""
from __future__ import annotations
import csv
import hashlib
import json
import re
import struct
import sys
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

SPEC_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SPEC_ROOT.parents[2]
errors: list[str] = []
checks = 0

def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if not condition:
        errors.append(message)

# 1. Required canonical specification files
required_spec_files = [
    "README.md", "PRODUCT_SPEC.md", "DECISIONS.md",
    "ARCHITECTURE.md", "DATA_MODEL.md", "API_CONTRACTS.md", "AI_SPEC.md", "UI_SPEC.md",
    "SECURITY_AND_PRIVACY.md", "PROVIDER_SETUP.md", "DEPLOYMENT.md", "IMPLEMENTATION_PLAN.md",
    "ACCEPTANCE_TESTS.md", "ROADMAP.md", "SOURCES.md", "BRAND_ASSETS.md",
    "contracts/domain.ts", "contracts/stream.ts", "fixtures/measurements-synthetic.csv",
    "fixtures/expected-results.json", "assets/brand-inventory.json"
]
for name in required_spec_files:
    check((SPEC_ROOT / name).is_file(), "Missing required spec file: " + name)

required_repo_files = ["README.md", "AGENTS.md", ".env.example", ".gitignore"]
for name in required_repo_files:
    check((REPO_ROOT / name).is_file(), "Missing required repo file: " + name)

# 2. JSON validation across specs
for path in SPEC_ROOT.rglob("*.json"):
    try:
        json.loads(path.read_text(encoding="utf-8"))
        check(True, "")
    except (ValueError, OSError) as exc:
        check(False, f"Invalid JSON {path.relative_to(SPEC_ROOT)}: {exc}")

# 3. Reference register anchors match SOURCES.md
refs = json.loads((SPEC_ROOT / "config/reference-register.json").read_text(encoding="utf-8"))
source_ids = {item["id"] for item in refs["sources"]}
check(len(source_ids) == len(refs["sources"]), "Duplicate reference IDs in register")
source_md = (SPEC_ROOT / "SOURCES.md").read_text(encoding="utf-8")
for sid in source_ids:
    check(f"## {sid}\n" in source_md, "Missing source anchor in SOURCES.md: " + sid)

# 4. Markdown links and code fences
link_pattern = re.compile(r"(?<!!)\[[^\]]*\]\(([^)]+)\)")
for path in [p for p in SPEC_ROOT.rglob("*.md")] + [REPO_ROOT / "README.md", REPO_ROOT / "AGENTS.md", REPO_ROOT / "docs/DECISIONS_IMPLEMENTATION.md"]:
    text = path.read_text(encoding="utf-8")
    rel_label = str(path.relative_to(REPO_ROOT))
    check(text.count("```") % 2 == 0, f"Unbalanced code fence: {rel_label}")
    for target in link_pattern.findall(text):
        if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target):
            continue
        filename, _, anchor = target.partition("#")
        resolved = (path.parent / filename).resolve() if filename else path
        check(resolved.exists(), f"Broken relative link in {rel_label}: {target}")
        if resolved.name == "SOURCES.md" and anchor:
            check(anchor in source_ids, f"Unknown source reference in {rel_label}: {anchor}")

# 5. Model registry template verification
registry = json.loads((SPEC_ROOT / "config/model-registry.example.json").read_text(encoding="utf-8"))
expected_models = {
    "everyday": "openai/gpt-6-luna", "intermediate": "gemini-3.8-flash",
    "advanced": "gemini-4-argon", "decision": "microsoft/microsoft-decision-1"
}
check(registry["live_ai_enabled"] is False, "Live AI must be disabled in template")
for role, model in expected_models.items():
    cfg = registry["roles"][role]
    check(cfg["model_id"] == model, "Unexpected selected model: " + role)
    check(cfg["price"]["status"] == "unverified", "Price incorrectly marked verified: " + role)
    check(cfg["live_smoke_test_status"] == "not_run", "Invented smoke result: " + role)
check(registry["roles"]["decision"]["api_family"] == "openrouter_decisions", "Decision adapter is not separate")
check(registry["roles"]["decision"]["enabled_by_default"] is False, "Decision engine must default off")

# 6. Feature flags verification
flags = json.loads((SPEC_ROOT / "config/feature-flags.example.json").read_text(encoding="utf-8"))
for flag in ["health_connect", "direct_scale_ble", "scientific_rag", "web_research", "automatic_memory", "scheduled_reviews"]:
    check(flags[flag] is False, "Deferred feature accidentally enabled: " + flag)

# 7. Root environment template check
env = {}
for line in (REPO_ROOT / ".env.example").read_text(encoding="utf-8").splitlines():
    if line and not line.startswith("#") and "=" in line:
        key, value = line.split("=", 1)
        env[key] = value
for key in ["OPENROUTER_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "VULPES_TRACE_ENCRYPTION_KEY_B64"]:
    check(env.get(key, "") == "", "Secret placeholder is populated: " + key)
check(env.get("VULPES_LIVE_AI_ENABLED") == "false", "VULPES_LIVE_AI_ENABLED must default to false")

# 8. Brand asset integrity
inventory = json.loads((SPEC_ROOT / "assets/brand-inventory.json").read_text(encoding="utf-8"))
for item in inventory["files"]:
    p = SPEC_ROOT / item["path"]
    check(p.exists(), "Missing brand file: " + item["path"])
    if not p.exists():
        continue
    data = p.read_bytes()
    check(hashlib.sha256(data).hexdigest() == item["sha256"], "Modified brand asset: " + item["path"])
    check(len(data) == item["bytes"], "Brand size mismatch: " + item["path"])
    if p.suffix.lower() == ".png":
        check(data[:8] == b"\x89PNG\r\n\x1a\n", "Not a PNG: " + item["path"])
        check(struct.unpack(">II", data[16:24]) == (item["width"], item["height"]), "PNG dimensions changed: " + item["path"])
for p in SPEC_ROOT.rglob("*"):
    check(p.suffix.lower() not in {".ttf", ".otf", ".woff", ".woff2", ".ttc"}, "Unexpected font binary: " + str(p))

# 9. Synthetic fixture arithmetic & expected results
rows = list(csv.DictReader((SPEC_ROOT / "fixtures/measurements-synthetic.csv").open(newline="", encoding="utf-8")))
expected = json.loads((SPEC_ROOT / "fixtures/expected-results.json").read_text(encoding="utf-8"))
check(len(rows) == expected["total_observations"], "Fixture observation count mismatch")
series = defaultdict(list)
for row in rows:
    series[row["metric"]].append(Decimal(row["value"]))
for metric in ["weight", "body_fat_percent"]:
    values = series[metric]
    check(len(values) == 14, "Fixture metric count mismatch: " + metric)
    baseline = sum(values[:7]) / Decimal(7)
    current = sum(values[7:]) / Decimal(7)
    check(baseline == Decimal(str(expected[metric]["baseline"])), "Baseline mismatch: " + metric)
    check(current == Decimal(str(expected[metric]["current"])), "Current mismatch: " + metric)
check(Decimal("150") * Decimal("0.45359237") == Decimal(str(expected["conversion_check"]["expected_kg"])), "Conversion oracle mismatch")
progress = (Decimal("69.0") - Decimal("69.7")) / (Decimal("68.0") - Decimal("69.7")) * 100
check(abs(progress - Decimal(str(expected["hypothetical_goal"]["raw_progress_percent"]))) < Decimal("1e-9"), "Goal oracle mismatch")

if errors:
    print(f"FAIL: {len(errors)} of {checks} checks failed")
    for error in errors:
        print(" - " + error)
    sys.exit(1)
print(f"PASS: {checks} specification and fixture checks passed")
print("Verified: required specifications, JSON syntax, source anchors, relative links,")
print("model registry template, feature flags, empty secret templates, brand asset hashes/dimensions,")
print("and synthetic fixture arithmetic.")
