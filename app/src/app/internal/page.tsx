"use client";

import Link from "next/link";
import { Eye, Wrench } from "lucide-react";

const internalPages = [
  {
    title: "Component Previews",
    description: "Preview integration components with mock data",
    href: "/internal/previews",
    icon: Eye,
  },
];

export default function InternalPage() {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Wrench className="h-8 w-8 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-bold">Internal Tools</h1>
            <p className="text-muted-foreground">Development and debugging utilities</p>
          </div>
        </div>

        <div className="grid gap-4">
          {internalPages.map((page) => (
            <Link
              key={page.href}
              href={page.href}
              className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent transition-colors"
            >
              <page.icon className="h-6 w-6 text-muted-foreground" />
              <div>
                <h2 className="font-medium">{page.title}</h2>
                <p className="text-sm text-muted-foreground">{page.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
