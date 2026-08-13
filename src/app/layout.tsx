import type { Metadata } from "next";
import { Libre_Franklin, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const franklin = Libre_Franklin({
  subsets: ["latin"],
  variable: "--font-franklin",
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-plexmono",
});

export const metadata: Metadata = {
  title: "RTO Tracker",
  description: "Personal return-to-office attendance record",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${franklin.variable} ${plexMono.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
