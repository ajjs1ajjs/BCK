import React, { useState, useEffect } from 'react';
import { Box, Typography, Stack, alpha } from '@mui/material';
import { 
  PlayArrow as RunIcon, 
  CheckCircle as SuccessIcon, 
  Error as ErrorIcon,
  HourglassEmpty as PendingIcon
} from '@mui/icons-material';
import { useSocket } from '../context/SocketContext';
import { C } from './DashboardWidgets';

export default function ActivityFeed() {
  const { lastEvent } = useSocket();
  const [events, setEvents] = useState([]);

  useEffect(() => {
    if (lastEvent) {
      setEvents(prev => [lastEvent, ...prev].slice(0, 10));
    }
  }, [lastEvent]);

  if (events.length === 0) {
    return (
      <Box sx={{ py: 4, textAlign: 'center', opacity: 0.5 }}>
        <Typography variant="body2">No real-time activity yet</Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={1.5}>
      {events.map((ev, i) => (
        <Box key={i} sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 2, 
          p: 1.5, 
          borderRadius: 2, 
          bgcolor: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.04)',
          animation: i === 0 ? 'slideIn 0.3s ease-out' : 'none',
          '@keyframes slideIn': {
            from: { transform: 'translateX(-10px)', opacity: 0 },
            to: { transform: 'translateX(0)', opacity: 1 }
          }
        }}>
          <Box sx={{ 
            width: 32, 
            height: 32, 
            borderRadius: '50%', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            bgcolor: alpha(ev.type === 'completed' ? C.success : ev.type === 'failed' ? C.error : ev.type === 'started' ? C.secondary : C.warning, 0.15),
            color: ev.type === 'completed' ? C.success : ev.type === 'failed' ? C.error : ev.type === 'started' ? C.secondary : C.warning
          }}>
            {ev.type === 'completed' && <SuccessIcon sx={{ fontSize: 18 }} />}
            {ev.type === 'failed' && <ErrorIcon sx={{ fontSize: 18 }} />}
            {ev.type === 'started' && <RunIcon sx={{ fontSize: 18 }} />}
            {ev.type === 'queued' && <PendingIcon sx={{ fontSize: 18 }} />}
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600, color: '#fff' }}>
              {ev.name}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              {ev.type.toUpperCase()} • {ev.timestamp.toLocaleTimeString()}
            </Typography>
          </Box>
        </Box>
      ))}
    </Stack>
  );
}
