import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fal Prompt Playground 🍌",
  description: "Test prompts on Fal.ai image models (Nano Banana, GPT Image) — no code.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
