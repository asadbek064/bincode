import type {
  ApiErrorBody,
  CollectionInput,
  CollectionListResponse,
  CollectionResponse,
  CollectionSummary,
  CreateSnippetRequest,
  ImportSummary,
  LoginResponse,
  MeResponse,
  Snippet,
  SnippetInput,
  SnippetListResponse,
  SnippetResponse,
  SnippetSettingsInput,
  UnlockResponse,
  UnlockSnippetResponse,
} from '../../../shared/api.ts';
import { UNLOCK_TOKEN_HEADER } from '../../../shared/constants.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly details: ApiErrorBody['details'];

  constructor(status: number, message: string, details?: ApiErrorBody['details']) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

/** Called when an authenticated request gets a 401 (expired token, deleted user). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

function fallbackMessage(status: number): string {
  if (status === 0) return 'Network error. Check your connection.';
  if (status === 404) return 'Not found.';
  if (status === 413) return 'Bin is too large.';
  if (status === 429) return 'Too many requests. Please wait a moment.';
  if (status >= 500) return 'Server error. Please try again.';
  return `Request failed (${status}).`;
}

interface RequestOptions {
  /** sent as-is (application/octet-stream) instead of JSON */
  rawBody?: Blob;
  /** resolve to the response body as a Blob instead of parsed JSON */
  blob?: boolean;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: opts.blob ? '*/*' : 'application/json', ...extraHeaders };
  if (opts.rawBody) headers['Content-Type'] = 'application/octet-stream';
  else if (body !== undefined) headers['Content-Type'] = 'application/json';
  const sentToken = authToken;
  if (sentToken) headers.Authorization = `Bearer ${sentToken}`;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: opts.rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch {
    throw new ApiError(0, fallbackMessage(0));
  }

  if (res.status === 204) return undefined as T;
  if (res.ok && opts.blob) return (await res.blob()) as T;

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body (e.g. a proxy error page); fall through to the status message.
  }

  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiErrorBody>;
    // Only treat it as a session problem if we actually sent a token; a failed
    // login is also a 401 but must not log anyone out.
    if (res.status === 401 && sentToken && sentToken === authToken) onUnauthorized?.();
    throw new ApiError(res.status, err.error || fallbackMessage(res.status), err.details);
  }
  return data as T;
}

const snippetPath = (shareId: string) => `/snippets/${encodeURIComponent(shareId)}`;

export const login = (email: string, password: string) =>
  request<LoginResponse>('POST', '/auth/login', { email, password });

export const me = () => request<MeResponse>('GET', '/auth/me');

export const listSnippets = () => request<SnippetListResponse>('GET', '/snippets');

const unlockHeader = (token: string | null | undefined) => (token ? { [UNLOCK_TOKEN_HEADER]: token } : undefined);

/** `unlockToken` reopens a password bin unlocked earlier; without it such bins come back `locked`. */
export const getSnippet = (shareId: string, unlockToken?: string | null) =>
  request<SnippetResponse>('GET', snippetPath(shareId), undefined, unlockHeader(unlockToken));

/** For the owner's own bins, which are never locked. */
export async function getOwnSnippet(shareId: string): Promise<Snippet> {
  const res = await getSnippet(shareId);
  if ('locked' in res) throw new ApiError(403, 'You do not own this bin.');
  return res;
}

export const unlockSnippet = (shareId: string, password?: string) =>
  request<UnlockSnippetResponse>('POST', `${snippetPath(shareId)}/unlock`, password ? { password } : {});

export const createSnippet = (input: CreateSnippetRequest) => request<Snippet>('POST', '/snippets', input);

/** Settings apply immediately and never touch the code. */
export const updateSnippetSettings = (shareId: string, settings: SnippetSettingsInput) =>
  request<Snippet>('PATCH', snippetPath(shareId), settings);

export const updateSnippet = (shareId: string, input: SnippetInput) =>
  request<Snippet>('PUT', snippetPath(shareId), input);

export const deleteSnippet = (shareId: string) =>
  request<void>('DELETE', snippetPath(shareId));

export const forkSnippet = (shareId: string, input?: Partial<SnippetInput>, unlockToken?: string | null) =>
  request<Snippet>('POST', `${snippetPath(shareId)}/fork`, input ?? {}, unlockHeader(unlockToken));

const collectionPath = (shareId: string) => `/collections/${encodeURIComponent(shareId)}`;

export const listCollections = () => request<CollectionListResponse>('GET', '/collections');

export const getCollection = (shareId: string, unlockToken?: string | null) =>
  request<CollectionResponse>('GET', collectionPath(shareId), undefined, unlockHeader(unlockToken));

export const createCollection = (input: CollectionInput) =>
  request<CollectionSummary>('POST', '/collections', input);

export const updateCollection = (shareId: string, input: CollectionInput) =>
  request<CollectionSummary>('PUT', collectionPath(shareId), input);

export const deleteCollection = (shareId: string) => request<void>('DELETE', collectionPath(shareId));

export const addToCollection = (shareId: string, snippetShareId: string) =>
  request<void>('PUT', `${collectionPath(shareId)}/snippets/${encodeURIComponent(snippetShareId)}`);

export const removeFromCollection = (shareId: string, snippetShareId: string) =>
  request<void>('DELETE', `${collectionPath(shareId)}/snippets/${encodeURIComponent(snippetShareId)}`);

export const unlockCollection = (shareId: string, password: string) =>
  request<UnlockResponse>('POST', `${collectionPath(shareId)}/unlock`, { password });

/** The user's full backup (Brotli-compressed JSON), as a Blob to download. */
export const exportBackup = () => request<Blob>('GET', '/account/export', undefined, undefined, { blob: true });

/** Restores a backup file (.json.br or .json); existing bins and collections are skipped. */
export const importBackup = (file: Blob) =>
  request<ImportSummary>('POST', '/account/import', undefined, undefined, { rawBody: file });
