import { Router } from "express";

/**
 * LinkedIn OAuth 2.0 callback route.
 *
 * After the user authorizes the app on LinkedIn, they are redirected here
 * with `?code=<auth_code>&state=<state>`. The page displays the code so
 * the agent can call the `linkedin-auth-callback` tool with it.
 */
export function oauthLinkedInRoutes(): Router {
  const router = Router();

  router.get("/oauth/linkedin/callback", (req, res) => {
    const code = req.query.code as string | undefined;
    const error = req.query.error as string | undefined;
    const errorDescription = req.query.error_description as string | undefined;

    if (error) {
      res.status(400).type("html").send(/* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>LinkedIn Authorization Failed</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 600px; margin: 80px auto; padding: 0 20px; color: #333; }
    .error { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 20px; }
    h1 { color: #dc2626; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="error">
    <h1>Authorization Failed</h1>
    <p><strong>Error:</strong> <code>${error}</code></p>
    ${errorDescription ? `<p>${errorDescription}</p>` : ""}
    <p>Please try the authorization flow again.</p>
  </div>
</body>
</html>`);
      return;
    }

    if (!code) {
      res.status(400).type("html").send(/* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>LinkedIn Authorization</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 600px; margin: 80px auto; padding: 0 20px; color: #333; }
    .warn { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 20px; }
  </style>
</head>
<body>
  <div class="warn">
    <h1>No Authorization Code</h1>
    <p>No authorization code was received from LinkedIn. Please try the authorization flow again.</p>
  </div>
</body>
</html>`);
      return;
    }

    res.type("html").send(/* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>LinkedIn Authorization Successful</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 600px; margin: 80px auto; padding: 0 20px; color: #333; }
    .success { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px; }
    h1 { color: #16a34a; }
    .code-box { background: #1e293b; color: #e2e8f0; padding: 16px; border-radius: 8px; font-family: "SF Mono", Monaco, Consolas, monospace; font-size: 14px; word-break: break-all; user-select: all; cursor: pointer; position: relative; }
    .code-box:hover { background: #334155; }
    .hint { color: #6b7280; font-size: 14px; margin-top: 8px; }
    .copied { position: absolute; top: -30px; right: 0; background: #16a34a; color: white; padding: 4px 12px; border-radius: 4px; font-size: 12px; opacity: 0; transition: opacity 0.2s; }
    .copied.show { opacity: 1; }
  </style>
</head>
<body>
  <div class="success">
    <h1>LinkedIn Authorization Successful</h1>
    <p>Copy the authorization code below and provide it to the agent:</p>
    <div class="code-box" id="codeBox" onclick="copyCode()">
      <span class="copied" id="copiedMsg">Copied!</span>
      ${code}
    </div>
    <p class="hint">Click the code to copy it. Then paste it into the <code>linkedin-auth-callback</code> tool.</p>
    <p class="hint">You can close this tab after copying the code.</p>
  </div>
  <script>
    function copyCode() {
      navigator.clipboard.writeText("${code}").then(() => {
        const msg = document.getElementById("copiedMsg");
        msg.classList.add("show");
        setTimeout(() => msg.classList.remove("show"), 2000);
      });
    }
  </script>
</body>
</html>`);
  });

  return router;
}
