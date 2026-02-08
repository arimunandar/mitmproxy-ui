const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

let mitmproxyProcess = null;
let isRunning = false;

const ADDON_PATH = path.join(__dirname, '..', 'scripts', 'mitm-addon.py');
const MITMDUMP_PATH = path.join(os.homedir(), '.mitmproxy-venv', 'bin', 'mitmdump');

function start(options = {}) {
  return new Promise((resolve, reject) => {
    if (isRunning) {
      return reject(new Error('mitmproxy is already running'));
    }

    const port = options.port || 8888;  // Changed from 8080 to avoid conflicts
    const serverPort = options.serverPort || 3000;

    // Build mitmproxy arguments
    const args = [
      '--listen-port', port.toString(),
      '--set', `server_port=${serverPort}`,
      '-s', ADDON_PATH,
      '--set', 'block_global=false',
      // Only ignore the specific IP causing the health check loop
      '--ignore-hosts', '^192\\.168\\.22\\.81:8080$'
    ];

    // Add mode if specified (regular, upstream, etc.)
    if (options.mode) {
      args.push('--mode', options.mode);
    }

    console.log(`Starting mitmproxy on port ${port}...`);
    console.log(`Command: ${MITMDUMP_PATH} ${args.join(' ')}`);

    mitmproxyProcess = spawn(MITMDUMP_PATH, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    let started = false;

    mitmproxyProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[mitmproxy]', output.trim());

      // Check for various success indicators
      if (!started && (
        output.includes('Proxy server listening') ||
        output.includes('proxy listening') ||
        output.includes('HTTP(S) proxy listening')
      )) {
        started = true;
        isRunning = true;
        resolve({ port, pid: mitmproxyProcess.pid });
      }
    });

    mitmproxyProcess.stderr.on('data', (data) => {
      const output = data.toString();
      // Only log actual errors, not info messages
      if (!output.includes('Loading script') && !output.includes('listening')) {
        console.error('[mitmproxy]', output.trim());
      } else {
        console.log('[mitmproxy]', output.trim());
      }

      // mitmproxy outputs to stderr for normal messages too
      if (!started && (
        output.includes('Proxy server listening') ||
        output.includes('proxy listening') ||
        output.includes('HTTP(S) proxy listening') ||
        output.includes('Loading script')
      )) {
        started = true;
        isRunning = true;
        resolve({ port, pid: mitmproxyProcess.pid });
      }
    });

    mitmproxyProcess.on('close', (code) => {
      console.log(`mitmproxy exited with code ${code}`);
      isRunning = false;
      mitmproxyProcess = null;
    });

    mitmproxyProcess.on('error', (err) => {
      console.error('Failed to start mitmproxy:', err.message);
      isRunning = false;
      mitmproxyProcess = null;
      reject(err);
    });

    // Timeout if mitmproxy doesn't start within 10 seconds
    setTimeout(() => {
      if (!started) {
        // Assume it started if process is still running
        if (mitmproxyProcess && !mitmproxyProcess.killed) {
          started = true;
          isRunning = true;
          resolve({ port, pid: mitmproxyProcess.pid });
        } else {
          reject(new Error('mitmproxy failed to start within timeout'));
        }
      }
    }, 10000);
  });
}

function stop() {
  return new Promise((resolve) => {
    if (!mitmproxyProcess) {
      isRunning = false;
      return resolve({ stopped: true });
    }

    mitmproxyProcess.on('close', () => {
      isRunning = false;
      mitmproxyProcess = null;
      resolve({ stopped: true });
    });

    // Try graceful shutdown first
    mitmproxyProcess.kill('SIGTERM');

    // Force kill after 5 seconds
    setTimeout(() => {
      if (mitmproxyProcess) {
        mitmproxyProcess.kill('SIGKILL');
      }
    }, 5000);
  });
}

function status() {
  return {
    running: isRunning,
    pid: mitmproxyProcess ? mitmproxyProcess.pid : null
  };
}

// Also kill any orphaned mitmproxy processes
async function killOrphaned() {
  return new Promise((resolve) => {
    const killProcess = spawn('pkill', ['-f', 'mitmdump.*mitm-addon.py']);
    killProcess.on('close', () => resolve());
  });
}

module.exports = {
  start,
  stop,
  status,
  killOrphaned
};
