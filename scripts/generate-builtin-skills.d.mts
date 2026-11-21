export const skillNames: string[];
export function renderBuiltinSkills(directory?: string): Promise<string>;
export function generateBuiltinSkills(options?: {check?: boolean; output?: string; directory?: string}): Promise<void>;
