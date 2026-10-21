import type {
  ApiErrorBody,
  CollectionInput,
  CollectionListResponse,
  CollectionResponse,
  CollectionSummary,
  LoginResponse,
  MeResponse,
  Snippet,
  SnippetInput,
  SnippetListResponse,
  UnlockResponse,
} from '../../../shared/api.ts';
import { COLLECTION_TOKEN_HEADER } from '../../../shared/constants.ts';

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
  if (status === 413) return 'Snippet is too large.';
  if (status === 429) return 'Too many requests. Please wait a moment.';
  if (status >= 500) return 'Server error. Please try again.';
  return `Request failed (${status}).`;
}

async function request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const sentToken = authToken;
  if (sentToken) headers.Authorization = `Bearer ${sentToken}`;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, fallbackMessage(0));
  }

  if (res.status === 204) return undefined as T;

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

const collectionHeader = (token: string | null | undefined) =>
  token ? { [COLLECTION_TOKEN_HEADER]: token } : undefined;

/** `collectionToken` unlocks private snippets that belong to a password-protected collection. */
export const getSnippet = (shareId: string, collectionToken?: string | null) =>
  request<Snippet>('GET', snippetPath(shareId), undefined, collectionHeader(collectionToken));

export const createSnippet = (input: SnippetInput) => request<Snippet>('POST', '/snippets', input);

export const updateSnippet = (shareId: string, input: SnippetInput) =>
  request<Snippet>('PUT', snippetPath(shareId), input);

export const deleteSnippet = (shareId: string) =>
  request<void>('DELETE', snippetPath(shareId));

export const forkSnippet = (shareId: string, input?: Partial<SnippetInput>) =>
  request<Snippet>('POST', `${snippetPath(shareId)}/fork`, input ?? {});

const collectionPath = (shareId: string) => `/collections/${encodeURIComponent(shareId)}`;

export const listCollections = () => request<CollectionListResponse>('GET', '/collections');

export const getCollection = (shareId: string, collectionToken?: string | null) =>
  request<CollectionResponse>('GET', collectionPath(shareId), undefined, collectionHeader(collectionToken));

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
