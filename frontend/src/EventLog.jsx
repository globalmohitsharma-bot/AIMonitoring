const TYPE_LABELS = {
  0: 'Tab Switch',
  1: 'Face Lost',
  2: 'Face Returned',
  3: 'Session Start',
  4: 'Session End',
};

export function EventLog({ events }) {
  return (
    <div className="event-log">
      <h3>Event Log <span className="badge">{events.length}</span></h3>
      {events.length === 0 && <p className="empty">No events yet — start monitoring.</p>}
      <ul>
        {events.map(evt => (
          <li key={evt.id} className={`event-item severity-${evt.severity}`}>
            <span className="event-time">
              {new Date(evt.timestamp).toLocaleTimeString()}
            </span>
            <span className="event-type">{TYPE_LABELS[evt.type] ?? evt.type}</span>
            <span className="event-msg">{evt.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
