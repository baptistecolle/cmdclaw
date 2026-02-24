import Link from "next/link";

export default function SupportLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background flex min-h-screen flex-col">
      <header className="border-b">
        <div className="container flex h-14 items-center px-4">
          <Link href="/" className="text-sm font-medium">
            CmdClaw
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-12">{children}</main>
      <footer className="border-t px-4 py-6">
        <div className="text-muted-foreground flex flex-col items-center gap-4 text-center text-sm md:flex-row md:justify-between md:text-left">
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
