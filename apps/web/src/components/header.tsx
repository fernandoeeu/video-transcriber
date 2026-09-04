import { Link } from "@tanstack/react-router";
import { AudioLines, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@video-transcriber/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@video-transcriber/ui/components/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@video-transcriber/ui/components/tooltip";

const links = [
  { to: "/", label: "Library" },
  { to: "/settings", label: "Settings" },
] as const;

export default function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-1 px-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-1 min-[400px]:gap-3 sm:gap-6">
          <Link
            to="/"
            aria-label="Video Transcriber"
            className="flex size-9 shrink-0 items-center justify-center gap-2 font-semibold tracking-tight sm:w-auto sm:justify-start"
          >
            <AudioLines className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Video Transcriber</span>
          </Link>
          <nav
            aria-label="Primary navigation"
            className="flex min-w-0 items-center gap-0.5 text-sm"
          >
            {links.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/" }}
                className="flex h-9 items-center rounded-md px-2 text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground data-[status=active]:font-medium data-[status=active]:text-foreground min-[400px]:px-2.5"
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Change theme"
                  className="shrink-0"
                />
              }
            />
          }
        >
          {mounted && theme === "light" ? (
            <Sun className="size-4" />
          ) : mounted && theme === "dark" ? (
            <Moon className="size-4" />
          ) : (
            <Monitor className="size-4" />
          )}
        </TooltipTrigger>
        <TooltipContent>Theme</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun className="size-4" />
          Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon className="size-4" />
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Monitor className="size-4" />
          System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
