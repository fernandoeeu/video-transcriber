import { createFileRoute } from "@tanstack/react-router";

import { HomeScreen } from "../features/videos/home-screen";
import { getDependencies } from "../server/dependencies";
import { getVideos } from "../server/video";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [report, videos] = await Promise.all([getDependencies(), getVideos()]);
    return { report, videos };
  },
  component: HomeComponent,
});

function HomeComponent() {
  const { report, videos } = Route.useLoaderData();
  return <HomeScreen report={report} initialVideos={videos} />;
}
