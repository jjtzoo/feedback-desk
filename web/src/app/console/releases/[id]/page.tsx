"use client";

import { ArrowLeft, Eye, EyeOff, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText, type Release, type ReleaseItem, type WorkType } from "@/lib/api";
import { day } from "@/lib/format";
import { cn } from "@/lib/utils";

const SOURCE: Record<ReleaseItem["source_type"], string> = {
  feedback: "Resolved feedback",
  progress: "Progress update",
  manual: "Added by hand",
};
const SECTION: { value: WorkType | "none"; label: string }[] = [
  { value: "new_feature", label: "New" },
  { value: "improvement", label: "Improved" },
  { value: "fix", label: "Fixed" },
  { value: "none", label: "Other" },
];

type Editable = Omit<ReleaseItem, "id"> & { id: string | null; key: string };

/** Review a Friday release: tick what staff see, reword, add or remove items, publish. */
export default function ReleaseReviewPage() {
  const { id } = useParams<{ id: string }>();
  const [release, setRelease] = useState<Release | null>(null);
  const [items, setItems] = useState<Editable[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);

  const apply = useCallback((r: Release) => {
    setRelease(r);
    setItems(r.items.map((i) => ({ ...i, key: i.id })));
  }, []);

  useEffect(() => {
    api.get<Release>(`/console/releases/${id}`).then(apply).catch((e: unknown) => setError(errorText(e)));
  }, [id, apply]);

  const editable = release?.status === "draft" && release.can_publish;
  const update = (key: string, patch: Partial<Editable>) => setItems((all) => all.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  async function save(): Promise<boolean> {
    setBusy("save");
    try {
      apply(
        await api.put<Release>(`/console/releases/${id}/items`, {
          items: items.map((i) => ({ id: i.id, title: i.title, body: i.body, work_type: i.work_type, visible_to_staff: i.visible_to_staff })),
        }),
      );
      toast.success("Saved");
      return true;
    } catch (e) {
      toast.error(errorText(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    if (!(await save())) return;
    setBusy("publish");
    try {
      apply(await api.post<Release>(`/console/releases/${id}/publish`));
      toast.success("Published. Staff whose feedback is in it have been told.");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="p-6 text-destructive">{error}</p>;
  if (!release) return <Skeleton className="m-6 h-80 rounded-3xl" />;

  return (
    <div className="mx-auto grid max-w-3xl gap-4 p-4 sm:p-6">
      <Link href="/console/releases" className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" /> Releases
      </Link>
      <div>
        <h1 className="text-2xl font-extrabold">{release.project.name}</h1>
        <p className="text-sm text-muted-foreground">
          Week ending {day(release.week_ending)} · {release.status === "published" ? "Published" : "Draft"}
          {!release.can_publish && release.status === "draft" && " · only the project owner or an Admin can publish"}
        </p>
      </div>

      {release.status === "published" ? (
        <ol className="grid gap-3" aria-label="Items in this release">
          {release.items.map((i) => (
            <li key={i.id} className="grid gap-2 rounded-3xl border bg-card p-5 shadow-card">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                <span className="rounded-full bg-muted px-2.5 py-0.5 font-semibold text-foreground">{SECTION.find((s) => s.value === (i.work_type ?? "none"))?.label}</span>
                <span>{SOURCE[i.source_type]}</span>
                <span className={cn("inline-flex items-center gap-1 font-semibold", i.visible_to_staff ? "text-success" : "text-muted-foreground")}>
                  {i.visible_to_staff ? <Eye className="size-3.5" aria-hidden="true" /> : <EyeOff className="size-3.5" aria-hidden="true" />}
                  {i.visible_to_staff ? "Shown to staff" : "Not shown to staff"}
                </span>
                {!!i.thanks && <span className="ml-auto">👍 {i.thanks} from staff</span>}
              </div>
              <h2 className="text-lg font-bold">{i.title}</h2>
              {i.body && <p className="text-muted-foreground">{i.body}</p>}
            </li>
          ))}
          {release.items.length === 0 && <li className="rounded-3xl border border-dashed p-8 text-center text-muted-foreground">Nothing was in this release.</li>}
        </ol>
      ) : (
        <ol className="grid gap-3">
          {items.map((i) => (
            <li key={i.key} className="grid gap-3 rounded-3xl border bg-card p-4 shadow-card">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <Checkbox checked={i.visible_to_staff} disabled={!editable} onCheckedChange={(v) => update(i.key, { visible_to_staff: v === true })} />
                  Staff can see this
                </label>
                <span className="text-xs text-muted-foreground">{SOURCE[i.source_type]}</span>
                {release.status === "published" && !!i.thanks && (
                  <span className="text-xs text-muted-foreground">👍 {i.thanks} from staff</span>
                )}
                {editable && (
                  <Button variant="ghost" size="icon" className="ml-auto" aria-label="Remove item" onClick={() => setItems((all) => all.filter((x) => x.key !== i.key))}>
                    <Trash2 />
                  </Button>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
                <Input value={i.title} disabled={!editable} onChange={(e) => update(i.key, { title: e.target.value })} aria-label="Title" className="h-11 rounded-xl font-semibold" />
                <Select value={i.work_type ?? "none"} disabled={!editable} onValueChange={(v) => update(i.key, { work_type: v === "none" ? null : (v as WorkType) })}>
                  <SelectTrigger className="h-11 w-full rounded-xl" aria-label="Section">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SECTION.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Textarea value={i.body} disabled={!editable} rows={2} onChange={(e) => update(i.key, { body: e.target.value })} aria-label="Description" className="rounded-xl" />
            </li>
          ))}
        </ol>
      )}

      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="h-11 rounded-xl"
            onClick={() =>
              setItems((all) => [
                ...all,
                { id: null, key: `new-${all.length}-${Date.now()}`, title: "", body: "", work_type: null, source_type: "manual", source_id: null, visible_to_staff: true },
              ])
            }
          >
            Add item
          </Button>
          <Button variant="outline" className="h-11 rounded-xl" onClick={() => void save()} disabled={busy !== null}>
            {busy === "save" && <Loader2 className="animate-spin" />} Save draft
          </Button>
          <Button className="h-11 rounded-xl px-5" onClick={() => void publish()} disabled={busy !== null || !items.some((i) => i.visible_to_staff)}>
            {busy === "publish" && <Loader2 className="animate-spin" />} Approve and publish
          </Button>
        </div>
      )}
    </div>
  );
}
