#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Create venv if it doesn't exist
if [ ! -d ".venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
fi

source .venv/bin/activate

# Install / upgrade deps
pip install -q -r requirements.txt

# Check for API key
if [ -z "$ANTHROPIC_API_KEY" ] && [ ! -f ".env" ]; then
  echo ""
  echo "⚠️  ANTHROPIC_API_KEY not set."
  echo "   Copy .env.example to .env and add your key, or export the variable."
  echo ""
fi

echo "Starting URL Categorizer at http://localhost:8000"
python main.py
