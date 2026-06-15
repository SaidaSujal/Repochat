import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ThemeProvider from "@/components/ThemeProvider";
import ThemeToggle from "@/components/ThemeToggle";
import Link from "next/link";
import { BookOpen } from "lucide-react";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "RepoChat — Chat with any GitHub repository",
  description: "Index and chat with any public GitHub repository instantly using RAG and Gemini LLM. Retrieve code chunks and file citations with ease.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isApiMissing = !process.env.NEXT_PUBLIC_API_URL;

  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} min-h-full flex flex-col bg-rc-bg text-rc-foreground transition-colors duration-200`}>
        <ThemeProvider>
          {isApiMissing && (
            <div className="bg-rc-destructive text-white text-center py-2 px-4 text-xs font-bold z-50 sticky top-0 shadow-rc-sm">
              ⚠️ NEXT_PUBLIC_API_URL environment variable is not defined. Please set it to your FastAPI server URL.
            </div>
          )}
          {/* Header */}
          <header className={`sticky ${isApiMissing ? 'top-8' : 'top-0'} z-40 w-full border-b border-rc-border bg-rc-bg/80 dark:bg-rc-bg/85 backdrop-blur-md`}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2 font-bold text-xl tracking-tight text-rc-primary hover:opacity-90 transition-opacity rounded-rc-md rc-focus-ring" aria-label="RepoChat home page">
                <BookOpen className="h-6 w-6" />
                <span>RepoChat</span>
              </Link>
              <div className="flex items-center gap-4">
                <ThemeToggle />
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 flex flex-col">
            {children}
          </main>

          {/* Footer */}
          <footer className="border-t border-rc-border bg-rc-bg-secondary py-6 mt-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-rc-foreground-secondary">
              <p>© 2026 RepoChat. All rights reserved.</p>
              <p className="flex items-center gap-1 font-medium">
                Powered by Gemini & ChromaDB. Built with Next.js.
              </p>
            </div>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
