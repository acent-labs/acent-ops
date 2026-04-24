import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { DEFAULT_CONFIG, PLUGIN_ID, PLUGIN_VERSION, TOOL_NAMES } from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "X Connector",
  description:
    "X (Twitter) connector with OAuth 2.0 PKCE and OAuth 1.0a compatibility. Agents can authorize, post, publish threads, and inspect profiles, tweets, followers, mentions, and search results.",
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
      bearerTokenRef: {
        type: "string",
        title: "X Bearer Token (secret ref)",
        description: "Paperclip secret reference for app-only read access. Falls back to TWITTER_BEARER_TOKEN env var if empty.",
        default: DEFAULT_CONFIG.bearerTokenRef,
      },
      clientIdRef: {
        type: "string",
        title: "X OAuth 2.0 Client ID (secret ref)",
        description: "Paperclip secret reference. Falls back to X_CLIENT_ID env var if empty.",
        default: DEFAULT_CONFIG.clientIdRef,
      },
      clientSecretRef: {
        type: "string",
        title: "X OAuth 2.0 Client Secret (secret ref)",
        description: "Paperclip secret reference. Falls back to X_CLIENT_SECRET env var if empty.",
        default: DEFAULT_CONFIG.clientSecretRef,
      },
      consumerKeyRef: {
        type: "string",
        title: "X OAuth 1.0a Consumer Key (secret ref)",
        description: "Paperclip secret reference. Falls back to TWITTER_CONSUMER_KEY env var if empty.",
        default: DEFAULT_CONFIG.consumerKeyRef,
      },
      consumerSecretRef: {
        type: "string",
        title: "X OAuth 1.0a Consumer Secret (secret ref)",
        description: "Paperclip secret reference. Falls back to TWITTER_CONSUMER_SECRET env var if empty.",
        default: DEFAULT_CONFIG.consumerSecretRef,
      },
      accessTokenRef: {
        type: "string",
        title: "X OAuth 1.0a Access Token (secret ref)",
        description: "Paperclip secret reference. Falls back to TWITTER_ACCESS_TOKEN env var if empty.",
        default: DEFAULT_CONFIG.accessTokenRef,
      },
      accessTokenSecretRef: {
        type: "string",
        title: "X OAuth 1.0a Access Token Secret (secret ref)",
        description: "Paperclip secret reference. Falls back to TWITTER_ACCESS_TOKEN_SECRET env var if empty.",
        default: DEFAULT_CONFIG.accessTokenSecretRef,
      },
      oauth2AccessTokenRef: {
        type: "string",
        title: "X OAuth 2.0 Access Token (secret ref)",
        description: "Paperclip secret reference. Falls back to X_ACCESS_TOKEN env var if empty.",
        default: DEFAULT_CONFIG.oauth2AccessTokenRef,
      },
      oauth2RefreshTokenRef: {
        type: "string",
        title: "X OAuth 2.0 Refresh Token (secret ref)",
        description: "Paperclip secret reference. Falls back to X_REFRESH_TOKEN env var if empty.",
        default: DEFAULT_CONFIG.oauth2RefreshTokenRef,
      },
      redirectUri: {
        type: "string",
        title: "OAuth Redirect URI",
        description: "OAuth 2.0 redirect URI. Falls back to X_REDIRECT_URI env var if empty.",
        default: DEFAULT_CONFIG.redirectUri,
      },
    },
  },
  tools: [
    {
      name: TOOL_NAMES.xAuthStart,
      displayName: "X Auth Start",
      description:
        "Generate an X OAuth 2.0 PKCE authorization URL. Visit it, authorize the app, then send the callback code to x-auth-callback.",
      parametersSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: TOOL_NAMES.xAuthCallback,
      displayName: "X Auth Callback",
      description:
        "Exchange an X OAuth 2.0 authorization code for access and refresh tokens.",
      parametersSchema: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The authorization code from the X OAuth callback.",
          },
          state: {
            type: "string",
            description: "Optional state value from the X OAuth callback.",
          },
        },
        required: ["code"],
      },
    },
    {
      name: TOOL_NAMES.xCreatePost,
      displayName: "X Create Post",
      description:
        "Create a new text post on X for the authenticated user.",
      parametersSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The post text to publish.",
          },
          replyToPostId: {
            type: "string",
            description: "Optional parent post ID. When provided, the new post is published as a reply.",
          },
        },
        required: ["text"],
      },
    },
    {
      name: TOOL_NAMES.xCreateThread,
      displayName: "X Create Thread",
      description:
        "Create an X thread by publishing the first text post, then replying to each previous post.",
      parametersSchema: {
        type: "object",
        properties: {
          posts: {
            type: "array",
            description: "Ordered post texts to publish as a reply chain.",
            minItems: 2,
            items: {
              type: "string",
            },
          },
        },
        required: ["posts"],
      },
    },
    {
      name: TOOL_NAMES.xGetMe,
      displayName: "X Get My Profile",
      description:
        "Get the authenticated X (Twitter) user profile including follower count, following count, tweet count, and bio.",
      parametersSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: TOOL_NAMES.xGetUserTweets,
      displayName: "X Get User Tweets",
      description:
        "Get recent tweets by the authenticated user or another user by ID. Returns engagement metrics (likes, retweets, replies, impressions).",
      parametersSchema: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "X user ID. Omit to get your own tweets.",
          },
          maxResults: {
            type: "number",
            description: "Number of tweets to return (5-100). Default: 10.",
          },
        },
      },
    },
    {
      name: TOOL_NAMES.xSearch,
      displayName: "X Search Recent Tweets",
      description:
        "Search recent tweets (last 7 days) by keyword or query. Returns tweets with author info and engagement metrics. Requires Basic tier or above.",
      parametersSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query (e.g. keyword, @mention, #hashtag). Required.",
          },
          maxResults: {
            type: "number",
            description: "Number of results to return (10-100). Default: 10.",
          },
        },
        required: ["query"],
      },
    },
    {
      name: TOOL_NAMES.xGetFollowers,
      displayName: "X Get Followers",
      description:
        "Get the follower list for the authenticated user or another user by ID. Returns profile info and public metrics for each follower.",
      parametersSchema: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "X user ID. Omit to get your own followers.",
          },
          maxResults: {
            type: "number",
            description: "Number of followers to return (1-1000). Default: 20.",
          },
        },
      },
    },
    {
      name: TOOL_NAMES.xGetMentions,
      displayName: "X Get Mentions",
      description:
        "Get recent tweets mentioning the authenticated user or another user by ID. Returns tweets with author info and engagement metrics.",
      parametersSchema: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "X user ID. Omit to get your own mentions.",
          },
          maxResults: {
            type: "number",
            description: "Number of mentions to return (5-100). Default: 10.",
          },
        },
      },
    },
  ],
};

export default manifest;
