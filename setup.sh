#!/bin/bash

# mitmproxy-ui Setup Script
# Run this script to set up the project on a new Mac

set -e

echo ""
echo "========================================"
echo "   mitmproxy-ui Setup"
echo "========================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo -e "${RED}Error: This script only works on macOS${NC}"
    exit 1
fi

echo "Checking dependencies..."
echo ""

# Check for Homebrew
if ! command -v brew &> /dev/null; then
    echo -e "${YELLOW}Homebrew not found. Installing...${NC}"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
    echo -e "${GREEN}✓ Homebrew installed${NC}"
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Node.js not found. Installing...${NC}"
    brew install node
else
    NODE_VERSION=$(node -v)
    echo -e "${GREEN}✓ Node.js installed ($NODE_VERSION)${NC}"
fi

# Check for mitmproxy
if ! command -v mitmdump &> /dev/null; then
    echo -e "${YELLOW}mitmproxy not found. Installing...${NC}"
    brew install mitmproxy
else
    MITM_VERSION=$(mitmdump --version | head -1)
    echo -e "${GREEN}✓ mitmproxy installed ($MITM_VERSION)${NC}"
fi

echo ""
echo "Installing npm dependencies..."
npm install

echo ""
echo "Checking for port conflicts..."

# Kill any process using port 3000 (Dashboard)
PORT_3000_PID=$(lsof -ti:3000 2>/dev/null || true)
if [ -n "$PORT_3000_PID" ]; then
    echo -e "${YELLOW}Port 3000 in use. Killing process...${NC}"
    kill -9 $PORT_3000_PID 2>/dev/null || true
    echo -e "${GREEN}✓ Port 3000 freed${NC}"
else
    echo -e "${GREEN}✓ Port 3000 available${NC}"
fi

# Kill any process using port 8888 (Proxy)
PORT_8888_PID=$(lsof -ti:8888 2>/dev/null || true)
if [ -n "$PORT_8888_PID" ]; then
    echo -e "${YELLOW}Port 8888 in use. Killing process...${NC}"
    kill -9 $PORT_8888_PID 2>/dev/null || true
    echo -e "${GREEN}✓ Port 8888 freed${NC}"
else
    echo -e "${GREEN}✓ Port 8888 available${NC}"
fi

# Kill any orphaned mitmproxy processes
MITM_PIDS=$(pgrep -f "mitmdump.*mitm-addon" 2>/dev/null || true)
if [ -n "$MITM_PIDS" ]; then
    echo -e "${YELLOW}Found orphaned mitmproxy processes. Killing...${NC}"
    pkill -f "mitmdump.*mitm-addon" 2>/dev/null || true
    echo -e "${GREEN}✓ Orphaned processes cleaned${NC}"
fi

echo ""
echo -e "${GREEN}========================================"
echo "   Setup Complete!"
echo "========================================${NC}"
echo ""
echo "To start the server, run:"
echo ""
echo -e "  ${YELLOW}npm start${NC}"
echo ""
echo "Then open http://localhost:3000 in your browser."
echo ""
echo "========================================"
echo "   Quick Start Guide"
echo "========================================"
echo ""
echo "1. Click 'Start Proxy' in the dashboard"
echo "2. Go to Tutorial tab for setup instructions"
echo "3. Install the mitmproxy certificate (first time only)"
echo ""
echo "For Real iPhone:"
echo "  - Connect to same WiFi as this Mac"
echo "  - Set proxy to this Mac's IP:8888"
echo "  - Go to http://mitm.it in Safari to install cert"
echo ""
echo "Your Mac's IP address:"
IP_ADDRESS=$(ipconfig getifaddr en0 2>/dev/null || echo "Not found")
echo -e "  ${GREEN}$IP_ADDRESS${NC}"
echo ""
