#!/bin/sh
# 文献面板的启动脚本。按顺序找一个能用的 node：Antigravity 自带的 agy-node（每台装了 Antigravity 的 Mac 都有）、PATH 里的 node、Homebrew 的 node。
cd "$(dirname "$0")"
for n in "$HOME/Library/Application Support/Antigravity/bin/agy-node" "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node; do
  if [ -n "$n" ] && [ -x "$n" ]; then exec "$n" server.mjs; fi
done
echo "文献面板：没有找到 node，请安装 Node.js 22 以上版本" >&2
exit 1
