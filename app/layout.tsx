import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "../src/features/auth/AuthProvider";

export const metadata: Metadata = {
  title: {
    default: "ResearchOps",
    template: "%s · ResearchOps",
  },
  description: "Research fieldwork operations, supplier performance and project delivery in one place.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
