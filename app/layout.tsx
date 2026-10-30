import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "../src/features/auth/AuthProvider";
import { PwaInstaller } from "./components/PwaInstaller";

export const metadata: Metadata = {
  title: {
    default: "ResearchOps",
    template: "%s · ResearchOps",
  },
  description: "Research fieldwork operations, supplier performance and project delivery in one place.",
  applicationName: "ResearchOps",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "ResearchOps" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#173a42" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body><AuthProvider>{children}<PwaInstaller /></AuthProvider></body>
    </html>
  );
}
