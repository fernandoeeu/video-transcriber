"use client";

import { ArrowUp, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@video-transcriber/ui/components/button";
import { Input } from "@video-transcriber/ui/components/input";

type GlimmModule = typeof import("glimm");
type ShaderController = NonNullable<ReturnType<GlimmModule["createShader"]>>;
type SweepHandle = ReturnType<GlimmModule["playSweep"]>;

let glimmPromise: Promise<GlimmModule> | null = null;

function loadGlimm() {
  glimmPromise ??= import("glimm");
  return glimmPromise;
}

/**
 * Beautiful UI's Prompt Bar reduced to the product's real input: one video URL.
 * The composer shell and Glimm sweep are preserved; unsupported AI controls are not.
 */
function PromptBar({
  value,
  onChange,
  onSubmit,
  loading = false,
  placeholder = "Paste a video URL...",
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  loading?: boolean;
  placeholder?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shaderRef = useRef<ShaderController | null>(null);
  const sweepRef = useRef<SweepHandle | null>(null);
  const sweepingRef = useRef(false);
  const sweepRequestRef = useRef(0);

  const destroySweep = () => {
    sweepRequestRef.current += 1;
    sweepRef.current?.cancel();
    sweepRef.current = null;
    shaderRef.current?.destroy();
    shaderRef.current = null;
    sweepingRef.current = false;
  };

  useEffect(() => destroySweep, []);

  const sweep = async () => {
    if (sweepingRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const request = sweepRequestRef.current + 1;
    sweepRequestRef.current = request;
    sweepingRef.current = true;

    try {
      const { ACCENTS, accentChain, createShader, playSweep } = await loadGlimm();
      if (sweepRequestRef.current !== request || canvasRef.current !== canvas) return;

      const palette = accentChain([
        ACCENTS.red,
        ACCENTS.orange,
        ACCENTS.yellow,
        ACCENTS.green,
        ACCENTS.cyan,
        ACCENTS.blue,
        ACCENTS.purple,
      ]);
      const shader = createShader({
        canvas,
        palette,
        direction: "ltr",
        bandTight: 10,
        swellAmount: 0.75,
      });

      if (!shader) {
        console.warn("[PromptBar] Submit sweep unavailable; continuing without animation.");
        return;
      }

      shaderRef.current = shader;

      const activeSweep = playSweep(shader, {
        palette,
        direction: "ltr",
        sweepMs: 480,
        outroMs: 100,
        peakAlpha: 1,
        bandTight: 10,
        brightness: 1.2,
        swellAmount: 0.8,
        waveSpeed: 1.1,
        easing: "easeOutExpo",
      });
      sweepRef.current = activeSweep;

      void activeSweep.done.then(
        () => {
          if (sweepRef.current === activeSweep) destroySweep();
        },
        (error: unknown) => {
          if (sweepRef.current !== activeSweep) return;
          destroySweep();
          console.error("[PromptBar] Submit sweep failed; continuing without animation.", error);
        },
      );
    } catch (error) {
      if (sweepRequestRef.current !== request) return;
      destroySweep();
      console.error("[PromptBar] Submit sweep failed; continuing without animation.", error);
    } finally {
      if (sweepRequestRef.current === request && sweepRef.current === null) {
        sweepingRef.current = false;
      }
    }
  };

  const canSubmit = value.trim().length > 0 && !loading;

  return (
    <form
      data-beautiful-ui
      data-slot="prompt-bar"
      className="relative isolate overflow-hidden rounded-xl border border-border bg-card p-1.5 shadow-card transition-[border-color,box-shadow] duration-150 ease-out focus-within:border-foreground/20 focus-within:shadow-raised"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        void sweep();
        void onSubmit();
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 size-full"
        style={{ borderRadius: "inherit" }}
      />
      <div className="flex items-center gap-1.5">
        <Input
          type="url"
          aria-label="Video URL"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={loading}
          className="h-9 flex-1 border-0 bg-transparent font-mono text-xs shadow-none focus-visible:border-transparent focus-visible:ring-0 placeholder:font-sans placeholder:text-sm"
          autoComplete="url"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!canSubmit}
          aria-label={loading ? "Fetching video metadata" : "Fetch video metadata"}
          className="rounded-lg"
        >
          {loading ? <Loader2 className="animate-spin" /> : <ArrowUp />}
        </Button>
      </div>
    </form>
  );
}

export { PromptBar };
