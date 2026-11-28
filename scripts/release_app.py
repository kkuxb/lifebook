"""构建 人生簿（lifebook）独立发布包并生成兼容 unpack_verify.py 的 _release-manifest.json。"""
import argparse
import hashlib
import json
import os
import re
import sys
import zipfile
from pathlib import Path, PurePosixPath

APP_NAME = "lifebook"
RECEIPT = "_release-manifest.json"

EXCLUDED_DIRS = {
    "node_modules",
    ".git",
    "dist",
    "target",
    "gen",
    "workspace-data",
    "prototype",
    "__pycache__",
    ".venv",
    "venv",
    ".pytest_cache",
}

TEXT_SUFFIXES = {
    ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yaml", ".yml",
    ".css", ".html", ".md", ".py", ".sh", ".example", ".txt",
    ".rs", ".toml", ".svg", ""
}

ROOT_FILES = [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "vitest.config.ts",
    ".env.example",
    ".dockerignore",
    ".gitignore",
    "Dockerfile",
    "docker-compose.yml",
    "README.md",
    "AGENTS.md",
]

INCLUDE_DIRS = [
    "packages/core",
    "apps/api",
    "apps/web",
    "apps/desktop",
    "scripts",
]

INCLUDE_DOC_FILES = [
    "docs/README.md",
    "docs/绿联NAS部署与使用指南.md",
    "docs/设计规范.md",
    "docs/development-method.md",
    "docs/designs/lifebook-v0.1.0-design.md",
    "docs/designs/lifebook-v0.1.0-implementation-plan.md",
    "docs/designs/lifebook-v0.1.0-test-plan.md",
    "docs/designs/lifebook-v0.2.0-design.md",
    "docs/designs/lifebook-v0.2.0-implementation-plan.md",
    "docs/designs/lifebook-v0.2.0-test-plan.md",
    "docs/designs/lifebook-v0.2.1-brief.md",
    "docs/requirements/lifebook-讨论纪要.md",
    "docs/requirements/project-context.md",
]


def is_excluded(rel_posix: str) -> bool:
    p = PurePosixPath(rel_posix)
    if any(part in EXCLUDED_DIRS for part in p.parts):
        return True
    name = p.name
    if name == RECEIPT:
        return True
    if name.startswith(".env") and name != ".env.example":
        return True
    if p.suffix.lower() in {".sqlite", ".sqlite3", ".db", ".pem", ".key", ".enc", ".log", ".pyc", ".tsbuildinfo"}:
        return True
    if ".sqlite-" in name:
        return True
    return False


def scan_content(rel_posix: str, text: str) -> list[str]:
    issues: list[str] = []
    if re.search(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", text):
        issues.append("private-key material")
    if re.search(r"\b(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[A-Z0-9]{16})\b", text):
        issues.append("credential-shaped token")
    # 本机绝对路径（排除本打包脚本及原有冻结设计/测试参考文档中的路径示例）
    if rel_posix != "scripts/release_app.py" and not rel_posix.startswith(("docs/designs/", "docs/requirements/")):
        if re.search(r"(?:[A-Z]:[\\/](?:Users|Projects|个人项目)[\\/]|/(?:Users|home)/[A-Za-z0-9_.-]+/)", text, re.I):
            issues.append("machine-specific path")
        # 检测硬编码局域网 IP（仅在源代码与配置文件中严格排查，排除测试文件）
        if rel_posix.startswith(("apps/", "packages/")) and "/test/" not in rel_posix:
            if re.search(r"\b192\.168\.\d{1,3}\.\d{1,3}\b", text):
                issues.append("hardcoded LAN IP")
    # 检查已废除旧方案名词不应出现在应用源码中
    if rel_posix.startswith(("apps/", "packages/")):
        forbidden = "\u5e74\u5ea6\u4eba\u7269\u4fa7\u5199"
        if forbidden in text:
            issues.append("forbidden deprecated term")
    return [f"{rel_posix}: {item}" for item in issues]


def collect_files(root: Path) -> tuple[dict[str, bytes], list[str]]:
    snapshot: dict[str, bytes] = {}
    errors: list[str] = []

    def add_file(rel_posix: str):
        if is_excluded(rel_posix):
            return
        full = root / rel_posix
        if not full.is_file():
            return
        data = full.read_bytes()
        snapshot[rel_posix] = data
        if Path(rel_posix).suffix.lower() in TEXT_SUFFIXES or Path(rel_posix).name in {"Dockerfile", ".dockerignore", ".gitignore", ".env.example"}:
            try:
                text = data.decode("utf-8-sig")
                errors.extend(scan_content(rel_posix, text))
            except UnicodeDecodeError:
                pass

    for rf in ROOT_FILES:
        add_file(rf)

    for df in INCLUDE_DOC_FILES:
        add_file(df)

    for inc_dir in INCLUDE_DIRS:
        base = root / inc_dir
        if not base.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIRS]
            for fn in sorted(filenames):
                full = Path(dirpath) / fn
                rel = full.relative_to(root).as_posix()
                add_file(rel)

    return snapshot, errors


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_check = sub.add_parser("check")
    p_check.add_argument("--root", default=".")
    p_build = sub.add_parser("build")
    p_build.add_argument("--root", default=".")
    p_build.add_argument("--output", required=True)

    args = ap.parse_args()
    root = Path(args.root).resolve()

    snapshot, errors = collect_files(root)
    if errors:
        print(json.dumps({"status": "error", "errors": errors}, ensure_ascii=False, indent=2))
        return 1

    if args.cmd == "check":
        print(json.dumps({"status": "checked", "fileCount": len(snapshot)}, ensure_ascii=False))
        return 0

    out_path = Path(args.output).resolve()
    if out_path.exists():
        print(json.dumps({"status": "error", "error": f"output already exists: {out_path}"}, ensure_ascii=False))
        return 1

    hashes = {rel: hashlib.sha256(content).hexdigest() for rel, content in sorted(snapshot.items())}
    receipt = json.dumps(
        {"schemaVersion": 1, "skill": APP_NAME, "files": hashes},
        ensure_ascii=False,
        indent=2
    ).encode("utf-8")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("xb") as f:
        with zipfile.ZipFile(f, "w", zipfile.ZIP_DEFLATED) as zf:
            for rel, content in sorted(snapshot.items()):
                zf.writestr(f"{APP_NAME}/{rel}", content)
            zf.writestr(f"{APP_NAME}/{RECEIPT}", receipt)

    with zipfile.ZipFile(out_path) as zf:
        if zf.testzip() is not None:
            print(json.dumps({"status": "error", "error": "ZIP CRC failed"}))
            return 1

    print(
        json.dumps(
            {
                "status": "built",
                "output": str(out_path),
                "fileCount": len(snapshot),
                "sha256": hashlib.sha256(out_path.read_bytes()).hexdigest(),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
