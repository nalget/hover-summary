#!/usr/bin/env bash
# pack.sh — 将扩展打包为 zip（不含开发/测试产物），产物名含版本号。
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

VERSION="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' manifest.json | head -1 | sed -E 's/.*"([^"]*)".*/\1/')"
OUT="hover-summary-${VERSION}.zip"

# 仅打包扩展运行所需文件
zip -r "$OUT" \
  manifest.json \
  src \
  icons \
  -x '*/node_modules/*' '*/.git/*' '*.zip' \
  >/dev/null

echo "✅ 已打包：$OUT"
