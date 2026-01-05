const { spawn, exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Parse simulator list from xcrun simctl
async function list() {
  try {
    const { stdout } = await execAsync('xcrun simctl list devices -j');
    const data = JSON.parse(stdout);

    const simulators = [];

    for (const [runtime, devices] of Object.entries(data.devices)) {
      // Extract OS name and version from runtime
      // e.g., "com.apple.CoreSimulator.SimRuntime.iOS-17-2" -> "iOS 17.2"
      const runtimeMatch = runtime.match(/SimRuntime\.(\w+)-(\d+)-(\d+)/);
      let osName = runtime;
      if (runtimeMatch) {
        osName = `${runtimeMatch[1]} ${runtimeMatch[2]}.${runtimeMatch[3]}`;
      }

      for (const device of devices) {
        simulators.push({
          udid: device.udid,
          name: device.name,
          state: device.state.toLowerCase(),
          os: osName,
          isAvailable: device.isAvailable
        });
      }
    }

    // Sort: booted first, then by OS (descending), then by name
    simulators.sort((a, b) => {
      if (a.state === 'booted' && b.state !== 'booted') return -1;
      if (b.state === 'booted' && a.state !== 'booted') return 1;
      if (a.os > b.os) return -1;
      if (a.os < b.os) return 1;
      return a.name.localeCompare(b.name);
    });

    return simulators;
  } catch (error) {
    console.error('Failed to list simulators:', error.message);
    throw error;
  }
}

// Get currently booted simulators
async function getBooted() {
  const all = await list();
  return all.filter(sim => sim.state === 'booted');
}

// Boot a simulator with proxy environment variables
async function boot(udid, proxyPort = 8080) {
  try {
    // First boot the simulator
    await execAsync(`xcrun simctl boot "${udid}"`);

    // Open the Simulator app to show the UI
    await execAsync('open -a Simulator');

    return {
      success: true,
      udid,
      message: `Simulator booted. Configure proxy manually or use the certificate installation.`,
      proxyInstructions: {
        note: 'iOS Simulator uses Mac network. Set proxy on Mac:',
        commands: [
          `networksetup -setwebproxy "Wi-Fi" 127.0.0.1 ${proxyPort}`,
          `networksetup -setsecurewebproxy "Wi-Fi" 127.0.0.1 ${proxyPort}`
        ]
      }
    };
  } catch (error) {
    // Check if already booted
    if (error.message.includes('Unable to boot device in current state: Booted')) {
      await execAsync('open -a Simulator');
      return { success: true, udid, message: 'Simulator was already booted' };
    }
    throw error;
  }
}

// Shutdown a simulator
async function shutdown(udid) {
  try {
    await execAsync(`xcrun simctl shutdown "${udid}"`);
    return { success: true, udid };
  } catch (error) {
    if (error.message.includes('Unable to shutdown device in current state: Shutdown')) {
      return { success: true, udid, message: 'Simulator was already shut down' };
    }
    throw error;
  }
}

// Shutdown all simulators
async function shutdownAll() {
  try {
    await execAsync('xcrun simctl shutdown all');
    return { success: true };
  } catch (error) {
    throw error;
  }
}

// Erase a simulator (reset to clean state)
async function erase(udid) {
  try {
    // Shutdown first if running
    await shutdown(udid).catch(() => {});
    await execAsync(`xcrun simctl erase "${udid}"`);
    return { success: true, udid };
  } catch (error) {
    throw error;
  }
}

// Open URL in simulator (useful for certificate installation)
async function openURL(udid, url) {
  try {
    await execAsync(`xcrun simctl openurl "${udid}" "${url}"`);
    return { success: true };
  } catch (error) {
    throw error;
  }
}

// Get certificate installation instructions
function getCertificateInstructions(proxyPort = 8080) {
  return {
    steps: [
      {
        step: 1,
        title: 'Open Safari in Simulator',
        description: 'Launch Safari app in the iOS Simulator'
      },
      {
        step: 2,
        title: 'Navigate to mitm.it',
        description: 'Go to http://mitm.it in Safari',
        url: 'http://mitm.it'
      },
      {
        step: 3,
        title: 'Download Certificate',
        description: 'Tap "Apple" to download the mitmproxy certificate'
      },
      {
        step: 4,
        title: 'Install Profile',
        description: 'Go to Settings > General > VPN & Device Management > mitmproxy > Install'
      },
      {
        step: 5,
        title: 'Trust Certificate',
        description: 'Go to Settings > General > About > Certificate Trust Settings > Enable mitmproxy'
      }
    ],
    macProxyCommands: {
      enable: [
        `networksetup -setwebproxy "Wi-Fi" 127.0.0.1 ${proxyPort}`,
        `networksetup -setsecurewebproxy "Wi-Fi" 127.0.0.1 ${proxyPort}`
      ],
      disable: [
        'networksetup -setwebproxystate "Wi-Fi" off',
        'networksetup -setsecurewebproxystate "Wi-Fi" off'
      ]
    }
  };
}

// Enable Mac proxy settings
async function enableMacProxy(proxyPort = 8080) {
  try {
    await execAsync(`networksetup -setwebproxy "Wi-Fi" 127.0.0.1 ${proxyPort}`);
    await execAsync(`networksetup -setsecurewebproxy "Wi-Fi" 127.0.0.1 ${proxyPort}`);
    // Set proxy bypass for localhost to prevent infinite loops
    await execAsync(`networksetup -setproxybypassdomains "Wi-Fi" "localhost" "127.0.0.1" "*.local"`);
    return { success: true, port: proxyPort };
  } catch (error) {
    throw error;
  }
}

// Disable Mac proxy settings
async function disableMacProxy() {
  try {
    await execAsync('networksetup -setwebproxystate "Wi-Fi" off');
    await execAsync('networksetup -setsecurewebproxystate "Wi-Fi" off');
    return { success: true };
  } catch (error) {
    throw error;
  }
}

// Check Mac proxy status
async function getMacProxyStatus() {
  try {
    const { stdout: httpProxy } = await execAsync('networksetup -getwebproxy "Wi-Fi"');
    const { stdout: httpsProxy } = await execAsync('networksetup -getsecurewebproxy "Wi-Fi"');

    const parseProxy = (output) => {
      const enabled = output.includes('Enabled: Yes');
      const serverMatch = output.match(/Server: (.+)/);
      const portMatch = output.match(/Port: (\d+)/);
      return {
        enabled,
        server: serverMatch ? serverMatch[1].trim() : null,
        port: portMatch ? parseInt(portMatch[1]) : null
      };
    };

    return {
      http: parseProxy(httpProxy),
      https: parseProxy(httpsProxy)
    };
  } catch (error) {
    throw error;
  }
}

module.exports = {
  list,
  getBooted,
  boot,
  shutdown,
  shutdownAll,
  erase,
  openURL,
  getCertificateInstructions,
  enableMacProxy,
  disableMacProxy,
  getMacProxyStatus
};
