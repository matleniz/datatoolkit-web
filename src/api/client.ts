import {
  AlignReport,
  ColumnNotes,
  ColumnProfiles,
  EngineError,
  ErrorBody,
  ExportManifest,
  ExportRequest,
  JsonSchema,
  KeyInfo,
  PreviewStep,
  Result,
  Role,
  SourceColumn,
  SourceSpec,
  Step,
  TransformInfo,
  UploadResponse,
  Workspace,
  WorkspaceDocument,
  WorkspacePreview,
  WorkspaceRows,
  CorruptEntry,
  WorkspaceSummaryEntry,
} from "./types";
import { gridViewBody, type GridView } from "../state/gridView";
import { scopeOf, trackRequest } from "./inflight";
import { InFlightDedupe } from "./requestDedupe";

interface ApiClient {
  listKeys(): Promise<KeyInfo[]>;
  keySchema(id: string): Promise<JsonSchema>;
  runKey(id: string, params: Record<string, unknown>): Promise<Result>;

  listTransforms(): Promise<TransformInfo[]>;
  transformSchema(op: string): Promise<JsonSchema>;

  listWorkspaces(): Promise<(Workspace | CorruptEntry)[]>;
  listWorkspaceSummaries(): Promise<WorkspaceSummaryEntry[]>;
  getWorkspace(name: string): Promise<Workspace>;
  saveWorkspace(ws: Workspace, signal?: AbortSignal): Promise<Workspace>;
  deleteWorkspace(name: string): Promise<void>;
  renameWorkspace(name: string, newName: string): Promise<Workspace>;
  duplicateWorkspace(name: string, newName: string): Promise<Workspace>;
  exportWorkspace(name: string, body: ExportRequest): Promise<ExportManifest>;

  sourceColumns(spec: SourceSpec): Promise<SourceColumn[]>;
  previewWorkspace(
    workspace: Workspace,
    role: Role,
    headRows?: number,
  ): Promise<WorkspacePreview>;
  workspaceRows(
    workspace: Workspace,
    role: Role,
    version: number | null,
    offset: number,
    limit: number,
    signal?: AbortSignal,
    /** View-only filter / sort, run by the engine on the full frame. */
    view?: GridView,
  ): Promise<WorkspaceRows>;
  columnProfiles(
    workspace: Workspace,
    role: Role,
    version?: number | null,
    /** Optional column filter — engine ignores until MAT-152 engine change. */
    columns?: string[] | null,
  ): Promise<ColumnProfiles>;
  previewStep(
    workspace: Workspace,
    step: Step,
    role: Role,
    signal?: AbortSignal,
  ): Promise<PreviewStep>;
  alignReport(workspace: Workspace): Promise<AlignReport>;
  /** Column notes by name at `version` (null = latest), renames traced (#152). */
  columnNotes(workspace: Workspace, role: Role, version?: number | null): Promise<ColumnNotes>;

  upload(filename: string, body: BodyInit): Promise<UploadResponse>;
  /** `POST /documents/describe`: a document entry (no id) for an uploaded file (#178). */
  describeDocument(path: string, name?: string): Promise<Omit<WorkspaceDocument, "id">>;
}

function isErrorBody(value: unknown): value is ErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "message" in value &&
    typeof (value as ErrorBody).type === "string" &&
    typeof (value as ErrorBody).message === "string"
  );
}

function sanitizeStep(step: Step): Record<string, unknown> {
  const { align: _align, ...rest } = step;
  return rest;
}

/** Stable JSON for workspace equality (PUT skip / debounce). */
export function serializeWorkspace(ws: Workspace): string {
  return JSON.stringify(workspaceBody(ws));
}

/** PUT body: the stored workspace, saved charts, notes, agent memory, documents and id counters included (MAT-185, #152, #179, #178, #180). */
function workspaceBody(ws: Workspace): Record<string, unknown> {
  return {
    ...notesBody(ws),
    charts: ws.charts ?? [],
    ...(ws.memory?.length ? { memory: ws.memory } : {}),
    ...(ws.documents?.length ? { documents: ws.documents } : {}),
    ...(ws.id_counters ? { id_counters: ws.id_counters } : {}),
  };
}

/**
 * Workspace sent to frame / analysis calls: saved charts, notes, the agent
 * memory and documents never feed a frame, so saving one does not change
 * those request bodies (MAT-175 identity, #152, #179, #178). Step.align is
 * front-only pipeline ordering.
 */
function frameBody(ws: Workspace): Record<string, unknown> {
  const { charts: _charts, notes: _notes, memory: _memory, documents: _documents, id_counters: _ids, ...rest } = ws;
  return {
    ...rest,
    steps: ws.steps.map((step) => {
      const { note: _note, ...plain } = sanitizeStep(step);
      return plain;
    }),
  };
}

/** Frame body plus the notes (stored body without charts): column notes need both. */
function notesBody(ws: Workspace): Record<string, unknown> {
  return {
    ...frameBody(ws),
    steps: ws.steps.map(sanitizeStep),
    ...(ws.notes ? { notes: ws.notes } : {}),
  };
}

/** The engine API base (`/api` behind the Vite / nginx proxy); every module goes through it. */
export const API_BASE: string = import.meta.env.VITE_API_URL ?? "/api";

/**
 * Agent bridge (/api/ui, datatoolkit-issues#63). Not on `ApiClient`: these
 * calls bypass the request dedupe (a context PUT must always go out) and carry
 * the per-run token the page got in `<meta name="dtk-ui-token">`.
 */
export function uiToken(): string | null {
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="dtk-ui-token"]',
  );
  return meta?.content?.trim() || null;
}

/** `/ui/agent` -> `<API_BASE>/ui/agent`. */
export function uiUrl(path: string, base: string = API_BASE): string {
  return `${base.replace(/\/$/, "")}/ui${path}`;
}

/**
 * The per-tab UI session id, shared by the AgentBridge context, the agent
 * chat, its attachments and the terminal, so the agent sees this tab.
 */
export function uiSession(): string {
  const key = "dtk-ui-session";
  const known = window.sessionStorage.getItem(key);
  if (known) return known;
  const id = crypto.randomUUID();
  window.sessionStorage.setItem(key, id);
  return id;
}

/** A failed `/ui/*` call: HTTP status, the engine's error `type` and its message. */
export class UiHttpError extends Error {
  constructor(
    readonly status: number,
    readonly kind: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

/** Error of a non-ok `/ui/*` response; the engine answers `{type, message}`. */
export async function uiError(res: Response, what: string): Promise<UiHttpError> {
  let kind: string | undefined;
  let message = `${what}: HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { type?: unknown; message?: unknown };
    if (typeof body.type === "string") kind = body.type;
    if (typeof body.message === "string" && body.message) message = body.message;
  } catch {
    /* no JSON body */
  }
  return new UiHttpError(res.status, kind, message);
}

/** `EventSource` cannot set headers: the token goes in the query string. */
export function uiEventsUrl(
  session: string,
  token: string,
  base: string = API_BASE,
): string {
  const q = new URLSearchParams({ session, token });
  return `${uiUrl("/events", base)}?${q}`;
}

export function uiAuthHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function uiSend(
  method: "PUT" | "POST",
  path: string,
  token: string,
  body: unknown,
): Promise<Response> {
  return fetch(uiUrl(path), {
    method,
    headers: { "Content-Type": "application/json", ...uiAuthHeaders(token) },
    body: JSON.stringify(body),
  });
}

export async function putUiContext(
  token: string,
  context: unknown,
): Promise<void> {
  const res = await uiSend("PUT", "/context", token, context);
  if (!res.ok) throw new Error(`PUT /ui/context: HTTP ${res.status}`);
}

/** Ack a command. A 404 (the engine already timed the command out) is fine. */
export async function postUiAck(token: string, ack: unknown): Promise<void> {
  const res = await uiSend("POST", "/ack", token, ack);
  if (!res.ok && res.status !== 404) {
    throw new Error(`POST /ui/ack: HTTP ${res.status}`);
  }
}

class HttpApiClient implements ApiClient {
  readonly baseUrl: string;
  private readonly dedupe = new InFlightDedupe();
  private transformsCache: Promise<TransformInfo[]> | null = null;
  /** Session cache — schemas are immutable per op/key id for a given engine. */
  private readonly transformSchemaCache = new Map<string, Promise<JsonSchema>>();
  private readonly keySchemaCache = new Map<string, Promise<JsonSchema>>();

  constructor(baseUrl = API_BASE) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /** Drop a rejected promise from a session cache so the next call retries (#246). */
  private evictOnFailure<T>(
    cache: Map<string, Promise<T>>,
    id: string,
    p: Promise<T>,
  ): void {
    p.catch(() => {
      if (cache.get(id) === p) cache.delete(id);
    });
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    rawBody?: BodyInit,
    signal?: AbortSignal,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    let payload: BodyInit | undefined = rawBody;
    let bodyKey = "";
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyKey = JSON.stringify(body);
      payload = bodyKey;
    }
    // Do not dedupe raw uploads (binary body is not a stable string key).
    // Do not dedupe abortable calls — a shared promise cannot be half-aborted.
    if (rawBody !== undefined || signal) {
      return this.execute<T>(method, path, headers, payload, signal);
    }
    const key = this.dedupe.key(method, path, bodyKey);
    // A write to the workspace store makes every in-flight workspace read
    // stale: a list requested right after a create / rename / delete must not
    // join the answer computed before it (#244).
    const writesStore = method !== "GET" && path.startsWith("/workspaces/");
    if (writesStore) this.dedupe.invalidateReads("/workspaces");
    const run = this.dedupe.run(key, () =>
      this.execute<T>(method, path, headers, payload),
    );
    return writesStore
      ? run.finally(() => this.dedupe.invalidateReads("/workspaces"))
      : run;
  }

  private async execute<T>(
    method: string,
    path: string,
    headers: Record<string, string>,
    payload: BodyInit | undefined,
    signal?: AbortSignal,
  ): Promise<T> {
    const scope = scopeOf(method, path);
    const ac = new AbortController();
    let cancelled = false;
    if (signal) {
      if (signal.aborted) ac.abort();
      else signal.addEventListener("abort", () => ac.abort(), { once: true });
    }
    const untrack = scope
      ? trackRequest(scope, () => {
          cancelled = true;
          ac.abort();
        })
      : () => {};
    try {
      return await this.fetchJson<T>(method, path, headers, payload, ac.signal);
    } catch (e) {
      if (cancelled) {
        throw new EngineError("Cancelled", "Request cancelled.");
      }
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        console.error(`[engine] ${method} ${path} failed`, e);
      }
      throw e;
    } finally {
      untrack();
    }
  }

  /** One fetch + decode; every failure is an `EngineError` (or an `AbortError`). */
  private async fetchJson<T>(
    method: string,
    path: string,
    headers: Record<string, string>,
    payload: BodyInit | undefined,
    signal: AbortSignal,
  ): Promise<T> {
    const where = `${method} ${path}`;
    let res: Response;
    let text: string;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: payload,
        signal,
      });
      if (res.status === 204) return undefined as T;
      text = await res.text();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      // fetch rejects with a bare TypeError("Failed to fetch") when the engine
      // is down, the connection drops or the body stream is cut.
      const why = e instanceof Error ? e.message : String(e);
      throw new EngineError(
        "NetworkError",
        `Cannot reach the engine (${where}): ${why}`,
      );
    }
    let data: unknown = null;
    let parsed = true;
    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        parsed = false;
      }
    }
    const snippet = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    if (!res.ok) {
      if (parsed && isErrorBody(data)) {
        throw new EngineError(data.type, data.message, res.status);
      }
      const base = `HTTP ${res.status} ${res.statusText}`.trim();
      throw new EngineError(
        "HttpError",
        !parsed && snippet ? `${base}: ${snippet}` : base,
        res.status,
      );
    }
    if (!parsed) {
      // A 2xx that is not JSON (proxy page, truncated body): never hand the
      // raw text to a caller expecting data.
      throw new EngineError(
        "ParseError",
        `Engine answered HTTP ${res.status} (${where}) with a body that is not JSON: ${snippet}`,
        res.status,
      );
    }
    return data as T;
  }

  listKeys(): Promise<KeyInfo[]> {
    return this.request("GET", "/keys");
  }

  keySchema(id: string): Promise<JsonSchema> {
    let cached = this.keySchemaCache.get(id);
    if (!cached) {
      cached = this.request(
        "GET",
        `/keys/${encodeURIComponent(id)}/schema`,
      );
      this.keySchemaCache.set(id, cached);
      this.evictOnFailure(this.keySchemaCache, id, cached);
    }
    return cached;
  }

  runKey(id: string, params: Record<string, unknown>): Promise<Result> {
    return this.request("POST", `/keys/${encodeURIComponent(id)}/run`, {
      params,
    });
  }

  listTransforms(): Promise<TransformInfo[]> {
    if (!this.transformsCache) {
      const p: Promise<TransformInfo[]> = this.request("GET", "/transforms");
      // A failed catalogue must be retried, not cached for the session (#246).
      p.catch(() => {
        if (this.transformsCache === p) this.transformsCache = null;
      });
      this.transformsCache = p;
    }
    return this.transformsCache;
  }

  transformSchema(op: string): Promise<JsonSchema> {
    let cached = this.transformSchemaCache.get(op);
    if (!cached) {
      cached = this.request(
        "GET",
        `/transforms/${encodeURIComponent(op)}/schema`,
      );
      this.transformSchemaCache.set(op, cached);
      this.evictOnFailure(this.transformSchemaCache, op, cached);
    }
    return cached;
  }

  listWorkspaces(): Promise<(Workspace | CorruptEntry)[]> {
    return this.request("GET", "/workspaces");
  }

  listWorkspaceSummaries(): Promise<WorkspaceSummaryEntry[]> {
    return this.request("GET", "/workspaces/summaries");
  }

  getWorkspace(name: string): Promise<Workspace> {
    return this.request("GET", `/workspaces/${encodeURIComponent(name)}`);
  }

  saveWorkspace(ws: Workspace, signal?: AbortSignal): Promise<Workspace> {
    return this.request(
      "PUT",
      `/workspaces/${encodeURIComponent(ws.name)}`,
      workspaceBody(ws),
      undefined,
      signal,
    );
  }

  deleteWorkspace(name: string): Promise<void> {
    return this.request("DELETE", `/workspaces/${encodeURIComponent(name)}`);
  }

  renameWorkspace(name: string, newName: string): Promise<Workspace> {
    return this.request(
      "POST",
      `/workspaces/${encodeURIComponent(name)}/rename`,
      { new_name: newName },
    );
  }

  duplicateWorkspace(name: string, newName: string): Promise<Workspace> {
    return this.request(
      "POST",
      `/workspaces/${encodeURIComponent(name)}/duplicate`,
      { new_name: newName },
    );
  }

  exportWorkspace(name: string, body: ExportRequest): Promise<ExportManifest> {
    return this.request(
      "POST",
      `/workspaces/${encodeURIComponent(name)}/export`,
      body,
    );
  }

  sourceColumns(spec: SourceSpec): Promise<SourceColumn[]> {
    return this.request("POST", "/source/columns", { spec });
  }

  previewWorkspace(
    workspace: Workspace,
    role: Role,
    headRows = 5,
  ): Promise<WorkspacePreview> {
    return this.request("POST", "/workspace/preview", {
      workspace: frameBody(workspace),
      role,
      head_rows: headRows,
    });
  }

  workspaceRows(
    workspace: Workspace,
    role: Role,
    version: number | null,
    offset: number,
    limit: number,
    signal?: AbortSignal,
    view?: GridView,
  ): Promise<WorkspaceRows> {
    return this.request(
      "POST",
      "/workspace/rows",
      {
        workspace: frameBody(workspace),
        role,
        version,
        offset,
        limit,
        ...(view ? gridViewBody(view) : {}),
      },
      undefined,
      signal,
    );
  }

  columnNotes(
    workspace: Workspace,
    role: Role,
    version: number | null = null,
  ): Promise<ColumnNotes> {
    return this.request("POST", "/workspace/column-notes", {
      workspace: notesBody(workspace),
      role,
      version,
    });
  }

  columnProfiles(
    workspace: Workspace,
    role: Role,
    version: number | null = null,
    columns: string[] | null = null,
  ): Promise<ColumnProfiles> {
    const body: Record<string, unknown> = {
      workspace: frameBody(workspace),
      role,
      version,
    };
    // Prefer viewport columns first when the engine supports filtering.
    if (columns && columns.length > 0) {
      body.columns = columns;
    }
    return this.request("POST", "/workspace/profiles", body);
  }

  previewStep(
    workspace: Workspace,
    step: Step,
    role: Role,
    signal?: AbortSignal,
  ): Promise<PreviewStep> {
    return this.request(
      "POST",
      "/workspace/preview-step",
      {
        workspace: frameBody(workspace),
        step: sanitizeStep(step),
        role,
      },
      undefined,
      signal,
    );
  }

  alignReport(workspace: Workspace): Promise<AlignReport> {
    return this.request("POST", "/workspace/align", {
      workspace: frameBody(workspace),
    });
  }

  upload(filename: string, body: BodyInit): Promise<UploadResponse> {
    return this.request(
      "PUT",
      `/uploads/${encodeURIComponent(filename)}`,
      undefined,
      body,
    );
  }

  describeDocument(path: string, name?: string): Promise<Omit<WorkspaceDocument, "id">> {
    return this.request("POST", "/documents/describe", name ? { path, name } : { path });
  }
}

/** The stored file of a workspace document (open / download, #178). */
export function documentFileUrl(workspace: string, id: string, base: string = API_BASE): string {
  return `${base.replace(/\/$/, "")}/workspaces/${encodeURIComponent(workspace)}/documents/${encodeURIComponent(id)}/file`;
}

export const apiClient: ApiClient = new HttpApiClient();
