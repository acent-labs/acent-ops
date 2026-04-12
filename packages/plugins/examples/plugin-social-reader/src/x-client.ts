import { createHmac, randomBytes } from "node:crypto";

const X_API_BASE = "https://api.twitter.com/2";

export interface XCredentials {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

// ---------------------------------------------------------------------------
// OAuth 1.0a signing (RFC 5849)
// ---------------------------------------------------------------------------

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

function buildOAuthHeader(
  method: string,
  baseUrl: string,
  queryParams: Record<string, string>,
  creds: XCredentials,
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString("hex");

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  const allParams = { ...queryParams, ...oauthParams };
  const paramString = Object.keys(allParams)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(allParams[key]!)}`)
    .join("&");

  const baseString = `${method.toUpperCase()}&${percentEncode(baseUrl)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(creds.consumerSecret)}&${percentEncode(creds.accessTokenSecret)}`;
  const signature = createHmac("sha1", signingKey).update(baseString).digest("base64");

  oauthParams.oauth_signature = signature;

  const header = Object.keys(oauthParams)
    .sort()
    .map((key) => `${percentEncode(key)}="${percentEncode(oauthParams[key]!)}"`)
    .join(", ");

  return `OAuth ${header}`;
}

// ---------------------------------------------------------------------------
// X API v2 client
// ---------------------------------------------------------------------------

export class XApiClient {
  private cachedUserId: string | null = null;

  constructor(private readonly creds: XCredentials) {}

  private async request<T = unknown>(path: string, params: Record<string, string> = {}): Promise<T> {
    const baseUrl = `${X_API_BASE}${path}`;
    const authHeader = buildOAuthHeader("GET", baseUrl, params, this.creds);

    const qs = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    const url = qs ? `${baseUrl}?${qs}` : baseUrl;

    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: authHeader },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`X API GET ${path} failed (${response.status}): ${body}`);
    }

    return (await response.json()) as T;
  }

  /** Resolve the authenticated user's ID, caching after first call. */
  private async resolveUserId(userId?: string): Promise<string> {
    if (userId) return userId;
    if (this.cachedUserId) return this.cachedUserId;
    const me = await this.getMe();
    const data = me as { data?: { id?: string } };
    this.cachedUserId = data.data?.id ?? null;
    if (!this.cachedUserId) throw new Error("Could not resolve authenticated user ID");
    return this.cachedUserId;
  }

  // -- public API methods ---------------------------------------------------

  async getMe(): Promise<unknown> {
    return this.request("/users/me", {
      "user.fields": "public_metrics,description,created_at,profile_image_url,verified_type",
    });
  }

  async getUserTweets(userId?: string, maxResults = 10): Promise<unknown> {
    const id = await this.resolveUserId(userId);
    return this.request(`/users/${id}/tweets`, {
      "tweet.fields": "public_metrics,created_at",
      "max_results": String(Math.max(5, Math.min(maxResults, 100))),
    });
  }

  async searchRecent(query: string, maxResults = 10): Promise<unknown> {
    return this.request("/tweets/search/recent", {
      query,
      "tweet.fields": "public_metrics,created_at,author_id",
      "expansions": "author_id",
      "user.fields": "name,username",
      "max_results": String(Math.max(10, Math.min(maxResults, 100))),
    });
  }

  async getFollowers(userId?: string, maxResults = 20): Promise<unknown> {
    const id = await this.resolveUserId(userId);
    return this.request(`/users/${id}/followers`, {
      "user.fields": "public_metrics,description,created_at",
      "max_results": String(Math.max(1, Math.min(maxResults, 1000))),
    });
  }

  async getMentions(userId?: string, maxResults = 10): Promise<unknown> {
    const id = await this.resolveUserId(userId);
    return this.request(`/users/${id}/mentions`, {
      "tweet.fields": "public_metrics,created_at,author_id",
      "expansions": "author_id",
      "user.fields": "name,username",
      "max_results": String(Math.max(5, Math.min(maxResults, 100))),
    });
  }
}
