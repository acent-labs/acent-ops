import {
  definePlugin,
  runWorker,
  type PaperclipPlugin,
  type PluginContext,
  type PluginHealthDiagnostics,
  type ToolResult,
} from "@paperclipai/plugin-sdk";
import { DEFAULT_CONFIG, PLUGIN_ID, TOOL_NAMES } from "./constants.js";
import { XApiClient, type XCredentials } from "./x-client.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

type SocialReaderConfig = {
  consumerKeyRef?: string;
  consumerSecretRef?: string;
  accessTokenRef?: string;
  accessTokenSecretRef?: string;
};

// ---------------------------------------------------------------------------
// Credential resolution
// ---------------------------------------------------------------------------

let xClient: XApiClient | null = null;

async function resolveValue(
  ctx: PluginContext,
  ref: string | undefined,
  envFallback: string,
): Promise<string> {
  if (ref) {
    try {
      return await ctx.secrets.resolve(ref);
    } catch {
      // fall through to env
    }
  }
  const value = process.env[envFallback];
  if (!value) {
    throw new Error(
      `Missing credential: set the "${envFallback}" secret ref in plugin config, or set the ${envFallback} environment variable`,
    );
  }
  return value;
}

async function resolveCredentials(ctx: PluginContext): Promise<XCredentials> {
  const config: SocialReaderConfig = {
    ...DEFAULT_CONFIG,
    ...((await ctx.config.get()) as SocialReaderConfig),
  };
  return {
    consumerKey: await resolveValue(ctx, config.consumerKeyRef, "TWITTER_CONSUMER_KEY"),
    consumerSecret: await resolveValue(ctx, config.consumerSecretRef, "TWITTER_CONSUMER_SECRET"),
    accessToken: await resolveValue(ctx, config.accessTokenRef, "TWITTER_ACCESS_TOKEN"),
    accessTokenSecret: await resolveValue(ctx, config.accessTokenSecretRef, "TWITTER_ACCESS_TOKEN_SECRET"),
  };
}

async function getClient(ctx: PluginContext): Promise<XApiClient> {
  if (!xClient) {
    const creds = await resolveCredentials(ctx);
    xClient = new XApiClient(creds);
  }
  return xClient;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

async function registerTools(ctx: PluginContext): Promise<void> {
  // 1. x-get-me
  ctx.tools.register(
    TOOL_NAMES.xGetMe,
    {
      displayName: "X Get My Profile",
      description: "Get the authenticated X user profile with follower/following/tweet counts.",
      parametersSchema: { type: "object", properties: {} },
    },
    async (): Promise<ToolResult> => {
      const client = await getClient(ctx);
      const result = await client.getMe();
      return { content: JSON.stringify(result, null, 2), data: result };
    },
  );

  // 2. x-get-user-tweets
  ctx.tools.register(
    TOOL_NAMES.xGetUserTweets,
    {
      displayName: "X Get User Tweets",
      description: "Get recent tweets with engagement metrics.",
      parametersSchema: {
        type: "object",
        properties: {
          userId: { type: "string" },
          maxResults: { type: "number" },
        },
      },
    },
    async (params): Promise<ToolResult> => {
      const { userId, maxResults } = params as { userId?: string; maxResults?: number };
      const client = await getClient(ctx);
      const result = await client.getUserTweets(userId, maxResults);
      return { content: JSON.stringify(result, null, 2), data: result };
    },
  );

  // 3. x-search
  ctx.tools.register(
    TOOL_NAMES.xSearch,
    {
      displayName: "X Search Recent Tweets",
      description: "Search recent tweets by keyword or query.",
      parametersSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          maxResults: { type: "number" },
        },
        required: ["query"],
      },
    },
    async (params): Promise<ToolResult> => {
      const { query, maxResults } = params as { query: string; maxResults?: number };
      if (!query) return { error: "query is required" };
      const client = await getClient(ctx);
      const result = await client.searchRecent(query, maxResults);
      return { content: JSON.stringify(result, null, 2), data: result };
    },
  );

  // 4. x-get-followers
  ctx.tools.register(
    TOOL_NAMES.xGetFollowers,
    {
      displayName: "X Get Followers",
      description: "Get the follower list with profile info and public metrics.",
      parametersSchema: {
        type: "object",
        properties: {
          userId: { type: "string" },
          maxResults: { type: "number" },
        },
      },
    },
    async (params): Promise<ToolResult> => {
      const { userId, maxResults } = params as { userId?: string; maxResults?: number };
      const client = await getClient(ctx);
      const result = await client.getFollowers(userId, maxResults);
      return { content: JSON.stringify(result, null, 2), data: result };
    },
  );

  // 5. x-get-mentions
  ctx.tools.register(
    TOOL_NAMES.xGetMentions,
    {
      displayName: "X Get Mentions",
      description: "Get recent tweets mentioning the user.",
      parametersSchema: {
        type: "object",
        properties: {
          userId: { type: "string" },
          maxResults: { type: "number" },
        },
      },
    },
    async (params): Promise<ToolResult> => {
      const { userId, maxResults } = params as { userId?: string; maxResults?: number };
      const client = await getClient(ctx);
      const result = await client.getMentions(userId, maxResults);
      return { content: JSON.stringify(result, null, 2), data: result };
    },
  );
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const plugin: PaperclipPlugin = definePlugin({
  async setup(ctx) {
    await registerTools(ctx);
  },

  async onHealth(): Promise<PluginHealthDiagnostics> {
    const hasEnvCreds =
      !!process.env.TWITTER_CONSUMER_KEY &&
      !!process.env.TWITTER_ACCESS_TOKEN;
    return {
      status: hasEnvCreds || xClient ? "ok" : "degraded",
      message: hasEnvCreds || xClient
        ? "Social Reader plugin ready"
        : "X credentials not configured — set env vars or plugin secret refs",
      details: {
        pluginId: PLUGIN_ID,
        clientInitialized: !!xClient,
        envCredentialsDetected: hasEnvCreds,
      },
    };
  },

  async onConfigChanged() {
    // Reset client so next call picks up new credentials
    xClient = null;
  },

  async onShutdown() {
    xClient = null;
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
