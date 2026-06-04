import React, { useState, useEffect } from 'react';
import { Play, CheckCircle2, AlertCircle, Hourglass } from 'lucide-react';
import { useSocket } from '../context/SocketContext';

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
      <div className="py-8 text-center opacity-50">
        <p className="text-sm text-slate-500 dark:text-slate-400">No real-time activity yet</p>
      </div>
    );
  }

  const getEventColors = (type) => {
    switch (type) {
      case 'completed': return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
      case 'failed': return 'bg-red-500/15 text-red-600 dark:text-red-400';
      case 'started': return 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400';
      default: return 'bg-amber-500/15 text-amber-600 dark:text-amber-400'; // queued
    }
  };

  const getEventIcon = (type) => {
    switch (type) {
      case 'completed': return <CheckCircle2 size={16} />;
      case 'failed': return <AlertCircle size={16} />;
      case 'started': return <Play size={16} />;
      default: return <Hourglass size={16} />;
    }
  };

  return (
    <div className="space-y-3">
      {events.map((ev, i) => (
        <div 
          key={i} 
          className={`flex items-center gap-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50 ${i === 0 ? 'animate-slide-in' : ''}`}
        >
          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${getEventColors(ev.type)}`}>
            {getEventIcon(ev.type)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
              {ev.name}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 block truncate">
              {ev.type.toUpperCase()} • {ev.timestamp.toLocaleTimeString()}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
