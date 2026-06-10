import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fal Prompt Playground 🍌",
  description: "Testuj prompty na modelach Fal.ai (nano-banana, GPT Image) bez kodu.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
