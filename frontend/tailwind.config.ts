import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      /* ── Color Tokens (bridged from CSS custom properties) ── */
      colors: {
        rc: {
          bg: "var(--rc-bg)",
          "bg-secondary": "var(--rc-bg-secondary)",
          "bg-tertiary": "var(--rc-bg-tertiary)",
          foreground: "var(--rc-foreground)",
          "foreground-secondary": "var(--rc-foreground-secondary)",
          "foreground-muted": "var(--rc-foreground-muted)",
          card: "var(--rc-card)",
          "card-hover": "var(--rc-card-hover)",
          border: "var(--rc-border)",
          "border-subtle": "var(--rc-border-subtle)",
          primary: "var(--rc-primary)",
          "primary-hover": "var(--rc-primary-hover)",
          "primary-foreground": "var(--rc-primary-foreground)",
          "primary-muted": "var(--rc-primary-muted)",
          secondary: "var(--rc-secondary)",
          "secondary-hover": "var(--rc-secondary-hover)",
          "secondary-foreground": "var(--rc-secondary-foreground)",
          muted: "var(--rc-muted)",
          "muted-foreground": "var(--rc-muted-foreground)",
          accent: "var(--rc-accent)",
          "accent-hover": "var(--rc-accent-hover)",
          "accent-foreground": "var(--rc-accent-foreground)",
          "accent-muted": "var(--rc-accent-muted)",
          success: "var(--rc-success)",
          "success-muted": "var(--rc-success-muted)",
          warning: "var(--rc-warning)",
          "warning-muted": "var(--rc-warning-muted)",
          destructive: "var(--rc-destructive)",
          "destructive-muted": "var(--rc-destructive-muted)",
          glass: {
            bg: "var(--rc-glass-bg)",
            border: "var(--rc-glass-border)",
          },
        },
      },
      /* ── Existing gradient utilities (preserved) ── */
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
      /* ── Shadow System ── */
      boxShadow: {
        "rc-xs": "var(--rc-shadow-xs)",
        "rc-sm": "var(--rc-shadow-sm)",
        "rc-md": "var(--rc-shadow-md)",
        "rc-lg": "var(--rc-shadow-lg)",
      },
      /* ── Border Radius System ── */
      borderRadius: {
        "rc-sm": "var(--rc-radius-sm)",
        "rc-md": "var(--rc-radius-md)",
        "rc-lg": "var(--rc-radius-lg)",
        "rc-xl": "var(--rc-radius-xl)",
        "rc-2xl": "var(--rc-radius-2xl)",
        "rc-pill": "var(--rc-radius-pill)",
      },
      /* ── Animation System ── */
      keyframes: {
        "rc-fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "rc-slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "rc-slide-down": {
          from: { opacity: "0", transform: "translateY(-8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "rc-shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "rc-pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(59, 130, 246, 0)" },
          "50%": { boxShadow: "0 0 0 4px rgba(59, 130, 246, 0.1)" },
        },
        "rc-spin-slow": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "rc-fade-in": "rc-fade-in 0.3s ease-out",
        "rc-slide-up": "rc-slide-up 0.35s ease-out",
        "rc-slide-down": "rc-slide-down 0.35s ease-out",
        "rc-shimmer": "rc-shimmer 1.8s ease-in-out infinite",
        "rc-pulse-glow": "rc-pulse-glow 2s ease-in-out infinite",
        "rc-spin-slow": "rc-spin-slow 2s linear infinite",
      },
      /* ── Transition Timing ── */
      transitionDuration: {
        "rc-fast": "150ms",
        "rc-base": "200ms",
        "rc-slow": "300ms",
      },
      transitionTimingFunction: {
        "rc-ease": "cubic-bezier(0.4, 0, 0.2, 1)",
      },
    },
  },
  plugins: [],
};
export default config;
