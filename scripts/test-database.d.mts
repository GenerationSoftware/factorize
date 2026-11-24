export function cloneTestDatabase(templateUrl: string): Promise<{ url: string; close(): Promise<void> }>;
