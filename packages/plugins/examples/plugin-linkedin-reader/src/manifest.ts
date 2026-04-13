import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { DEFAULT_CONFIG, PLUGIN_ID, PLUGIN_VERSION, TOOL_NAMES } from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "LinkedIn Reader",
  description:
    "Read-only social media analytics for LinkedIn. Agents can check profiles, posts, and organization pages without posting anything. Uses OAuth 2.0 for authentication.",
  author: "Acent Labs",
  categories: ["connector", "automation"],
  capabilities: [
    "http.outbound",
    "secrets.read-ref",
    "plugin.state.read",
    "plugin.state.write",
    "agent.tools.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      clientIdRef: {
        type: "string",
        title: "LinkedIn Client ID (secret ref)",
        description: "Paperclip secret reference. Falls back to LINKEDIN_CONSUMER_KEY env var if empty.",
        default: DEFAULT_CONFIG.clientIdRef,
      },
      clientSecretRef: {
        type: "string",
        title: "LinkedIn Client Secret (secret ref)",
        description: "Paperclip secret reference. Falls back to LINKEDIN_CONSUMER_SECRET env var if empty.",
        default: DEFAULT_CONFIG.clientSecretRef,
      },
      accessTokenRef: {
        type: "string",
        title: "LinkedIn Access Token (secret ref)",
        description: "Paperclip secret reference. Falls back to LINKEDIN_ACCESS_TOKEN env var if empty.",
        default: DEFAULT_CONFIG.accessTokenRef,
      },
      refreshTokenRef: {
        type: "string",
        title: "LinkedIn Refresh Token (secret ref)",
        description: "Paperclip secret reference. Falls back to LINKEDIN_REFRESH_TOKEN env var if empty.",
        default: DEFAULT_CONFIG.refreshTokenRef,
      },
      redirectUri: {
        type: "string",
        title: "OAuth Redirect URI",
        description: "OAuth 2.0 redirect URI. Falls back to LINKEDIN_REDIRECT_URI env var if empty.",
        default: DEFAULT_CONFIG.redirectUri,
      },
    },
  },
  tools: [
    {
      name: TOOL_NAMES.linkedinAuthStart,
      displayName: "LinkedIn Auth Start",
      description:
        "Generate a LinkedIn OAuth 2.0 authorization URL. The user must visit this URL to authorize the app and obtain an auth code.",
      parametersSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: TOOL_NAMES.linkedinAuthCallback,
      displayName: "LinkedIn Auth Callback",
      description:
        "Exchange a LinkedIn OAuth 2.0 authorization code for access/refresh tokens. Call this after the user has authorized via the URL from linkedin-auth-start.",
      parametersSchema: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The authorization code from the LinkedIn OAuth callback.",
          },
        },
        required: ["code"],
      },
    },
    {
      name: TOOL_NAMES.linkedinGetMe,
      displayName: "LinkedIn Get My Profile",
      description:
        "Get the authenticated LinkedIn user profile including name, email, and profile picture.",
      parametersSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: TOOL_NAMES.linkedinGetPosts,
      displayName: "LinkedIn Get Posts",
      description:
        "Get recent posts by the authenticated user or a specific author. Returns posts with engagement data.",
      parametersSchema: {
        type: "object",
        properties: {
          authorUrn: {
            type: "string",
            description: "LinkedIn person URN (e.g. urn:li:person:xxx). Omit to get your own posts.",
          },
          count: {
            type: "number",
            description: "Number of posts to return (1-100). Default: 10.",
          },
        },
      },
    },
    {
      name: TOOL_NAMES.linkedinGetOrganization,
      displayName: "LinkedIn Get Organization",
      description:
        "Get a LinkedIn organization (company page) profile by ID. Returns basic organization info.",
      parametersSchema: {
        type: "object",
        properties: {
          orgId: {
            type: "string",
            description: "LinkedIn organization ID. Required.",
          },
        },
        required: ["orgId"],
      },
    },
    {
      name: TOOL_NAMES.linkedinGetPostAnalytics,
      displayName: "LinkedIn Get Post Analytics",
      description:
        "Get social engagement analytics (likes, comments, shares) for specific LinkedIn posts by URN.",
      parametersSchema: {
        type: "object",
        properties: {
          postUrns: {
            type: "array",
            items: { type: "string" },
            description: "Array of post URNs to get analytics for (max 10).",
          },
        },
        required: ["postUrns"],
      },
    },
  ],
};

export default manifest;
