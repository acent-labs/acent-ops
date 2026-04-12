import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { DEFAULT_CONFIG, PLUGIN_ID, PLUGIN_VERSION, TOOL_NAMES } from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Social Reader",
  description:
    "Read-only social media analytics for X (Twitter). Agents can check profiles, follower counts, recent tweets, mentions, and search results without posting anything.",
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
      consumerKeyRef: {
        type: "string",
        title: "X Consumer Key (secret ref)",
        description: "Paperclip secret reference. Falls back to TWITTER_CONSUMER_KEY env var if empty.",
        default: DEFAULT_CONFIG.consumerKeyRef,
      },
      consumerSecretRef: {
        type: "string",
        title: "X Consumer Secret (secret ref)",
        description: "Paperclip secret reference. Falls back to TWITTER_CONSUMER_SECRET env var if empty.",
        default: DEFAULT_CONFIG.consumerSecretRef,
      },
      accessTokenRef: {
        type: "string",
        title: "X Access Token (secret ref)",
        description: "Paperclip secret reference. Falls back to TWITTER_ACCESS_TOKEN env var if empty.",
        default: DEFAULT_CONFIG.accessTokenRef,
      },
      accessTokenSecretRef: {
        type: "string",
        title: "X Access Token Secret (secret ref)",
        description: "Paperclip secret reference. Falls back to TWITTER_ACCESS_TOKEN_SECRET env var if empty.",
        default: DEFAULT_CONFIG.accessTokenSecretRef,
      },
    },
  },
  tools: [
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
