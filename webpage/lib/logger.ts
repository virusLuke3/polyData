const LOG_PREFIX = "[polyData:web]";

function toErrorPayload(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return { value: error };
}

export function logInfo(scope: string, message: string, meta?: Record<string, unknown>) {
  console.info(`${LOG_PREFIX}[${scope}] ${message}`, meta ?? {});
}

export function logError(scope: string, message: string, error?: unknown, meta?: Record<string, unknown>) {
  console.error(`${LOG_PREFIX}[${scope}] ${message}`, {
    ...(meta ?? {}),
    ...(error === undefined ? {} : { error: toErrorPayload(error) })
  });
}