import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const lock = {
  active: false,
  sessionId: null,
  startedAt: null,
  lastHeartbeat: null,
  clientId: null
};

const broadcast = (type, payload = {}) => {
  const message = JSON.stringify({ type, payload, sentAt: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
};

const publishState = () => {
  broadcast('session-state', {
    state: lock.active ? 'active' : 'idle',
    sessionId: lock.sessionId,
    startedAt: lock.startedAt,
    clientId: lock.clientId
  });
};

app.use(express.json({ limit: '1mb' }));
app.use(express.raw({ type: '*/*', limit: '10mb' }));

app.get('/api/health', (_, res) => {
  res.json({ ok: true, state: lock.active ? 'active' : 'idle' });
});

app.post('/api/session/start', (req, res) => {
  if (lock.active) {
    return res.status(409).json({ ok: false, error: 'frog busy' });
  }

  const sessionId = `session-${Date.now()}`;
  lock.active = true;
  lock.sessionId = sessionId;
  lock.startedAt = Date.now();
  lock.lastHeartbeat = Date.now();
  lock.clientId = req.body?.clientId ?? 'unknown-client';

  publishState();
  res.json({ ok: true, sessionId, status: 'active' });
});

app.post('/api/session/end', (_, res) => {
  lock.active = false;
  lock.sessionId = null;
  lock.startedAt = null;
  lock.lastHeartbeat = null;
  lock.clientId = null;

  publishState();
  res.json({ ok: true, status: 'idle' });
});

app.post('/api/session/reset', (_, res) => {
  lock.active = false;
  lock.sessionId = null;
  lock.startedAt = null;
  lock.lastHeartbeat = null;
  lock.clientId = null;

  publishState();
  res.json({ ok: true, status: 'idle' });
});

app.post('/api/transcribe', async (req, res) => {
  try {
    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ ok: false, error: 'missing audio payload' });
    }

    const audioPath = path.join(os.tmpdir(), `tubi-audio-${Date.now()}.webm`);
    writeFileSync(audioPath, req.body);

    const pythonScript = path.join(rootDir, 'python', 'stt_worker.py');
    const result = await new Promise((resolve, reject) => {
      const child = spawn('python3', [pythonScript, audioPath], {
        cwd: rootDir,
        env: process.env
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(stderr || 'python transcription failed'));
        }

        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(new Error('invalid json response from python stt worker'));
        }
      });
    });

    res.json({ ok: true, text: result.text || 'I did not catch that clearly.' });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'transcription failed'
    });
  }
});

app.post('/api/dev/display', (req, res) => {
  const {
    type = 'display',
    message = 'Tubi is showing a display update.',
    payload = {}
  } = req.body ?? {};

  broadcast(type, { message, ...payload });
  res.json({ ok: true, type, message, payload });
});

app.post('/api/dev/transcript', (req, res) => {
  const { text = 'Demo transcript from the fake backend.' } = req.body ?? {};
  broadcast('transcript', { text, source: 'fake-backend' });
  res.json({ ok: true, text });
});

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'session-state', payload: { state: lock.active ? 'active' : 'idle' } }));

  socket.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      if (data.type === 'session:start') {
        lock.active = true;
        lock.sessionId = data.payload?.sessionId ?? `session-${Date.now()}`;
        lock.startedAt = Date.now();
        lock.lastHeartbeat = Date.now();
        lock.clientId = data.payload?.clientId ?? 'ws-client';
        publishState();
      }

      if (data.type === 'session:end') {
        lock.active = false;
        lock.sessionId = null;
        lock.startedAt = null;
        lock.lastHeartbeat = null;
        lock.clientId = null;
        publishState();
      }

      if (data.type === 'heartbeat') {
        lock.lastHeartbeat = Date.now();
      }

      if (data.type === 'transcript') {
        broadcast('transcript', { text: data.payload?.text ?? '' });
      }
    } catch (error) {
      // ignore malformed messages during early development
    }
  });
});

const serveClient = () => {
  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }
};

serveClient();

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`Tubi server listening on http://localhost:${port}`);
});
