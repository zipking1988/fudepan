import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/family/capture" }));
vi.mock("@/app/login/actions", () => ({ signOut: async () => {} }));

import { FamilyHeader } from "./family-chrome";

describe("FamilyHeader", () => {
  it("has a skip link, a labelled nav, and marks the current page", () => {
    const html = renderToStaticMarkup(<FamilyHeader role="family_member" language="en" />);
    expect(html).toContain('href="#main"');
    expect(html).toContain("Skip to main content");
    expect(html).toContain('aria-label="Family"');
    expect(html).toContain(">Notes</a>");
    expect(html).not.toContain(">Home</a>");
    expect(html).toContain(">Members</a>");
    expect(html).toContain("/family/settings/language");
    expect(html).toContain("Language");
    expect(html).toContain("Sign out");
  });
  it("shows the care recipient only the Home link", () => {
    const html = renderToStaticMarkup(<FamilyHeader role="care_recipient" language="en" />);
    expect(html).toContain(">Home</a>");
    expect(html).not.toContain("Members");
    expect(html).not.toContain("Language");
    expect(html).not.toContain("/family/settings/language");
  });
  it("shows the unseen reminder count in text, and writes Japanese for a Japanese member", () => {
    const html = renderToStaticMarkup(<FamilyHeader role="family_member" language="ja" unseenReminders={2} />);
    expect(html).toContain("新しいリマインダーが2件あります");
    expect(html).toContain("本文へ移動");
    expect(html).not.toContain("Skip to main content");
  });
  it("uses the shared Landing wordmark and bar, linking to the public landing in the member's language", () => {
    const en = renderToStaticMarkup(<FamilyHeader role="family_member" language="en" />);
    expect(en).toMatch(/<a class="lp-wordmark" href="\/en">Fudepan<svg[^>]*class="lp-wordmark__ticks"/);
    const ja = renderToStaticMarkup(<FamilyHeader role="family_member" language="ja" />);
    expect(ja).toMatch(/<a class="lp-wordmark" href="\/">Fudepan<svg[^>]*class="lp-wordmark__ticks"/);
    expect(en).toContain('href="/family"');
    expect(en).toContain('class="lp-header pb-header"');
    expect(en).toContain("lp-shell lp-header__bar");
    expect(en).not.toContain("pb-wordmark");
  });
  it("shows no nav when signed out", () => {
    const html = renderToStaticMarkup(<FamilyHeader role={null} language="en" />);
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("Sign out");
  });
});
