import type { TranscriptionData } from "../../core/transcription";
import { FilterTable, type FilterTableRow } from "./filter-table";
import { toFilterStatus } from "./transcription-status";

const transcriptionDateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function TranscriptionHistory({
  transcriptions,
  latest,
  selectedTranscriptionId,
  onSelect,
}: {
  transcriptions: TranscriptionData[];
  latest: TranscriptionData | null;
  selectedTranscriptionId: number | null;
  onSelect: (transcription: TranscriptionData) => void;
}) {
  if (transcriptions.length === 0) return null;

  const rows: FilterTableRow[] = transcriptions.map((transcription) => ({
    id: String(transcription.id),
    primary: transcription.engine || "Local transcription",
    date: transcriptionDateFormatter.format(new Date(transcription.createdAt)),
    status: toFilterStatus(transcription.status),
    model: transcription.model,
    language: transcription.language,
    selected: selectedTranscriptionId === transcription.id,
    onSelect:
      transcription.status === "completed" && transcription.segments
        ? () => onSelect(transcription)
        : undefined,
  }));

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">History</h2>
        {latest && <span className="text-xs text-muted-foreground">Latest #{latest.id}</span>}
      </div>
      <FilterTable rows={rows} />
    </section>
  );
}

export { TranscriptionHistory };
