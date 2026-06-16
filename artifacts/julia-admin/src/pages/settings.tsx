import { Settings as SettingsIcon, Shield, Bell, Webhook } from "lucide-react";

export default function Settings() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-4xl mx-auto pb-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground font-mono">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure Júlia's operational parameters.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
        <div className="col-span-1 flex flex-col gap-1">
          <button className="flex items-center gap-3 px-4 py-3 bg-muted/40 border border-border rounded-lg text-left text-sm font-medium hover:bg-muted transition-colors">
            <SettingsIcon size={18} className="text-primary" />
            General Preferences
          </button>
          <button className="flex items-center gap-3 px-4 py-3 border border-transparent rounded-lg text-left text-sm font-medium text-muted-foreground hover:bg-muted/40 transition-colors">
            <Webhook size={18} />
            Integrations (Evolution API)
          </button>
          <button className="flex items-center gap-3 px-4 py-3 border border-transparent rounded-lg text-left text-sm font-medium text-muted-foreground hover:bg-muted/40 transition-colors">
            <Bell size={18} />
            Notifications
          </button>
          <button className="flex items-center gap-3 px-4 py-3 border border-transparent rounded-lg text-left text-sm font-medium text-muted-foreground hover:bg-muted/40 transition-colors">
            <Shield size={18} />
            Security & Auth
          </button>
        </div>

        <div className="col-span-1 md:col-span-2">
          <div className="bg-card border border-border rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-bold font-mono mb-4">General Preferences</h2>
            <p className="text-sm text-muted-foreground mb-6">Manage basic settings for the admin panel and agent behavior.</p>
            
            <div className="space-y-6 opacity-70 pointer-events-none">
              <div className="space-y-2">
                <label className="text-sm font-medium">Agent Name</label>
                <div className="h-10 w-full max-w-sm rounded-md border border-input bg-muted px-3 py-2 text-sm flex items-center text-muted-foreground">
                  Júlia Vendedora
                </div>
                <p className="text-xs text-muted-foreground">The display name used in WhatsApp messages.</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Auto-Followup Interval (Hours)</label>
                <div className="h-10 w-full max-w-xs rounded-md border border-input bg-muted px-3 py-2 text-sm flex items-center text-muted-foreground">
                  24
                </div>
              </div>

              <div className="pt-4 border-t border-border">
                <p className="text-xs italic text-muted-foreground flex items-center justify-center p-4 bg-muted/20 border border-dashed rounded">
                  Settings configuration is coming in a future update.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}