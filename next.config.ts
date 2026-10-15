import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Поступления переехали на страницу ввода: старые закладки /income ведут туда
  async redirects() {
    return [{ source: "/income", destination: "/?mode=income", permanent: false }];
  },
};

export default nextConfig;
