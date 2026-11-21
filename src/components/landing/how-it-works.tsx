import type { CSSProperties } from "react";

import { AccentText } from "./accent-title";
import { HOW_IT_WORKS } from "./content";
import { Avatar } from "./primitives";

type Step = 1 | 2 | 3 | "live";

/**
 * Three steps from paper to a plan. Without JavaScript, and on small screens,
 * each step is a card with its own picture. On large screens the motion
 * runtime pins the section and plays one picture through all three steps.
 */
export function HowItWorks() {
  return (
    <section id="how-it-works" className="section how" aria-labelledby="how-title" data-how>
      <div className="shell how__pin" data-how-pin>
        <div className="how__text">
          <header className="section__head how__head" data-reveal>
            <p className="eyebrow">{HOW_IT_WORKS.eyebrow}</p>
            <h2 id="how-title" className="section__title">
              <AccentText title={HOW_IT_WORKS.title} />
            </h2>
          </header>
          <div className="how__rail" aria-hidden="true">
            <span className="how__rail-fill" data-how-fill />
          </div>
          <ol className="how__steps">
            {HOW_IT_WORKS.steps.map((step, i) => (
              <li
                key={step.title}
                className={`how__step ${i === 0 ? "is-current" : ""}`}
                data-how-step={i}
                data-reveal
                style={{ "--d": i } as CSSProperties}
              >
                <Scene step={(i + 1) as Step} className="how__mini" />
                <p className="how__number" aria-hidden="true">
                  {i + 1}
                </p>
                <div className="how__copy">
                  <h3 className="how__title">{step.title}</h3>
                  <p className="how__body">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="how__stage" aria-hidden="true">
          <Scene step="live" />
        </div>
      </div>
    </section>
  );
}

/**
 * A small world drawn in code: the fridge, Grandma's note, and a phone whose
 * screen changes with each step. Purely decorative; the step text says it all.
 */
function Scene({ step, className = "" }: { step: Step; className?: string }) {
  return (
    <div aria-hidden="true" className={`scene ${className}`} data-step={step} data-scene>
      <div className="scene__fridge">
        <span className="scene__seam" />
        <span className="scene__handle" />
        <div className="scene__note">
          <span className="scene__magnet" />
          <span>Thursday. Hospital.</span>
          <span>Pick up medicine.</span>
          <span>Insurance card.</span>
        </div>
      </div>

      <div className="scene__phone" data-scene-phone>
        <div className="scene__screen">
          {/* Step 1: the camera frames the note. */}
          <div className="screen screen--camera" data-screen="1">
            <div className="screen__viewfinder">
              <span className="screen__corner screen__corner--tl" />
              <span className="screen__corner screen__corner--tr" />
              <span className="screen__corner screen__corner--bl" />
              <span className="screen__corner screen__corner--br" />
              <div className="mini-note">
                <span>Thursday. Hospital.</span>
                <span>Pick up medicine.</span>
                <span>Insurance card.</span>
              </div>
            </div>
            <span className="screen__shutter" />
          </div>

          {/* Step 2: Fudepan reads it and marks what it found. */}
          <div className="screen screen--read" data-screen="2">
            <p className="screen__label">Reading the note</p>
            <div className="mini-note mini-note--flat">
              <span className="mini-note__hit" data-scene-hit>
                Thursday. Hospital.
              </span>
              <span className="mini-note__hit" data-scene-hit>
                Pick up medicine.
              </span>
              <span>Insurance card.</span>
              <span className="screen__scan" data-scene-scan />
            </div>
            <p className="screen__found">
              <span className="screen__dot" />3 tasks found
            </p>
          </div>

          {/* Step 3: a plan with people and times, approved by the family. */}
          <div className="screen screen--plan" data-screen="3">
            <p className="screen__label">Fudepan draft</p>
            <ul className="screen__rows">
              {[
                { who: "Misa", what: "Confirm the visit", when: "Wed 6 PM" },
                { who: "Kenta", what: "Pick up medicine", when: "Thu 5 PM" },
                { who: "Yui", what: "Tell the family", when: "Thu 8 PM" },
              ].map((row) => (
                <li key={row.who} className="screen__row" data-scene-row>
                  <Avatar name={row.who} />
                  <span className="screen__what">
                    <span>{row.what}</span>
                    <span>{row.when}</span>
                  </span>
                </li>
              ))}
            </ul>
            <span className="screen__approved" data-scene-approved>
              <svg aria-hidden="true" viewBox="0 0 20 20" className="icon">
                <path
                  d="M4.5 10.5l3.5 3.5 7.5-8"
                  pathLength={1}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  data-scene-check
                />
              </svg>
              Approved
            </span>
          </div>
        </div>
      </div>

      {/* Step 2 callouts: what is missing, asked rather than guessed. */}
      <div className="scene__asks">
        <span className="scene__ask" data-scene-ask>
          Which hospital?
        </span>
        <span className="scene__ask" data-scene-ask>
          Which pharmacy?
        </span>
      </div>

      {/* Step 3: the family, each with their part. */}
      <div className="scene__family">
        {["Misa", "Kenta", "Yui"].map((name) => (
          <span key={name} className="scene__person" data-scene-person>
            <Avatar name={name} />
            {name}
          </span>
        ))}
      </div>

      <span className="scene__flash" data-scene-flash />
    </div>
  );
}
