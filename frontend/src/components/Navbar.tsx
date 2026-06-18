'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ThemeToggle from '@/components/ThemeToggle';
import { BookOpen, Menu, X, ArrowLeft } from 'lucide-react';

interface NavLink {
  label: string;
  href: string;
}

const LANDING_NAV_LINKS: NavLink[] = [
  { label: 'Home', href: '#home' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Features', href: '#features' },
  { label: 'Demo', href: '#demo' },
  { label: 'Architecture', href: '#architecture' },
  { label: 'Tech Stack', href: '#tech' },
  { label: 'Limits', href: '#limits' },
];

export default function Navbar() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState('home');
  const isLandingPage = pathname === '/';
  const isApiMissing = !process.env.NEXT_PUBLIC_API_URL;

  // Scrollspy: Track active section in viewport
  useEffect(() => {
    if (!isLandingPage) return;

    const sectionIds = LANDING_NAV_LINKS.map((link) => link.href.substring(1));
    const observerOptions = {
      root: null,
      rootMargin: '-30% 0px -50% 0px', // Trigger when section occupies the middle portion of the screen
      threshold: 0,
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setActiveSection(entry.target.id);
        }
      });
    }, observerOptions);

    sectionIds.forEach((id) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });

    return () => {
      sectionIds.forEach((id) => {
        const element = document.getElementById(id);
        if (element) observer.unobserve(element);
      });
    };
  }, [isLandingPage]);

  // Detect scroll to apply sticky bg shadow & blur transitions
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 10) {
        setScrolled(true);
      } else {
        setScrolled(false);
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    setMobileMenuOpen(false);
    if (isLandingPage && href.startsWith('#')) {
      e.preventDefault();
      const id = href.substring(1);
      setActiveSection(id);
      const element = document.getElementById(id);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  return (
    <header
      className={`sticky ${isApiMissing ? 'top-8' : 'top-0'} z-40 w-full transition-all duration-rc-base border-b ${
        scrolled
          ? 'rc-glass shadow-rc-sm border-rc-border'
          : 'bg-transparent border-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo */}
        <Link
          href="/"
          onClick={() => {
            if (isLandingPage) {
              window.scrollTo({ top: 0, behavior: 'smooth' });
              setActiveSection('home');
            }
          }}
          className="flex items-center gap-2 font-extrabold text-xl tracking-tight text-rc-primary hover:opacity-90 transition-opacity rounded-rc-md rc-focus-ring"
          aria-label="RepoChat home page"
        >
          <BookOpen className="h-6 w-6 stroke-[2.5]" />
          <span className="bg-gradient-to-r from-rc-primary to-rc-accent bg-clip-text text-transparent">
            RepoChat
          </span>
        </Link>

        {/* Desktop Navigation Links */}
        {isLandingPage ? (
          <nav className="hidden md:flex items-center gap-1" aria-label="Desktop primary navigation">
            {LANDING_NAV_LINKS.map((link) => {
              const sectionId = link.href.substring(1);
              const isActive = activeSection === sectionId;
              return (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={(e) => handleLinkClick(e, link.href)}
                  className={`relative px-3.5 py-1.5 text-xs font-semibold rounded-rc-md transition-all duration-rc-base focus:outline-none rc-focus-ring ${
                    isActive
                      ? 'text-rc-primary dark:text-indigo-400 font-bold'
                      : 'text-rc-foreground-secondary hover:text-rc-foreground hover:bg-rc-bg-secondary/40'
                  }`}
                >
                  {isActive && (
                    <span className="absolute inset-0 bg-rc-primary/10 dark:bg-indigo-500/15 rounded-rc-md -z-10 animate-rc-fade-in" />
                  )}
                  {link.label}
                </a>
              );
            })}
          </nav>
        ) : (
          <nav className="hidden md:flex items-center" aria-label="Desktop context navigation">
            <Link
              href="/"
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-rc-foreground-secondary hover:text-rc-foreground bg-rc-bg-secondary hover:bg-rc-secondary-hover border border-rc-border rounded-rc-xl transition-all hover:scale-[1.01] active:scale-95"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Home</span>
            </Link>
          </nav>
        )}

        {/* Right side controls */}
        <div className="flex items-center gap-2.5">
          <ThemeToggle />

          {/* Mobile hamburger button */}
          {isLandingPage && (
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2.5 rounded-rc-lg bg-rc-bg-secondary text-rc-foreground-secondary hover:text-rc-foreground hover:bg-rc-secondary-hover transition-all focus:outline-none rc-focus-ring"
              aria-expanded={mobileMenuOpen}
              aria-label="Toggle mobile menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          )}

          {!isLandingPage && (
            <Link
              href="/"
              className="md:hidden p-2.5 rounded-rc-lg bg-rc-bg-secondary text-rc-foreground-secondary hover:text-rc-foreground hover:bg-rc-secondary-hover transition-all"
              aria-label="Back to home page"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
          )}
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {isLandingPage && mobileMenuOpen && (
        <div className="md:hidden absolute top-16 left-0 right-0 border-b border-rc-border bg-rc-bg/95 dark:bg-rc-bg/98 backdrop-blur-lg shadow-rc-md animate-rc-slide-down">
          <nav className="flex flex-col px-4 pt-2.5 pb-6 gap-1" aria-label="Mobile navigation menu">
            {LANDING_NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={(e) => handleLinkClick(e, link.href)}
                className="px-4 py-3 text-sm font-semibold text-rc-foreground-secondary hover:text-rc-foreground rounded-rc-xl hover:bg-rc-bg-secondary/80 transition-all"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
