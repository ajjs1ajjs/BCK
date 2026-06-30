"use client";

import { useEffect, useState, useCallback } from "react";

type WSMessage = {
  type: string;
  data: any;
};

export function useWebSocket() {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);

  const connect = useCallback(() => {
    const wsUrl = (process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080").replace(/^http/, "ws") + "/ws";
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        setLastMessage(msg);
      } catch {}
    };

    setWs(socket);

    return () => socket.close();
  }, []);

  useEffect(() => {
    const cleanup = connect();
    return () => cleanup?.();
  }, [connect]);

  const send = useCallback((msg: WSMessage) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, [ws]);

  return { connected, lastMessage, send };
}
