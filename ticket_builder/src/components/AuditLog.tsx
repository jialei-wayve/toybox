export function AuditLog(props: { entries: string[] }) {
  if (props.entries.length === 0) {
    return (
      <section className="audit-log">
        <h2 className="audit-log__title">Activity</h2>
        <p className="muted">No actions yet.</p>
      </section>
    );
  }

  return (
    <section className="audit-log">
      <h2 className="audit-log__title">Activity</h2>
      <ol className="audit-log__list" reversed>
        {props.entries
          .slice()
          .reverse()
          .map((line, i) => (
            <li key={`${props.entries.length - i}-${line.slice(0, 24)}`}>{line}</li>
          ))}
      </ol>
    </section>
  );
}
