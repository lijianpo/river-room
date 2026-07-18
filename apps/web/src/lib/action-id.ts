interface RandomUuidSource {
  randomUUID?: () => string;
}

let fallbackSequence = 0;

export function createActionId(source: RandomUuidSource | null = globalThis.crypto ?? null): string {
  if (typeof source?.randomUUID === 'function') return source.randomUUID();
  fallbackSequence = (fallbackSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `action-${Date.now().toString(36)}-${fallbackSequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
