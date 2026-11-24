import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { getDemoAccount } from "./demo-account";
import { DemoSignIn } from "./demo-sign-in";

describe("demo account", () => {
  it("is off unless both the email and the password are set", () => {
    expect(getDemoAccount({})).toBeNull();
    expect(getDemoAccount({ DEMO_EMAIL: "misa.demo@example.com" })).toBeNull();
    expect(getDemoAccount({ DEMO_PASSWORD: "fudepan-demo" })).toBeNull();
    expect(getDemoAccount({ DEMO_EMAIL: "  ", DEMO_PASSWORD: "fudepan-demo" })).toBeNull();
  });

  it("reads the account from the environment", () => {
    expect(
      getDemoAccount({ DEMO_EMAIL: " misa.demo@example.com ", DEMO_PASSWORD: "fudepan-demo" }),
    ).toEqual({ email: "misa.demo@example.com", password: "fudepan-demo" });
  });
});

describe("demo sign-in box", () => {
  const html = renderToStaticMarkup(
    createElement(DemoSignIn, {
      email: "misa.demo@example.com",
      password: "fudepan-demo",
      next: "/family",
    }),
  );
  const form = html.match(/<form[\s\S]*?<\/form>/)?.[0] ?? "";

  it("has one clearly named button and shows the account for typing", () => {
    expect(form).toMatch(/<button type="submit"[^>]*>Sign in to the demo<\/button>/);
    expect(html).toContain("misa.demo@example.com");
    expect(html).toContain("fudepan-demo");
  });

  it("does not send the password from the browser, only where to go next", () => {
    expect(form).not.toContain("fudepan-demo");
    expect(form).not.toContain("misa.demo@example.com");
    expect(form).toContain('<input type="hidden" name="next" value="/family"/>');
  });

  it("warns that the demo is shared", () => {
    expect(html).toMatch(/Anyone can use it/);
  });
});
