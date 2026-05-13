const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const WebSocket = require('ws');
const QRCode = require('qrcode');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8'
};

const sessions = new Map();

function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      senders: new Set(),
      receivers: new Set(),
      latest: null,
      updatedAt: null
    });
  }
  return sessions.get(sessionId);
}

function cleanupSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;
  if (s.senders.size === 0 && s.receivers.size === 0) {
    sessions.delete(sessionId);
  }
}

function sendJson(res, status, payload) {
  const data = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store'
  });
  res.end(data);
}

function serveStaticFile(reqPath, res) {
  let relativePath = reqPath === '/' ? '/index.html' : reqPath;
  relativePath = decodeURIComponent(relativePath);

  const safePath = path.normalize(relativePath).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === '/api/session' && req.method === 'POST') {
    const id = crypto.randomBytes(4).toString('hex');
    getOrCreateSession(id);
    return sendJson(res, 200, { sessionId: id });
  }

  if (requestUrl.pathname === '/api/qr' && req.method === 'GET') {
    const text = requestUrl.searchParams.get('text') || '';
    if (!text) {
      return sendJson(res, 400, { error: 'Missing text' });
    }

    try {
      const svg = await QRCode.toString(text, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 512
      });
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(svg);
    } catch (err) {
      return sendJson(res, 500, { error: 'Failed to render QR code' });
    }
    return;
  }

  if (requestUrl.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }

  serveStaticFile(requestUrl.pathname, res);
});

const wsServer = new WebSocket.Server({ server, path: '/ws' });

function safeSend(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

wsServer.on('connection', (socket, request) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const sessionId = (requestUrl.searchParams.get('session') || '').trim();
  const role = (requestUrl.searchParams.get('role') || '').trim();

  if (!sessionId || !['sender', 'receiver'].includes(role)) {
    safeSend(socket, { type: 'error', message: 'Invalid session or role' });
    socket.close(1008, 'Invalid parameters');
    return;
  }

  const session = getOrCreateSession(sessionId);
  if (role === 'sender') session.senders.add(socket);
  if (role === 'receiver') session.receivers.add(socket);

  safeSend(socket, {
    type: 'connected',
    role,
    sessionId,
    hasLatest: Boolean(session.latest)
  });

  if (role === 'receiver' && session.latest) {
    safeSend(socket, {
      type: 'qr_update',
      content: session.latest,
      updatedAt: session.updatedAt
    });
  }

  socket.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      safeSend(socket, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    if (role !== 'sender') return;
    if (data.type !== 'qr_update') return;

    const content = typeof data.content === 'string' ? data.content.trim() : '';
    if (!content) return;

    session.latest = content;
    session.updatedAt = new Date().toISOString();

    const payload = {
      type: 'qr_update',
      content,
      updatedAt: session.updatedAt
    };

    for (const receiverSocket of session.receivers) {
      safeSend(receiverSocket, payload);
    }
  });

  socket.on('close', () => {
    session.senders.delete(socket);
    session.receivers.delete(socket);
    cleanupSession(sessionId);
  });

  socket.on('error', () => {
    session.senders.delete(socket);
    session.receivers.delete(socket);
    cleanupSession(sessionId);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`ChaoxingHelper relay server listening on http://${HOST}:${PORT}`);
});
