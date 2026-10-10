import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import { WebSocketServer } from 'ws';
import { SessionLock } from './session-lock.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const transcriptOutputPath = path.join(rootDir, 'output', 'transcripts.jsonl');

const appendTranscriptFile = (text) => {
  const outputDir = path.dirname(transcriptOutputPath);
  mkdirSync(outputDir, { recursive: true });
  appendFileSync(
    transcriptOutputPath,
    `${JSON.stringify({ timestamp: new Date().toISOString(), text })}\n`,
    'utf8'
  );
};

const resetTranscriptFile = () => {
  mkdirSync(path.dirname(transcriptOutputPath), { recursive: true });
  writeFileSync(transcriptOutputPath, '', 'utf8');
};

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const getDuration = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const sessionLock = new SessionLock({
  idleTimeoutMs: getDuration('SESSION_IDLE_TIMEOUT_MS', 60_000),
  maxDurationMs: getDuration('SESSION_MAX_DURATION_MS', 180_000)
});
let devBusySessionId = null;

const clearExpiredDevBusy = () => {
  if (devBusySessionId && !sessionLock.isOwner(devBusySessionId)) {
    devBusySessionId = null;
  }
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
  broadcast('session-state', sessionLock.snapshot());
};

const expiryTimer = setInterval(() => {
  if (sessionLock.expireIfNeeded()) {
    clearExpiredDevBusy();
    resetTranscriptFile();
    publishState();
  }
}, 5_000);
expiryTimer.unref();

app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_, res) => {
  if (sessionLock.expireIfNeeded()) {
    resetTranscriptFile();
    publishState();
  }
  clearExpiredDevBusy();
  res.json({ ok: true, ...sessionLock.snapshot(), devBusy: Boolean(devBusySessionId) });
});

app.post('/api/session/start', (_, res) => {
  if (sessionLock.expireIfNeeded()) {
    resetTranscriptFile();
    publishState();
  }
  const session = sessionLock.start();
  if (!session) {
    return res.status(409).json({ ok: false, error: 'frog busy' });
  }

  resetTranscriptFile();
  publishState();
  res.json({ ok: true, ...session, status: 'active' });
});

app.post('/api/session/resume', (req, res) => {
  if (sessionLock.expireIfNeeded()) {
    resetTranscriptFile();
    publishState();
  }
  const session = sessionLock.resume(req.body?.sessionId);
  if (!session) {
    return res.status(409).json({ ok: false, error: 'session expired or not owned by this tab' });
  }

  res.json({ ok: true, ...session, status: 'active' });
});

app.post('/api/session/heartbeat', (req, res) => {
  if (sessionLock.expireIfNeeded()) {
    resetTranscriptFile();
    publishState();
  }
  if (!sessionLock.heartbeat(req.body?.sessionId)) {
    return res.status(409).json({ ok: false, error: 'session expired or not owned by this tab' });
  }

  res.json({ ok: true });
});

app.post('/api/session/end', (req, res) => {
  if (sessionLock.expireIfNeeded()) {
    resetTranscriptFile();
    publishState();
  }
  if (!sessionLock.end(req.body?.sessionId)) {
    return res.status(409).json({ ok: false, error: 'session expired or not owned by this tab' });
  }

  resetTranscriptFile();
  publishState();
  res.json({ ok: true, status: 'idle' });
});

app.post('/api/session/reset', (_, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ ok: false, error: 'not found' });
  }

  sessionLock.forceEnd();
  devBusySessionId = null;
  resetTranscriptFile();
  publishState();
  res.json({ ok: true, status: 'idle' });
});

app.post('/api/dev/session/busy', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ ok: false, error: 'not found' });
  }

  if (sessionLock.expireIfNeeded()) {
    resetTranscriptFile();
    publishState();
  }
  clearExpiredDevBusy();

  if (req.body?.busy) {
    if (!devBusySessionId) {
      const session = sessionLock.start();
      if (!session) {
        return res.status(409).json({ ok: false, error: 'another session already owns the lock' });
      }
      devBusySessionId = session.sessionId;
      publishState();
    }
  } else if (devBusySessionId) {
    const released = sessionLock.end(devBusySessionId);
    devBusySessionId = null;
    if (released) publishState();
  }

  res.json({
    ok: true,
    devBusy: Boolean(devBusySessionId),
    ...sessionLock.snapshot()
  });
});

app.post('/api/transcribe', async (req, res) => {
  try {
    if (sessionLock.expireIfNeeded()) publishState();
    if (!sessionLock.heartbeat(req.body?.sessionId)) {
      return res.status(409).json({ ok: false, error: 'active session required' });
    }

    if (!req.body || (typeof req.body === 'object' && Object.keys(req.body).length === 0)) {
      return res.status(400).json({ ok: false, error: 'missing audio payload' });
    }

    let audioBuffer;
    let mimeType = 'audio/webm';
    let extension = 'webm';

    const candidate =
      (typeof req.body === 'object' && req.body !== null && 'audioBase64' in req.body)
        ? req.body.audioBase64
        : (typeof req.body === 'object' && req.body !== null && 'audio' in req.body)
          ? req.body.audio
          : undefined;

    if (Buffer.isBuffer(req.body)) {
      audioBuffer = req.body;
    } else if (typeof candidate === 'string') {
      mimeType = req.body.mimeType || 'audio/webm';
      extension = req.body.extension || (mimeType.includes('wav') ? 'wav' : 'webm');
      const base64Data = candidate.replace(/^data:audio\/[a-zA-Z0-9.+-]+;base64,/, '');
      audioBuffer = Buffer.from(base64Data, 'base64');
    } else if (typeof req.body === 'string') {
      audioBuffer = Buffer.from(req.body, 'base64');
    } else if (ArrayBuffer.isView(req.body) || req.body instanceof ArrayBuffer) {
      audioBuffer = Buffer.from(req.body);
    } else {
      audioBuffer = Buffer.from(JSON.stringify(req.body));
    }

    const audioPath = path.join(os.tmpdir(), `tubi-audio-${Date.now()}.${extension}`);
    writeFileSync(audioPath, audioBuffer);

    const pythonScript = path.join(rootDir, 'python', 'stt_worker.py');
    const result = await new Promise((resolve, reject) => {
      const child = spawn('.venv/bin/python', [pythonScript, audioPath], {
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

    if (!sessionLock.heartbeat(req.body.sessionId)) {
      return res.status(409).json({ ok: false, error: 'session ended before transcription completed' });
    }

    const text = result.text || 'I did not catch that clearly.';
    appendTranscriptFile(text);
    res.json({ ok: true, text });
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
  socket.send(JSON.stringify({ type: 'session-state', payload: sessionLock.snapshot() }));

  socket.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());

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
