"use client";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Icon } from "./playful/ui";

/**
 * A note-list row that shows a spinner in place of the chevron while the
 * next page is loading. The page itself is still a full server render; this
 * only gives the user immediate feedback while they wait for the response.
 */
export function NoteRowLink({
  href,
  ariaLabel,
  children,
}: {
  href: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    router.push(href);
  }

  return (
    <a
      href={href}
      onClick={handleClick}
      aria-label={ariaLabel}
      aria-busy={pending}
      className={`nx-row${pending ? " nx-row--loading" : ""}`}
    >
      {children}
      <span className="nx-row__chev" aria-hidden="true">
        {pending ? <span className="nx-spinner" /> : <Icon name="chevronRight" size={22} />}
      </span>
    </a>
  );
}
