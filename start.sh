#!/bin/bash
# =============================================================
# CanWin Team OS — 启动脚本
# 局域网可访问 · 端口 5173
# =============================================================

set -e

echo "══ CanWin Team OS v1.0.0 ══"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
  echo "❌ 未检测到 Node.js，请先安装 Node.js 18+"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 版本过低 ($(node -v))，需要 18+"
  exit 1
fi

echo "✅ Node.js $(node -v)"

# 安装依赖（如有需要）
if [ ! -d "node_modules" ]; then
  echo "📦 安装依赖..."
  npm install
fi

# 获取本机 IP
if [[ "$OSTYPE" == "darwin"* ]]; then
  LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || echo "localhost")
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  LOCAL_IP=$(hostname -I | awk '{print $1}' 2>/dev/null || echo "localhost")
else
  LOCAL_IP="localhost"
fi

echo ""
echo "🚀 启动开发服务器..."
echo ""
echo "  本地访问:  http://localhost:5173"
if [ "$LOCAL_IP" != "localhost" ]; then
  echo "  局域网访问: http://${LOCAL_IP}:5173"
fi
echo ""
echo "  按 Ctrl+C 停止服务器"
echo ""

npm run dev
