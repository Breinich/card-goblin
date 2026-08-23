import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import type { ReactElement } from "react";
import AdminAuthPanel from "./_components/adminAuthPanel";

export const metadata: Metadata = {
  title: "Admin",
  description: "Private Card Goblin administration.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-static";

export default function AdminPage(): ReactElement {
  return (
    <div className="min-h-screen bg-gray-900 text-gray-300">
      <header className="border-b border-gray-800">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/card_goblin_logo_simple_2.svg"
              alt=""
              width={36}
              height={36}
              aria-hidden
            />
            <span className="font-extrabold tracking-tight text-white">Card Goblin</span>
            <span className="text-sm text-gray-500">Admin</span>
          </Link>
          <Link href="/" className="text-sm text-gray-400 transition hover:text-white">
            Home
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            Card Goblin Admin
          </h1>
          <p className="mt-3 text-sm leading-6 text-gray-400">
            Manage the private cloud session for this browser.
          </p>
        </div>
        <AdminAuthPanel />
      </main>
    </div>
  );
}
