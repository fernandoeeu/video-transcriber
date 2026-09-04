import { createFileRoute } from "@tanstack/react-router";

import { VideoTranscriptionScreen } from "../features/transcriptions/video-transcription-screen";
import { getVideoLatestTranscription, getVideoTranscriptions } from "../server/transcription";
import { getVideo } from "../server/video";

export const Route = createFileRoute("/videos/$videoId")({
  loader: async ({ params }) => {
    const videoId = Number(params.videoId);
    const [video, transcriptions, latest] = await Promise.all([
      getVideo({ data: { videoId } }),
      getVideoTranscriptions({ data: { videoId } }),
      getVideoLatestTranscription({ data: { videoId } }),
    ]);
    return { video, transcriptions, latest };
  },
  component: VideoDetailComponent,
});

function VideoDetailComponent() {
  return <VideoTranscriptionScreen {...Route.useLoaderData()} />;
}
