import { describe, expect, it, vi } from "vitest";
import {
  buildWorkProductSteeringPayload,
} from "./DeliverablesPanel";

vi.mock("@/lib/router", () => ({
  Link: () => null,
}));

describe("DeliverablesPanel helpers", () => {
  it("omits stale channel metadata for comment and request-changes steering", () => {
    expect(buildWorkProductSteeringPayload({
      action: "comment",
      comment: "Open link still points at app.paperclip.ing.",
      channel: "blog_post",
      openClawAgentId: "",
    })).toEqual({
      action: "comment",
      comment: "Open link still points at app.paperclip.ing.",
    });

    expect(buildWorkProductSteeringPayload({
      action: "request_changes",
      comment: "Use relative Paperclip paths.",
      channel: "internal",
      openClawAgentId: "",
    })).toEqual({
      action: "request_changes",
      comment: "Use relative Paperclip paths.",
    });
  });

  it("keeps valid channels for channel-aware steering actions", () => {
    expect(buildWorkProductSteeringPayload({
      action: "queue_for_publish",
      comment: "",
      channel: "blog",
      openClawAgentId: "",
    })).toEqual({
      action: "queue_for_publish",
      channel: "blog",
    });
  });
});
