import type { NextConfig } from "next";
import * as envConfig from "./src/env.js";

void envConfig;

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  serverExternalPackages: ["@whiskeysockets/baileys"],
};

export default nextConfig;
