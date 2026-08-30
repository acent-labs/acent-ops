// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingWizardVariant } from "./OnboardingWizardVariant";

let onboardingOpen = false;
let pathname = "/PAP/dashboard";

vi.mock("@/lib/router", () => ({
  useLocation: () => ({ pathname }),
}));

vi.mock("../context/DialogContext", () => ({
  useDialogState: () => ({ onboardingOpen }),
}));

vi.mock("./OnboardingWizard", () => ({
  OnboardingWizard: () => <div data-testid="wizard-capsule" />,
}));

describe("OnboardingWizardVariant (PAP-138)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  function renderVariant() {
    root = createRoot(container);
    flushSync(() => {
      root!.render(<OnboardingWizardVariant />);
    });
  }

  beforeEach(() => {
    onboardingOpen = false;
    pathname = "/PAP/dashboard";
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    flushSync(() => {
      root?.unmount();
    });
    root = null;
    container.remove();
    vi.clearAllMocks();
  });

  it("does not load the wizard on ordinary routes", () => {
    renderVariant();

    expect(container.querySelector('[data-testid="wizard-capsule"]')).toBeNull();
  });

  it("renders the capsule wizard when opened", async () => {
    onboardingOpen = true;
    renderVariant();

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="wizard-capsule"]')).not.toBeNull();
    });
  });
});
