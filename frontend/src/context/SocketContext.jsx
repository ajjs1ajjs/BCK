import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { API } from '../utils/config';

const SocketContext = createContext(null);

export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [queueStats, setQueueStats] = useState({ active: 0, pending: 0, completed: 0, failed: 0 });
  const [lastEvent, setLastEvent] = useState(null);

  useEffect(() => {
    const s = io(API || window.location.origin, {
      withCredentials: true,
      transports: ['websocket', 'polling']
    });

    s.on('connect', () => {
      console.log('Socket connected:', s.id);
    });

    s.on('queueStats', (stats) => {
      setQueueStats(stats);
    });

    s.on('jobQueued', (data) => {
      setLastEvent({ type: 'queued', ...data, timestamp: new Date() });
    });

    s.on('jobStarted', (data) => {
      setLastEvent({ type: 'started', ...data, timestamp: new Date() });
    });

    s.on('jobCompleted', (data) => {
      setLastEvent({ type: 'completed', ...data, timestamp: new Date() });
    });

    s.on('jobFailed', (data) => {
      setLastEvent({ type: 'failed', ...data, timestamp: new Date() });
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, queueStats, lastEvent }}>
      {children}
    </SocketContext.Provider>
  );
};
