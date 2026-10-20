import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Service worker должен обновляться сразу после деплоя, а не через кеш браузера
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] }];
  },
  // Поступления переехали на страницу ввода, копилки — в «Сбережения»: старые закладки ведут туда
  async redirects() {
    return [
      { source: "/income", destination: "/?mode=income", permanent: false },
      { source: "/goals", destination: "/savings", permanent: false },
    ];
  },
};

export default nextConfig;
