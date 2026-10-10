import { useEffect, useMemo, useRef, useState } from 'react';

type SessionState = 'idle' | 'busy' | 'active';
type TranscriptItem = {
  id: string;
  text: string;
  source: 'user' | 'system';
  createdAt: string;
};

type ServerMessage = {
  type: string;
  payload?: Record<string, unknown>;
  message?: string;
  state?: SessionState;
};

const getSocketUrl = () => {
  const host = window.location.hostname;
  const port = window.location.port;

  const backendPort = port === '5173' || port === '4173' || !port ? '3000' : port;
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';

  if (host === 'localhost' || host === '127.0.0.1') {
    return `${protocol}://localhost:${backendPort}`;
  }

  return `${protocol}://${host}:${backendPort}`;
};

function App() {
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [status, setStatus] = useState('Waiting for a customer');
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [lastTranscription, setLastTranscription] = useState('No transcription yet.');
  const [isRecording, setIsRecording] = useState(false);
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    const syncSessionState = async () => {
      try {
        const response = await fetch('/api/health');
        const body = (await response.json()) as { state?: SessionState };
        const serverState = body.state === 'active' ? 'active' : 'idle';
        setSessionState(serverState);

        if (serverState === 'active') {
          setStatus('Another customer is already using Tubi.');
        } else {
          setStatus('Waiting for a customer');
        }
      } catch (error) {
        setStatus('Unable to reach the session server.');
      }
    };

    void syncSessionState();

    const socket = new WebSocket(getSocketUrl());
    socketRef.current = socket;

    socket.onopen = () => {
      setIsSocketConnected(true);
      setStatus('Connected. Ready to awaken Tubi.');
    };

    socket.onclose = () => {
      setIsSocketConnected(false);
      setStatus('Connection lost. Reconnect when ready.');
    };

    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data) as ServerMessage;

      if (msg.type === 'session-state') {
        const nextState = (msg.payload?.state ?? 'idle') as SessionState;
        setSessionState(nextState);
        if (nextState === 'busy') {
          setStatus('Another customer is already using Tubi.');
        } else if (nextState === 'active') {
          setStatus('Session active. Press and hold to speak.');
        } else {
          setStatus('Waiting for a customer');
        }
      }

      if (msg.type === 'display') {
        setStatus(msg.message ?? 'Tubi is showing a display update.');
      }

      if (msg.type === 'transcript') {
        const text = String(msg.payload?.text ?? '');
        if (!text) return;

        setTranscripts((current) => [
          {
            id: `${Date.now()}-${Math.random()}`,
            text,
            source: 'system',
            createdAt: new Date().toLocaleTimeString()
          },
          ...current
        ]);
      }
    };

    return () => {
      socket.close();
    };
  }, []);

  const canRecord = useMemo(() => {
    return sessionState === 'active' && isSocketConnected;
  }, [sessionState, isSocketConnected]);

  const sendSocketMessage = (type: string, payload: Record<string, unknown> = {}) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type, payload }));
  };

  const addTranscript = (text: string, source: 'user' | 'system' = 'system') => {
    setLastTranscription(text);
    setTranscripts((current) => [
      {
        id: `${Date.now()}-${Math.random()}`,
        text,
        source,
        createdAt: new Date().toLocaleTimeString()
      },
      ...current
    ]);
  };

  const triggerDemoDisplay = async (type: string, message: string, payload?: Record<string, unknown>) => {
    setStatus(message);
    await fetch('/api/dev/display', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, message, payload })
    });
  };

  const triggerDemoTranscript = async () => {
    const samples = [
      'I would like a crunchy snack please.',
      'Please tell me what kind of snack matches my mood.',
      'I want something bright and cheerful.',
      'I am ready for my wizard snack.'
    ];
    const text = samples[Math.floor(Math.random() * samples.length)];
    await fetch('/api/dev/transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    addTranscript(text, 'user');
  };

  const resetLock = async () => {
    try {
      await fetch('/api/session/reset', { method: 'POST' });
      setSessionState('idle');
      setStatus('Lock reset. The frog is free again.');
    } catch (error) {
      setStatus('Unable to reset the lock.');
    }
  };

  const startSession = async () => {
    setStatus('Awakening the wizard...');

    try {
      const response = await fetch('/api/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'phone-demo-client' })
      });

      const body = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          setSessionState('busy');
          setStatus('Another customer is already using Tubi.');
          return;
        }
        throw new Error(body?.error ?? 'Unable to start the session');
      }

      setSessionState('active');
      setStatus('Session started. Press and hold to speak.');
      sendSocketMessage('session:start', { sessionId: body.sessionId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start the session';
      setStatus(message);
    }
  };

  const endSession = async () => {
    try {
      await fetch('/api/session/end', { method: 'POST' });
      setSessionState('idle');
      setStatus('Session ended. The frog is ready for the next customer.');
      sendSocketMessage('session:end');
    } catch (error) {
      setStatus('Unable to end the session cleanly.');
    }
  };

  const stopRecording = async () => {
    if (!mediaRecorderRef.current) return;

    mediaRecorderRef.current.stop();
    setIsRecording(false);
  };

  const startRecording = async () => {
    if (!canRecord) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/webm;codecs=opus';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: mimeType });
        const arrayBuffer = await audioBlob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';

        bytes.forEach((byte) => {
          binary += String.fromCharCode(byte);
        });

        const base64 = btoa(binary);

        const response = await fetch('/api/transcribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            audioBase64: base64,
            mimeType: audioBlob.type || 'audio/webm',
            extension: audioBlob.type.includes('wav') ? 'wav' : 'webm'
          })
        });

          const data = (await response.json()) as { text?: string; error?: string };
        const text = data.text || 'I did not catch that clearly.';

        addTranscript(text, 'user');
        setStatus(`Python transcription: ${text}`);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setStatus('Listening... release when you are done speaking.');
    } catch (error) {
      setStatus('Microphone access was blocked. Please allow access and try again.');
    }
  };

  return (
    <div className="app-shell">
      <div className="app-card">
        <header className="topbar">
          <div>
            <p className="eyebrow">Tubi the Wizard Frog</p>
            <h1>Awaken the Wizard</h1>
          </div>
          <span className={`status-dot ${isSocketConnected ? 'connected' : 'disconnected'}`} />
        </header>

        <div className="panel">
          <p className="status-message">{status}</p>

          {sessionState === 'idle' && (
            <button className="primary-button" onClick={startSession}>
              Awaken Tubi
            </button>
          )}

          {sessionState === 'active' && (
            <div className="mic-controls">
              <button
                className={`speak-button ${isRecording ? 'recording' : ''}`}
                onPointerDown={startRecording}
                onPointerUp={stopRecording}
                onPointerLeave={stopRecording}
              >
                {isRecording ? 'Listening… release to send' : 'Hold to speak'}
              </button>

              <button className="secondary-button" onClick={endSession}>
                End session
              </button>
            </div>
          )}

          {sessionState === 'busy' && (
            <div className="mic-controls">
              <button className="secondary-button" disabled>
                Frog is busy
              </button>
              <button className="tiny-button" onClick={resetLock}>
                Reset lock (dev only)
              </button>
            </div>
          )}

          {sessionState === 'active' && (
            <div className="demo-controls">
              <h3>Fake backend</h3>
              <div className="demo-grid">
                <button className="tiny-button" onClick={triggerDemoTranscript}>
                  Simulate transcript
                </button>
                <button className="tiny-button" onClick={() => triggerDemoDisplay('inkblot', 'Tubi is showing an inkblot.', { kind: 'inkblot', seed: 'wizard-42' })}>
                  Show inkblot
                </button>
                <button className="tiny-button" onClick={() => triggerDemoDisplay('result', 'Tubi has chosen a snack.', { snack: 'Crispy Cranberry Crunch' })}>
                  Show snack
                </button>
                <button className="tiny-button" onClick={() => triggerDemoDisplay('display', 'Tubi is speaking.', { speaking: true })}>
                  Tubi speaking
                </button>
                <button className="tiny-button" onClick={() => triggerDemoDisplay('display', 'Tubi stopped speaking.', { speaking: false })}>
                  Tubi quiet
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="transcript-box">
          <h2>Python STT transcript</h2>
          <div className="last-transcription">
            <span className="label">Latest result</span>
            <p>{lastTranscription}</p>
          </div>

          {transcripts.length === 0 ? (
            <p className="empty-state">No transcript yet.</p>
          ) : (
            <ul>
              {transcripts.map((item) => (
                <li key={item.id} className={item.source}>
                  <span>{item.createdAt}</span>
                  <strong>{item.source === 'user' ? 'You' : 'Tubi'}</strong>
                  <p>{item.text}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
