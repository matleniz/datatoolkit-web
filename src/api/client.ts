import {
  AlignReport,
  ColumnProfile,
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
} from "./types";

export interface ApiClient {
  listKeys(): Promise<KeyInfo[]>;
  keySchema(id: string): Promise<JsonSchema>;
  runKey(id: string, params: Record<string, unknown>): Promise<Result>;

  listTransforms(): Promise<TransformInfo[]>;
  transformSchema(op: string): Promise<JsonSchema>;

  listWorkspaces(): Promise<Workspace[]>;
  getWorkspace(name: string): Promise<Workspace>;
  saveWorkspace(ws: Workspace): Promise<Workspace>;
  deleteWorkspace(name: string): Promise<void>;
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
    version: number,
    offset: number,
    limit: number,
  ): Promise<WorkspaceRows>;
  columnProfiles(
    workspace: Workspace,
    role: Role,
    version: number,
  ): Promise<ColumnProfile[]>;
  previewStep(
    workspace: Workspace,
    step: Step,
    role: Role,
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

export class HttpApiClient implements ApiClient {
  readonly baseUrl: string;

  constructor(baseUrl = import.meta.env.VITE_API_URL ?? "/api") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    rawBody?: BodyInit,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    let payload: BodyInit | undefined = rawBody;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: payload,
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
        throw new EngineError(data.type, data.message);
      }
      throw new EngineError(
        "HttpError",
        `HTTP ${res.status} ${res.statusText}`.trim(),
      );
    }
    return data as T;
  }

  listKeys(): Promise<KeyInfo[]> {
    return this.request("GET", "/keys");
  }

  keySchema(id: string): Promise<JsonSchema> {
    return this.request("GET", `/keys/${encodeURIComponent(id)}/schema`);
  }

  runKey(id: string, params: Record<string, unknown>): Promise<Result> {
    return this.request("POST", `/keys/${encodeURIComponent(id)}/run`, params);
  }

  listTransforms(): Promise<TransformInfo[]> {
    return this.request("GET", "/transforms");
  }

  transformSchema(op: string): Promise<JsonSchema> {
    return this.request(
      "GET",
      `/transforms/${encodeURIComponent(op)}/schema`,
    );
  }

  listWorkspaces(): Promise<Workspace[]> {
    return this.request("GET", "/workspaces");
  }

  getWorkspace(name: string): Promise<Workspace> {
    return this.request("GET", `/workspaces/${encodeURIComponent(name)}`);
  }

  saveWorkspace(ws: Workspace): Promise<Workspace> {
    return this.request(
      "PUT",
      `/workspaces/${encodeURIComponent(ws.name)}`,
      ws,
    );
  }

  deleteWorkspace(name: string): Promise<void> {
    return this.request("DELETE", `/workspaces/${encodeURIComponent(name)}`);
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
      workspace,
      role,
      head_rows: headRows,
    });
  }

  workspaceRows(
    workspace: Workspace,
    role: Role,
    version: number,
    offset: number,
    limit: number,
  ): Promise<WorkspaceRows> {
    return this.request("POST", "/workspace/rows", {
      workspace,
      role,
      version,
      offset,
      limit,
    });
  }

  columnProfiles(
    workspace: Workspace,
    role: Role,
    version: number,
  ): Promise<ColumnProfile[]> {
    return this.request("POST", "/workspace/profiles", {
      workspace,
      role,
      version,
    });
  }

  previewStep(
    workspace: Workspace,
    step: Step,
    role: Role,
  ): Promise<PreviewStep> {
    return this.request("POST", "/workspace/preview-step", {
      workspace,
      step,
      role,
    });
  }

  alignReport(workspace: Workspace): Promise<AlignReport> {
    return this.request("POST", "/workspace/align", { workspace });
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
