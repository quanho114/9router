"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * OAuth Callback Page Content
 */
function CallbackContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("processing");
  const [callbackUrl, setCallbackUrl] = useState("");

  useEffect(() => {
    // SSR and the first client render must both show an empty URL.
    const timer = setTimeout(() => setCallbackUrl(window.location.href), 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const code = searchParams.get("code");
    const token = searchParams.get("token");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    const callbackData = {
      code,
      token,
      state,
      error,
      errorDescription,
      fullUrl: window.location.href,
    };

    // Keep the URL available until the dashboard confirms the account was saved.
    let completed = false;
    // Give automatic exchange time to finish before offering manual recovery.
    const fallbackTimer = setTimeout(() => {
      if (!completed) setStatus("manual");
    }, error || !(code || token) ? 0 : 5000);
    let channel;
    let closeTimer;
    let doneTimer;
    const acceptCompletion = (data) => {
      if (completed || !state || data?.type !== "oauth_complete" || data.state !== state) return;
      completed = true;
      clearTimeout(fallbackTimer);
      setStatus("success");
      closeTimer = setTimeout(() => {
        window.close();
        doneTimer = setTimeout(() => setStatus("done"), 500);
      }, 1500);
    };
    const handleMessage = (event) => {
      if (event.origin !== window.location.origin || event.source !== window.opener) return;
      acceptCompletion(event.data);
    };
    const handleStorage = (event) => {
      if (event.key !== "oauth_completion" || !event.newValue) return;
      try { acceptCompletion(JSON.parse(event.newValue)); } catch {}
    };
    window.addEventListener("message", handleMessage);
    window.addEventListener("storage", handleStorage);
    try {
      channel = new BroadcastChannel("oauth_completion");
      channel.onmessage = (event) => acceptCompletion(event.data);
    } catch {}
    const relay = () => {
      if (completed) return;
      try {
        window.opener?.postMessage({ type: "oauth_callback", data: callbackData }, window.location.origin);
      } catch {}
      try {
        const callbacks = new BroadcastChannel("oauth_callback");
        callbacks.postMessage(callbackData);
        callbacks.close();
      } catch {}
      try {
        localStorage.setItem("oauth_callback", JSON.stringify({ ...callbackData, timestamp: Date.now() }));
      } catch {}
    };
    relay();
    // Retry briefly in case the dashboard listener is still mounting.
    const retryTimer = setInterval(relay, 1000);
    const stopTimer = setTimeout(() => clearInterval(retryTimer), 30000);
    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("storage", handleStorage);
      channel?.close();
      clearInterval(retryTimer);
      clearTimeout(stopTimer);
      clearTimeout(closeTimer);
      clearTimeout(doneTimer);
      clearTimeout(fallbackTimer);
    };
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="text-center p-8 max-w-md">
        {status === "processing" && (
          <>
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">progress_activity</span>
            </div>
            <h1 className="text-xl font-semibold mb-2">Processing...</h1>
            <p className="text-text-muted">Please wait while we complete the authorization.</p>
          </>
        )}

        {(status === "success" || status === "done") && (
          <>
            <div className="size-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-green-600">check_circle</span>
            </div>
            <h1 className="text-xl font-semibold mb-2">Authorization Successful!</h1>
            <p className="text-text-muted">
              {status === "success" ? "This window will close automatically..." : "You can close this tab now."}
            </p>
          </>
        )}

        {status === "manual" && (
          <>
            <div className="size-16 mx-auto mb-4 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-yellow-600">info</span>
            </div>
            <h1 className="text-xl font-semibold mb-2">Copy This URL</h1>
            <p className="text-text-muted mb-4">
              Automatic sign-in has not completed. Copy this URL and paste it into Step 2 to continue manually. This tab stays open until the account is saved.
            </p>
            <div className="bg-surface border border-border rounded-lg p-3 text-left">
              <code className="text-xs break-all">{callbackUrl}</code>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * OAuth Callback Page
 * Receives callback from OAuth providers and sends data back via multiple methods
 */
export default function CallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="text-center p-8">
          <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-3xl text-primary animate-spin">progress_activity</span>
          </div>
          <p className="text-text-muted">Loading...</p>
        </div>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  );
}
