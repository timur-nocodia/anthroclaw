import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "anthroClaw Control",
  description: "anthroClaw multi-agent control panel",
};

interface Props {
  children: ReactNode;
}

export default function RootLayout({ children }: Props): ReactNode {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${inter.className} antialiased bg-background`}>{children}</body>
    </html>
  );
}
