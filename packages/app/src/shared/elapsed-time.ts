type ElapsedTime = { duration: number } | { low: number; high: number };

const formatSeconds = (seconds: number) => {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60), remainder = seconds % 60;
  if (minutes < 60) return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60), remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};

export const formatElapsedTime = (elapsed: ElapsedTime) => "duration" in elapsed
  ? formatSeconds(elapsed.duration)
  : `${formatSeconds(elapsed.low)}–${formatSeconds(elapsed.high)}`;
