import {
  Client,
  OAuth1,
  OAuth2,
  type ClientConfig,
  type OAuth1Config,
  type OAuth2Config,
  type OAuth2Token,
} from "@xdevplatform/xdk";
import { X_OAUTH2_SCOPES } from "./constants.js";

export interface XOAuth1Credentials {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

export interface XOAuth2Credentials {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scope?: string[];
}

export interface XOAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  expiresIn?: number;
  tokenType?: string;
  scope?: string;
}

export interface XCredentials {
  bearerToken?: string;
  oauth1?: XOAuth1Credentials;
  oauth2?: {
    credentials: XOAuth2Credentials;
    tokens?: XOAuth2Tokens | null;
  };
}

const USER_FIELDS = ["public_metrics", "description", "created_at", "profile_image_url", "verified_type"];
const TWEET_FIELDS = ["public_metrics", "created_at"];
const TWEET_FIELDS_WITH_AUTHOR = ["public_metrics", "created_at", "author_id"];
const USER_SEARCH_FIELDS = ["name", "username"];

type CreatedPost = {
  id: string;
  text: string;
  url: string;
};

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(value, max));
}

function createOAuth1Client(creds: XOAuth1Credentials | undefined): Client | null {
  if (!creds) return null;

  const oauth1Config: OAuth1Config = {
    apiKey: creds.consumerKey,
    apiSecret: creds.consumerSecret,
    accessToken: creds.accessToken,
    accessTokenSecret: creds.accessTokenSecret,
    callback: "oob",
  };

  const config: ClientConfig = { oauth1: new OAuth1(oauth1Config) };
  return new Client(config);
}

function createAccessTokenClient(accessToken: string | undefined): Client | null {
  if (!accessToken) return null;
  return new Client({ accessToken });
}

function createBearerClient(bearerToken: string | undefined): Client | null {
  if (!bearerToken) return null;
  return new Client({ bearerToken });
}

export function createOAuth2Auth(config: XOAuth2Credentials, tokens?: XOAuth2Tokens | null): OAuth2 {
  const oauth2Config: OAuth2Config = {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
    scope: config.scope ?? [...X_OAUTH2_SCOPES],
  };
  const auth = new OAuth2(oauth2Config);

  if (tokens?.accessToken) {
    auth.setToken(
      {
        access_token: tokens.accessToken,
        token_type: tokens.tokenType ?? "bearer",
        expires_in: tokens.expiresIn ?? 0,
        refresh_token: tokens.refreshToken,
        scope: tokens.scope,
      },
      tokens.expiresAt,
    );
  }

  return auth;
}

export function normalizeOAuth2Token(token: OAuth2Token): XOAuth2Tokens {
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
    expiresIn: token.expires_in,
    tokenType: token.token_type,
    scope: token.scope,
  };
}

/**
 * Thin Paperclip wrapper around X's first-party TypeScript XDK.
 *
 * Keep XDK-specific method names isolated here so plugin tools and output
 * contracts can stay stable even if the upstream SDK shifts while still 0.x.
 */
export class XApiClient {
  private readonly oauth2Auth: OAuth2 | null;
  private readonly oauth1Client: Client | null;
  private oauth2Tokens: XOAuth2Tokens | null;
  private userContextClient: Client | null;
  private readClient: Client | null;
  private cachedUserId: string | null = null;

  constructor(private readonly creds: XCredentials) {
    this.oauth2Tokens = creds.oauth2?.tokens ?? null;
    this.oauth2Auth = creds.oauth2?.credentials ? createOAuth2Auth(creds.oauth2.credentials, this.oauth2Tokens) : null;
    this.oauth1Client = createOAuth1Client(creds.oauth1);
    this.userContextClient = null;
    this.readClient = null;
    this.rebuildClients();

    if (!this.userContextClient && !this.readClient) {
      throw new Error(
        "Missing X credentials: configure TWITTER_BEARER_TOKEN, complete the OAuth 2.0 PKCE flow, or configure the OAuth1 credential set " +
          "(TWITTER_CONSUMER_KEY, TWITTER_CONSUMER_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET).",
      );
    }
  }

  async ensureValidToken(): Promise<boolean> {
    if (!this.oauth2Auth || !this.oauth2Tokens?.accessToken) return false;
    if (!this.oauth2Auth.isTokenExpired()) return false;
    const refreshed = await this.oauth2Auth.refreshToken(this.oauth2Tokens.refreshToken);
    this.oauth2Tokens = normalizeOAuth2Token(refreshed);
    this.cachedUserId = null;
    this.rebuildClients();
    return true;
  }

  getStoredOAuth2Tokens(): XOAuth2Tokens | null {
    return this.oauth2Tokens;
  }

  private requireUserContext(action: string): Client {
    if (this.userContextClient) return this.userContextClient;
    throw new Error(
      `${action} requires user-context credentials. Complete X OAuth 2.0 PKCE or configure the OAuth1 credential set ` +
        "(TWITTER_CONSUMER_KEY, TWITTER_CONSUMER_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET).",
    );
  }

  private requireReadClient(): Client {
    if (this.readClient) return this.readClient;
    return this.requireUserContext("X read operation");
  }

  private requireWriteClient(): Client {
    return this.requireUserContext("x-create-post");
  }

  private rebuildClients(): void {
    this.userContextClient = createAccessTokenClient(this.oauth2Tokens?.accessToken) ?? this.oauth1Client;
    this.readClient = this.userContextClient ?? createBearerClient(this.creds.bearerToken);
  }

  /** Resolve the authenticated user's ID, caching after first call. */
  private async resolveUserId(userId?: string): Promise<string> {
    if (userId) return userId;
    if (this.cachedUserId) return this.cachedUserId;

    const me = await this.getMe();
    const data = me as { data?: { id?: string } };
    this.cachedUserId = data.data?.id ?? null;
    if (!this.cachedUserId) throw new Error("Could not resolve authenticated X user ID");
    return this.cachedUserId;
  }

  async getMe(): Promise<unknown> {
    const client = this.requireUserContext("x-get-me");
    return client.users.getMe({
      userFields: USER_FIELDS,
    });
  }

  async createPost(text: string, opts?: { replyToPostId?: string }): Promise<unknown> {
    const body: { text: string; reply?: { in_reply_to_tweet_id: string } } = { text };
    if (opts?.replyToPostId) {
      body.reply = { in_reply_to_tweet_id: opts.replyToPostId };
    }
    return this.requireWriteClient().posts.create(body);
  }

  async createThread(posts: string[]): Promise<{
    data: { id: string; text: string };
    rootId: string;
    lastId: string;
    url: string;
    posts: CreatedPost[];
  }> {
    const created: CreatedPost[] = [];
    let replyToPostId: string | undefined;

    for (const [index, text] of posts.entries()) {
      const result = await this.createPost(text, replyToPostId ? { replyToPostId } : undefined) as {
        data?: { id?: string; text?: string };
      };
      const id = result.data?.id;
      if (!id) {
        throw new Error(`X did not return an id for thread post ${index + 1}`);
      }
      const post = {
        id,
        text: result.data?.text ?? text,
        url: `https://x.com/i/web/status/${id}`,
      };
      created.push(post);
      replyToPostId = id;
    }

    const root = created[0];
    const last = created.at(-1);
    if (!root || !last) {
      throw new Error("Thread requires at least one post");
    }

    return {
      data: { id: root.id, text: root.text },
      rootId: root.id,
      lastId: last.id,
      url: root.url,
      posts: created,
    };
  }

  async getUserTweets(userId?: string, maxResults = 10): Promise<unknown> {
    const id = await this.resolveUserId(userId);
    return this.requireReadClient().users.getPosts(id, {
      tweetFields: TWEET_FIELDS,
      maxResults: clamp(maxResults, 5, 100, 10),
    });
  }

  async searchRecent(query: string, maxResults = 10): Promise<unknown> {
    return this.requireReadClient().posts.searchRecent(query, {
      tweetFields: TWEET_FIELDS_WITH_AUTHOR,
      expansions: ["author_id"],
      userFields: USER_SEARCH_FIELDS,
      maxResults: clamp(maxResults, 10, 100, 10),
    });
  }

  async getFollowers(userId?: string, maxResults = 20): Promise<unknown> {
    const id = await this.resolveUserId(userId);
    return this.requireReadClient().users.getFollowers(id, {
      userFields: ["public_metrics", "description", "created_at"],
      maxResults: clamp(maxResults, 1, 1000, 20),
    });
  }

  async getMentions(userId?: string, maxResults = 10): Promise<unknown> {
    const id = await this.resolveUserId(userId);
    return this.requireReadClient().users.getMentions(id, {
      tweetFields: TWEET_FIELDS_WITH_AUTHOR,
      expansions: ["author_id"],
      userFields: USER_SEARCH_FIELDS,
      maxResults: clamp(maxResults, 5, 100, 10),
    });
  }
}
