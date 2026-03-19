/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    CHAT_DEBUG: process.env.CHAT_DEBUG
  },
  async rewrites() {
    const expoIndex = "/expo-web/index.html";

    return {
      beforeFiles: [
        {
          source: "/assets/:path*",
          destination: "/expo-web/assets/:path*"
        },
        {
          source: "/_expo/:path*",
          destination: "/expo-web/_expo/:path*"
        },
        {
          source: "/",
          destination: expoIndex
        },
        {
          source: "/login",
          destination: expoIndex
        },
        {
          source: "/privacy",
          destination: expoIndex
        },
        {
          source: "/terms",
          destination: expoIndex
        },
        {
          source: "/delete-account",
          destination: expoIndex
        },
        {
          source: "/delete-data",
          destination: expoIndex
        },
        {
          source: "/sessions",
          destination: expoIndex
        },
        {
          source: "/sessions/:path*",
          destination: expoIndex
        },
        {
          source: "/games/:path*",
          destination: expoIndex
        },
        {
          source: "/chat",
          destination: expoIndex
        },
        {
          source: "/friends",
          destination: expoIndex
        },
        {
          source: "/record",
          destination: expoIndex
        },
        {
          source: "/record/:path*",
          destination: expoIndex
        },
        {
          source: "/account",
          destination: expoIndex
        },
        {
          source: "/invite/:path*",
          destination: expoIndex
        }
      ]
    };
  }
};

module.exports = nextConfig;
