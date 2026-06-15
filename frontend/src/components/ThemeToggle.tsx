'use client';

import { useTheme } from './ThemeProvider';
import { Sun, Moon } from 'lucide-react';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="p-2.5 rounded-rc-lg bg-rc-bg-secondary text-rc-foreground-secondary hover:bg-rc-secondary-hover hover:text-rc-foreground transition-all duration-rc-base active:scale-90 hover:scale-105 focus:outline-none rc-focus-ring"
      aria-label="Toggle visual theme"
    >
      {theme === 'light' ? <Moon className="h-5 w-5 animate-rc-fade-in" /> : <Sun className="h-5 w-5 animate-rc-fade-in" />}
    </button>
  );
}
export default ThemeToggle;
