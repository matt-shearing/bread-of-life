import type { Config } from "tailwindcss";

/**
 * Design tokens salvaged from the prior `UI-guide.md`:
 *  - amber #f59e0b as the "Bread of Life" primary signature
 *  - Inter for UI, Merriweather serif for scripture only
 *  - light + dark via CSS variables (see src/index.css)
 */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        // amber ramp — the brand
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          50: "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
          800: "#92400e",
          900: "#78350f",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: { DEFAULT: "hsl(var(--success))", foreground: "hsl(var(--success-foreground))" },
      },
      borderRadius: { lg: "12px", md: "10px", sm: "8px" },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        serif: ["Merriweather", "Georgia", "serif"],
      },
      boxShadow: { card: "0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.08)" },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        // Now Playing: the sheet rises from the mini-player; the panel settles in.
        "sheet-up": { from: { transform: "translateY(100%)" }, to: { transform: "translateY(0)" } },
        "panel-in": {
          from: { opacity: "0", transform: "translateY(12px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        // The little "now playing" equaliser bars.
        "np-bar": { "0%, 100%": { transform: "scaleY(0.35)" }, "50%": { transform: "scaleY(1)" } },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        "sheet-up": "sheet-up 320ms cubic-bezier(0.32, 0.72, 0, 1)",
        "panel-in": "panel-in 220ms ease-out",
        "np-bar": "np-bar 900ms ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
