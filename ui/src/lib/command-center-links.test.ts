import { describe, expect, it } from "vitest";
import {
  isExternalCommandCenterHref,
  normalizeCommandCenterHref,
} from "./command-center-links";

describe("command center links", () => {
  it("normalizes Paperclip app board URLs to company-relative paths", () => {
    expect(normalizeCommandCenterHref("https://app.paperclip.ing/ACENT/issues/ACE-219#document-plan")).toBe(
      "/issues/ACE-219#document-plan",
    );
    expect(normalizeCommandCenterHref("https://app.paperclip.ing/ACENT/command-center?tab=review")).toBe(
      "/command-center?tab=review",
    );
  });

  it("normalizes same-origin and loopback board URLs", () => {
    expect(normalizeCommandCenterHref("http://localhost:3100/ACENT/projects/project-1")).toBe(
      "/projects/project-1",
    );
    expect(normalizeCommandCenterHref("http://127.0.0.1:3100/issues/ACE-219?tab=documents")).toBe(
      "/issues/ACE-219?tab=documents",
    );
  });

  it("keeps external evidence URLs absolute", () => {
    expect(normalizeCommandCenterHref("https://www.acent.com/blog/8211")).toBe("https://www.acent.com/blog/8211");
    expect(normalizeCommandCenterHref("https://x.com/i/web/status/2046425694436249985")).toBe(
      "https://x.com/i/web/status/2046425694436249985",
    );
  });

  it("classifies normalized internal links as non-external", () => {
    expect(isExternalCommandCenterHref("https://app.paperclip.ing/ACENT/issues/ACE-219")).toBe(false);
    expect(isExternalCommandCenterHref("https://www.acent.com/blog/8211")).toBe(true);
  });
});
