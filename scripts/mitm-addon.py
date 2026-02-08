"""
mitmproxy addon that captures traffic and sends it to the mitmproxy-ui server.
This addon also applies mock rules from the server.
Supports HTTP and WebSocket traffic capture.
"""

import json
import time
import fnmatch
import re
import urllib.request
import urllib.error
from mitmproxy import http, ctx, websocket

# Server configuration - will be passed via --set server_port=3000
SERVER_PORT = 3000

def get_server_url():
    """Get the server URL from mitmproxy options."""
    try:
        port = ctx.options.server_port
    except AttributeError:
        port = SERVER_PORT
    return f"http://127.0.0.1:{port}"

def send_to_server(endpoint, data):
    """Send data to the mitmproxy-ui server, bypassing proxy."""
    try:
        url = f"{get_server_url()}{endpoint}"

        # Create a proxy handler that bypasses proxy for localhost
        # This prevents the infinite loop when Mac proxy is enabled
        proxy_handler = urllib.request.ProxyHandler({})
        opener = urllib.request.build_opener(proxy_handler)

        req = urllib.request.Request(
            url,
            data=json.dumps(data).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        opener.open(req, timeout=1)
    except Exception as e:
        # Don't log errors to avoid noise - server might not be running
        pass

def load_option(name, default):
    """Load option from mitmproxy context."""
    try:
        return getattr(ctx.options, name)
    except AttributeError:
        return default

class MitmProxyUIAddon:
    """Main addon class for mitmproxy-ui integration."""

    def __init__(self):
        self.mock_rules = []
        self.last_rules_fetch = 0
        self.rules_cache_ttl = 5  # Refresh rules every 5 seconds

    def load(self, loader):
        """Register addon options."""
        loader.add_option(
            name="server_port",
            typespec=int,
            default=3000,
            help="Port where mitmproxy-ui server is running"
        )

    def fetch_mock_rules(self):
        """Fetch mock rules from server, bypassing proxy."""
        now = time.time()
        if now - self.last_rules_fetch < self.rules_cache_ttl:
            return self.mock_rules

        try:
            url = f"{get_server_url()}/api/rules"
            # Bypass proxy for localhost to prevent infinite loop
            proxy_handler = urllib.request.ProxyHandler({})
            opener = urllib.request.build_opener(proxy_handler)

            req = urllib.request.Request(url, method='GET')
            with opener.open(req, timeout=1) as response:
                self.mock_rules = json.loads(response.read().decode('utf-8'))
                self.last_rules_fetch = now
        except Exception:
            pass

        return self.mock_rules

    def match_url(self, pattern, pattern_type, url):
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

    def match_method(self, rule_method, request_method):
        """Match HTTP method."""
        if rule_method == 'ANY':
            return True
        return rule_method.upper() == request_method.upper()

    def find_matching_rule(self, url, method):
        """Find a matching mock rule for the request."""
        rules = self.fetch_mock_rules()

        for rule in rules:
            if not rule.get('enabled', True):
                continue

            if self.match_url(rule['urlPattern'], rule.get('urlPatternType', 'wildcard'), url):
                if self.match_method(rule.get('method', 'ANY'), method):
                    return rule

        return None

    def request(self, flow: http.HTTPFlow) -> None:
        """Handle incoming request."""
        url = flow.request.pretty_url
        method = flow.request.method

        # Check for matching mock rule
        rule = self.find_matching_rule(url, method)

        if rule:
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

            # Mark as mocked for logging
            flow.metadata['mocked'] = True
            flow.metadata['rule_id'] = rule.get('id')

            ctx.log.info(f"[Mock] {method} {url} -> {rule.get('statusCode', 200)}")

    def response(self, flow: http.HTTPFlow) -> None:
        """Handle response (both real and mocked)."""
        # Extract request info
        request_data = {
            'id': flow.id,
            'timestamp': time.time(),
            'method': flow.request.method,
            'url': flow.request.pretty_url,
            'host': flow.request.host,
            'path': flow.request.path,
            'requestHeaders': dict(flow.request.headers),
            'requestBody': self.safe_decode(flow.request.content),
            'mocked': flow.metadata.get('mocked', False),
            'ruleId': flow.metadata.get('rule_id')
        }

        # Extract response info
        if flow.response:
            request_data['response'] = {
                'status': flow.response.status_code,
                'reason': flow.response.reason,
                'headers': dict(flow.response.headers),
                'body': self.safe_decode(flow.response.content),
                'size': len(flow.response.content) if flow.response.content else 0
            }

        # Calculate timing
        if flow.request.timestamp_start and flow.response and flow.response.timestamp_end:
            request_data['duration'] = round(
                (flow.response.timestamp_end - flow.request.timestamp_start) * 1000, 2
            )

        # Send to server
        send_to_server('/api/traffic', request_data)

    def safe_decode(self, content):
        """Safely decode content to string."""
        if not content:
            return None

        # Limit size to avoid huge payloads
        max_size = 50000
        if len(content) > max_size:
            return f"[Content too large: {len(content)} bytes]"

        try:
            return content.decode('utf-8')
        except UnicodeDecodeError:
            try:
                return content.decode('latin-1')
            except:
                return f"[Binary content: {len(content)} bytes]"

    # WebSocket handlers
    def websocket_start(self, flow: http.HTTPFlow) -> None:
        """Handle WebSocket connection start."""
        ws_data = {
            'id': f"ws-{flow.id}",
            'timestamp': time.time(),
            'type': 'websocket',
            'event': 'open',
            'method': 'WS',
            'url': flow.request.pretty_url.replace('http://', 'ws://').replace('https://', 'wss://'),
            'host': flow.request.host,
            'path': flow.request.path,
            'requestHeaders': dict(flow.request.headers),
            'requestBody': None,
            'mocked': False,
            'ruleId': None,
            'response': {
                'status': 101,
                'reason': 'Switching Protocols',
                'headers': dict(flow.response.headers) if flow.response else {},
                'body': '[WebSocket Connected]',
                'size': 0
            }
        }
        send_to_server('/api/traffic', ws_data)
        ctx.log.info(f"[WebSocket] Connected: {flow.request.pretty_url}")

    def websocket_message(self, flow: http.HTTPFlow) -> None:
        """Handle WebSocket message."""
        import base64

        message = flow.websocket.messages[-1]

        # Determine direction
        direction = "→" if message.from_client else "←"
        msg_type = "sent" if message.from_client else "received"

        # Decode message content
        if message.is_text:
            content = message.text
            content_type = 'text'
        else:
            # For binary (Protobuf, etc.), encode as base64 for display/copying
            content = base64.b64encode(message.content).decode('ascii')
            content_type = 'binary/protobuf'

        ws_data = {
            'id': f"ws-msg-{flow.id}-{len(flow.websocket.messages)}",
            'timestamp': time.time(),
            'type': 'websocket',
            'event': 'message',
            'method': f"WS {direction}",
            'url': flow.request.pretty_url.replace('http://', 'ws://').replace('https://', 'wss://'),
            'host': flow.request.host,
            'path': flow.request.path,
            'requestHeaders': {
                'Direction': msg_type,
                'Content-Type': content_type,
                'Size': f"{len(message.content)} bytes"
            },
            'requestBody': content if message.from_client else None,
            'mocked': False,
            'ruleId': None,
            'response': {
                'status': 0,
                'reason': msg_type,
                'headers': {
                    'Direction': msg_type,
                    'Content-Type': content_type,
                    'Size': f"{len(message.content)} bytes"
                },
                'body': content if not message.from_client else None,
                'size': len(message.content)
            },
            'duration': 0
        }
        send_to_server('/api/traffic', ws_data)

    def websocket_end(self, flow: http.HTTPFlow) -> None:
        """Handle WebSocket connection end."""
        ws_data = {
            'id': f"ws-close-{flow.id}",
            'timestamp': time.time(),
            'type': 'websocket',
            'event': 'close',
            'method': 'WS ✕',
            'url': flow.request.pretty_url.replace('http://', 'ws://').replace('https://', 'wss://'),
            'host': flow.request.host,
            'path': flow.request.path,
            'requestHeaders': {},
            'requestBody': None,
            'mocked': False,
            'ruleId': None,
            'response': {
                'status': 0,
                'reason': 'Connection Closed',
                'headers': {},
                'body': '[WebSocket Closed]',
                'size': 0
            }
        }
        send_to_server('/api/traffic', ws_data)
        ctx.log.info(f"[WebSocket] Closed: {flow.request.pretty_url}")

addons = [MitmProxyUIAddon()]
