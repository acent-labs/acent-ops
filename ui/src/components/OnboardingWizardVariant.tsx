import { lazy, Suspense } from "react";
import { useLocation } from "@/lib/router";
import { useDialogState } from "../context/DialogContext";
import { PaperclipLoading } from "./AnimatedPaperclipIcon";

const OnboardingWizard = lazy(() =>
  import("./OnboardingWizard").then((module) => ({ default: module.OnboardingWizard })),
);

/**
 * Default onboarding wizard. Conference-room chat is now the only surface left
 * behind `enableConferenceRoomChat`; onboarding stays available without that
 * experimental flag.
 */
export function OnboardingWizardVariant() {
  const { onboardingOpen } = useDialogState();
  const location = useLocation();
  const routeOpen = /^(?:\/[^/]+)?\/onboarding\/?$/.test(location.pathname);
  if (!onboardingOpen && !routeOpen) return null;
  return (
    <Suspense fallback={<PaperclipLoading />}>
      <OnboardingWizard />
    </Suspense>
  );
}
