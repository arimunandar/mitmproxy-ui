const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '..', 'data');
const RULES_FILE = path.join(DATA_DIR, 'rules.json');
const RECORDINGS_DIR = path.join(DATA_DIR, 'recordings');

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(RECORDINGS_DIR, { recursive: true });
  } catch (error) {
    // Ignore if already exists
  }
}

// Load rules from file
async function loadRules() {
  await ensureDataDir();
  try {
    const data = await fs.readFile(RULES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // Return empty array if file doesn't exist
    return [];
  }
}

// Save rules to file
async function saveRules(rules) {
  await ensureDataDir();
  await fs.writeFile(RULES_FILE, JSON.stringify(rules, null, 2));
}

// Get all rules
async function getAll() {
  return await loadRules();
}

// Get a single rule by ID
async function getById(id) {
  const rules = await loadRules();
  return rules.find(rule => rule.id === id);
}

// Create a new rule
async function create(ruleData) {
  const rules = await loadRules();

  const newRule = {
    id: uuidv4(),
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // Rule matching
    urlPattern: ruleData.urlPattern || '*',
    urlPatternType: ruleData.urlPatternType || 'wildcard', // 'exact', 'wildcard', 'regex'
    method: ruleData.method || 'ANY', // GET, POST, PUT, DELETE, ANY
    // Response
    statusCode: ruleData.statusCode || 200,
    headers: ruleData.headers || { 'Content-Type': 'application/json' },
    body: ruleData.body || '{}',
    // Options
    delay: ruleData.delay || 0, // ms
    description: ruleData.description || ''
  };

  rules.push(newRule);
  await saveRules(rules);
  return newRule;
}

// Update a rule
async function update(id, updates) {
  const rules = await loadRules();
  const index = rules.findIndex(rule => rule.id === id);

  if (index === -1) {
    throw new Error(`Rule not found: ${id}`);
  }

  rules[index] = {
    ...rules[index],
    ...updates,
    id, // Prevent ID from being changed
    updatedAt: new Date().toISOString()
  };

  await saveRules(rules);
  return rules[index];
}

// Delete a rule
async function remove(id) {
  const rules = await loadRules();
  const filtered = rules.filter(rule => rule.id !== id);

  if (filtered.length === rules.length) {
    throw new Error(`Rule not found: ${id}`);
  }

  await saveRules(filtered);
  return { deleted: true, id };
}

// Toggle a rule's enabled status
async function toggle(id) {
  const rules = await loadRules();
  const rule = rules.find(r => r.id === id);

  if (!rule) {
    throw new Error(`Rule not found: ${id}`);
  }

  return await update(id, { enabled: !rule.enabled });
}

// Generate mitmproxy Python script from rules
async function generatePythonScript(serverPort = 3000) {
  const rules = await loadRules();
  const enabledRules = rules.filter(r => r.enabled);

  const script = `"""
Auto-generated mitmproxy addon for mock rules.
Generated at: ${new Date().toISOString()}
"""

import re
import json
import time
import fnmatch
from mitmproxy import http, ctx

# Mock rules configuration
MOCK_RULES = ${JSON.stringify(enabledRules, null, 2)}

def match_url(pattern, pattern_type, url):
    """Match URL against pattern based on pattern type."""
    if pattern_type == 'exact':
        return url == pattern
    elif pattern_type == 'wildcard':
        return fnmatch.fnmatch(url, pattern)
    elif pattern_type == 'regex':
        try:
            return bool(re.search(pattern, url))
        except re.error:
            return False
    return False

def match_method(rule_method, request_method):
    """Match HTTP method."""
    if rule_method == 'ANY':
        return True
    return rule_method.upper() == request_method.upper()

class MockRulesAddon:
    def request(self, flow: http.HTTPFlow) -> None:
        url = flow.request.pretty_url
        method = flow.request.method

        for rule in MOCK_RULES:
            if not rule.get('enabled', True):
                continue

            if match_url(rule['urlPattern'], rule.get('urlPatternType', 'wildcard'), url):
                if match_method(rule.get('method', 'ANY'), method):
                    # Apply delay if specified
                    delay = rule.get('delay', 0)
                    if delay > 0:
                        time.sleep(delay / 1000.0)

                    # Create mock response
                    headers = rule.get('headers', {'Content-Type': 'application/json'})
                    body = rule.get('body', '{}')

                    if isinstance(body, dict):
                        body = json.dumps(body)

                    flow.response = http.Response.make(
                        rule.get('statusCode', 200),
                        body.encode('utf-8'),
                        headers
                    )

                    ctx.log.info(f"[MockRule] Matched: {rule.get('description', rule['urlPattern'])} -> {url}")
                    return

addons = [MockRulesAddon()]
`;

  return script;
}

// Export rules to Python script file
async function exportToPython(outputPath) {
  const script = await generatePythonScript();
  await fs.writeFile(outputPath, script);
  return { success: true, path: outputPath };
}

// Recording functionality
let currentRecording = null;
let recordedRequests = [];

function startRecording(name) {
  if (currentRecording) {
    throw new Error('Recording already in progress');
  }

  currentRecording = {
    id: uuidv4(),
    name: name || `Recording ${new Date().toISOString()}`,
    startedAt: new Date().toISOString()
  };
  recordedRequests = [];

  return currentRecording;
}

function addToRecording(request) {
  if (currentRecording) {
    recordedRequests.push({
      ...request,
      recordedAt: new Date().toISOString()
    });
  }
}

async function stopRecording() {
  if (!currentRecording) {
    throw new Error('No recording in progress');
  }

  const recording = {
    ...currentRecording,
    endedAt: new Date().toISOString(),
    requests: recordedRequests
  };

  // Save recording to file
  await ensureDataDir();
  const filename = `${recording.id}.json`;
  const filepath = path.join(RECORDINGS_DIR, filename);
  await fs.writeFile(filepath, JSON.stringify(recording, null, 2));

  currentRecording = null;
  recordedRequests = [];

  return recording;
}

function getRecordingStatus() {
  return {
    isRecording: !!currentRecording,
    recording: currentRecording,
    requestCount: recordedRequests.length
  };
}

// List all recordings
async function listRecordings() {
  await ensureDataDir();
  try {
    const files = await fs.readdir(RECORDINGS_DIR);
    const recordings = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filepath = path.join(RECORDINGS_DIR, file);
        const data = await fs.readFile(filepath, 'utf8');
        const recording = JSON.parse(data);
        recordings.push({
          id: recording.id,
          name: recording.name,
          startedAt: recording.startedAt,
          endedAt: recording.endedAt,
          requestCount: recording.requests?.length || 0
        });
      }
    }

    return recordings.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  } catch (error) {
    return [];
  }
}

// Get a single recording
async function getRecording(id) {
  const filepath = path.join(RECORDINGS_DIR, `${id}.json`);
  const data = await fs.readFile(filepath, 'utf8');
  return JSON.parse(data);
}

// Convert recording to mock rules
async function recordingToRules(recordingId) {
  const recording = await getRecording(recordingId);
  const createdRules = [];

  for (const request of recording.requests) {
    if (request.response) {
      const rule = await create({
        urlPattern: request.url,
        urlPatternType: 'exact',
        method: request.method,
        statusCode: request.response.status,
        headers: request.response.headers || { 'Content-Type': 'application/json' },
        body: request.response.body || '{}',
        description: `From recording: ${recording.name}`
      });
      createdRules.push(rule);
    }
  }

  return createdRules;
}

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
  toggle,
  generatePythonScript,
  exportToPython,
  startRecording,
  addToRecording,
  stopRecording,
  getRecordingStatus,
  listRecordings,
  getRecording,
  recordingToRules
};
