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

  const backendPort = port === '5173' || port === '4173' || !port
    ? import.meta.env.VITE_BACKEND_PORT || '3000'
    : port;
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';

  if (host === 'localhost' || host === '127.0.0.1') {
    return `${protocol}://localhost:${backendPort}`;
  }

  return `${protocol}://${host}:${backendPort}`;
};

function App() {
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState('Waiting for a customer');
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [lastTranscription, setLastTranscription] = useState('No transcription yet.');
  const [isRecording, setIsRecording] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [isSimulatedBusy, setIsSimulatedBusy] = useState(false);
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const hasCalibratedRef = useRef(false);
  const recordingRequestedRef = useRef(false);

  const setSessionOwnership = (sessionId: string | null) => {
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
    try {
      if (sessionId) {
        sessionStorage.setItem('tubi.sessionId', sessionId);
      } else {
        sessionStorage.removeItem('tubi.sessionId');
      }
    } catch (error) {
      setStatus('This browser cannot save the session for refresh recovery.');
    }
  };

  useEffect(() => {
    const syncSessionState = async () => {
      try {
        const storedSessionId = sessionStorage.getItem('tubi.sessionId');
        if (storedSessionId) {
          const resumeResponse = await fetch('/api/session/resume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: storedSessionId })
          });

          if (resumeResponse.ok) {
            setSessionOwnership(storedSessionId);
            setSessionState('active');
            setStatus('Session resumed. Press and hold to speak.');
            return;
          }

          setSessionOwnership(null);
        }

        const response = await fetch('/api/health');
        const body = (await response.json()) as { state?: SessionState; devBusy?: boolean };
        setIsSimulatedBusy(Boolean(body.devBusy));
        const serverState = body.state === 'active' ? 'busy' : 'idle';
        setSessionState(serverState);

        if (serverState === 'busy') {
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
      setStatus(activeSessionIdRef.current
        ? 'Session active. Press and hold to speak.'
        : 'Connected. Ready to awaken Tubi.');
    };

    socket.onclose = () => {
      setIsSocketConnected(false);
      setStatus('Connection lost. Reconnect when ready.');
    };

    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data) as ServerMessage;

      if (msg.type === 'session-state') {
        const nextState = (msg.payload?.state ?? 'idle') as SessionState;
        if (nextState === 'active') {
          const isOwner = Boolean(activeSessionIdRef.current);
          setSessionState(isOwner ? 'active' : 'busy');
          setStatus(isOwner
            ? 'Session active. Press and hold to speak.'
            : 'Another customer is already using Tubi.');
        } else {
          const wasOwner = Boolean(activeSessionIdRef.current);
          setSessionState('idle');
          setIsSimulatedBusy(false);
          if (wasOwner) setSessionOwnership(null);
          setStatus(wasOwner
            ? 'Session timed out. The frog is free again.'
            : 'Waiting for a customer');
        }

        if (nextState === 'busy') {
          setSessionState('busy');
          setStatus('Another customer is already using Tubi.');
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

  useEffect(() => {
    if (sessionState !== 'active' || !activeSessionId || !isSocketConnected) return;

    const heartbeat = async () => {
      try {
        const response = await fetch('/api/session/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: activeSessionId })
        });

        if (response.status === 409) {
          setSessionOwnership(null);
          setSessionState('idle');
          setStatus('Session expired. Awaken Tubi to start again.');
        }
      } catch (error) {
        // The server's idle timeout releases this lock if the phone stays offline.
      }
    };

    void heartbeat();
    const heartbeatTimer = window.setInterval(() => void heartbeat(), 15_000);
    return () => window.clearInterval(heartbeatTimer);
  }, [sessionState, activeSessionId, isSocketConnected]);

  const toggleSimulatedBusy = async (busy: boolean) => {
    setIsSimulatedBusy(busy);
    try {
      const response = await fetch('/api/dev/session/busy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ busy })
      });
      const body = (await response.json()) as { error?: string; devBusy?: boolean; state?: SessionState };
      if (!response.ok) throw new Error(body.error ?? 'Unable to change the simulated busy state');

      setIsSimulatedBusy(Boolean(body.devBusy));
      setStatus(body.state === 'active'
        ? 'Another customer is already using Tubi.'
        : 'Test busy mode is off. The frog is free.');
    } catch (error) {
      setIsSimulatedBusy(!busy);
      setStatus(error instanceof Error ? error.message : 'Unable to change the simulated busy state');
    }
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
      setSessionOwnership(null);
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
        headers: { 'Content-Type': 'application/json' }
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

      setSessionOwnership(body.sessionId);
      hasCalibratedRef.current = false;
      setSessionState('active');
      setStatus('Session started. Press and hold to speak.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start the session';
      setStatus(message);
    }
  };

  const endSession = async () => {
    try {
      const response = await fetch('/api/session/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSessionId })
      });
      if (!response.ok && response.status !== 409) throw new Error('Unable to end session');
      setSessionOwnership(null);
      setSessionState('idle');
      setStatus(response.status === 409
        ? 'Session already expired. The frog is ready for the next customer.'
        : 'Session ended. The frog is ready for the next customer.');
    } catch (error) {
      setStatus('Unable to end the session cleanly.');
    }
  };

  const stopRecording = async () => {
    recordingRequestedRef.current = false;
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') return;

    mediaRecorderRef.current.stop();
    setIsRecording(false);
  };

  const startRecording = async () => {
    if (!canRecord) return;
    recordingRequestedRef.current = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      if (!recordingRequestedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      let noisyEnvironment = false;
      if (!hasCalibratedRef.current) {
        setIsCalibrating(true);
        setStatus('Calibrating microphone. Stay quiet for a moment...');

        try {
          const audioContext = new AudioContext();
          const analyser = audioContext.createAnalyser();
          const source = audioContext.createMediaStreamSource(stream);
          const silentGain = audioContext.createGain();
          const samples = new Float32Array(analyser.fftSize);
          const noiseLevels: number[] = [];

          analyser.fftSize = 2048;
          silentGain.gain.value = 0;
          source.connect(analyser);
          analyser.connect(silentGain);
          silentGain.connect(audioContext.destination);
          await audioContext.resume();

          const calibrationInterval = window.setInterval(() => {
            analyser.getFloatTimeDomainData(samples);
            const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
            noiseLevels.push(rms);
          }, 60);

          await new Promise((resolve) => window.setTimeout(resolve, 1000));
          window.clearInterval(calibrationInterval);
          source.disconnect();
          analyser.disconnect();
          silentGain.disconnect();
          await audioContext.close();

          const noiseFloor = noiseLevels.length
            ? noiseLevels.reduce((sum, level) => sum + level, 0) / noiseLevels.length
            : 0;
          noisyEnvironment = noiseFloor > 0.04;
        } catch {
          noisyEnvironment = false;
        }

        hasCalibratedRef.current = true;
        setIsCalibrating(false);
      }

      if (!recordingRequestedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/webm;codecs=opus';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        mediaRecorderRef.current = null;
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
            sessionId: activeSessionId,
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
      setStatus(noisyEnvironment
        ? 'Listening... background noise is high; speak close to the mic.'
        : 'Listening... release when you are done speaking.');
    } catch (error) {
      setIsCalibrating(false);
      setStatus('Microphone access was blocked. Please allow access and try again.');
    }
  };

  const orbText = isCalibrating
    ? 'Quiet'
    : isRecording
      ? 'Listening'
      : sessionState === 'idle'
        ? 'Awaken'
        : sessionState === 'busy'
          ? 'Resting'
          : 'Speak';

  return (
    <main className="wizard-screen">
      <header className="wizard-header">
        <p className="brand-kicker">A little magic, just for you</p>
        <h1>Tubi the<br />Wizard Frog</h1>
        <span className={`connection-mark ${isSocketConnected ? 'connected' : ''}`} aria-label={isSocketConnected ? 'Connected' : 'Connecting'} />
      </header>

      <section className="interaction-scene" aria-label="Talk with Tubi">
        <p className={`session-message ${sessionState === 'busy' ? 'is-busy' : ''}`} role="status">
          {sessionState === 'busy' ? 'Tubi is with another guest' : status}
        </p>

        {lastTranscription !== 'No transcription yet.' && (
          <div className="latest-words" aria-live="polite">
            <span>{transcripts[0]?.source === 'user' ? 'Your words' : 'Tubi heard'}</span>
            <p>{lastTranscription}</p>
          </div>
        )}

        <div className={`crystal-console ${isRecording || isCalibrating ? 'is-lit' : ''}`}>
          <span className="crystal-stand" aria-hidden="true" />
          <button
            className={`crystal-control state-${sessionState} ${isRecording ? 'is-recording' : ''} ${isCalibrating ? 'is-calibrating' : ''}`}
            type="button"
            aria-label={sessionState === 'idle'
              ? 'Awaken Tubi'
              : sessionState === 'busy'
                ? 'Tubi is busy'
                : isCalibrating
                  ? 'Calibrating microphone'
                  : isRecording
                    ? 'Listening, release to send'
                    : 'Press and hold to speak'}
            disabled={sessionState === 'busy'}
            onClick={() => {
              if (sessionState === 'idle') void startSession();
            }}
            onPointerDown={(event) => {
              if (sessionState !== 'active') return;
              event.currentTarget.setPointerCapture(event.pointerId);
              void startRecording();
            }}
            onPointerUp={() => {
              if (sessionState === 'active') void stopRecording();
            }}
            onPointerCancel={() => {
              if (sessionState === 'active') void stopRecording();
            }}
            onLostPointerCapture={() => {
              if (sessionState === 'active') void stopRecording();
            }}
          >
            <span className="crystal-sphere" aria-hidden="true">
              <span className="crystal-glint" />
              <span className="crystal-current current-one" />
              <span className="crystal-current current-two" />
              <span className="crystal-word">{orbText}</span>
            </span>
          </button>
          <p className="crystal-hint">
            {isCalibrating
              ? 'Stay quiet for a moment'
              : isRecording
                ? 'Release when you are finished'
                : sessionState === 'active'
                  ? 'Press and hold to speak'
                  : sessionState === 'busy'
                    ? 'A guest is speaking with Tubi'
                    : 'Touch the crystal to awaken Tubi'}
          </p>
          {sessionState === 'active' && (
            <button className="end-session-button" type="button" onClick={endSession}>
              Let Tubi rest
            </button>
          )}
        </div>
      </section>

      {transcripts.length > 0 && (
        <details className="transcript-history">
          <summary>Conversation notes <span>{transcripts.length}</span></summary>
          <ul>
            {transcripts.map((item) => (
              <li key={item.id}>
                <span>{item.source === 'user' ? 'You' : 'Tubi'} · {item.createdAt}</span>
                <p>{item.text}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {import.meta.env.DEV && (
        <details className="dev-drawer">
          <summary>Test controls</summary>
          <div className="dev-tools">
            <label className="busy-test-toggle">
              <input
                type="checkbox"
                checked={isSimulatedBusy}
                onChange={(event) => void toggleSimulatedBusy(event.target.checked)}
              />
              <span>Simulate frog busy</span>
            </label>
            {sessionState === 'busy' && (
              <button className="tiny-button" onClick={resetLock}>Reset session lock</button>
            )}
            {sessionState === 'active' && (
              <div className="demo-grid">
                <button className="tiny-button" onClick={triggerDemoTranscript}>Simulate transcript</button>
                <button className="tiny-button" onClick={() => triggerDemoDisplay('inkblot', 'Tubi is showing an inkblot.', { kind: 'inkblot', seed: 'wizard-42' })}>Show inkblot</button>
                <button className="tiny-button" onClick={() => triggerDemoDisplay('result', 'Tubi has chosen a snack.', { snack: 'Crispy Cranberry Crunch' })}>Show snack</button>
                <button className="tiny-button" onClick={() => triggerDemoDisplay('display', 'Tubi is speaking.', { speaking: true })}>Tubi speaking</button>
                <button className="tiny-button" onClick={() => triggerDemoDisplay('display', 'Tubi stopped speaking.', { speaking: false })}>Tubi quiet</button>
              </div>
            )}
          </div>
        </details>
      )}
    </main>
  );
}

export default App;
