export const PLUGIN_ID = "paperclip-social-reader";
export const PLUGIN_VERSION = "0.1.0";

export const TOOL_NAMES = {
  xAuthStart: "x-auth-start",
  xAuthCallback: "x-auth-callback",
  xCreatePost: "x-create-post",
  xCreateThread: "x-create-thread",
  xGetMe: "x-get-me",
  xGetUserTweets: "x-get-user-tweets",
  xSearch: "x-search",
  xGetFollowers: "x-get-followers",
  xGetMentions: "x-get-mentions",
} as const;

export const X_OAUTH2_SCOPES = ["tweet.read", "users.read", "tweet.write", "offline.access"] as const;

export const DEFAULT_CONFIG = {
  /** Paperclip secret ref for TWITTER_BEARER_TOKEN. Used for app-only read access when present. */
  bearerTokenRef: "",
  /** Paperclip secret ref for X OAuth 2.0 Client ID. Falls back to env var if empty. */
  clientIdRef: "",
  /** Paperclip secret ref for X OAuth 2.0 Client Secret. Falls back to env var if empty. */
  clientSecretRef: "",
  /** Paperclip secret ref for TWITTER_CONSUMER_KEY. Falls back to env var if empty. */
  consumerKeyRef: "",
  /** Paperclip secret ref for TWITTER_CONSUMER_SECRET. Falls back to env var if empty. */
  consumerSecretRef: "",
  /** Paperclip secret ref for X OAuth 1.0a Access Token. Falls back to env var if empty. */
  accessTokenRef: "",
  /** Paperclip secret ref for X OAuth 1.0a Access Token Secret. Falls back to env var if empty. */
  accessTokenSecretRef: "",
  /** Paperclip secret ref for X OAuth 2.0 Access Token. Falls back to env var if empty. */
  oauth2AccessTokenRef: "",
  /** Paperclip secret ref for X OAuth 2.0 Refresh Token. Falls back to env var if empty. */
  oauth2RefreshTokenRef: "",
  /** OAuth 2.0 redirect URI. Falls back to X_REDIRECT_URI if empty. */
  redirectUri: "",
} as const;
