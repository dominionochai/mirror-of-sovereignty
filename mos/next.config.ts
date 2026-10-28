import type { NextConfig } from "next";

// Extra hosts allowed to load the dev server (e.g. a phone on the LAN).
// Override with ALLOWED_DEV_ORIGINS="192.168.1.7,192.168.1.8".
const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "192.168.1.7")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  allowedDevOrigins,
};

export default nextConfig;
