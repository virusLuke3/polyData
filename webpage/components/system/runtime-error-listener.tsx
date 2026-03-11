"use client";

import { useEffect } from "react";

import { logError, logInfo } from "@/lib/logger";

export function RuntimeErrorListener() {
  useEffect(() => {
    logInfo("runtime", "browser runtime listeners attached");

    const onError = (event: ErrorEvent) => {
      logError("runtime", "unhandled window error", event.error ?? event.message, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      logError("runtime", "unhandled promise rejection", event.reason);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}