# mitmproxy UI for iOS

A web-based dashboard to manage mitmproxy for iOS app API mocking. Intercept, view, and mock API responses for iOS Simulator and real iPhone devices.

## Features

- **Live Traffic View** - See all HTTP/HTTPS requests in real-time
- **Mock Rules** - Create fake API responses for testing
- **iOS Simulator Support** - Works automatically with Mac proxy
- **Real iPhone Support** - Configure your iPhone to use the proxy
- **Recording** - Record traffic sessions for later replay

## Requirements

- macOS
- Node.js 18+ ([Download](https://nodejs.org/))
- mitmproxy ([Install](https://mitmproxy.org/))

## Quick Setup (5 minutes)

### Step 1: Install Dependencies

```bash
# Install mitmproxy (if not installed)
brew install mitmproxy

# Install Node.js dependencies
npm install
```

### Step 2: Start the Server

```bash
npm start
```

Open http://localhost:3000 in your browser.

### Step 3: Start the Proxy

1. Click **"Start Proxy"** button in the header
2. The proxy will start on port 8888

### Step 4: Install Certificate (First Time Only)

For HTTPS interception, you need to install the mitmproxy certificate.

#### For Mac Browser:
1. Open Finder → Go → Go to Folder → `~/.mitmproxy/`
2. Double-click `mitmproxy-ca-cert.pem`
3. In Keychain Access, select "System" keychain
4. Find "mitmproxy", double-click → Trust → "Always Trust"
5. Restart your browser

#### For Real iPhone:
1. Connect iPhone to **same WiFi** as your Mac
2. Go to Settings → WiFi → tap (i) → Configure Proxy → Manual
3. Server: `YOUR_MAC_IP` (shown in Tutorial tab), Port: `8888`
4. Open Safari → go to `http://mitm.it` → tap Apple → Allow
5. Settings → General → VPN & Device Management → Install mitmproxy
6. Settings → General → About → Certificate Trust Settings → Enable mitmproxy

#### For iOS Simulator:
1. Open Safari in Simulator → `http://mitm.it`
2. Follow same steps as real iPhone

## Usage

### View Traffic
Go to **Live Traffic** tab to see all requests passing through the proxy.

### Create Mock Rules
1. Click on any request in Live Traffic
2. Click **"Create Mock Rule"**
3. Modify the response as needed
4. Save the rule

### Mock Rule Examples

**Mock login error:**
- URL Pattern: `*/api/*/login*`
- Status: `401`
- Body: `{"error": "Invalid credentials"}`

**Mock user profile:**
- URL Pattern: `*/api/users/profile*`
- Status: `200`
- Body: `{"name": "Test User", "balance": 1000000}`

## Ports

| Service | Port |
|---------|------|
| Dashboard | 3000 |
| Proxy | 8888 |

## Troubleshooting

### "No Internet" error
- Make sure proxy is running (green status in header)
- If stopped, Mac Proxy is automatically disabled

### HTTPS sites not working
- Install and trust the mitmproxy certificate
- Restart your browser after installing

### iPhone can't connect
- Must be on same WiFi as Mac
- Check Mac IP is correct (shown in Tutorial → Real iPhone tab)
- Proxy must be running

### Traffic not showing
- Check proxy is running
- Check Mac Proxy is enabled (Setup Guide tab)
- For iPhone: verify proxy settings in WiFi config

## Project Structure

```
mitmproxy-ui/
├── server.js           # Express server
├── lib/
│   ├── mitmproxy.js    # Proxy process management
│   ├── simulator.js    # iOS Simulator controls
│   └── mockRules.js    # Mock rules CRUD
├── scripts/
│   └── mitm-addon.py   # mitmproxy addon
├── public/
│   └── index.html      # Dashboard UI
└── data/
    └── rules.json      # Saved mock rules
```

## License

MIT
