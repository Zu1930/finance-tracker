import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Поступления переехали на страницу ввода, копилки — в «Сбережения»: старые закладки ведут туда
  async redirects() {
    return [
      { source: "/income", destination: "/?mode=income", permanent: false },
      { source: "/goals", destination: "/savings", permanent: false },
    ];
  },
};

export default nextConfig;
