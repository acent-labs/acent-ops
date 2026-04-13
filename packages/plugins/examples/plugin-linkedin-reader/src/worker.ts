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

type LinkedInReaderConfig = {
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
  const config: LinkedInReaderConfig = {
    ...DEFAULT_CONFIG,
    ...((await ctx.config.get()) as LinkedInReaderConfig),
  };
  return {
    clientId: await resolveValue(ctx, config.clientIdRef, "LINKEDIN_CONSUMER_KEY"),
    clientSecret: await resolveValue(ctx, config.clientSecretRef, "LINKEDIN_CONSUMER_SECRET"),
    redirectUri: config.redirectUri || process.env.LINKEDIN_REDIRECT_URI || "http://localhost:3100/api/oauth/linkedin/callback",
  };
}

async function resolveTokens(ctx: PluginContext): Promise<LinkedInTokens | null> {
  const config: LinkedInReaderConfig = {
    ...DEFAULT_CONFIG,
    ...((await ctx.config.get()) as LinkedInReaderConfig),
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
          message: "Visit the following URL to authorize LinkedIn access. After authorizing, you will be redirected to the callback URL with an authorization code. Provide that code to the linkedin-auth-callback tool.",
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
        properties: {
          code: { type: "string" },
        },
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

      // Reset client so it picks up new tokens
      linkedInClient = null;

      return {
        content: JSON.stringify({
          message: "LinkedIn authorization successful! Access token stored. You can now use other LinkedIn tools.",
          hasRefreshToken: !!tokens.refreshToken,
          expiresAt: tokens.expiresAt
            ? new Date(tokens.expiresAt).toISOString()
            : "unknown",
        }, null, 2),
        data: {
          success: true,
          hasRefreshToken: !!tokens.refreshToken,
        },
      };
    },
  );

  // 3. linkedin-get-me
  ctx.tools.register(
    TOOL_NAMES.linkedinGetMe,
    {
      displayName: "LinkedIn Get My Profile",
      description: "Get the authenticated LinkedIn user profile.",
      parametersSchema: { type: "object", properties: {} },
    },
    async (): Promise<ToolResult> => {
      const client = await getClient(ctx);
      const userinfo = await client.getMe();
      const profile = await client.getProfile();
      const result = { userinfo, profile };
      return { content: JSON.stringify(result, null, 2), data: result };
    },
  );

  // 4. linkedin-get-posts
  ctx.tools.register(
    TOOL_NAMES.linkedinGetPosts,
    {
      displayName: "LinkedIn Get Posts",
      description: "Get recent posts with engagement data.",
      parametersSchema: {
        type: "object",
        properties: {
          authorUrn: { type: "string" },
          count: { type: "number" },
        },
      },
    },
    async (params): Promise<ToolResult> => {
      const { authorUrn, count } = params as { authorUrn?: string; count?: number };
      const client = await getClient(ctx);
      const result = await client.getPosts(authorUrn, count);
      return { content: JSON.stringify(result, null, 2), data: result };
    },
  );

  // 5. linkedin-get-organization
  ctx.tools.register(
    TOOL_NAMES.linkedinGetOrganization,
    {
      displayName: "LinkedIn Get Organization",
      description: "Get a LinkedIn organization (company page) profile.",
      parametersSchema: {
        type: "object",
        properties: {
          orgId: { type: "string" },
        },
        required: ["orgId"],
      },
    },
    async (params): Promise<ToolResult> => {
      const { orgId } = params as { orgId: string };
      if (!orgId) return { error: "orgId is required" };
      const client = await getClient(ctx);
      const org = await client.getOrganization(orgId);
      const posts = await client.getOrganizationPosts(orgId);
      const result = { organization: org, recentPosts: posts };
      return { content: JSON.stringify(result, null, 2), data: result };
    },
  );

  // 6. linkedin-get-post-analytics
  ctx.tools.register(
    TOOL_NAMES.linkedinGetPostAnalytics,
    {
      displayName: "LinkedIn Get Post Analytics",
      description: "Get engagement analytics for specific LinkedIn posts.",
      parametersSchema: {
        type: "object",
        properties: {
          postUrns: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["postUrns"],
      },
    },
    async (params): Promise<ToolResult> => {
      const { postUrns } = params as { postUrns: string[] };
      if (!postUrns?.length) return { error: "postUrns array is required" };
      const client = await getClient(ctx);
      const result = await client.getPostAnalytics(postUrns);
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
        ? "LinkedIn Reader plugin ready"
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
