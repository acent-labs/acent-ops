import { LINKEDIN_AUTH_BASE, LINKEDIN_API_BASE, LINKEDIN_API_VERSION } from "./constants.js";

export interface LinkedInCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface LinkedInTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

// ---------------------------------------------------------------------------
// OAuth 2.0 helpers
// ---------------------------------------------------------------------------

const SCOPES = ["openid", "profile", "email", "w_member_social"];

export function buildAuthorizationUrl(creds: LinkedInCredentials, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: creds.clientId,
    redirect_uri: creds.redirectUri,
    scope: SCOPES.join(" "),
    state,
  });
  return `${LINKEDIN_AUTH_BASE}/authorization?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  creds: LinkedInCredentials,
  code: string,
): Promise<LinkedInTokens> {
  const response = await fetch(`${LINKEDIN_AUTH_BASE}/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: creds.redirectUri,
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LinkedIn token exchange failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

export async function refreshAccessToken(
  creds: LinkedInCredentials,
  refreshToken: string,
): Promise<LinkedInTokens> {
  const response = await fetch(`${LINKEDIN_AUTH_BASE}/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LinkedIn token refresh failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

// ---------------------------------------------------------------------------
// LinkedIn REST API client
// ---------------------------------------------------------------------------

export class LinkedInApiClient {
  private cachedPersonUrn: string | null = null;

  constructor(
    private readonly creds: LinkedInCredentials,
    private tokens: LinkedInTokens,
  ) {}

  get accessToken(): string {
    return this.tokens.accessToken;
  }

  updateTokens(tokens: LinkedInTokens): void {
    this.tokens = tokens;
  }

  isTokenExpired(): boolean {
    if (!this.tokens.expiresAt) return false;
    return Date.now() > this.tokens.expiresAt - 5 * 60 * 1000;
  }

  async ensureValidToken(): Promise<boolean> {
    if (!this.isTokenExpired()) return false;
    if (!this.tokens.refreshToken) {
      throw new Error("Access token expired and no refresh token available. Re-authorize via linkedin-auth-start.");
    }
    const newTokens = await refreshAccessToken(this.creds, this.tokens.refreshToken);
    this.tokens = newTokens;
    return true;
  }

  /** Resolve the authenticated user's person URN (sub claim), caching after first call. */
  async resolvePersonUrn(): Promise<string> {
    if (this.cachedPersonUrn) return this.cachedPersonUrn;
    const me = await this.getMe();
    const data = me as { sub?: string };
    if (!data.sub) throw new Error("Could not resolve LinkedIn person URN from userinfo");
    this.cachedPersonUrn = data.sub;
    return this.cachedPersonUrn;
  }

  private async request<T = unknown>(
    path: string,
    options: {
      method?: string;
      params?: Record<string, string>;
      headers?: Record<string, string>;
      body?: unknown;
      versioned?: boolean;
    } = {},
  ): Promise<T> {
    await this.ensureValidToken();

    const method = options.method ?? "GET";
    const qs = options.params
      ? "?" + new URLSearchParams(options.params).toString()
      : "";
    const url = `${LINKEDIN_API_BASE}${path}${qs}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.tokens.accessToken}`,
      "X-Restli-Protocol-Version": "2.0.0",
      ...options.headers,
    };

    if (options.versioned !== false) {
      headers["LinkedIn-Version"] = LINKEDIN_API_VERSION;
    }

    const fetchOpts: RequestInit = { method, headers };
    if (options.body) {
      headers["Content-Type"] = "application/json";
      fetchOpts.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, fetchOpts);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LinkedIn API ${method} ${path} failed (${response.status}): ${body}`);
    }

    const text = await response.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  // -- public API methods ---------------------------------------------------

  /** Get authenticated user profile via OpenID userinfo endpoint. */
  async getMe(): Promise<unknown> {
    await this.ensureValidToken();

    const response = await fetch(`${LINKEDIN_API_BASE}/v2/userinfo`, {
      headers: { Authorization: `Bearer ${this.tokens.accessToken}` },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LinkedIn userinfo failed (${response.status}): ${body}`);
    }
    return response.json();
  }

  /** Create a text post on LinkedIn. */
  async createPost(text: string, visibility: "PUBLIC" | "CONNECTIONS" = "PUBLIC"): Promise<unknown> {
    const personUrn = await this.resolvePersonUrn();
    return this.request("/rest/posts", {
      method: "POST",
      body: {
        author: `urn:li:person:${personUrn}`,
        commentary: text,
        visibility,
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      },
    });
  }

  /** Delete a post by URN. */
  async deletePost(postUrn: string): Promise<void> {
    const encoded = encodeURIComponent(postUrn);
    await this.request(`/rest/posts/${encoded}`, { method: "DELETE" });
  }

  /** Get reactions for a specific entity (post URN). */
  async getReactions(entityUrn: string): Promise<unknown> {
    const encoded = encodeURIComponent(entityUrn);
    return this.request(`/rest/reactions/${encoded}`, {
      params: { q: "entity" },
    });
  }
}
