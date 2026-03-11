"use client";

import { useEffect } from "react";

import { logError } from "@/lib/logger";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    logError("route", "route segment crashed", error, { digest: error.digest });
  }, [error]);

  return (
    <div className="rounded-[2rem] border border-red-200 bg-red-50/80 p-8 shadow-panel backdrop-blur">
      <div className="space-y-4">
        <div className="text-sm font-semibold uppercase tracking-[0.24em] text-red-700">Page Error</div>
        <h2 className="font-serif text-3xl font-semibold tracking-tight text-red-950">页面渲染失败</h2>
        <p className="max-w-2xl text-sm text-red-900/80">
          终端和浏览器控制台已经输出错误日志。{error.digest ? `错误摘要: ${error.digest}` : "请查看完整堆栈信息定位问题。"}
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
  );
}