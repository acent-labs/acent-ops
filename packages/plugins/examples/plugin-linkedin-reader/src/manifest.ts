import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { DEFAULT_CONFIG, PLUGIN_ID, PLUGIN_VERSION, TOOL_NAMES } from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "LinkedIn Connector",
  description:
    "LinkedIn social connector with OAuth 2.0. Agents can check profiles, create/delete posts, and view reactions. Uses the 'Share on LinkedIn' product API.",
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
        "Get the authenticated LinkedIn user profile including name, email, and profile picture via OpenID userinfo.",
      parametersSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: TOOL_NAMES.linkedinCreatePost,
      displayName: "LinkedIn Create Post",
      description:
        "Create a new text post on LinkedIn as the authenticated user. Returns the created post info.",
      parametersSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The text content of the post. Required.",
          },
          visibility: {
            type: "string",
            enum: ["PUBLIC", "CONNECTIONS"],
            description: "Post visibility. Default: PUBLIC.",
          },
        },
        required: ["text"],
      },
    },
    {
      name: TOOL_NAMES.linkedinDeletePost,
      displayName: "LinkedIn Delete Post",
      description:
        "Delete a LinkedIn post by its URN.",
      parametersSchema: {
        type: "object",
        properties: {
          postUrn: {
            type: "string",
            description: "The post URN to delete (e.g. urn:li:share:1234567890). Required.",
          },
        },
        required: ["postUrn"],
      },
    },
    {
      name: TOOL_NAMES.linkedinGetReactions,
      displayName: "LinkedIn Get Reactions",
      description:
        "Get reactions (likes, celebrates, etc.) for a specific LinkedIn post by URN.",
      parametersSchema: {
        type: "object",
        properties: {
          entityUrn: {
            type: "string",
            description: "The entity URN to get reactions for (e.g. urn:li:share:1234567890). Required.",
          },
        },
        required: ["entityUrn"],
      },
    },
  ],
};

export default manifest;
