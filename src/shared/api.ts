// API contract shared by the server and the client. Add new endpoints here first.
import type { Visibility } from './constants.ts';

export type { Visibility };

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

export interface SnippetInput {
  title: string;
  html: string;
  css: string;
  js: string;
  /** POST defaults to 'unlisted'; PUT keeps the current value when omitted */
  visibility?: Visibility;
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

/** A locked collection reveals only its title; nothing else is sent until it is unlocked. */
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
 *   POST   /api/snippets                   (auth) SnippetInput     -> 201 Snippet
 *   GET    /api/snippets/:shareId          (optional auth, optional X-Collection-Token) -> 200 Snippet
 *   PUT    /api/snippets/:shareId          (auth, owner) SnippetInput -> 200 Snippet
 *   DELETE /api/snippets/:shareId          (auth, owner)           -> 204
 *   POST   /api/snippets/:shareId/fork     (auth) Partial<SnippetInput> -> 201 Snippet
 *   GET    /api/collections                (auth)                  -> 200 CollectionListResponse
 *   POST   /api/collections                (auth) CollectionInput  -> 201 CollectionSummary
 *   GET    /api/collections/:shareId       (optional auth, optional X-Collection-Token) -> 200 CollectionResponse
 *   PUT    /api/collections/:shareId       (auth, owner) CollectionInput -> 200 CollectionSummary
 *   DELETE /api/collections/:shareId       (auth, owner)           -> 204 (bins are kept)
 *   PUT    /api/collections/:shareId/snippets/:snippetShareId (auth, owner of both) -> 204
 *   DELETE /api/collections/:shareId/snippets/:snippetShareId (auth, owner)         -> 204
 *   POST   /api/collections/:shareId/unlock UnlockRequest          -> 200 UnlockResponse
 *   GET    /api/health                                             -> 200 { ok: true }
 * Private snippets and owner-only collections answer 404 to everyone but the owner.
 * Errors always use ApiErrorBody.
 */
