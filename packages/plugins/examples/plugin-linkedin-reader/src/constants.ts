export const PLUGIN_ID = "paperclip-linkedin-reader";
export const PLUGIN_VERSION = "0.2.0";

export const TOOL_NAMES = {
  linkedinAuthStart: "linkedin-auth-start",
  linkedinAuthCallback: "linkedin-auth-callback",
  linkedinGetMe: "linkedin-get-me",
  linkedinCreatePost: "linkedin-create-post",
  linkedinDeletePost: "linkedin-delete-post",
  linkedinGetReactions: "linkedin-get-reactions",
} as const;

export const DEFAULT_CONFIG = {
  clientIdRef: "",
  clientSecretRef: "",
  accessTokenRef: "",
  refreshTokenRef: "",
  redirectUri: "",
} as const;

export const LINKEDIN_AUTH_BASE = "https://www.linkedin.com/oauth/v2";
export const LINKEDIN_API_BASE = "https://api.linkedin.com";
export const LINKEDIN_API_VERSION = "202401";
