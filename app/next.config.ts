import type { NextConfig } from "next";
import "./src/env.js";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  serverExternalPackages: ["@whiskeysockets/baileys"],
};

export default nextConfig;
