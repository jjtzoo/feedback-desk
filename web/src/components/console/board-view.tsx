"use client";

import { DndContext, PointerSensor, KeyboardSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { AlertCircle } from "lucide-react";

import { WorkCard } from "@/components/console/work-card";
import type { Card, Column } from "@/lib/api";
import { cn } from "@/lib/utils";

const DROPPABLE = new Set(["approved", "in_progress", "resolved", "fixed"]);
const EMPTY: Record<string, string> = {
  needs_review: "New items nobody has looked at yet appear here.",
  awaiting_approval: "Items waiting for an Admin appear here.",
  approved: "Approved items appear here.",
  in_progress: "Items someone is working on appear here.",
  resolved: "Resolved items appear here.",
  fixed: "Items fixed in the last 7 days appear here.",
};

function DraggableCard({ card, onOpen }: { card: Card; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.reference, data: { status: card.status } });
  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 20 } : undefined}
      {...listeners}
      {...attributes}
      aria-roledescription="Draggable card. Space to pick up, arrows to move, space to drop."
    >
      <WorkCard card={card} onOpen={onOpen} dragging={isDragging} />
    </div>
  );
}

function ColumnView({ column, onOpen }: { column: Column; onOpen: (ref: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key, disabled: !DROPPABLE.has(column.key) });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${column.title}, ${column.count} items`}
      className={cn("flex w-[290px] shrink-0 flex-col rounded-3xl bg-muted/60 p-2.5 transition-colors", isOver && "bg-muted ring-2 ring-foreground/20")}
    >
      <header className="flex items-center justify-between px-2 pt-1 pb-2.5">
        <h2 className="text-sm font-bold">
          {column.title} <span className="font-mono text-muted-foreground tabular">{column.count}</span>
        </h2>
        {column.overdue > 0 && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive">
            <AlertCircle className="size-3.5" aria-hidden="true" /> {column.overdue} overdue
          </span>
        )}
      </header>
      <div className="grid content-start gap-2">
        {column.items.length === 0 && <p className="rounded-2xl border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">{EMPTY[column.key] ?? "No items"}</p>}
        {column.items.map((card) => (
          <DraggableCard key={card.reference} card={card} onOpen={() => onOpen(card.reference)} />
        ))}
      </div>
    </section>
  );
}

/** Kanban board (brief §4.4): moving a card is the same as changing its stage. */
export function BoardView({ columns, onOpen, onMove }: { columns: Column[]; onOpen: (ref: string) => void; onMove: (ref: string, column: string) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  function onDragEnd(e: DragEndEvent) {
    const target = e.over?.id;
    if (!target || !DROPPABLE.has(String(target))) return;
    const from = columns.find((c) => c.items.some((i) => i.reference === e.active.id));
    if (from?.key === target) return;
    onMove(String(e.active.id), String(target));
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {columns.map((c) => (
          <ColumnView key={c.key} column={c} onOpen={onOpen} />
        ))}
      </div>
    </DndContext>
  );
}
