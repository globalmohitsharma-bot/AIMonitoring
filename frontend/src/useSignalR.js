import { useEffect, useRef, useState, useCallback } from 'react';
import * as signalR from '@microsoft/signalr';

const HUB_URL = import.meta.env.DEV
  ? 'http://localhost:5165/hub/monitoring'
  : `${window.location.origin}/hub/monitoring`;

export function useSignalR(sessionId = null, candidateInfo = null) {
  const connRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [events,    setEvents]    = useState([]);

  const joinSession = useCallback((conn) => {
    if (!sessionId) return;
    conn.invoke('JoinSession', sessionId, candidateInfo?.name ?? null, candidateInfo?.email ?? null, candidateInfo?.resumeScore ?? null)
        .catch(console.error);
  }, [sessionId, candidateInfo?.name, candidateInfo?.email]);

  useEffect(() => {
    const conn = new signalR.HubConnectionBuilder()
      .withUrl(HUB_URL)
      .withAutomaticReconnect()
      .build();

    conn.on('EventReceived', (evt) => {
      setEvents(prev => [evt, ...prev].slice(0, 100));
    });

    conn.onreconnected(() => {
      setConnected(true);
      joinSession(conn);
    });

    conn.start()
      .then(() => { setConnected(true); joinSession(conn); })
      .catch(console.error);

    connRef.current = conn;
    return () => conn.stop();
  }, [joinSession]);

  const reportEvent = useCallback((sid, type, message, severity = 'warning') => {
    if (connRef.current?.state === signalR.HubConnectionState.Connected) {
      connRef.current.invoke('ReportEvent', { sessionId: sid, type, message, severity });
    }
  }, []);

  const sendFrame = useCallback((sid, frameData) => {
    if (connRef.current?.state === signalR.HubConnectionState.Connected) {
      connRef.current.invoke('SendVideoFrame', sid, frameData);
    }
  }, []);

  const submitQuiz = useCallback((result) => {
    if (connRef.current?.state === signalR.HubConnectionState.Connected) {
      connRef.current.invoke('SubmitQuizResult', result);
    }
  }, []);

  const updateQuestions = useCallback((questions) => {
    if (connRef.current?.state === signalR.HubConnectionState.Connected) {
      connRef.current.invoke('AdminUpdateQuestions', questions);
    }
  }, []);

  return { connected, events, reportEvent, sendFrame, submitQuiz, updateQuestions };
}
