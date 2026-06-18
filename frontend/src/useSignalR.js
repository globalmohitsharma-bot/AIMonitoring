import { useEffect, useRef, useState, useCallback } from 'react';
import * as signalR from '@microsoft/signalr';

const HUB_URL = import.meta.env.DEV
  ? 'http://localhost:5165/hub/monitoring'
  : `${window.location.origin}/hub/monitoring`;

export function useSignalR() {
  const connRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState([]);

  useEffect(() => {
    const conn = new signalR.HubConnectionBuilder()
      .withUrl(HUB_URL)
      .withAutomaticReconnect()
      .build();

    conn.on('EventReceived', (evt) => {
      setEvents(prev => [evt, ...prev].slice(0, 100));
    });

    conn.start()
      .then(() => setConnected(true))
      .catch(console.error);

    connRef.current = conn;
    return () => conn.stop();
  }, []);

  const reportEvent = useCallback((sessionId, type, message, severity = 'warning') => {
    if (connRef.current?.state === signalR.HubConnectionState.Connected) {
      connRef.current.invoke('ReportEvent', { sessionId, type, message, severity });
    }
  }, []);

  return { connected, events, reportEvent };
}
