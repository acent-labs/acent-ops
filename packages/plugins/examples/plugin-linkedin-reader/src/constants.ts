export const PLUGIN_ID = "paperclip-linkedin-reader";
export const PLUGIN_VERSION = "0.1.0";

export const TOOL_NAMES = {
  linkedinAuthStart: "linkedin-auth-start",
  linkedinAuthCallback: "linkedin-auth-callback",
  linkedinGetMe: "linkedin-get-me",
  linkedinGetPosts: "linkedin-get-posts",
  linkedinGetOrganization: "linkedin-get-organization",
  linkedinGetPostAnalytics: "linkedin-get-post-analytics",
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
