import { Trash2 } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@video-transcriber/ui/components/alert-dialog";
import { Button } from "@video-transcriber/ui/components/button";

import type { VideoMetadata } from "../../core/video";

function DeleteVideoButton({
  video,
  onDelete,
  disabled = false,
}: {
  video: VideoMetadata;
  onDelete: (videoId: number) => Promise<void>;
  disabled?: boolean;
}) {
  const [deleting, setDeleting] = useState(false);

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Delete ${video.title}`}
            disabled={disabled || deleting || video.status === "downloading"}
          />
        }
      >
        <Trash2 className="text-muted-foreground" />
      </AlertDialogTrigger>
      <AlertDialogBackdrop />
      <AlertDialogPopup>
        <AlertDialogTitle>Delete video</AlertDialogTitle>
        <AlertDialogDescription>
          This will permanently remove <strong>{video.title}</strong>, all its Transcriptions and
          its files on disk. This action cannot be undone.
        </AlertDialogDescription>
        <div className="mt-4 flex justify-end gap-2">
          <AlertDialogClose render={<Button size="sm" variant="outline" />}>
            Cancel
          </AlertDialogClose>
          <AlertDialogClose
            render={
              <Button
                size="sm"
                variant="destructive"
                disabled={disabled || deleting}
                onClick={() => {
                  setDeleting(true);
                  void onDelete(video.id).finally(() => setDeleting(false));
                }}
              />
            }
          >
            {deleting ? "Deleting..." : "Delete"}
          </AlertDialogClose>
        </div>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

export { DeleteVideoButton };
