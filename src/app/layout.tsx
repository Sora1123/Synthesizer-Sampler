import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Synth Param Finder — Sound Replication Lab",
  description:
    "Analyze a reference sound, visualize its spectrum and envelope, and experiment with synthesis parameters to reproduce its acoustic character.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-mono antialiased">{children}</body>
    </html>
  );
}
