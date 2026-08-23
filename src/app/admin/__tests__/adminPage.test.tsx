import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdminPage, { metadata } from "@/app/admin/page";
import {
  AdminAuthPanelContent,
  type AdminAuthPanelContentProps,
} from "@/app/admin/_components/adminAuthPanel";
import sitemap from "@/app/sitemap";

function render(
  props: Partial<AdminAuthPanelContentProps> = {},
): string {
  return renderToStaticMarkup(
    <AdminAuthPanelContent
      status={props.status ?? "signed-out"}
      errorMessage={props.errorMessage ?? null}
      onSignIn={props.onSignIn ?? (() => {})}
      onSignOut={props.onSignOut ?? (() => {})}
    />,
  );
}

const stripTags = (markup: string): string => markup.replace(/<[^>]+>/g, "");

describe("/admin presentation", () => {
  it("is explicitly noindex, nofollow and remains absent from the sitemap", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(sitemap().map((entry) => new URL(entry.url).pathname)).not.toContain("/admin");
  });

  it("server-renders a private admin page in the checking state", () => {
    const markup = renderToStaticMarkup(<AdminPage />);
    const text = stripTags(markup);
    expect(text).toContain("Card Goblin Admin");
    expect(text).toContain("Checking admin session");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toContain("Sign out");
  });

  it("renders an accessible username/password form while signed out", () => {
    const markup = render();
    expect(markup).toContain('for="admin-username"');
    expect(markup).toContain('id="admin-username"');
    expect(markup).toContain('autoComplete="username"');
    expect(markup).toContain('for="admin-password"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('autoComplete="current-password"');
    expect(stripTags(markup)).toContain("Sign in");
    expect(markup).not.toContain('value="');
    expect(markup).not.toContain("Open Editor");
  });

  it("announces pending sign-in and disables all credential controls", () => {
    const markup = render({ status: "signing-in" });
    expect(markup).toContain('aria-busy="true"');
    expect(stripTags(markup)).toContain("Signing in…");
    expect((markup.match(/ disabled=""/g) ?? [])).toHaveLength(3);
  });

  it("shows fixed errors as alerts associated with the form", () => {
    const markup = render({ errorMessage: "Incorrect username or password." });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-describedby="admin-auth-error"');
    expect(stripTags(markup)).toContain("Incorrect username or password.");
  });

  it("shows Open Editor and sign-out controls only in authenticated states", () => {
    const signedIn = render({ status: "signed-in" });
    expect(stripTags(signedIn)).toContain("Signed in");
    expect(signedIn).toContain('href="/editor"');
    expect(stripTags(signedIn)).toContain("Open Editor");
    expect(stripTags(signedIn)).toContain("Sign out");
    expect(signedIn).not.toContain('type="password"');

    const signingOut = render({ status: "signing-out" });
    expect(signingOut).toContain('aria-busy="true"');
    expect(stripTags(signingOut)).toContain("Signing out…");
    expect(signingOut).toContain("disabled");
  });
});
