#!/bin/bash
set -e

echo "🎬 IPTV Player Builder"
echo "----------------------"

if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Install it from https://nodejs.org"
  exit 1
fi

echo "✅ Node.js $(node -v)"
echo ""
echo "📦 Installing dependencies..."
npm install

if [ "$1" == "mac" ] || [ "$1" == "build" ]; then
  echo ""
  echo "🍎 Building macOS app..."
  npm run build
  echo "✅ Done! Find your app in dist/"
  open dist/ 2>/dev/null || true

elif [ "$1" == "win" ]; then
  echo ""
  echo "🪟 Building Windows app..."
  echo "ℹ️  Note: building Windows .exe from macOS requires Wine or a Windows machine."
  echo "   On Windows, just run: npm run build:win"
  npm run build:win
  echo "✅ Done! Find installer in dist/"

elif [ "$1" == "all" ]; then
  echo ""
  echo "🌍 Building for all platforms..."
  npm run build:all
  echo "✅ Done! Find builds in dist/"
  open dist/ 2>/dev/null || true

else
  echo "🚀 Starting in dev mode..."
  npm start
fi
