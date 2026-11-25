import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { MoonIcon, SunIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

type Theme = "light" | "dark"

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: "light", toggle: () => {} })
export const useTheme = () => useContext(ThemeContext)

/** Light or dark. Follows the computer's setting until the person picks one, then remembers it. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem("theme") as Theme | null) ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"))
  useEffect(() => { document.documentElement.classList.toggle("dark", theme === "dark") }, [theme])
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark"
    localStorage.setItem("theme", next)
    setTheme(next)
  }
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const dark = theme === "dark"
  return (
    <Button variant="ghost" size="icon-sm" className="relative ml-auto" onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
      <SunIcon className="theme-icon absolute" data-hidden={!dark || undefined} />
      <MoonIcon className="theme-icon" data-hidden={dark || undefined} />
    </Button>
  )
}
