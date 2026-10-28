"use client";

import { Camera, FileText, X } from "lucide-react";
import { useRef, type ClipboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { fileSize } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The file types the API takes (D10, S2-3). The API checks type, contents, size and count again. */
export const ACCEPT = ".pdf,.docx,.xlsx,.png,.jpg,.jpeg,.webp";
export const IMAGES = "image/png,image/jpeg,image/webp";

/** A file shown before or after sending: an image as a thumbnail (D95), anything else by name. */
export type Shown = { key: string; name: string; size?: number; src: string | null; href?: string };

export function isImage(mime: string) {
  return mime.startsWith("image/");
}

/** A local preview of a file not yet sent; the caller revokes it when the page no longer shows it. */
export function preview(file: File): string | null {
  return isImage(file.type) ? URL.createObjectURL(file) : null;
}

/**
 * Images pasted with Ctrl+V or Cmd+V, such as a screenshot. A browser names a pasted picture
 * "image.png", so it becomes "Screenshot 10.42.07.png". Copied text that also carries a picture
 * (cells from Excel) pastes as text.
 */
export function pastedImages(e: ClipboardEvent): File[] {
  if (e.clipboardData.getData("text/plain")) return [];
  const images = Array.from(e.clipboardData.files).filter((f) => isImage(f.type));
  const stamp = new Date().toTimeString().slice(0, 8).replaceAll(":", ".");
  return images.map((f, i) => {
    if (!/^image\.\w+$/.test(f.name)) return f;
    const ext = f.type === "image/jpeg" ? "jpg" : f.type.split("/")[1];
    return new File([f], `Screenshot ${stamp}${images.length > 1 ? ` (${i + 1})` : ""}.${ext}`, { type: f.type });
  });
}

/** Size and count, checked before uploading so a refusal is instant. */
export function withinLimits(files: File[], already: number, maxFiles: number, maxMb: number) {
  const ok: File[] = [];
  let error: string | null = null;
  for (const file of files) {
    if (already + ok.length >= maxFiles) {
      error = `Up to ${maxFiles} files per feedback.`;
      break;
    }
    if (file.size > maxMb * 1024 * 1024) {
      error = `${file.name}: Files can be up to ${maxMb} MB.`;
      continue;
    }
    ok.push(file);
  }
  return { ok, error };
}

/** Files as thumbnails (images) and chips (anything else), each removable when `onRemove` is given. */
export function FileThumbs({ files, onRemove, className }: { files: Shown[]; onRemove?: (key: string) => void; className?: string }) {
  if (files.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-2", className)} aria-label="Attached files">
      {files.map((f) => {
        const label = f.size === undefined ? f.name : `${f.name} · ${fileSize(f.size)}`;
        const body = f.src ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local preview or a signed file link, not a static asset
          <img src={f.src} alt={f.name} title={label} className="size-16 rounded-lg border bg-muted object-cover" />
        ) : (
          <span className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-full border bg-card py-1 pl-3 text-xs text-foreground", onRemove ? "pr-8" : "pr-3")}>
            <FileText className="size-3.5" aria-hidden="true" /> {label}
          </span>
        );
        return (
          <li key={f.key} className="relative">
            {f.href ? (
              <a href={f.href} target="_blank" rel="noreferrer" className="block rounded-lg" aria-label={f.src ? `Open ${f.name}` : undefined}>
                {body}
              </a>
            ) : (
              body
            )}
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(f.key)}
                className={cn(
                  "grid size-6 place-items-center rounded-full border bg-card shadow-sm hover:bg-muted",
                  f.src ? "absolute -top-2 -right-2" : "absolute top-1 right-1",
                )}
                aria-label={`Don't send ${f.name}`}
              >
                <X className="size-3.5" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Text masking can't read an image (D95), so a new screenshot gets this one line. */
export function ScreenshotNote({ files }: { files: Shown[] }) {
  if (!files.some((f) => f.src)) return null;
  return <p className="text-xs text-muted-foreground">Check it doesn&apos;t show passwords or card numbers.</p>;
}

/** Take a photo with the phone's camera (D95). Shown only where the main pointer is a finger. */
export function PhotoButton({ onFiles, disabled, iconOnly, className }: { onFiles: (files: File[]) => void; disabled?: boolean; iconOnly?: boolean; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={IMAGES}
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="photo-input"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant={iconOnly ? "ghost" : "outline"}
        size={iconOnly ? "icon-lg" : "lg"}
        className={cn("hidden pointer-coarse:inline-flex", className)}
        disabled={disabled}
        onClick={() => input.current?.click()}
        aria-label={iconOnly ? "Take a photo" : undefined}
      >
        <Camera className="size-5" aria-hidden="true" />
        {!iconOnly && "Take a photo"}
      </Button>
    </>
  );
}
