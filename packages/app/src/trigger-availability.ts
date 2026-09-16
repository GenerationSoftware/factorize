export type TriggerAvailability = {
  manual: true;
  schedule: true;
  jobLifecycle: true;
  linear: boolean;
  github: boolean;
  cloudflareTail: boolean;
};

export const installedTriggerAvailability = (linearConnected: boolean, githubStates: string[], tailInstallationCount: number): TriggerAvailability => ({
  manual: true,
  schedule: true,
  jobLifecycle: true,
  linear: linearConnected,
  github: githubStates.some(state => state === "active"),
  cloudflareTail: tailInstallationCount > 0,
});

export const sameProviderReference = (next: Record<string, any>, previous: Record<string, any>): boolean => {
  if (next.provider !== previous.provider) return false;
  if (next.provider === "github") return Number(next.installationId) === Number(previous.installationId);
  if (next.provider === "cloudflareTail") return next.integrationId === previous.integrationId;
  return next.provider === "linear";
};
