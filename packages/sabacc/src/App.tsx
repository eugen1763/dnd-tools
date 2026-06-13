import { useEffect, useRef } from 'react';
import { useStore } from './store';
import { JoinScreen } from './components/JoinScreen';
import { Table } from './components/Table';

function tokenKey(gameId: string) {
  return `sabacc_token_${gameId}`;
}

export default function App() {
  const connected = useStore((s) => s.connected);
  const state = useStore((s) => s.state);
  const youId = useStore((s) => s.youId);
  const reconnecting = useStore((s) => s.reconnecting);
  const joinError = useStore((s) => s.joinError);

  const setSend = useStore((s) => s.setSend);
  const setConnected = useStore((s) => s.setConnected);
  const setReconnecting = useStore((s) => s.setReconnecting);
  const applyServer = useStore((s) => s.applyServer);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Resolve the table id from /sabacc/:id
  const parts = window.location.pathname.split('/').filter(Boolean);
  const gameId = parts[0] === 'sabacc' ? parts[1] : parts[parts.length - 1];

  useEffect(() => {
    if (!gameId || gameId === 'sabacc') return;
    let cancelled = false;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/sabacc/${gameId}`;

    function connect() {
      if (cancelled) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) {
          ws.close();
          return;
        }
        setConnected(true);
        setSend((msg: unknown) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
        });

        // Try to reclaim a previous seat for this table.
        const token = localStorage.getItem(tokenKey(gameId));
        if (token) {
          setReconnecting(true);
          ws.send(JSON.stringify({ type: 'reconnect', playerToken: token }));
        }
      };

      ws.onmessage = (event) => {
        if (cancelled) return;
        const data = JSON.parse(event.data);
        // Persist our reconnect token the moment we receive it.
        if (data.type === 'joined' && data.you?.token) {
          localStorage.setItem(tokenKey(gameId), data.you.token);
        }
        applyServer(data);
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        setSend(null);
        wsRef.current = null;
        reconnectTimerRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      cancelled = true;
      wsRef.current?.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [gameId, setConnected, setSend, setReconnecting, applyServer]);

  // A failed reconnect means the stored token is stale — drop it so the join
  // screen appears.
  useEffect(() => {
    if (joinError && !youId && gameId) localStorage.removeItem(tokenKey(gameId));
  }, [joinError, youId, gameId]);

  if (!gameId || gameId === 'sabacc') {
    return (
      <Centered>
        <h1 className="text-2xl font-semibold">No table specified</h1>
        <p className="mt-2 text-emerald-200/70">Create a Sabacc table from Discord with <code>/game create</code>.</p>
      </Centered>
    );
  }

  if (!state) {
    return (
      <Centered>
        <div className="animate-pulse text-emerald-200/80">{connected ? 'Loading table…' : 'Connecting…'}</div>
      </Centered>
    );
  }

  if (!youId) {
    if (reconnecting) {
      return (
        <Centered>
          <div className="animate-pulse text-emerald-200/80">Reclaiming your seat…</div>
        </Centered>
      );
    }
    return <JoinScreen />;
  }

  return <Table />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center text-center px-6">
      {children}
    </div>
  );
}
