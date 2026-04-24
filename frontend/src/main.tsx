import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import App from "./App";
import AuthTokenBridge from "./components/AuthTokenBridge";
import { ErrorBoundary } from "./ErrorBoundary";
import "./styles.css";

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

function Root() {
  if (!CLERK_PUBLISHABLE_KEY) {
    // Render without Clerk so the rest of the app still loads in dev without auth.
    // The UI auth controls will hide themselves when Clerk is not initialised.
    // eslint-disable-next-line no-console
    console.warn("[auth] VITE_CLERK_PUBLISHABLE_KEY is not set — Clerk is disabled.");
    return <App />;
  }
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <AuthTokenBridge />
      <App />
    </ClerkProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>
);
