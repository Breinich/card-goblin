"use client";

import Link from "next/link";
import {
  useEffect,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import {
  probeAdminSession,
  signInAdmin,
  signOutAdmin,
} from "./adminAuthClient";

export type AdminAuthStatus =
  | "checking"
  | "signed-out"
  | "signing-in"
  | "signed-in"
  | "signing-out";

export interface AdminAuthPanelContentProps {
  status: AdminAuthStatus;
  errorMessage: string | null;
  onSignIn: (event: FormEvent<HTMLFormElement>) => void;
  onSignOut: () => void;
}

/**
 * Pure display seam for static accessibility tests. Credentials are read
 * from FormData by the stateful wrapper and never passed through component
 * props or retained in React state.
 */
export function AdminAuthPanelContent({
  status,
  errorMessage,
  onSignIn,
  onSignOut,
}: AdminAuthPanelContentProps): ReactElement {
  if (status === "checking") {
    return (
      <section
        className="rounded-2xl border border-gray-700 bg-gray-800 p-6 shadow-2xl sm:p-8"
        aria-busy="true"
        aria-labelledby="admin-session-heading"
      >
        <h2 id="admin-session-heading" className="text-lg font-semibold text-white">
          Checking admin session
        </h2>
        <p className="mt-2 text-sm text-gray-400" role="status" aria-live="polite">
          One moment…
        </p>
      </section>
    );
  }

  const isSigningIn = status === "signing-in";
  if (status === "signed-out" || isSigningIn) {
    return (
      <section
        className="rounded-2xl border border-gray-700 bg-gray-800 p-6 shadow-2xl sm:p-8"
        aria-labelledby="admin-sign-in-heading"
        aria-busy={isSigningIn}
      >
        <h2 id="admin-sign-in-heading" className="text-xl font-bold text-white">
          Sign in
        </h2>
        <p className="mt-2 text-sm leading-6 text-gray-400">
          Use the private administrator credentials configured for this deployment.
        </p>

        {errorMessage !== null && (
          <p
            id="admin-auth-error"
            className="mt-4 rounded-lg border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-200"
            role="alert"
          >
            {errorMessage}
          </p>
        )}

        <form
          className="mt-6 space-y-4"
          onSubmit={onSignIn}
          aria-describedby={errorMessage === null ? undefined : "admin-auth-error"}
        >
          <div>
            <label htmlFor="admin-username" className="block text-sm font-medium text-gray-200">
              Username
            </label>
            <input
              id="admin-username"
              name="username"
              type="text"
              autoComplete="username"
              required
              disabled={isSigningIn}
              className="mt-1 block w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white outline-none transition placeholder:text-gray-600 focus:border-teal-400 focus:ring-2 focus:ring-teal-400/30 disabled:cursor-wait disabled:opacity-60"
            />
          </div>

          <div>
            <label htmlFor="admin-password" className="block text-sm font-medium text-gray-200">
              Password
            </label>
            <input
              id="admin-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={isSigningIn}
              className="mt-1 block w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-400/30 disabled:cursor-wait disabled:opacity-60"
            />
          </div>

          <button
            type="submit"
            disabled={isSigningIn}
            className="flex w-full items-center justify-center rounded-lg bg-teal-500 px-4 py-2.5 font-semibold text-gray-950 transition hover:bg-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-300 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:cursor-wait disabled:bg-teal-700"
          >
            {isSigningIn ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    );
  }

  const isSigningOut = status === "signing-out";
  return (
    <section
      className="rounded-2xl border border-gray-700 bg-gray-800 p-6 shadow-2xl sm:p-8"
      aria-labelledby="admin-signed-in-heading"
      aria-busy={isSigningOut}
    >
      <div className="flex items-center gap-3">
        <span className="h-2.5 w-2.5 rounded-full bg-teal-400" aria-hidden="true" />
        <h2 id="admin-signed-in-heading" className="text-xl font-bold text-white">
          Signed in
        </h2>
      </div>
      <p className="mt-3 text-sm leading-6 text-gray-400">
        Cloud projects are available when you open the editor.
      </p>

      {errorMessage !== null && (
        <p
          id="admin-auth-error"
          className="mt-4 rounded-lg border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-200"
          role="alert"
        >
          {errorMessage}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/editor"
          className="inline-flex flex-1 items-center justify-center rounded-lg bg-teal-500 px-4 py-2.5 font-semibold text-gray-950 transition hover:bg-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-300 focus:ring-offset-2 focus:ring-offset-gray-800"
        >
          Open Editor
        </Link>
        <button
          type="button"
          onClick={onSignOut}
          disabled={isSigningOut}
          className="inline-flex flex-1 items-center justify-center rounded-lg border border-gray-600 px-4 py-2.5 font-semibold text-gray-200 transition hover:border-gray-500 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:cursor-wait disabled:opacity-60"
        >
          {isSigningOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </section>
  );
}

export default function AdminAuthPanel(): ReactElement {
  const [status, setStatus] = useState<AdminAuthStatus>("checking");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void probeAdminSession().then((result) => {
      if (!active) return;
      if (result.ok) {
        setStatus(result.authenticated ? "signed-in" : "signed-out");
        setErrorMessage(null);
        return;
      }
      setStatus("signed-out");
      setErrorMessage(result.message);
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleSignIn(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (status === "signing-in") return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const username = data.get("username");
    const password = data.get("password");

    setStatus("signing-in");
    setErrorMessage(null);
    const result = await signInAdmin(
      typeof username === "string" ? username : "",
      typeof password === "string" ? password : "",
    );
    form.reset();

    if (result.ok) {
      setStatus("signed-in");
      return;
    }
    setStatus("signed-out");
    setErrorMessage(result.message);
  }

  async function handleSignOut(): Promise<void> {
    if (status === "signing-out") return;
    setStatus("signing-out");
    setErrorMessage(null);
    const result = await signOutAdmin();
    if (result.ok) {
      setStatus("signed-out");
      return;
    }
    setStatus("signed-in");
    setErrorMessage(result.message);
  }

  return (
    <AdminAuthPanelContent
      status={status}
      errorMessage={errorMessage}
      onSignIn={(event) => {
        void handleSignIn(event);
      }}
      onSignOut={() => {
        void handleSignOut();
      }}
    />
  );
}
