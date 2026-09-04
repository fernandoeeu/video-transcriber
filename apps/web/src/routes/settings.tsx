import { createFileRoute } from "@tanstack/react-router";
import { FolderOpen, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@video-transcriber/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@video-transcriber/ui/components/card";
import { Input } from "@video-transcriber/ui/components/input";
import { Label } from "@video-transcriber/ui/components/label";
import { LoadingState } from "@video-transcriber/ui/components/loading-state";

import { getSettings, resetDownloadFolder, updateDownloadFolder } from "../server/settings";

export const Route = createFileRoute("/settings")({
  loader: async () => {
    return getSettings();
  },
  component: SettingsComponent,
});

function SettingsComponent() {
  const settings = Route.useLoaderData();
  const [folder, setFolder] = useState(settings.downloadFolder);
  const [saving, setSaving] = useState(false);

  const isDefault = folder === settings.defaultDownloadFolder;
  const hasChanges = folder !== settings.downloadFolder;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!folder.trim() || saving) return;

    setSaving(true);
    try {
      const result = await updateDownloadFolder({ data: { folder: folder.trim() } });
      setFolder(result.downloadFolder);
      toast.success("Settings saved");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    try {
      const result = await resetDownloadFolder();
      setFolder(result.downloadFolder);
      toast.success("Reset to default folder");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-lg font-semibold tracking-tight">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="size-4" />
            Download folder
          </CardTitle>
          <CardDescription>
            Where new audio downloads are saved. Previously downloaded Videos keep their existing
            file paths.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="download-folder">Folder path</Label>
              <Input
                id="download-folder"
                type="text"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                disabled={saving}
                placeholder="/path/to/downloads"
                className="font-mono text-xs"
              />
              {!isDefault && (
                <p className="text-xs text-muted-foreground">
                  Default: <span className="font-mono">{settings.defaultDownloadFolder}</span>
                </p>
              )}
            </div>

            <div className="flex min-h-8 items-center gap-2">
              <Button type="submit" disabled={saving || !folder.trim() || !hasChanges}>
                Save
              </Button>

              {!isDefault && (
                <Button type="button" variant="outline" onClick={handleReset} disabled={saving}>
                  <RotateCcw data-icon="inline-start" />
                  Reset to default
                </Button>
              )}

              {saving && <LoadingState label="Saving settings" variant="Dots" className="ml-1" />}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
