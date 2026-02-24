import type { Metadata } from "next";
import { AutumnProvider } from "autumn-js/react";
import { Geist, Geist_Mono } from "next/font/google";
import { PostHogClientProvider } from "@/components/posthog-provider";
import { env } from "@/env";
import { ORPCProvider } from "@/orpc/provider";
// oxlint-disable-next-line import/no-unassigned-import
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CmdClaw",
  description: "Your AI Assistant",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <PostHogClientProvider>
          <ORPCProvider>
            <AutumnProvider betterAuthUrl={env.NEXT_PUBLIC_APP_URL}>{children}</AutumnProvider>
          </ORPCProvider>
        </PostHogClientProvider>
      </body>
    </html>
  );
}
