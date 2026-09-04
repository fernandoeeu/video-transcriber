export interface VideoCommands {
  download: (videoId: number) => Promise<void>;
  redownload: (videoId: number) => Promise<void>;
  delete: (videoId: number) => Promise<void>;
}
