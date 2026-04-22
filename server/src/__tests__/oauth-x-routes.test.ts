import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { oauthXRoutes } from "../routes/oauth-x.js";

function createApp() {
  const app = express();
  app.use("/api", oauthXRoutes());
  return app;
}

describe("oauth x routes", () => {
  it("renders the authorization code when X redirects successfully", async () => {
    const res = await request(createApp()).get("/api/oauth/x/callback?code=test-code-123&state=state-456");

    expect(res.status).toBe(200);
    expect(res.text).toContain("X Authorization Successful");
    expect(res.text).toContain("test-code-123");
    expect(res.text).toContain("state-456");
    expect(res.text).toContain("x-auth-callback");
  });

  it("renders an error page when X returns an OAuth error", async () => {
    const res = await request(createApp()).get("/api/oauth/x/callback?error=access_denied&error_description=Denied");

    expect(res.status).toBe(400);
    expect(res.text).toContain("Authorization Failed");
    expect(res.text).toContain("access_denied");
    expect(res.text).toContain("Denied");
  });

  it("warns when the callback is missing the authorization code", async () => {
    const res = await request(createApp()).get("/api/oauth/x/callback");

    expect(res.status).toBe(400);
    expect(res.text).toContain("No Authorization Code");
  });
});
