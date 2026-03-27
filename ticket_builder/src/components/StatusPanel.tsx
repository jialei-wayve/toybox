import type { ReactNode } from "react";

type Tone = "idle" | "loading" | "success" | "error";

const toneClass: Record<Tone, string> = {
  idle: "status-panel--idle",
  loading: "status-panel--loading",
  success: "status-panel--success",
  error: "status-panel--error",
};

export function StatusPanel(props: {
  tone: Tone;
  title: string;
  children?: ReactNode;
}) {
  return (
    <section className={`status-panel ${toneClass[props.tone]}`} aria-live="polite">
      <h2 className="status-panel__title">{props.title}</h2>
      {props.children ? <div className="status-panel__body">{props.children}</div> : null}
    </section>
  );
}
