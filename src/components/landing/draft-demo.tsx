"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { DRAFT, NOTE, type NoteLineId } from "./content";
import { Avatar, RiskLabel } from "./primitives";

type Intro = { replay: () => void; stop: () => void };

/** The exact words on Grandma's note that a task came from. */
function lineFor(id: NoteLineId): string {
  return NOTE.lines.find((line) => line.id === id)?.text ?? "";
}

/**
 * The hero picture: Grandma's note next to the draft Fudepan makes from it.
 * Lines on the note are joined to their tasks; choosing a task marks the words
 * it came from, so visitors see that nothing is invented. The entrance is
 * loaded separately (motion/hero-intro) and the demo works without it.
 */
export function DraftDemo() {
  const [selected, setSelected] = useState<NoteLineId | null>(null);
  const [hovered, setHovered] = useState<NoteLineId | null>(null);
  // Phones show two tasks first, so the picture fits on the first screen.
  const [expanded, setExpanded] = useState(false);
  const demoRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const intro = useRef<Intro | null>(null);
  const active = hovered ?? selected;
  const activeTask = DRAFT.tasks.find((t) => t.id === selected);
  const activeLine = NOTE.lines.find((l) => l.id === selected);

  // Connector geometry: from the end of each note line to its task card.
  const layout = useCallback((force = false) => {
    const demo = demoRef.current;
    const svg = svgRef.current;
    if (!demo || !svg) return;
    // While the entrance moves the note and cards, positions are not final.
    // The entrance measures once before it starts and again when it ends.
    const html = document.documentElement.classList;
    if (!force && html.contains("intro-live") && !html.contains("intro-done")) return;
    const box = demo.getBoundingClientRect();
    const sideBySide = getComputedStyle(demo).getPropertyValue("--connectors").trim() === "1";
    svg.setAttribute("viewBox", `0 0 ${Math.round(box.width)} ${Math.round(box.height)}`);
    for (const line of NOTE.lines) {
      const path = svg.querySelector<SVGPathElement>(`[data-connector="${line.id}"]`);
      const dot = svg.querySelector<SVGCircleElement>(`[data-connector-dot="${line.id}"]`);
      const from = demo.querySelector(`[data-line="${line.id}"] [data-line-end]`);
      const paper = demo.querySelector(".demo-note__paper");
      const to = demo.querySelector(`[data-task="${line.id}"]`);
      if (!path || !dot || !from || !to || !sideBySide) {
        path?.setAttribute("d", "");
        dot?.setAttribute("r", "0");
        continue;
      }
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const edge = paper?.getBoundingClientRect().right ?? a.right;
      const x1 = edge - box.left + 5;
      const y1 = a.top + a.height / 2 - box.top;
      const x2 = b.left - box.left - 4;
      const y2 = b.top + Math.min(b.height / 2, 26) - box.top;
      const bend = Math.max(24, (x2 - x1) * 0.55);
      path.setAttribute(
        "d",
        `M${x1.toFixed(1)} ${y1.toFixed(1)} C${(x1 + bend).toFixed(1)} ${y1.toFixed(1)}, ${(x2 - bend).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`,
      );
      dot.setAttribute("cx", x1.toFixed(1));
      dot.setAttribute("cy", y1.toFixed(1));
      dot.setAttribute("r", "3.5");
    }
  }, []);

  useEffect(() => {
    const demo = demoRef.current;
    if (!demo) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => layout());
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(demo);
    for (const el of demo.querySelectorAll("[data-line], [data-task]")) observer.observe(el);
    // Caveat and Inter change line lengths once they load.
    void document.fonts?.ready.then(schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [layout]);

  // The entrance lives in its own chunk, loaded after hydration.
  useEffect(() => {
    const demo = demoRef.current;
    if (!demo) return;
    let cancelled = false;
    void import("./motion/hero-intro").then(({ startIntro }) => {
      if (cancelled) return;
      intro.current = startIntro(demo, { onLayout: () => layout(true) });
    });
    return () => {
      cancelled = true;
      intro.current?.stop();
      intro.current = null;
    };
  }, [layout]);

  const replay = () => {
    setSelected(null);
    setHovered(null);
    intro.current?.replay();
  };

  return (
    <div className="demo-tilt" data-demo-tilt>
      <div className="demo" ref={demoRef} data-demo>
        <svg ref={svgRef} aria-hidden="true" className="connectors" data-intro-connectors>
          {NOTE.lines.map((line) => (
            <g
              key={line.id}
              className={`connector ${active === line.id ? "is-active" : ""}`}
              data-intro-connector={line.id}
            >
              <path data-connector={line.id} pathLength={1} />
              <circle data-connector-dot={line.id} r={0} />
            </g>
          ))}
        </svg>

        <figure className="demo-note" aria-labelledby="demo-note-caption" data-intro-note>
          <div className="demo-note__paper">
            <span aria-hidden="true" className="demo-note__magnet" data-intro-magnet />
            <span aria-hidden="true" className="demo-note__scan" data-intro-scan />
            <blockquote className="demo-note__text" lang="en">
              {NOTE.lines.map((line, i) => (
                <p
                  key={line.id}
                  className={`demo-note__line ${active === line.id ? "is-active" : ""}`}
                  data-line={line.id}
                  style={{ "--i": i } as CSSProperties}
                  onMouseEnter={() => setHovered(line.id)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span aria-hidden="true" className="demo-note__mark" data-intro-mark />
                  <span className="demo-note__words">
                    {line.text}
                    <span aria-hidden="true" data-line-end />
                  </span>
                  <span aria-hidden="true" className="demo-note__wipe" data-intro-wipe />
                </p>
              ))}
              <p className="demo-note__line demo-note__sign">
                <span className="demo-note__words">{NOTE.signature}</span>
                <span aria-hidden="true" className="demo-note__wipe" data-intro-wipe />
              </p>
            </blockquote>
          </div>
          <figcaption id="demo-note-caption" className="sr-only">
            {NOTE.caption}
          </figcaption>
        </figure>

        <span aria-hidden="true" className="demo-down" data-intro-down>
          ↓
        </span>

        {/* Anchor target for "Try the sample note". Focusable so keyboard users
            land here after following the link (see motion/runtime.ts). */}
        <section id="sample-draft" className="draft" aria-labelledby="draft-title" tabIndex={-1}>
          <header className="draft__head">
            <p id="draft-title" className="draft__label">
              <span aria-hidden="true" className="draft__pulse" />
              {DRAFT.label}
            </p>
            <p className="draft__summary">{DRAFT.summary}</p>
          </header>
          <p className="draft__hint">{DRAFT.hint}</p>
          <ul className={`draft__list ${expanded ? "is-expanded" : ""}`} id="draft-tasks">
            {DRAFT.tasks.map((task) => (
              <li key={task.id} className="draft__item" data-intro-card={task.id}>
                <button
                  type="button"
                  className={`task ${active === task.id ? "is-active" : ""}`}
                  aria-pressed={selected === task.id}
                  data-task={task.id}
                  onClick={() => setSelected((s) => (s === task.id ? null : task.id))}
                  onMouseEnter={() => setHovered(task.id)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span className="task__title">{task.title}</span>
                  <span className="task__meta">
                    {task.owner ? (
                      <span className="task__owner">
                        <Avatar name={task.owner} />
                        {task.owner}
                      </span>
                    ) : (
                      <span className="task__owner task__owner--none">{DRAFT.unowned}</span>
                    )}
                    <span className="task__due">{task.due}</span>
                    <RiskLabel risk={task.risk} />
                  </span>
                  {task.question && (
                    <span className="task__ask" data-intro-ask>
                      <span className="task__ask-label">{DRAFT.missing}</span> {task.question}
                    </span>
                  )}
                  {task.professional && (
                    <span className="task__ask task__ask--doctor">{task.professional}</span>
                  )}
                  {/* Phones: the note may be off screen, so the selected card quotes it. */}
                  {selected === task.id && (
                    <span className="task__source" data-task-source>
                      <span className="task__source-label">{DRAFT.source}</span>
                      <span className="task__source-text" lang="en">
                        {lineFor(task.id)}
                      </span>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="draft__more"
            aria-expanded={expanded}
            aria-controls="draft-tasks"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? DRAFT.showFewer : DRAFT.showAll}
          </button>
          <footer className="draft__foot" data-intro-foot>
            <span>{DRAFT.footer}</span>
            <button type="button" className="draft__replay" onClick={replay}>
              {DRAFT.replay}
            </button>
          </footer>
        </section>
      </div>

      <p className="sr-only" aria-live="polite">
        {activeTask && activeLine ? `${activeTask.title}. From the note: “${activeLine.text}”` : ""}
      </p>
    </div>
  );
}
