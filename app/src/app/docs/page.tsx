"use client";

import { ApiReferenceReact } from "@scalar/api-reference-react";
import scalarStyles from "@scalar/api-reference-react/style.css";

void scalarStyles;

const docsConfiguration = {
  url: "/api/openapi",
  theme: "kepler",
} as const;

export default function DocsPage() {
  return <ApiReferenceReact configuration={docsConfiguration} />;
}
