// API contract shared by the server and the client. Add new endpoints here first.

export interface User {
  id: string;
  email: string;
}

export interface SnippetSummary {
  shareId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** shareId of the snippet this one was forked from, if it still exists */
  forkedFrom: string | null;
}

export interface Snippet extends SnippetSummary {
  html: string;
  css: string;
  js: string;
  /** true when the requesting user owns this snippet */
  isOwner: boolean;
}

export interface SnippetInput {
  title: string;
  html: string;
  css: string;
  js: string;
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
 *   GET    /api/snippets/:shareId          (optional auth)         -> 200 Snippet
 *   PUT    /api/snippets/:shareId          (auth, owner) SnippetInput -> 200 Snippet
 *   DELETE /api/snippets/:shareId          (auth, owner)           -> 204
 *   POST   /api/snippets/:shareId/fork     (auth) Partial<SnippetInput> -> 201 Snippet
 *   GET    /api/health                                             -> 200 { ok: true }
 * Errors always use ApiErrorBody.
 */
