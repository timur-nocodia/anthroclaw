import type { NextConfig } from "next";
import { resolve } from "path";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "better-sqlite3",
    "pino",
    "@whiskeysockets/baileys",
    "grammy",
    "@anthropic-ai/claude-agent-sdk",
    "ssh2",
    "bcrypt",
    "cpu-features",
  ],
  webpack: (config, { isServer }) => {
    // Resolve @backend/* alias so webpack can find ../src/*.ts files
    // The backend uses ESM .js extensions in imports (e.g. '@backend/gateway.js')
    // which actually refer to .ts source files
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "@backend": resolve(__dirname, "../src"),
    };

    // Allow webpack to resolve .ts files when .js extension is specified
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".js"],
    };

    return config;
  },
};

export default nextConfig;
