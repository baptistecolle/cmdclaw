import Link from "next/link";

export default function SupportLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b">
        <div className="container flex h-14 items-center px-4">
          <Link href="/" className="text-sm font-medium">
            Bap
          </Link>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-12">{children}</main>
      <footer className="border-t py-6 px-4">
        <div className="flex flex-col items-center gap-4 text-center text-sm text-muted-foreground md:flex-row md:justify-between md:text-left">
          <p>&copy; {new Date().getFullYear()} Bap. All rights reserved.</p>
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
