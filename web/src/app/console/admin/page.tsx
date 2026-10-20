"use client";

import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { useMe } from "@/components/me";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText, type Category, type ProjectAdmin, type Rule, type Staff } from "@/lib/api";
import { CATEGORIES, CATEGORY_LABEL } from "@/lib/format";

const GROUPS = { platforms: "Platforms", agents: "Agents", other: "Other" } as const;
const ANY = "any";

/** Admin page (F2): projects, Digital Staff and routing rules. Changes take effect at once. */
export default function AdminPage() {
  const me = useMe();
  const admin = me.role === "admin";
  const [projects, setProjects] = useState<ProjectAdmin[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [editProject, setEditProject] = useState<ProjectAdmin | "new" | null>(null);
  const [addStaff, setAddStaff] = useState(false);
  const [addRule, setAddRule] = useState(false);

  const load = useCallback(() => {
    api.get<ProjectAdmin[]>("/admin/projects").then(setProjects).catch((e: unknown) => toast.error(errorText(e)));
    api.get<Staff[]>("/admin/digital-staff").then(setStaff).catch(() => undefined);
    api.get<Rule[]>("/admin/routing-rules").then(setRules).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const staffName = (id: string | null) => staff.find((s) => s.id === id)?.name ?? "–";

  async function patchStaff(s: Staff, change: Partial<Staff>) {
    try {
      await api.patch(`/admin/digital-staff/${s.id}`, change);
      load();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  async function deleteRule(id: string) {
    try {
      await api.del(`/admin/routing-rules/${id}`);
      load();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  return (
    <div className="grid gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-extrabold">Admin</h1>
        <p className="text-sm text-muted-foreground">
          {admin ? "The project list, the people who can be assigned, and routing rules. The agent picks up changes straight away." : "Read only. Only Admins can change these."}
        </p>
      </div>
      <Tabs defaultValue="projects">
        <TabsList>
          <TabsTrigger value="projects">Projects ({projects.length})</TabsTrigger>
          <TabsTrigger value="staff">Digital Staff ({staff.length})</TabsTrigger>
          <TabsTrigger value="rules">Routing rules ({rules.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="grid gap-3 pt-3">
          {admin && (
            <Button className="w-fit rounded-xl" onClick={() => setEditProject("new")}>
              <Plus /> Add project
            </Button>
          )}
          <div className="overflow-x-auto rounded-2xl border bg-card shadow-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Aliases and keywords</TableHead>
                  <TableHead>Active</TableHead>
                  {admin && <TableHead className="sr-only">Edit</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <span className="block font-semibold">{p.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{p.slug}</span>
                    </TableCell>
                    <TableCell>{GROUPS[p.project_group]}</TableCell>
                    <TableCell>{staffName(p.owner_id)}</TableCell>
                    <TableCell className="max-w-72 truncate text-sm text-muted-foreground">{[...p.aliases, ...p.keywords].join(", ")}</TableCell>
                    <TableCell>{p.active ? "Yes" : "No"}</TableCell>
                    {admin && (
                      <TableCell>
                        <Button variant="ghost" size="icon" aria-label={`Edit ${p.name}`} onClick={() => setEditProject(p)}>
                          <Pencil />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="staff" className="grid gap-3 pt-3">
          {admin && (
            <Button className="w-fit rounded-xl" onClick={() => setAddStaff(true)}>
              <Plus /> Add person
            </Button>
          )}
          <div className="overflow-x-auto rounded-2xl border bg-card shadow-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Open items</TableHead>
                  <TableHead>Away</TableHead>
                  <TableHead>Triage lead</TableHead>
                  <TableHead>Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <span className="block font-semibold">{s.name}</span>
                      <span className="text-xs text-muted-foreground">{s.google_email}</span>
                    </TableCell>
                    <TableCell>
                      <Select value={s.role} disabled={!admin} onValueChange={(v) => void patchStaff(s, { role: v as Staff["role"] })}>
                        <SelectTrigger className="h-9 w-32 rounded-lg" aria-label={`Role for ${s.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="digital">Digital Staff</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="font-mono tabular">{s.open_items}</TableCell>
                    {(["is_away", "is_triage_lead", "active"] as const).map((k) => (
                      <TableCell key={k}>
                        <Switch checked={s[k]} disabled={!admin} onCheckedChange={(v) => void patchStaff(s, { [k]: v })} aria-label={`${k.replace(/_/g, " ")}: ${s.name}`} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-sm text-muted-foreground">Away people get no new items; their projects go to Needs review for the triage lead.</p>
        </TabsContent>

        <TabsContent value="rules" className="grid gap-3 pt-3">
          {admin && (
            <Button className="w-fit rounded-xl" onClick={() => setAddRule(true)}>
              <Plus /> Add rule
            </Button>
          )}
          <p className="text-sm text-muted-foreground">Checked before the project owner, lowest order first. Several rules at the same order form a group; the person with fewest open items gets it.</p>
          <div className="overflow-x-auto rounded-2xl border bg-card shadow-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>When project is</TableHead>
                  <TableHead>And category is</TableHead>
                  <TableHead>Assign to</TableHead>
                  {admin && <TableHead className="sr-only">Delete</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono tabular">{r.priority_order}</TableCell>
                    <TableCell>{projects.find((p) => p.id === r.project_id)?.name ?? "Any project"}</TableCell>
                    <TableCell>{r.category ? CATEGORY_LABEL[r.category] : "Any category"}</TableCell>
                    <TableCell className="font-semibold">{staffName(r.assignee_id)}</TableCell>
                    {admin && (
                      <TableCell>
                        <Button variant="ghost" size="icon" aria-label="Delete rule" onClick={() => void deleteRule(r.id)}>
                          <Trash2 />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {editProject && <ProjectDialog project={editProject === "new" ? null : editProject} staff={staff} onClose={() => setEditProject(null)} onSaved={load} />}
      {addStaff && <StaffDialog onClose={() => setAddStaff(false)} onSaved={load} />}
      {addRule && <RuleDialog projects={projects} staff={staff} onClose={() => setAddRule(false)} onSaved={load} />}
    </div>
  );
}

function useSubmit(onSaved: () => void, onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await task();
      toast.success("Saved");
      onSaved();
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function ProjectDialog({ project, staff, onClose, onSaved }: { project: ProjectAdmin | null; staff: Staff[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    slug: project?.slug ?? "",
    name: project?.name ?? "",
    project_group: project?.project_group ?? "platforms",
    description: project?.description ?? "",
    aliases: project?.aliases.join(", ") ?? "",
    keywords: project?.keywords.join(", ") ?? "",
    owner_id: project?.owner_id ?? "",
    active: project?.active ?? true,
  });
  const { busy, error, run } = useSubmit(onSaved, onClose);
  function submit(e: FormEvent) {
    e.preventDefault();
    const body = { ...form, aliases: list(form.aliases), keywords: list(form.keywords), owner_id: form.owner_id || null };
    void run(() => (project ? api.patch(`/admin/projects/${project.id}`, { ...body, slug: undefined }) : api.post("/admin/projects", body)));
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-3">
          <DialogHeader>
            <DialogTitle>{project ? `Edit ${project.name}` : "Add a project"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="p-name">Name</Label>
              <Input id="p-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-slug">Short name (for links)</Label>
              <Input id="p-slug" required disabled={!!project} pattern="[a-z0-9][a-z0-9-]{1,78}" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} className="font-mono" />
            </div>
            <div className="grid gap-1.5">
              <Label>Group</Label>
              <Select value={form.project_group} onValueChange={(v) => setForm({ ...form, project_group: v as ProjectAdmin["project_group"] })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(GROUPS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Primary owner</Label>
              <Select value={form.owner_id || "none"} onValueChange={(v) => setForm({ ...form, owner_id: v === "none" ? "" : v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No owner (Needs review)</SelectItem>
                  {staff.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-desc">Description</Label>
            <Textarea id="p-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-aliases">Aliases (comma-separated)</Label>
            <Input id="p-aliases" value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-keywords">Keywords (comma-separated)</Label>
            <Input id="p-keywords" value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} />
          </div>
          <Label className="flex items-center gap-2 font-normal">
            <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} /> Active (the agent recognises it)
          </Label>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StaffDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: "", google_email: "", role: "digital" });
  const { busy, error, run } = useSubmit(onSaved, onClose);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.post("/admin/digital-staff", form));
          }}
          className="grid gap-3"
        >
          <DialogHeader>
            <DialogTitle>Add a person</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="s-name">Name</Label>
            <Input id="s-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="s-email">REDADAIR Google email</Label>
            <Input id="s-email" type="email" required value={form.google_email} onChange={(e) => setForm({ ...form, google_email: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Role</Label>
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="digital">Digital Staff</SelectItem>
                <SelectItem value="admin">Admin (approves feedback)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RuleDialog({ projects, staff, onClose, onSaved }: { projects: ProjectAdmin[]; staff: Staff[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ project_id: ANY, category: ANY, assignee_id: "", priority_order: "100" });
  const { busy, error, run } = useSubmit(onSaved, onClose);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() =>
              api.post("/admin/routing-rules", {
                project_id: form.project_id === ANY ? null : form.project_id,
                category: form.category === ANY ? null : (form.category as Category),
                assignee_id: form.assignee_id,
                priority_order: Number(form.priority_order),
              }),
            );
          }}
          className="grid gap-3"
        >
          <DialogHeader>
            <DialogTitle>Add a routing rule</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label>When the project is</Label>
            <Select value={form.project_id} onValueChange={(v) => setForm({ ...form, project_id: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any project</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>And the category is</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any category</SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Assign to</Label>
            <Select value={form.assignee_id} onValueChange={(v) => setForm({ ...form, assignee_id: v })}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick a person" />
              </SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="r-order">Order (lower runs first)</Label>
            <Input id="r-order" type="number" min={0} max={10000} value={form.priority_order} onChange={(e) => setForm({ ...form, priority_order: e.target.value })} />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !form.assignee_id}>
              {busy && <Loader2 className="animate-spin" />} Add rule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
