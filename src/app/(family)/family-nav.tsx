"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isCurrentLink } from "@/lib/family/session-core";

export type NavItem = { href: string; label: string };

/** Navigation pills with aria-current on the page the person is on. */
export function FamilyNav({ label, items }: { label: string; items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="pb-nav">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isCurrentLink(item.href, pathname) ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
