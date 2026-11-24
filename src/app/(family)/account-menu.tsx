"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./family/playful/ui";

/**
 * The name in the corner. A button opens a small paper menu with the language link and sign-out.
 * Escape or a click outside closes it, and focus goes back to the button.
 */
export function AccountMenu({
  name,
  label,
  avatar,
  children,
}: {
  name: string;
  /** Accessible name of the button, already translated. */
  label: string;
  avatar: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);
  return (
    <div className="pb-account" ref={root}>
      <button
        ref={button}
        type="button"
        className="pb-account__button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        {avatar}
        <span className="pb-account__name">{name}</span>
        <Icon name="chevronDown" size={18} />
      </button>
      <div id={id} className="pb-account__menu" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
