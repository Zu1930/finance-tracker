import { SettingsFrame } from "@/components/settings/SettingsFrame";

/** Настройки: меню слева на десктопе, на мобильном — индекс /settings и страницы разделов */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsFrame>{children}</SettingsFrame>;
}
