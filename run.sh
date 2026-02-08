#!/bin/bash

# MitmproxyUI - Run Script
# Usage: ./run.sh [port] [proxy_port]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default ports
PORT=${1:-9000}
PROXY_PORT=${2:-8890}

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════╗"
echo "║              MitmproxyUI - Launcher                   ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    echo "Install with: brew install node"
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    npm install
fi

# Check mitmproxy venv
MITMDUMP_PATH="$HOME/.mitmproxy-venv/bin/mitmdump"
if [ ! -f "$MITMDUMP_PATH" ]; then
    echo -e "${YELLOW}mitmproxy not found. Installing...${NC}"

    # Check Python 3.12
    PYTHON_PATH="/opt/homebrew/opt/python@3.12/bin/python3.12"
    if [ ! -f "$PYTHON_PATH" ]; then
        echo -e "${YELLOW}Installing Python 3.12...${NC}"
        brew install python@3.12
    fi

    # Create venv and install mitmproxy
    echo -e "${YELLOW}Creating virtual environment and installing mitmproxy...${NC}"
    $PYTHON_PATH -m venv ~/.mitmproxy-venv
    source ~/.mitmproxy-venv/bin/activate
    pip install mitmproxy
    deactivate

    echo -e "${GREEN}mitmproxy installed successfully${NC}"
fi

# Kill any existing processes on our ports
echo -e "${YELLOW}Cleaning up old processes...${NC}"
lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
lsof -ti:$PROXY_PORT | xargs kill -9 2>/dev/null || true
pkill -f "mitmdump.*mitm-addon.py" 2>/dev/null || true
sleep 1

# Disable Mac proxy if it was left enabled
networksetup -setwebproxystate Wi-Fi off 2>/dev/null || true
networksetup -setsecurewebproxystate Wi-Fi off 2>/dev/null || true

# Start the server
echo -e "${GREEN}Starting MitmproxyUI...${NC}"
echo -e "  Dashboard: ${BLUE}http://localhost:$PORT${NC}"
echo -e "  Proxy Port: ${BLUE}$PROXY_PORT${NC}"
echo ""

export PORT=$PORT
export PROXY_PORT=$PROXY_PORT

# Run server in foreground so Ctrl+C works
node server.js
