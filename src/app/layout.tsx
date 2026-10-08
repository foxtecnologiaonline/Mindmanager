import type { Metadata } from "next";
import { Fraunces, Work_Sans } from "next/font/google";
import "./globals.css";

// Só 500/600 — nenhuma página usa font-bold (700); evita baixar um
// arquivo de fonte inteiro sem necessidade.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["500", "600"],
});

const workSans = Work_Sans({
  variable: "--font-work-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  // Páginas definem só o próprio `title` (ex: "Entrar") e o Next monta
  // "Entrar · MindManager" — antes toda página aparecia como só
  // "MindManager" na aba/histórico, sem distinção.
  title: { default: "MindManager", template: "%s · MindManager" },
  description: "Gestão para profissionais de saúde",
  openGraph: {
    siteName: "MindManager",
    locale: "pt_BR",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${fraunces.variable} ${workSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink">{children}</body>
    </html>
  );
}
