import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CLAUDE_EFFORTS,
  CODEX_EFFORTS,
  SKILLBENCH_OPERATIONS,
  type RunnerEffort,
  type RunnerType,
  type SkillbenchOperation,
} from "@thisisjuke/skillbench/contracts";
import {
  ActivityIcon,
  DatabaseIcon,
  DownloadIcon,
  FolderGit2Icon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  SquareIcon,
  TerminalIcon,
  Trash2Icon,
} from "lucide-react";

import { Badge } from "#components/ui/badge";
import { Button } from "#components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#components/ui/card";
import { Input } from "#components/ui/input";
import { Label } from "#components/ui/label";
import { NativeSelect, NativeSelectOption } from "#components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "#components/ui/tabs";

type Command = SkillbenchOperation;
type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
type Job = {
  id: string;
  command: Command;
  status: JobStatus;
  result: unknown;
  error: { message: string } | null;
  createdAt: string;
};
type Source = { id: string; label: string; kind: "local" | "github"; input: string };
type RunFile = { id: string; path: string };
type RunDetails = { id: string; reports: RunFile[]; artifacts: RunFile[] };
type JobDetails = {
  job: Job;
  run: RunDetails | null;
  events: Array<{ sequence: number; event: string; createdAt: string }>;
};

const terminal = new Set<JobStatus>(["completed", "failed", "cancelled", "interrupted"]);
const commands = SKILLBENCH_OPERATIONS;

export function App() {
  const queryClient = useQueryClient();
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: () => api<{ jobs: Job[] }>("/api/jobs"),
    refetchInterval: 1_000,
  });
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => api<{ sources: Source[] }>("/api/sources"),
  });
  const selectedJob = jobs.data?.jobs.find((job) => job.id === selectedJobId) ?? jobs.data?.jobs[0];

  useEffect(() => {
    if (selectedJob === undefined || terminal.has(selectedJob.status)) return;
    const events = new EventSource(`/api/jobs/${selectedJob.id}/events`);
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["job", selectedJob.id] });
    };
    for (const name of ["phase", "progress", "artifact", "completed", "failed", "cancelled"]) {
      events.addEventListener(name, refresh);
    }
    return () => events.close();
  }, [queryClient, selectedJob?.id, selectedJob?.status]);

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <TerminalIcon aria-hidden="true" className="size-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Skillbench</h1>
              <p className="text-sm text-muted-foreground">Local evaluation workbench</p>
            </div>
          </div>
          <Badge variant="outline" className="gap-1.5 bg-background">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />
            Serveur local
          </Badge>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(20rem,1fr)] lg:px-8">
        <Card>
          <CardHeader>
            <CardTitle>Lancer une opération</CardTitle>
            <CardDescription>
              Le serveur orchestre le CLI installé avec un protocole JSONL strict.
            </CardDescription>
            <CardAction>
              <Badge variant="secondary">CLI isolé</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <JobForm
              sources={sources.data?.sources ?? []}
              onCreated={(job) => {
                setSelectedJobId(job.id);
                void queryClient.invalidateQueries({ queryKey: ["jobs"] });
              }}
            />
          </CardContent>
        </Card>

        <Card className="lg:row-span-2">
          <CardHeader className="border-b">
            <CardTitle>Jobs récents</CardTitle>
            <CardDescription>Historique persistant de cette interface Web.</CardDescription>
            <CardAction>
              <DatabaseIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            {jobs.isPending ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
            {jobs.isError ? (
              <p role="alert" className="text-sm text-destructive">
                Impossible de charger les jobs.
              </p>
            ) : null}
            <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
              {jobs.data?.jobs.map((job) => (
                <button
                  type="button"
                  className={
                    job.id === selectedJob?.id
                      ? "flex w-full items-center gap-3 rounded-lg bg-muted px-3 py-2.5 text-left outline-none ring-1 ring-border transition-colors focus-visible:ring-3 focus-visible:ring-ring/50"
                      : "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring/50"
                  }
                  key={job.id}
                  onClick={() => setSelectedJobId(job.id)}
                >
                  <StatusDot status={job.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium capitalize">{job.command}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDate(job.createdAt)}
                    </span>
                  </span>
                  <StatusBadge status={job.status} />
                </button>
              ))}
            </div>
            {selectedJob !== undefined ? (
              <JobDetail
                job={selectedJob}
                onRerun={(job) => {
                  setSelectedJobId(job.id);
                  void queryClient.invalidateQueries({ queryKey: ["jobs"] });
                }}
              />
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Aucun job pour le moment.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sources favorites</CardTitle>
            <CardDescription>
              Chemins locaux et URL GitHub réutilisables depuis les formulaires Web.
            </CardDescription>
            <CardAction>
              <FolderGit2Icon aria-hidden="true" className="size-4 text-muted-foreground" />
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-5">
            <SourceForm />
            <SourceList sources={sources.data?.sources ?? []} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function JobForm({ sources, onCreated }: { sources: Source[]; onCreated: (job: Job) => void }) {
  const [command, setCommand] = useState<Command>("compare");
  const [sourceA, setSourceA] = useState("");
  const [sourceB, setSourceB] = useState("");
  const [evals, setEvals] = useState(".skillbench/evals/development/default.yaml");
  const [holdout, setHoldout] = useState("");
  const [runner, setRunner] = useState<RunnerType>("mock");
  const [model, setModel] = useState("");
  const [chooseOpenCodeModel, setChooseOpenCodeModel] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<RunnerEffort>("low");
  const [variant, setVariant] = useState("");
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<{ job: Job }>("/api/jobs", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: ({ job }) => onCreated(job),
  });
  const needsPair = command === "compare" || command === "merge";
  const needsEvals = command !== "inspect";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body: Record<string, unknown> = { command };
    if (needsPair) {
      body.sourceA = sourceA;
      body.sourceB = sourceB;
    } else body.source = sourceA;
    if (needsEvals) body.evals = evals;
    if (command === "merge" && holdout !== "") body.holdout = holdout;
    if (needsEvals) {
      body.profile =
        runner === "mock"
          ? { runner }
          : runner === "opencode"
            ? {
                runner,
                ...(chooseOpenCodeModel ? { model: model.trim() } : {}),
                ...(variant.trim() === "" ? {} : { variant: variant.trim() }),
              }
            : { runner, model: model.trim(), reasoningEffort };
    }
    mutation.mutate(body);
  };

  return (
    <form className="space-y-6" onSubmit={submit}>
      <Tabs value={command} onValueChange={(value) => setCommand(value as Command)}>
        <TabsList aria-label="Opération" className="grid h-auto w-full grid-cols-4">
          {commands.map((value) => (
            <TabsTrigger className="py-1.5 capitalize" value={value} key={value}>
              {value}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={needsPair ? "Source A" : "Source"}
          value={sourceA}
          onChange={setSourceA}
          list="favorite-sources"
          placeholder="./skills/local ou URL GitHub"
        />
        {needsPair ? (
          <Field
            label="Source B"
            value={sourceB}
            onChange={setSourceB}
            list="favorite-sources"
            placeholder="https://github.com/…"
          />
        ) : null}
        {needsEvals ? (
          <Field
            label="Suite d’évaluation"
            value={evals}
            onChange={setEvals}
            placeholder=".skillbench/evals/development/default.yaml"
          />
        ) : null}
        {command === "merge" ? (
          <Field
            label="Suite holdout (optionnel)"
            value={holdout}
            onChange={setHoldout}
            placeholder=".skillbench/evals/holdout"
            required={false}
          />
        ) : null}
        <SelectField
          label="Runner"
          value={runner}
          onChange={(value) => {
            const selected = value as RunnerType;
            setRunner(selected);
            const supported: readonly string[] = selected === "codex" ? CODEX_EFFORTS : CLAUDE_EFFORTS;
            if (
              selected !== "mock" &&
              selected !== "opencode" &&
              !supported.includes(reasoningEffort)
            ) {
              setReasoningEffort("low");
            }
          }}
          options={[
            ["mock", "Mock — chaîne de tooling"],
            ["codex", "Codex — évaluation réelle"],
            ["claude", "Claude — évaluation réelle"],
            ["opencode", "OpenCode — configuration locale"],
          ]}
        />
        {runner !== "mock" && needsEvals ? (
          <>
            {runner === "opencode" ? (
              <SelectField
                label="Choisir explicitement le modèle OpenCode"
                value={chooseOpenCodeModel ? "yes" : "no"}
                onChange={(value) => setChooseOpenCodeModel(value === "yes")}
                options={[
                  ["yes", "Oui"],
                  ["no", "Non — laisser OpenCode choisir"],
                ]}
              />
            ) : null}
            {runner !== "opencode" || chooseOpenCodeModel ? (
              <Field
                label={`Modèle ${runner === "codex" ? "Codex" : runner === "claude" ? "Claude" : "OpenCode"}`}
                value={model}
                onChange={setModel}
                placeholder={
                  runner === "codex"
                    ? "gpt-5.6-luna"
                    : runner === "claude"
                      ? "claude-sonnet-4-6"
                      : "provider/model"
                }
              />
            ) : null}
            {runner === "opencode" ? (
              <Field
                label="Variant OpenCode (optionnel)"
                value={variant}
                onChange={setVariant}
                placeholder="high"
                required={false}
              />
            ) : (
              <SelectField
                label="Effort de raisonnement"
                value={reasoningEffort}
                onChange={(value) => setReasoningEffort(value as RunnerEffort)}
                options={(runner === "codex" ? CODEX_EFFORTS : CLAUDE_EFFORTS).map(
                  (effort) => [effort, effort] as [string, string],
                )}
              />
            )}
          </>
        ) : null}
      </div>

      <datalist id="favorite-sources">
        {sources.map((source) => (
          <option value={source.input} key={source.id}>
            {source.label}
          </option>
        ))}
      </datalist>

      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p
          aria-live="polite"
          className={
            mutation.isError ? "text-sm text-destructive" : "text-sm text-muted-foreground"
          }
        >
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Aucun historique CLI n’est lu ou modifié par le serveur Web."}
        </p>
        <Button type="submit" size="lg" disabled={mutation.isPending}>
          <PlayIcon aria-hidden="true" data-icon="inline-start" />
          {mutation.isPending ? "Mise en file…" : `Lancer ${command}`}
        </Button>
      </div>
    </form>
  );
}

function JobDetail({ job, onRerun }: { job: Job; onRerun: (job: Job) => void }) {
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ["job", job.id],
    queryFn: () => api<JobDetails>(`/api/jobs/${job.id}`),
    refetchInterval: terminal.has(job.status) ? false : 1_000,
  });
  const cancel = useMutation({
    mutationFn: () => api(`/api/jobs/${job.id}/cancel`, { method: "POST" }),
    onSettled: () => void client.invalidateQueries({ queryKey: ["jobs"] }),
  });
  const rerun = useMutation({
    mutationFn: () => api<{ job: Job }>(`/api/jobs/${job.id}/rerun`, { method: "POST" }),
    onSuccess: ({ job: created }) => onRerun(created),
  });
  const current = detail.data?.job ?? job;
  return (
    <section aria-label="Détail du job" className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusBadge status={current.status} />
        <code className="max-w-full truncate rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
          {current.id}
        </code>
      </div>
      {current.error ? (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {current.error.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!terminal.has(current.status) ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            <SquareIcon aria-hidden="true" data-icon="inline-start" />
            {cancel.isPending ? "Annulation…" : "Annuler"}
          </Button>
        ) : null}
        {terminal.has(current.status) ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={rerun.isPending}
            onClick={() => rerun.mutate()}
          >
            <RotateCcwIcon aria-hidden="true" data-icon="inline-start" />
            {rerun.isPending ? "Relance…" : "Relancer"}
          </Button>
        ) : null}
      </div>
      {detail.data !== undefined && detail.data.events.length > 0 ? (
        <ol aria-label="Événements récents" className="space-y-1 rounded-lg border p-3">
          {detail.data.events.slice(-5).map((event) => (
            <li className="flex items-center justify-between gap-3 text-xs" key={event.sequence}>
              <span className="font-medium capitalize">{event.event}</span>
              <time className="text-muted-foreground" dateTime={event.createdAt}>
                {formatTime(event.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      ) : null}
      {detail.data?.run !== null &&
      detail.data?.run !== undefined &&
      (detail.data.run.reports.length > 0 || detail.data.run.artifacts.length > 0) ? (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Fichiers
          </p>
          {[
            ...detail.data.run.reports.map((file) => ({ ...file, kind: "report" as const })),
            ...detail.data.run.artifacts.map((file) => ({ ...file, kind: "artifact" as const })),
          ].map((file) => (
            <Button
              variant="ghost"
              size="sm"
              render={<a href={runFileUrl(current.id, file.kind, file.id)} download />}
              key={file.id}
              className="w-full justify-start"
            >
              <DownloadIcon aria-hidden="true" data-icon="inline-start" />
              <span className="truncate">{file.path}</span>
            </Button>
          ))}
        </div>
      ) : null}
      {current.result !== null ? (
        <details className="rounded-lg border bg-muted/30 open:bg-muted/50">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Résultat JSON</summary>
          <pre className="max-h-72 overflow-auto border-t p-3 text-xs">
            {JSON.stringify(current.result, null, 2)}
          </pre>
        </details>
      ) : null}
    </section>
  );
}

function SourceForm() {
  const client = useQueryClient();
  const [label, setLabel] = useState("");
  const [source, setSource] = useState("");
  const kind = useMemo(() => (source.includes("github.com") ? "github" : "local"), [source]);
  const mutation = useMutation({
    mutationFn: () =>
      api("/api/sources", { method: "POST", body: JSON.stringify({ label, kind, source }) }),
    onSuccess: () => {
      setLabel("");
      setSource("");
      void client.invalidateQueries({ queryKey: ["sources"] });
    },
  });
  return (
    <form
      className="grid gap-3 sm:grid-cols-[minmax(8rem,0.7fr)_minmax(12rem,1.3fr)_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <Field label="Nom" value={label} onChange={setLabel} placeholder="Skill local" />
      <Field
        label="Chemin ou URL"
        value={source}
        onChange={setSource}
        placeholder="./skills/demo"
      />
      <Button type="submit" variant="secondary" disabled={mutation.isPending}>
        <PlusIcon aria-hidden="true" data-icon="inline-start" />
        Ajouter
      </Button>
      {mutation.isError ? (
        <p role="alert" className="text-sm text-destructive sm:col-span-3">
          {mutation.error instanceof Error ? mutation.error.message : "Ajout impossible."}
        </p>
      ) : null}
    </form>
  );
}

function SourceList({ sources }: { sources: Source[] }) {
  const client = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/sources/${id}`, { method: "DELETE" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["sources"] }),
  });
  if (sources.length === 0)
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Ajoutez une première source pour la retrouver dans les opérations.
      </div>
    );
  return (
    <ul className="divide-y rounded-lg border">
      {sources.map((source) => (
        <li className="flex items-center gap-3 px-3 py-3" key={source.id}>
          <Badge variant="outline" className="capitalize">
            {source.kind}
          </Badge>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{source.label}</span>
            <code className="block truncate text-xs text-muted-foreground">{source.input}</code>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Supprimer ${source.label}`}
            disabled={remove.isPending && remove.variables === source.id}
            onClick={() => remove.mutate(source.id)}
          >
            <Trash2Icon aria-hidden="true" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  list,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  list?: string;
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        {...(list === undefined ? {} : { list })}
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        className="w-full"
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <NativeSelectOption value={optionValue} key={optionValue}>
            {optionLabel}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

function StatusDot({ status }: { status: JobStatus }) {
  const className =
    status === "completed"
      ? "size-2 shrink-0 rounded-full bg-emerald-500"
      : status === "running"
        ? "size-2 shrink-0 animate-pulse rounded-full bg-blue-500"
        : status === "queued"
          ? "size-2 shrink-0 rounded-full bg-amber-500"
          : "size-2 shrink-0 rounded-full bg-destructive";
  return <span aria-hidden="true" className={className} />;
}

function StatusBadge({ status }: { status: JobStatus }) {
  const variant =
    status === "failed" || status === "interrupted"
      ? "destructive"
      : status === "completed"
        ? "secondary"
        : "outline";
  return (
    <Badge variant={variant} className="capitalize">
      {status === "running" ? <ActivityIcon aria-hidden="true" data-icon="inline-start" /> : null}
      {status}
    </Badge>
  );
}

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...init?.headers },
    ...init,
  });
  const payload = (await response.json()) as { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
  return payload as T;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("fr", { timeStyle: "medium" }).format(new Date(value));
}

function runFileUrl(runId: string, kind: "report" | "artifact", id: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/files/${kind}/${encodeURIComponent(id)}`;
}
