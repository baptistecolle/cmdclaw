import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Support - Bap",
  description: "Get help and support for Bap",
};

export default function SupportPage() {
  return (
    <div className="space-y-6 text-center">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Support</h1>
        <p className="text-muted-foreground">
          For any questions or assistance, please reach out to us via email.
        </p>
      </div>

      <a
        href="mailto:baptiste@heybap.com"
        className="text-primary text-lg font-medium hover:underline"
      >
        baptiste@heybap.com
      </a>
    </div>
  );
}
