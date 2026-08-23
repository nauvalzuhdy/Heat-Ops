import type { Metadata } from "next";
import localFont from "next/font/local";
import ThemeScript from "@/components/theme/ThemeScript";
import ThemeSync from "@/components/theme/ThemeSync";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "HeatOps",
  description: "Urban heat analysis for FortyGuard Hackathon'26",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
