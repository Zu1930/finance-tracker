import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ServiceWorker } from "@/components/ServiceWorker";

const mono = JetBrains_Mono({ subsets: ["latin", "cyrillic"], weight: ["400", "500", "700"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "Траты по лимитам",
  // Иконки и манифест подключает Next по файлам app/icon.svg, app/apple-icon.png, app/manifest.ts
  appleWebApp: { capable: true, title: "Траты", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Цвет строки состояния — фон приложения в светлой и тёмной теме (--panel)
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#141414" },
    { media: "(prefers-color-scheme: light)", color: "#F7F6F2" },
  ],
};

/** Применяет сохранённую тему до первой отрисовки, чтобы не мигала тема по умолчанию. Ключ — как в components/settings/ThemeSwitch.tsx */
const themeScript = `try{var t=localStorage.getItem("ft:theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={mono.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
