import Link from "next/link";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background min-h-screen">
      <header className="border-b">
        <div className="container flex h-14 items-center px-4">
          <Link href="/" className="text-sm font-medium">
            CmdClaw
          </Link>
        </div>
      </header>
      <main className="container mx-auto max-w-4xl px-4 py-12">{children}</main>
      <footer className="border-t py-6">
        <div className="text-muted-foreground container flex flex-col items-center gap-4 px-4 text-center text-sm md:flex-row md:justify-between md:text-left">
          <p>&copy; {new Date().getFullYear()} CmdClaw. All rights reserved.</p>
          <nav className="flex gap-4">
            <Link href="/legal/terms" className="hover:underline">
              Terms
            </Link>
            <Link href="/legal/privacy-policy" className="hover:underline">
              Privacy
            </Link>
            <Link href="/support" className="hover:underline">
              Support
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
