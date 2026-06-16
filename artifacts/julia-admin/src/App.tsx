import { useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Leads from "@/pages/leads";
import LeadDetail from "@/pages/lead-detail";
import Settings from "@/pages/settings";
import Login from "@/pages/login";
import { checkAuth } from "@/lib/auth-api";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/leads" component={Leads} />
        <Route path="/leads/:id" component={LeadDetail} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  const [authState, setAuthState] = useState<"loading" | "in" | "out">(
    "loading",
  );

  useEffect(() => {
    checkAuth().then((ok) => setAuthState(ok ? "in" : "out"));
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {authState === "loading" ? (
          <div className="flex min-h-screen items-center justify-center bg-muted/30">
            <Loader2 className="animate-spin text-muted-foreground" size={28} />
          </div>
        ) : authState === "out" ? (
          <Login onSuccess={() => setAuthState("in")} />
        ) : (
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        )}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
