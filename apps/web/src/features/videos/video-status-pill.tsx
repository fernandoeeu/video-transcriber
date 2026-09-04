import { CheckCircle2 } from "lucide-react";

import { formatVideoStatus } from "./video-view-model";

function VideoStatusPill({ status }: { status: string }) {
  if (status === "downloaded") {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="inline-flex items-center gap-1.5 rounded-full bg-success/[12%] px-2 py-0.5 text-[11px] font-medium text-success"
      >
        <CheckCircle2 className="size-3" />
        Downloaded
      </span>
    );
  }

  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground"
    >
      {formatVideoStatus(status)}
    </span>
  );
}

export { VideoStatusPill };
