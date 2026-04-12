export const PLUGIN_ID = "paperclip-social-reader";
export const PLUGIN_VERSION = "0.1.0";

export const TOOL_NAMES = {
  xGetMe: "x-get-me",
  xGetUserTweets: "x-get-user-tweets",
  xSearch: "x-search",
  xGetFollowers: "x-get-followers",
  xGetMentions: "x-get-mentions",
} as const;

export const DEFAULT_CONFIG = {
  /** Paperclip secret ref for TWITTER_CONSUMER_KEY. Falls back to env var if empty. */
  consumerKeyRef: "",
  /** Paperclip secret ref for TWITTER_CONSUMER_SECRET. Falls back to env var if empty. */
  consumerSecretRef: "",
  /** Paperclip secret ref for TWITTER_ACCESS_TOKEN. Falls back to env var if empty. */
  accessTokenRef: "",
  /** Paperclip secret ref for TWITTER_ACCESS_TOKEN_SECRET. Falls back to env var if empty. */
  accessTokenSecretRef: "",
} as const;
