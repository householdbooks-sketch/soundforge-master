import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SoundForge Master — AI Audio Mastering Suite",
  description: "Demucs · DeepFilterNet3 · EBU R128 Broadcast Audio Mastering Suite",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased selection:bg-[#60B0E5]/30">
        {children}
      </body>
    </html>
  );
}
