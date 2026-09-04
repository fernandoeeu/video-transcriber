import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Toaster } from "@video-transcriber/ui/components/sonner";
import { TooltipProvider } from "@video-transcriber/ui/components/tooltip";

import Header from "../components/header";
import { ThemeProvider } from "../components/theme-provider";

import appCss from "../index.css?url";

export interface RouterAppContext {}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Video Transcriber",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),

  component: RootDocument,
});

function RootDocument() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="min-h-svh bg-background text-foreground antialiased">
        <ThemeProvider>
          <TooltipProvider delay={300}>
            <div className="grid min-h-svh grid-rows-[auto_1fr]">
              <Header />
              <main>
                <Outlet />
              </main>
            </div>
            <Toaster richColors />
          </TooltipProvider>
        </ThemeProvider>
        <TanStackRouterDevtools position="bottom-left" />
        <Scripts />
      </body>
    </html>
  );
}
