import {
  definePlugin,
  runWorker,
  type PaperclipPlugin,
  type PluginContext,
  type PluginHealthDiagnostics,
  type ToolResult,
} from "@paperclipai/plugin-sdk";
import { randomBytes } from "node:crypto";
import { generateCodeVerifier } from "@xdevplatform/xdk";
import { DEFAULT_CONFIG, PLUGIN_ID, TOOL_NAMES, X_OAUTH2_SCOPES } from "./constants.js";
import {
  XApiClient,
  createOAuth2Auth,
  normalizeOAuth2Token,
  type XCredentials,
  type XOAuth1Credentials,
  type XOAuth2Credentials,
  type XOAuth2Tokens,
} from "./x-client.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

type SocialReaderConfig = {
  bearerTokenRef?: string;
  clientIdRef?: string;
  clientSecretRef?: string;
  consumerKeyRef?: string;
  consumerSecretRef?: string;
  accessTokenRef?: string;
  accessTokenSecretRef?: string;
  oauth2AccessTokenRef?: string;
  oauth2RefreshTokenRef?: string;
  redirectUri?: string;
};

// ---------------------------------------------------------------------------
// Credential resolution
// ---------------------------------------------------------------------------

let xClient: XApiClient | null = null;

async function resolveValue(
  ctx: PluginContext,
  ref: string | undefined,
  envFallback: string,
): Promise<string | undefined> {
  if (ref) {
    try {
      return await ctx.secrets.resolve(ref);
    } catch {
      // fall through to env
    }
  }
  const value = process.env[envFallback];
  return value || undefined;
}

async function resolveConfig(ctx: PluginContext): Promise<SocialReaderConfig> {
  return {
    ...DEFAULT_CONFIG,
    ...((await ctx.config.get()) as SocialReaderConfig),
  };
}

function hasOAuth1Credentials(creds: XCredentials): boolean {
  return !!creds.oauth1;
}

async function resolveOAuth2Credentials(ctx: PluginContext): Promise<XOAuth2Credentials | null> {
  const config = await resolveConfig(ctx);
  const clientId = await resolveValue(ctx, config.clientIdRef, "X_CLIENT_ID");
  if (!clientId) return null;
  const clientSecret = await resolveValue(ctx, config.clientSecretRef, "X_CLIENT_SECRET");
  return {
    clientId,
    clientSecret,
    redirectUri: config.redirectUri || process.env.X_REDIRECT_URI || "http://127.0.0.1:3100/api/oauth/x/callback",
    scope: [...X_OAUTH2_SCOPES],
  };
}

async function resolveOAuth2Tokens(ctx: PluginContext): Promise<XOAuth2Tokens | null> {
  const config = await resolveConfig(ctx);
  try {
    const stored = (await ctx.state.get({
      scopeKind: "instance",
      stateKey: "x_oauth2_tokens",
    })) as XOAuth2Tokens | null;
    if (stored?.accessToken) return stored;
  } catch {
    // fall through to env
  }

  const accessToken = await resolveValue(ctx, config.oauth2AccessTokenRef, "X_ACCESS_TOKEN");
  if (!accessToken) return null;
  const refreshToken = await resolveValue(ctx, config.oauth2RefreshTokenRef, "X_REFRESH_TOKEN");
  return { accessToken, refreshToken };
}

async function persistOAuth2Tokens(ctx: PluginContext, tokens: XOAuth2Tokens): Promise<void> {
  await ctx.state.set(
    { scopeKind: "instance", stateKey: "x_oauth2_tokens" },
    tokens,
  );
}

async function resolveCredentials(ctx: PluginContext): Promise<XCredentials> {
  const config = await resolveConfig(ctx);
  const oauth1Candidate: Partial<XOAuth1Credentials> = {
    consumerKey: await resolveValue(ctx, config.consumerKeyRef, "TWITTER_CONSUMER_KEY"),
    consumerSecret: await resolveValue(ctx, config.consumerSecretRef, "TWITTER_CONSUMER_SECRET"),
    accessToken: await resolveValue(ctx, config.accessTokenRef, "TWITTER_ACCESS_TOKEN"),
    accessTokenSecret: await resolveValue(ctx, config.accessTokenSecretRef, "TWITTER_ACCESS_TOKEN_SECRET"),
  };

  const oauth1 = oauth1Candidate.consumerKey &&
    oauth1Candidate.consumerSecret &&
    oauth1Candidate.accessToken &&
    oauth1Candidate.accessTokenSecret
    ? oauth1Candidate as XOAuth1Credentials
    : undefined;

  const oauth2Credentials = await resolveOAuth2Credentials(ctx);
  const oauth2Tokens = await resolveOAuth2Tokens(ctx);

  return {
    bearerToken: await resolveValue(ctx, config.bearerTokenRef, "TWITTER_BEARER_TOKEN"),
    oauth1,
    oauth2: oauth2Credentials
      ? {
          credentials: oauth2Credentials,
          tokens: oauth2Tokens,
        }
      : undefined,
  };
}

async function getClient(ctx: PluginContext): Promise<XApiClient> {
  if (!xClient) {
    const creds = await resolveCredentials(ctx);
    if (!creds.bearerToken && !hasOAuth1Credentials(creds) && !creds.oauth2?.tokens?.accessToken) {
      if (creds.oauth2?.credentials) {
        throw new Error(
          "X not authenticated yet. Run x-auth-start, authorize the app, then call x-auth-callback with the returned code.",
        );
      }
      throw new Error(
        "Missing X credentials: configure TWITTER_BEARER_TOKEN, complete the OAuth 2.0 PKCE flow, or configure the OAuth1 credential set.",
      );
    }
    xClient = new XApiClient(creds);
  }

  const refreshed = await xClient.ensureValidToken();
  if (refreshed) {
    const tokens = xClient.getStoredOAuth2Tokens();
    if (tokens?.accessToken) await persistOAuth2Tokens(ctx, tokens);
  }
  return xClient;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

async function registerTools(ctx: PluginContext): Promise<void> {
  // 1. x-auth-start
  ctx.tools.register(
    TOOL_NAMES.xAuthStart,
    {
      displayName: "X Auth Start",
      description: "Generate an X OAuth 2.0 PKCE authorization URL.",
      parametersSchema: { type: "object", properties: {} },
    },
    async (): Promise<ToolResult> => {
      const creds = await resolveOAuth2Credentials(ctx);
      if (!creds) {
        return {
          error: "X OAuth 2.0 client credentials are missing. Configure X_CLIENT_ID (and optionally X_CLIENT_SECRET).",
        };
      }

      const state = randomBytes(16).toString("hex");
      const codeVerifier = generateCodeVerifier();
      const auth = createOAuth2Auth(creds);
      await auth.setPkceParameters(codeVerifier);
      const authorizationUrl = await auth.getAuthorizationUrl(state);

      await ctx.state.set(
        { scopeKind: "instance", stateKey: "x_oauth_state" },
        state,
      );
      await ctx.state.set(
        { scopeKind: "instance", stateKey: "x_oauth_code_verifier" },
        codeVerifier,
      );

      return {
        content: JSON.stringify({
          message: "Visit the following URL to authorize X access. After authorizing, copy the code from the callback page into x-auth-callback.",
          authorizationUrl,
          redirectUri: creds.redirectUri,
          scopes: creds.scope,
        }, null, 2),
        data: { authorizationUrl, redirectUri: creds.redirectUri, scopes: creds.scope },
      };
    },
  );

  // 2. x-auth-callback
  ctx.tools.register(
    TOOL_NAMES.xAuthCallback,
    {
      displayName: "X Auth Callback",
      description: "Exchange an X authorization code for access and refresh tokens.",
      parametersSchema: {
        type: "object",
        properties: {
          code: { type: "string" },
          state: { type: "string" },
        },
        required: ["code"],
      },
    },
    async (params): Promise<ToolResult> => {
      const { code, state } = params as { code: string; state?: string };
      if (!code) return { error: "code is required" };

      const creds = await resolveOAuth2Credentials(ctx);
      if (!creds) {
        return {
          error: "X OAuth 2.0 client credentials are missing. Configure X_CLIENT_ID (and optionally X_CLIENT_SECRET).",
        };
      }

      let storedState: string | null = null;
      let storedCodeVerifier: string | null = null;
      try {
        storedState = (await ctx.state.get({
          scopeKind: "instance",
          stateKey: "x_oauth_state",
        })) as string | null;
      } catch {
        // ignore
      }
      try {
        storedCodeVerifier = (await ctx.state.get({
          scopeKind: "instance",
          stateKey: "x_oauth_code_verifier",
        })) as string | null;
      } catch {
        // ignore
      }

      if (state && storedState && state !== storedState) {
        return { error: "OAuth state mismatch. Run x-auth-start again and retry the authorization flow." };
      }

      const auth = createOAuth2Auth(creds);
      const token = await auth.exchangeCode(code, storedCodeVerifier ?? undefined);
      const tokens = normalizeOAuth2Token(token);
      await persistOAuth2Tokens(ctx, tokens);
      xClient = null;

      return {
        content: JSON.stringify({
          message: "X authorization successful. Access token stored.",
          hasRefreshToken: !!tokens.refreshToken,
          expiresAt: tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : "unknown",
          scopes: token.scope ?? null,
        }, null, 2),
        data: {
          success: true,
          hasRefreshToken: !!tokens.refreshToken,
          expiresAt: tokens.expiresAt,
          scope: token.scope ?? null,
        },
      };
    },
  );

  // 3. x-create-post
  ctx.tools.register(
    TOOL_NAMES.xCreatePost,
    {
      displayName: "X Create Post",
      description: "Create a new text post on X.",
      parametersSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          replyToPostId: { type: "string" },
        },
        required: ["text"],
      },
    },
    async (params): Promise<ToolResult> => {
      const { text, replyToPostId } = params as { text: string; replyToPostId?: string };
      if (!text) return { error: "text is required" };
      const client = await getClient(ctx);
      const result = await client.createPost(text, replyToPostId ? { replyToPostId } : undefined) as {
        data?: { id?: string; text?: string };
      };
      const id = result?.data?.id ?? null;
      const url = id ? `https://x.com/i/web/status/${id}` : null;
      return {
        content: JSON.stringify({
          message: "Post created successfully on X.",
          id,
          text: result?.data?.text ?? text,
          url,
        }, null, 2),
        data: { ...result, url },
      };
    },
  );

  // 4. x-create-thread
  ctx.tools.register(
    TOOL_NAMES.xCreateThread,
    {
      displayName: "X Create Thread",
      description: "Create an X thread by replying each post to the previous one.",
      parametersSchema: {
        type: "object",
        properties: {
          posts: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
          },
        },
        required: ["posts"],
      },
    },
    async (params): Promise<ToolResult> => {
      const { posts } = params as { posts?: unknown };
      if (!Array.isArray(posts)) return { error: "posts must be an array of strings" };
      const normalizedPosts = posts
        .map((post) => typeof post === "string" ? post.trim() : "")
        .filter(Boolean);
      if (normalizedPosts.length < 2) return { error: "x-create-thread requires at least two posts" };

      const client = await getClient(ctx);
      const result = await client.createThread(normalizedPosts);
      return {
        content: JSON.stringify({
          message: "Thread created successfully on X.",
          rootId: result.rootId,
          lastId: result.lastId,
          url: result.url,
          posts: result.posts,
        }, null, 2),
        data: result,
      };
    },
  );

  // 5. x-get-me
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

  // 5. x-get-user-tweets
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

  // 6. x-search
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

  // 7. x-get-followers
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

  // 8. x-get-mentions
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
    const hasEnvOAuth2Client = !!process.env.X_CLIENT_ID;
    const hasEnvOAuth2Token = !!process.env.X_ACCESS_TOKEN;
    const hasEnvOAuth1Creds =
      !!process.env.TWITTER_CONSUMER_KEY &&
      !!process.env.TWITTER_CONSUMER_SECRET &&
      !!process.env.TWITTER_ACCESS_TOKEN &&
      !!process.env.TWITTER_ACCESS_TOKEN_SECRET;
    const hasEnvBearer = !!process.env.TWITTER_BEARER_TOKEN;
    const hasEnvCreds = hasEnvBearer || hasEnvOAuth1Creds || hasEnvOAuth2Token;
    return {
      status: hasEnvCreds || xClient ? "ok" : "degraded",
      message: hasEnvCreds || xClient
        ? "X connector ready with XDK-backed credentials"
        : "X credentials not configured — set TWITTER_BEARER_TOKEN, complete OAuth 2.0 PKCE, or configure OAuth1 env vars/plugin secret refs",
      details: {
        pluginId: PLUGIN_ID,
        clientInitialized: !!xClient,
        envBearerDetected: hasEnvBearer,
        envOAuth2ClientDetected: hasEnvOAuth2Client,
        envOAuth2TokenDetected: hasEnvOAuth2Token,
        envOAuth1Detected: hasEnvOAuth1Creds,
      },
    };
  },

  async onConfigChanged() {
    xClient = null;
  },

  async onShutdown() {
    xClient = null;
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
