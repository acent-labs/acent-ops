import { LINKEDIN_AUTH_BASE, LINKEDIN_API_BASE } from "./constants.js";

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
    // Consider expired 5 minutes before actual expiry
    return Date.now() > this.tokens.expiresAt - 5 * 60 * 1000;
  }

  async ensureValidToken(): Promise<boolean> {
    if (!this.isTokenExpired()) return false;
    if (!this.tokens.refreshToken) {
      throw new Error("Access token expired and no refresh token available. Re-authorize via linkedin-auth-start.");
    }
    const newTokens = await refreshAccessToken(this.creds, this.tokens.refreshToken);
    this.tokens = newTokens;
    return true; // tokens were refreshed
  }

  private async request<T = unknown>(
    path: string,
    options: {
      base?: string;
      params?: Record<string, string>;
      headers?: Record<string, string>;
      version?: string;
    } = {},
  ): Promise<T> {
    await this.ensureValidToken();

    const base = options.base ?? LINKEDIN_API_BASE;
    const qs = options.params
      ? "?" + new URLSearchParams(options.params).toString()
      : "";
    const url = `${base}${path}${qs}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.tokens.accessToken}`,
      "X-Restli-Protocol-Version": "2.0.0",
      ...options.headers,
    };

    if (options.version) {
      headers["LinkedIn-Version"] = options.version;
    }

    const response = await fetch(url, { method: "GET", headers });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LinkedIn API GET ${path} failed (${response.status}): ${body}`);
    }

    return (await response.json()) as T;
  }

  /** Resolve the authenticated user's person URN, caching after first call. */
  private async resolvePersonUrn(): Promise<string> {
    if (this.cachedPersonUrn) return this.cachedPersonUrn;
    const me = await this.getMe();
    const data = me as { sub?: string };
    if (!data.sub) throw new Error("Could not resolve LinkedIn person URN from userinfo");
    this.cachedPersonUrn = data.sub;
    return this.cachedPersonUrn;
  }

  // -- public API methods ---------------------------------------------------

  async getMe(): Promise<unknown> {
    return this.request("/v2/userinfo");
  }

  async getProfile(): Promise<unknown> {
    return this.request("/v2/me", {
      params: {
        projection: "(id,localizedFirstName,localizedLastName,localizedHeadline,vanityName,profilePicture(displayImage~digitalmediaAsset:playableStreams))",
      },
    });
  }

  async getPosts(authorUrn?: string, count = 10): Promise<unknown> {
    const personUrn = authorUrn ?? await this.resolvePersonUrn();
    const urn = personUrn.startsWith("urn:") ? personUrn : `urn:li:person:${personUrn}`;
    return this.request("/rest/posts", {
      params: {
        author: urn,
        q: "author",
        count: String(Math.max(1, Math.min(count, 100))),
        sortBy: "LAST_MODIFIED",
      },
      version: "202401",
    });
  }

  async getOrganization(orgId: string): Promise<unknown> {
    return this.request(`/rest/organizations/${orgId}`, {
      version: "202401",
    });
  }

  async getOrganizationPosts(orgUrn: string, count = 10): Promise<unknown> {
    const urn = orgUrn.startsWith("urn:") ? orgUrn : `urn:li:organization:${orgUrn}`;
    return this.request("/rest/posts", {
      params: {
        author: urn,
        q: "author",
        count: String(Math.max(1, Math.min(count, 100))),
        sortBy: "LAST_MODIFIED",
      },
      version: "202401",
    });
  }

  async getPostAnalytics(postUrns: string[]): Promise<unknown> {
    // Social actions (likes, comments) for specific posts
    const results: unknown[] = [];
    for (const urn of postUrns.slice(0, 10)) {
      try {
        const encoded = encodeURIComponent(urn);
        const data = await this.request(`/rest/socialMetadata/${encoded}`, {
          version: "202401",
        });
        results.push({ urn, analytics: data });
      } catch (err) {
        results.push({ urn, error: String(err) });
      }
    }
    return results;
  }
}
