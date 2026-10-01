import {
  AlignReport,
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
  WorkspacePreview,
  WorkspaceRows,
  WorkspaceSummary,
} from "./types";
import { InFlightDedupe } from "./requestDedupe";

interface ApiClient {
  listKeys(): Promise<KeyInfo[]>;
  keySchema(id: string): Promise<JsonSchema>;
  runKey(id: string, params: Record<string, unknown>): Promise<Result>;

  listTransforms(): Promise<TransformInfo[]>;
  transformSchema(op: string): Promise<JsonSchema>;

  listWorkspaces(): Promise<Workspace[]>;
  listWorkspaceSummaries(): Promise<WorkspaceSummary[]>;
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

  upload(filename: string, body: BodyInit): Promise<UploadResponse>;
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

/** PUT body: the stored workspace, saved charts included (MAT-185). */
function workspaceBody(ws: Workspace): Record<string, unknown> {
  return { ...frameBody(ws), charts: ws.charts ?? [] };
}

/**
 * Workspace sent to frame / analysis calls: saved charts never feed a frame,
 * so a chart save does not change those request bodies (MAT-175 identity).
 * Step.align is front-only pipeline ordering.
 */
function frameBody(ws: Workspace): Record<string, unknown> {
  const { charts: _charts, ...rest } = ws;
  return {
    ...rest,
    steps: ws.steps.map(sanitizeStep),
  };
}

class HttpApiClient implements ApiClient {
  readonly baseUrl: string;
  private readonly dedupe = new InFlightDedupe();
  private transformsCache: Promise<TransformInfo[]> | null = null;
  /** Session cache — schemas are immutable per op/key id for a given engine. */
  private readonly transformSchemaCache = new Map<string, Promise<JsonSchema>>();
  private readonly keySchemaCache = new Map<string, Promise<JsonSchema>>();

  constructor(baseUrl = import.meta.env.VITE_API_URL ?? "/api") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
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
    return this.dedupe.run(key, () =>
      this.execute<T>(method, path, headers, payload),
    );
  }

  private async execute<T>(
    method: string,
    path: string,
    headers: Record<string, string>,
    payload: BodyInit | undefined,
    signal?: AbortSignal,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: payload,
      signal,
    });
    if (res.status === 204) {
      return undefined as T;
    }
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = { type: "ParseError", message: text };
      }
    }
    if (!res.ok) {
      if (isErrorBody(data)) {
        throw new EngineError(data.type, data.message, res.status);
      }
      throw new EngineError(
        "HttpError",
        `HTTP ${res.status} ${res.statusText}`.trim(),
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
      this.transformsCache = this.request("GET", "/transforms");
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
    }
    return cached;
  }

  listWorkspaces(): Promise<Workspace[]> {
    return this.request("GET", "/workspaces");
  }

  listWorkspaceSummaries(): Promise<WorkspaceSummary[]> {
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
      },
      undefined,
      signal,
    );
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
}

export const apiClient: ApiClient = new HttpApiClient();
