import { LoadingState } from "@video-transcriber/ui/components/loading-state";

export default function Loader() {
  return (
    <div className="flex h-full items-center justify-center px-4 pt-8">
      <LoadingState label="Loading" variant="Orbit" />
    </div>
  );
}
