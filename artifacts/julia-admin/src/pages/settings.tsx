import { Settings as SettingsIcon, Shield, Bell, Webhook } from "lucide-react";

export default function Settings() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-4xl mx-auto pb-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground font-mono">Configurações</h1>
        <p className="text-sm text-muted-foreground mt-1">Ajustes de funcionamento da Júlia.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
        <div className="col-span-1 flex flex-col gap-1">
          <button className="flex items-center gap-3 px-4 py-3 bg-muted/40 border border-border rounded-lg text-left text-sm font-medium hover:bg-muted transition-colors">
            <SettingsIcon size={18} className="text-primary" />
            Preferências gerais
          </button>
          <button className="flex items-center gap-3 px-4 py-3 border border-transparent rounded-lg text-left text-sm font-medium text-muted-foreground hover:bg-muted/40 transition-colors">
            <Webhook size={18} />
            Integrações (Evolution API)
          </button>
          <button className="flex items-center gap-3 px-4 py-3 border border-transparent rounded-lg text-left text-sm font-medium text-muted-foreground hover:bg-muted/40 transition-colors">
            <Bell size={18} />
            Notificações
          </button>
          <button className="flex items-center gap-3 px-4 py-3 border border-transparent rounded-lg text-left text-sm font-medium text-muted-foreground hover:bg-muted/40 transition-colors">
            <Shield size={18} />
            Segurança e acesso
          </button>
        </div>

        <div className="col-span-1 md:col-span-2">
          <div className="bg-card border border-border rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-bold font-mono mb-4">Preferências gerais</h2>
            <p className="text-sm text-muted-foreground mb-6">Ajustes básicos do painel e do comportamento da Júlia.</p>
            
            <div className="space-y-6 opacity-70 pointer-events-none">
              <div className="space-y-2">
                <label className="text-sm font-medium">Nome da agente</label>
                <div className="h-10 w-full max-w-sm rounded-md border border-input bg-muted px-3 py-2 text-sm flex items-center text-muted-foreground">
                  Júlia Vendedora
                </div>
                <p className="text-xs text-muted-foreground">Nome usado nas mensagens de WhatsApp.</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Intervalo do follow-up (horas)</label>
                <div className="h-10 w-full max-w-xs rounded-md border border-input bg-muted px-3 py-2 text-sm flex items-center text-muted-foreground">
                  24
                </div>
              </div>

              <div className="pt-4 border-t border-border">
                <p className="text-xs italic text-muted-foreground flex items-center justify-center p-4 bg-muted/20 border border-dashed rounded">
                  A edição das configurações ainda vai chegar.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}