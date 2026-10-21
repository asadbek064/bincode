// API contract shared by the server and the client. Add new endpoints here first.
import type { Expiration, Visibility } from './constants.ts';

export type { Expiration, Visibility };

export interface User {
  id: string;
  email: string;
}

export interface SnippetSummary {
  shareId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** shareId of the snippet this one was forked from, if it still exists and is visible to the viewer */
  forkedFrom: string | null;
  visibility: Visibility;
  /** the bin is deleted at this time; null = never */
  expiresAt: string | null;
  /** deleted after the first view by someone other than the owner */
  burnAfterRead: boolean;
}

export interface Snippet extends SnippetSummary {
  html: string;
  css: string;
  js: string;
  /** true when the requesting user owns this snippet */
  isOwner: boolean;
  /** shareIds of the owner's collections containing this snippet; only sent to the owner */
  collections?: string[];
}

/** The content of a bin. PUT changes only this; settings go through PATCH. */
export interface SnippetInput {
  title: string;
  html: string;
  css: string;
  js: string;
}

/** Who can see a bin and how long it lives. Omitted fields keep their current value. */
export interface SnippetSettingsInput {
  visibility?: Visibility;
  /** required when switching to 'password' without a stored password; otherwise replaces it */
  password?: string;
  /** counted from now; 'never' removes the expiry */
  expiresIn?: Expiration;
  burnAfterRead?: boolean;
}

export interface CreateSnippetRequest extends SnippetInput {
  settings?: SnippetSettingsInput;
}

export type LockReason = 'password' | 'burn' | 'password+burn';

/** What a non-owner gets for a bin that needs a password or burns on reading: never any code. */
export interface LockedSnippet {
  locked: true;
  reason: LockReason;
  shareId: string;
  title: string;
}

export type SnippetResponse = Snippet | LockedSnippet;

export interface UnlockSnippetRequest {
  password?: string;
}

export interface UnlockSnippetResponse {
  snippet: Snippet;
  /** true when this view deleted the bin (burn after read) */
  burned: boolean;
  /** for password bins that don't burn: send as X-Unlock-Token to open it again */
  token?: string;
  expiresAt?: string;
}

export interface CollectionSummary {
  shareId: string;
  title: string;
  description: string;
  /** a password lets non-owners unlock the collection by link; without one it is owner-only */
  hasPassword: boolean;
  snippetCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionInput {
  title: string;
  description?: string;
  /** undefined keeps the current password, null removes it */
  password?: string | null;
}

/**
 * A locked collection reveals only its title; nothing else is sent until it is unlocked.
 * Unlocking shows the list only: each bin keeps its own visibility, and private bins are omitted.
 */
export type CollectionResponse =
  | { locked: true; shareId: string; title: string }
  | { locked: false; isOwner: boolean; collection: CollectionSummary; snippets: SnippetSummary[] };

export interface CollectionListResponse {
  collections: CollectionSummary[];
}

export interface UnlockRequest {
  password: string;
}

export interface UnlockResponse {
  token: string;
  expiresAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface MeResponse {
  user: User;
}

export interface SnippetListResponse {
  snippets: SnippetSummary[];
}

export interface ApiErrorBody {
  error: string;
  details?: { path: string; message: string }[];
}

/*
 * Endpoints
 *   POST   /api/auth/login                 LoginRequest            -> 200 LoginResponse
 *   GET    /api/auth/me                    (auth)                  -> 200 MeResponse
 *   GET    /api/snippets                   (auth)                  -> 200 SnippetListResponse (own, updatedAt desc)
 *   POST   /api/snippets                   (auth) CreateSnippetRequest -> 201 Snippet
 *   GET    /api/snippets/:shareId          (optional auth, optional X-Unlock-Token) -> 200 SnippetResponse
 *   PUT    /api/snippets/:shareId          (auth, owner) SnippetInput -> 200 Snippet (content only)
 *   PATCH  /api/snippets/:shareId          (auth, owner) SnippetSettingsInput -> 200 Snippet
 *   POST   /api/snippets/:shareId/unlock   UnlockSnippetRequest    -> 200 UnlockSnippetResponse (burns if set)
 *   DELETE /api/snippets/:shareId          (auth, owner)           -> 204
 *   POST   /api/snippets/:shareId/fork     (auth) Partial<SnippetInput> -> 201 Snippet
 *   GET    /api/collections                (auth)                  -> 200 CollectionListResponse
 *   POST   /api/collections                (auth) CollectionInput  -> 201 CollectionSummary
 *   GET    /api/collections/:shareId       (optional auth, optional X-Unlock-Token) -> 200 CollectionResponse
 *   PUT    /api/collections/:shareId       (auth, owner) CollectionInput -> 200 CollectionSummary
 *   DELETE /api/collections/:shareId       (auth, owner)           -> 204 (bins are kept)
 *   PUT    /api/collections/:shareId/snippets/:snippetShareId (auth, owner of both) -> 204
 *   DELETE /api/collections/:shareId/snippets/:snippetShareId (auth, owner)         -> 204
 *   POST   /api/collections/:shareId/unlock UnlockRequest          -> 200 UnlockResponse
 *   GET    /api/health                                             -> 200 { ok: true }
 * Private snippets, expired snippets and owner-only collections answer 404 to everyone but the owner.
 * Errors always use ApiErrorBody.
 */
