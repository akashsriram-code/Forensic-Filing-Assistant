import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SEC filings assistant",
  description: "SEC filing downloader and 13-F analysis",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className="antialiased"
      >
        {children}
      </body>
    </html>
  );
}
