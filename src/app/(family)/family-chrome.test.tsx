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
    expect(html).toContain("Family feed");
    expect(html).toContain("Language");
    expect(html).toMatch(/aria-current="page"[^>]*>Take a photo|href="\/family\/capture"[^>]*aria-current="page"/);
    expect(html).toContain("Sign out");
  });
  it("shows the care recipient only the photo and feed links", () => {
    const html = renderToStaticMarkup(<FamilyHeader role="care_recipient" language="en" />);
    expect(html).toContain("Take a photo");
    expect(html).toContain("Family feed");
    expect(html).not.toContain("Language");
    expect(html).not.toContain("/family/settings/language");
  });
  it("shows the unseen reminder count in text, and writes Japanese for a Japanese member", () => {
    const html = renderToStaticMarkup(<FamilyHeader role="family_member" language="ja" unseenReminders={2} />);
    expect(html).toContain("新しいリマインダーが2件あります");
    expect(html).toContain("本文へ移動");
    expect(html).not.toContain("Skip to main content");
  });
  it("shows no nav when signed out", () => {
    const html = renderToStaticMarkup(<FamilyHeader role={null} language="en" />);
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("Sign out");
  });
});
