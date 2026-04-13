import {
  definePlugin,
  runWorker,
  type PaperclipPlugin,
  type PluginContext,
  type PluginHealthDiagnostics,
  type ToolResult,
} from "@paperclipai/plugin-sdk";
import { randomBytes } from "node:crypto";
import { DEFAULT_CONFIG, PLUGIN_ID, TOOL_NAMES } from "./constants.js";
import {
  LinkedInApiClient,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  type LinkedInCredentials,
  type LinkedInTokens,
} from "./linkedin-client.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

type LinkedInConfig = {
  clientIdRef?: string;
  clientSecretRef?: string;
  accessTokenRef?: string;
  refreshTokenRef?: string;
  redirectUri?: string;
};

// ---------------------------------------------------------------------------
// Credential resolution
// ---------------------------------------------------------------------------

let linkedInClient: LinkedInApiClient | null = null;

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

async function resolveOptionalValue(
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
  return process.env[envFallback] || undefined;
}

async function resolveCredentials(ctx: PluginContext): Promise<LinkedInCredentials> {
  const config: LinkedInConfig = {
    ...DEFAULT_CONFIG,
    ...((await ctx.config.get()) as LinkedInConfig),
  };
  return {
    clientId: await resolveValue(ctx, config.clientIdRef, "LINKEDIN_CONSUMER_KEY"),
    clientSecret: await resolveValue(ctx, config.clientSecretRef, "LINKEDIN_CONSUMER_SECRET"),
    redirectUri: config.redirectUri || process.env.LINKEDIN_REDIRECT_URI || "http://localhost:3100/api/oauth/linkedin/callback",
  };
}

async function resolveTokens(ctx: PluginContext): Promise<LinkedInTokens | null> {
  const config: LinkedInConfig = {
    ...DEFAULT_CONFIG,
    ...((await ctx.config.get()) as LinkedInConfig),
  };

  // First, try to load tokens from plugin state (stored by auth flow)
  try {
    const storedTokens = (await ctx.state.get({
      scopeKind: "instance",
      stateKey: "linkedin_tokens",
    })) as LinkedInTokens | null;
    if (storedTokens?.accessToken) return storedTokens;
  } catch {
    // state not available, fall through
  }

  // Fall back to env vars / secret refs
  const accessToken = await resolveOptionalValue(ctx, config.accessTokenRef, "LINKEDIN_ACCESS_TOKEN");
  if (!accessToken) return null;

  const refreshToken = await resolveOptionalValue(ctx, config.refreshTokenRef, "LINKEDIN_REFRESH_TOKEN");
  return { accessToken, refreshToken };
}

async function getClient(ctx: PluginContext): Promise<LinkedInApiClient> {
  if (linkedInClient) {
    const refreshed = await linkedInClient.ensureValidToken();
    if (refreshed) {
      await ctx.state.set(
        { scopeKind: "instance", stateKey: "linkedin_tokens" },
        { accessToken: linkedInClient.accessToken },
      );
    }
    return linkedInClient;
  }

  const creds = await resolveCredentials(ctx);
  const tokens = await resolveTokens(ctx);
  if (!tokens) {
    throw new Error(
      "LinkedIn not authenticated. Run the linkedin-auth-start tool first, authorize, then call linkedin-auth-callback with the code.",
    );
  }

  linkedInClient = new LinkedInApiClient(creds, tokens);
  return linkedInClient;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

async function registerTools(ctx: PluginContext): Promise<void> {
  // 1. linkedin-auth-start
  ctx.tools.register(
    TOOL_NAMES.linkedinAuthStart,
    {
      displayName: "LinkedIn Auth Start",
      description: "Generate a LinkedIn OAuth 2.0 authorization URL.",
      parametersSchema: { type: "object", properties: {} },
    },
    async (): Promise<ToolResult> => {
      const creds = await resolveCredentials(ctx);
      const state = randomBytes(16).toString("hex");
      await ctx.state.set(
        { scopeKind: "instance", stateKey: "linkedin_oauth_state" },
        state,
      );
      const url = buildAuthorizationUrl(creds, state);
      return {
        content: JSON.stringify({
          message: "Visit the following URL to authorize LinkedIn access. After authorizing, you will be redirected with an authorization code. Provide that code to the linkedin-auth-callback tool.",
          authorizationUrl: url,
          redirectUri: creds.redirectUri,
        }, null, 2),
        data: { authorizationUrl: url, redirectUri: creds.redirectUri },
      };
    },
  );

  // 2. linkedin-auth-callback
  ctx.tools.register(
    TOOL_NAMES.linkedinAuthCallback,
    {
      displayName: "LinkedIn Auth Callback",
      description: "Exchange an authorization code for LinkedIn access tokens.",
      parametersSchema: {
        type: "object",
        properties: { code: { type: "string" } },
        required: ["code"],
      },
    },
    async (params): Promise<ToolResult> => {
      const { code } = params as { code: string };
      if (!code) return { error: "code is required" };

      const creds = await resolveCredentials(ctx);
      const tokens = await exchangeCodeForTokens(creds, code);
      await ctx.state.set(
        { scopeKind: "instance", stateKey: "linkedin_tokens" },
        tokens,
      );

      linkedInClient = null;

      return {
        content: JSON.stringify({
          message: "LinkedIn authorization successful! Access token stored.",
          hasRefreshToken: !!tokens.refreshToken,
          expiresAt: tokens.expiresAt
            ? new Date(tokens.expiresAt).toISOString()
            : "unknown",
        }, null, 2),
        data: { success: true, hasRefreshToken: !!tokens.refreshToken },
      };
    },
  );

  // 3. linkedin-get-me
  ctx.tools.register(
    TOOL_NAMES.linkedinGetMe,
    {
      displayName: "LinkedIn Get My Profile",
      description: "Get the authenticated LinkedIn user profile via OpenID userinfo.",
      parametersSchema: { type: "object", properties: {} },
    },
    async (): Promise<ToolResult> => {
      const client = await getClient(ctx);
      const result = await client.getMe();
      return { content: JSON.stringify(result, null, 2), data: result };
    },
  );

  // 4. linkedin-create-post
  ctx.tools.register(
    TOOL_NAMES.linkedinCreatePost,
    {
      displayName: "LinkedIn Create Post",
      description: "Create a new text post on LinkedIn.",
      parametersSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          visibility: { type: "string", enum: ["PUBLIC", "CONNECTIONS"] },
        },
        required: ["text"],
      },
    },
    async (params): Promise<ToolResult> => {
      const { text, visibility } = params as { text: string; visibility?: "PUBLIC" | "CONNECTIONS" };
      if (!text) return { error: "text is required" };
      const client = await getClient(ctx);
      const result = await client.createPost(text, visibility ?? "PUBLIC");
      return {
        content: JSON.stringify({
          message: "Post created successfully on LinkedIn.",
          ...result as object,
        }, null, 2),
        data: result,
      };
    },
  );

  // 5. linkedin-delete-post
  ctx.tools.register(
    TOOL_NAMES.linkedinDeletePost,
    {
      displayName: "LinkedIn Delete Post",
      description: "Delete a LinkedIn post by URN.",
      parametersSchema: {
        type: "object",
        properties: { postUrn: { type: "string" } },
        required: ["postUrn"],
      },
    },
    async (params): Promise<ToolResult> => {
      const { postUrn } = params as { postUrn: string };
      if (!postUrn) return { error: "postUrn is required" };
      const client = await getClient(ctx);
      await client.deletePost(postUrn);
      return {
        content: JSON.stringify({ message: "Post deleted successfully.", postUrn }, null, 2),
        data: { success: true, postUrn },
      };
    },
  );

  // 6. linkedin-get-reactions
  ctx.tools.register(
    TOOL_NAMES.linkedinGetReactions,
    {
      displayName: "LinkedIn Get Reactions",
      description: "Get reactions for a specific LinkedIn post.",
      parametersSchema: {
        type: "object",
        properties: { entityUrn: { type: "string" } },
        required: ["entityUrn"],
      },
    },
    async (params): Promise<ToolResult> => {
      const { entityUrn } = params as { entityUrn: string };
      if (!entityUrn) return { error: "entityUrn is required" };
      const client = await getClient(ctx);
      const result = await client.getReactions(entityUrn);
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
      !!process.env.LINKEDIN_CONSUMER_KEY &&
      !!process.env.LINKEDIN_CONSUMER_SECRET;
    const hasAccessToken = !!process.env.LINKEDIN_ACCESS_TOKEN || !!linkedInClient;
    return {
      status: hasAccessToken ? "ok" : hasEnvCreds ? "degraded" : "degraded",
      message: hasAccessToken
        ? "LinkedIn Connector plugin ready"
        : hasEnvCreds
          ? "LinkedIn credentials found but not yet authorized — run linkedin-auth-start"
          : "LinkedIn credentials not configured — set env vars or plugin secret refs",
      details: {
        pluginId: PLUGIN_ID,
        clientInitialized: !!linkedInClient,
        envCredentialsDetected: hasEnvCreds,
        hasAccessToken,
      },
    };
  },

  async onConfigChanged() {
    linkedInClient = null;
  },

  async onShutdown() {
    linkedInClient = null;
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
