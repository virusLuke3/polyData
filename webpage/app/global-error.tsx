"use client";

import { useEffect } from "react";

import { logError } from "@/lib/logger";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    logError("global", "application crashed", error, { digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-[#fffaf3] p-6 text-[#2b2118]">
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-red-200 bg-white p-8 shadow-panel">
          <div className="space-y-4">
            <div className="text-sm font-semibold uppercase tracking-[0.24em] text-red-700">Fatal Error</div>
            <h1 className="font-serif text-4xl font-semibold tracking-tight text-red-950">应用启动后发生未恢复异常</h1>
            <p className="text-sm text-red-900/80">
              错误已写入浏览器控制台和 Next.js 服务端日志。{error.digest ? `错误摘要: ${error.digest}` : "请查看完整堆栈。"}
            </p>
            <button
              type="button"
              onClick={() => reset()}
              className="inline-flex rounded-full bg-red-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-800"
            >
              Retry
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}