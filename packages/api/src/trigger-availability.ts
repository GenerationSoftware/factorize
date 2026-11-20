export type EventAvailability = {
  manual: true;
  schedule: true;
  triggerLifecycle: true;
  linear: boolean;
  clickup: boolean;
  github: boolean;
  cloudflareTail: boolean;
};

export const installedEventAvailability = (linearConnected: boolean, clickupConnected: boolean, githubStates: string[], tailInstallationCount: number): EventAvailability => ({
  manual: true,
  schedule: true,
  triggerLifecycle: true,
  linear: linearConnected,
  clickup: clickupConnected,
  github: githubStates.some(state => state === "active"),
  cloudflareTail: tailInstallationCount > 0,
});

export const sameProviderReference = (next: Record<string, any>, previous: Record<string, any>): boolean => {
  if (next.provider !== previous.provider) return false;
  if (next.provider === "github") return Number(next.installationId) === Number(previous.installationId);
  if (next.provider === "cloudflareTail") return next.integrationId === previous.integrationId;
  if (next.provider === "clickup") return true;
  return next.provider === "linear";
};
