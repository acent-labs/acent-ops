import { Client, OAuth1, type ClientConfig, type OAuth1Config } from "@xdevplatform/xdk";

export interface XCredentials {
  bearerToken?: string;
  consumerKey?: string;
  consumerSecret?: string;
  accessToken?: string;
  accessTokenSecret?: string;
}

const USER_FIELDS = ["public_metrics", "description", "created_at", "profile_image_url", "verified_type"];
const TWEET_FIELDS = ["public_metrics", "created_at"];
const TWEET_FIELDS_WITH_AUTHOR = ["public_metrics", "created_at", "author_id"];
const USER_SEARCH_FIELDS = ["name", "username"];

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(value, max));
}

function hasOAuth1Credentials(creds: XCredentials): creds is Required<Omit<XCredentials, "bearerToken">> & {
  bearerToken?: string;
} {
  return !!creds.consumerKey && !!creds.consumerSecret && !!creds.accessToken && !!creds.accessTokenSecret;
}

function createOAuth1Client(creds: XCredentials): Client | null {
  if (!hasOAuth1Credentials(creds)) return null;

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

function createBearerClient(creds: XCredentials): Client | null {
  if (!creds.bearerToken) return null;
  return new Client({ bearerToken: creds.bearerToken });
}

/**
 * Thin Paperclip wrapper around X's first-party TypeScript XDK.
 *
 * Keep XDK-specific method names isolated here so plugin tools and output
 * contracts can stay stable even if the upstream SDK shifts while still 0.x.
 */
export class XApiClient {
  private readonly userContextClient: Client | null;
  private readonly readClient: Client | null;
  private cachedUserId: string | null = null;

  constructor(creds: XCredentials) {
    this.userContextClient = createOAuth1Client(creds);
    this.readClient = createBearerClient(creds) ?? this.userContextClient;

    if (!this.userContextClient && !this.readClient) {
      throw new Error(
        "Missing X credentials: configure TWITTER_BEARER_TOKEN or the OAuth1 credential set " +
          "(TWITTER_CONSUMER_KEY, TWITTER_CONSUMER_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET).",
      );
    }
  }

  private requireUserContext(action: string): Client {
    if (this.userContextClient) return this.userContextClient;
    throw new Error(
      `${action} requires OAuth1 user-context credentials. Configure TWITTER_CONSUMER_KEY, ` +
        "TWITTER_CONSUMER_SECRET, TWITTER_ACCESS_TOKEN, and TWITTER_ACCESS_TOKEN_SECRET.",
    );
  }

  private requireReadClient(): Client {
    if (this.readClient) return this.readClient;
    return this.requireUserContext("X read operation");
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
