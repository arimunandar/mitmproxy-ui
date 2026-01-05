const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const mitmproxy = require('./lib/mitmproxy');
const simulator = require('./lib/simulator');
const mockRules = require('./lib/mockRules');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Configuration
const PORT = process.env.PORT || 3000;
const PROXY_PORT = process.env.PROXY_PORT || 8888;  // Changed from 8080 to avoid conflicts

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Store connected WebSocket clients
const clients = new Set();

// Traffic history (keep last 500 requests in memory)
const trafficHistory = [];
const MAX_TRAFFIC_HISTORY = 500;

// WebSocket connection handling
wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('WebSocket client connected');

  // Send current status on connect
  ws.send(JSON.stringify({
    type: 'status',
    data: {
      proxy: mitmproxy.status(),
      recording: mockRules.getRecordingStatus()
    }
  }));

  // Send recent traffic history
  ws.send(JSON.stringify({
    type: 'history',
    data: trafficHistory.slice(-100)
  }));

  ws.on('close', () => {
    clients.delete(ws);
    console.log('WebSocket client disconnected');
  });
});

// Broadcast to all connected clients
function broadcast(type, data) {
  const message = JSON.stringify({ type, data });
  clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(message);
    }
  });
}

// ============================================
// Proxy Control API
// ============================================

app.post('/api/proxy/start', async (req, res) => {
  try {
    const port = req.body.port || PROXY_PORT;
    const result = await mitmproxy.start({ port, serverPort: PORT });
    broadcast('status', { proxy: mitmproxy.status() });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/proxy/stop', async (req, res) => {
  try {
    const result = await mitmproxy.stop();
    broadcast('status', { proxy: mitmproxy.status() });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/proxy/status', (req, res) => {
  res.json(mitmproxy.status());
});

// ============================================
// Simulator API
// ============================================

app.get('/api/simulators', async (req, res) => {
  try {
    const simulators = await simulator.list();
    res.json(simulators);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/simulators/boot', async (req, res) => {
  try {
    const { udid } = req.body;
    if (!udid) {
      return res.status(400).json({ error: 'udid is required' });
    }
    const result = await simulator.boot(udid, PROXY_PORT);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/simulators/shutdown', async (req, res) => {
  try {
    const { udid } = req.body;
    if (udid) {
      const result = await simulator.shutdown(udid);
      res.json(result);
    } else {
      const result = await simulator.shutdownAll();
      res.json(result);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/simulators/erase', async (req, res) => {
  try {
    const { udid } = req.body;
    if (!udid) {
      return res.status(400).json({ error: 'udid is required' });
    }
    const result = await simulator.erase(udid);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/simulators/certificate-instructions', (req, res) => {
  res.json(simulator.getCertificateInstructions(PROXY_PORT));
});

app.post('/api/simulators/open-url', async (req, res) => {
  try {
    const { udid, url } = req.body;
    if (!udid || !url) {
      return res.status(400).json({ error: 'udid and url are required' });
    }
    const result = await simulator.openURL(udid, url);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mac proxy control
app.post('/api/mac-proxy/enable', async (req, res) => {
  try {
    const result = await simulator.enableMacProxy(PROXY_PORT);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/mac-proxy/disable', async (req, res) => {
  try {
    const result = await simulator.disableMacProxy();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/mac-proxy/status', async (req, res) => {
  try {
    const result = await simulator.getMacProxyStatus();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Mock Rules API
// ============================================

app.get('/api/rules', async (req, res) => {
  try {
    const rules = await mockRules.getAll();
    res.json(rules);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rules', async (req, res) => {
  try {
    const rule = await mockRules.create(req.body);
    broadcast('rulesUpdated', await mockRules.getAll());
    res.json(rule);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/rules/:id', async (req, res) => {
  try {
    const rule = await mockRules.update(req.params.id, req.body);
    broadcast('rulesUpdated', await mockRules.getAll());
    res.json(rule);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/rules/:id', async (req, res) => {
  try {
    const result = await mockRules.remove(req.params.id);
    broadcast('rulesUpdated', await mockRules.getAll());
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rules/:id/toggle', async (req, res) => {
  try {
    const rule = await mockRules.toggle(req.params.id);
    broadcast('rulesUpdated', await mockRules.getAll());
    res.json(rule);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rules/export', async (req, res) => {
  try {
    const script = await mockRules.generatePythonScript(PORT);
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="mock_rules.py"');
    res.send(script);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Traffic API (receives data from mitmproxy addon)
// ============================================

app.post('/api/traffic', (req, res) => {
  const trafficData = req.body;

  // Add to history
  trafficHistory.push(trafficData);
  if (trafficHistory.length > MAX_TRAFFIC_HISTORY) {
    trafficHistory.shift();
  }

  // Add to recording if active
  mockRules.addToRecording(trafficData);

  // Broadcast to all clients
  broadcast('traffic', trafficData);

  res.json({ received: true });
});

app.get('/api/traffic/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json(trafficHistory.slice(-limit));
});

app.delete('/api/traffic/history', (req, res) => {
  trafficHistory.length = 0;
  broadcast('historyCleared', {});
  res.json({ cleared: true });
});

// ============================================
// Recording API
// ============================================

app.get('/api/recordings', async (req, res) => {
  try {
    const recordings = await mockRules.listRecordings();
    res.json(recordings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/recordings/status', (req, res) => {
  res.json(mockRules.getRecordingStatus());
});

app.post('/api/recordings/start', (req, res) => {
  try {
    const { name } = req.body;
    const recording = mockRules.startRecording(name);
    broadcast('recordingStarted', recording);
    res.json(recording);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/recordings/stop', async (req, res) => {
  try {
    const recording = await mockRules.stopRecording();
    broadcast('recordingStopped', recording);
    res.json(recording);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/recordings/:id', async (req, res) => {
  try {
    const recording = await mockRules.getRecording(req.params.id);
    res.json(recording);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/recordings/:id/to-rules', async (req, res) => {
  try {
    const rules = await mockRules.recordingToRules(req.params.id);
    broadcast('rulesUpdated', await mockRules.getAll());
    res.json(rules);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Cleanup on exit
// ============================================

async function cleanup() {
  console.log('\nShutting down...');
  await mitmproxy.stop();
  await mitmproxy.killOrphaned();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// ============================================
// Start server
// ============================================

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║           mitmproxy-ui for iOS Simulator              ║
╠═══════════════════════════════════════════════════════╣
║  Dashboard:  http://localhost:${PORT}                    ║
║  Proxy Port: ${PROXY_PORT}                                     ║
╚═══════════════════════════════════════════════════════╝
`);
});
