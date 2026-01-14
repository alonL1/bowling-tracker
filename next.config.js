/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    CHAT_DEBUG: process.env.CHAT_DEBUG
  }
};

module.exports = nextConfig;
