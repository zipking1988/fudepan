import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LoginForm } from "./login-form";

describe("sign-in form", () => {
  const html = renderToStaticMarkup(<LoginForm next="/notes" />);

  it("labels every field and marks both as required", () => {
    expect(html).toMatch(
      /<label for="email"[^>]*>Email address <span[^>]*>\(required\)<\/span><\/label>/,
    );
    expect(html).toMatch(
      /<label for="password"[^>]*>Password <span[^>]*>\(required\)<\/span><\/label>/,
    );
    const email = html.match(/<input id="email"[^>]*>/)?.[0] ?? "";
    const password = html.match(/<input id="password"[^>]*>/)?.[0] ?? "";
    for (const attribute of [
      'type="email"',
      'name="email"',
      'autoComplete="email"',
      'required=""',
    ]) {
      expect(email).toContain(attribute);
    }
    for (const attribute of [
      'type="password"',
      'name="password"',
      'autoComplete="current-password"',
      'required=""',
    ]) {
      expect(password).toContain(attribute);
    }
  });

  it("has a clearly named submit button and carries the destination", () => {
    expect(html).toContain('<button type="submit" class="app-button">Sign in</button>');
    expect(html).toContain('<input type="hidden" name="next" value="/notes"/>');
  });

  it("shows no error before the first attempt", () => {
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("aria-invalid");
  });
});
