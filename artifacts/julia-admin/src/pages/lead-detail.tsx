import { useState, useRef, useEffect } from "react";
import { useParams, Link } from "wouter";
import { 
  useGetLead, 
  getGetLeadQueryKey, 
  useUpdateLead, 
  useListLeadMessages, 
  getListLeadMessagesQueryKey,
  useGetLeadFollowups,
  getGetLeadFollowupsQueryKey
} from "@workspace/api-client-react";
import { ArrowLeft, User, Phone, Save, AlertTriangle, MessageCircle, Calendar, Bot, PauseCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "./leads";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { PreviaAbordagem } from "@/components/previa-abordagem";
import { ConfirmarExclusao } from "@/components/confirmar-exclusao";
import { apagarLead } from "@/lib/import-api";
import { rotuloEtapa, rotuloFollowUp } from "@/lib/rotulos";
import { Trash2 } from "lucide-react";
import { useLocation } from "wouter";

const STAGES = ['new', 'contacted', 'qualified', 'interested', 'objection', 'closing', 'closed', 'lost'];

export default function LeadDetail() {
  const params = useParams();
  const id = Number(params.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: lead, isLoading: leadLoading } = useGetLead(id, {
    query: { enabled: !!id, queryKey: getGetLeadQueryKey(id) }
  });

  const { data: messages, isLoading: msgsLoading } = useListLeadMessages(id, {
    query: { enabled: !!id, queryKey: getListLeadMessagesQueryKey(id) }
  });

  const { data: followups, isLoading: followupsLoading } = useGetLeadFollowups(id, {
    query: { enabled: !!id, queryKey: getGetLeadFollowupsQueryKey(id) }
  });

  const updateLeadMutation = useUpdateLead({
    mutation: {
      onSuccess: (data) => {
        toast({ title: "Lead updated", description: "Changes saved successfully." });
        queryClient.setQueryData(getGetLeadQueryKey(id), data);
        queryClient.invalidateQueries({ queryKey: getGetLeadQueryKey(id) });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to update lead.", variant: "destructive" });
      }
    }
  });

  // Local state for edits
  const [notes, setNotes] = useState("");
  const [painPoints, setPainPoints] = useState("");
  const [mainObjection, setMainObjection] = useState("");
  
  const initRef = useRef<number | null>(null);
  
  useEffect(() => {
    if (lead && initRef.current !== id) {
      initRef.current = id;
      setNotes(lead.notes || "");
      setPainPoints(lead.painPoints || "");
      setMainObjection(lead.mainObjection || "");
    }
  }, [lead, id]);

  const handleSaveNotes = () => {
    updateLeadMutation.mutate({ 
      id, 
      data: { notes, painPoints, mainObjection } 
    });
  };

  const handleStatusChange = (val: any) => {
    updateLeadMutation.mutate({ id, data: { status: val } });
  };

  const handleStageChange = (val: any) => {
    updateLeadMutation.mutate({ id, data: { funnelStage: val } });
  };

  const handleResolveHandoff = () => {
    updateLeadMutation.mutate({ id, data: { handoffRequested: false } });
  };

  // A Júlia se cala por 5 minutos quando alguém responde o dentista pelo
  // celular, e cada mensagem nova renova o prazo. Este botão devolve a conversa
  // para ela antes disso — para quando você respondeu uma coisa pontual e quer
  // que ela siga conduzindo.
  const pausadaAte = lead?.pausedUntil ? new Date(lead.pausedUntil) : null;
  const estaPausada = Boolean(pausadaAte && pausadaAte.getTime() > Date.now());

  const handleRetomar = () => {
    updateLeadMutation.mutate({ id, data: { pausedUntil: null } });
  };

  const [apagando, setApagando] = useState(false);
  const [, navegar] = useLocation();

  async function handleApagar() {
    setApagando(true);
    try {
      await apagarLead(id);
      toast({
        title: "Dentista apagado",
        description: "Ele saiu da lista, junto com as mensagens e os follow-ups.",
      });
      navegar("/leads");
    } catch (e) {
      setApagando(false);
      toast({
        title: "Não deu para apagar",
        description: e instanceof Error ? e.message : "Tente de novo.",
        variant: "destructive",
      });
    }
  }

  if (leadLoading) {
    return (
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-[600px] col-span-1" />
          <Skeleton className="h-[600px] col-span-2" />
        </div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="p-6 text-center max-w-7xl mx-auto flex flex-col items-center justify-center h-full min-h-[50vh]">
        <h2 className="text-2xl font-bold mb-4 font-mono">Dentista não encontrado</h2>
        <Link href="/leads">
          <Button variant="outline"><ArrowLeft className="mr-2 h-4 w-4" /> Voltar para a lista</Button>
        </Link>
      </div>
    );
  }

  const currentStageIndex = STAGES.indexOf(lead.funnelStage);

  return (
    <div className="animate-in fade-in duration-300 max-w-[1400px] mx-auto pb-10 flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 shrink-0 pt-2 px-2">
        <div className="flex items-center gap-4">
          <Link href="/leads">
            <Button variant="outline" size="icon" className="h-8 w-8" data-testid="btn-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-foreground font-mono flex items-center gap-2">
                {lead.name || "Dentista sem nome"}
              </h1>
              <StatusBadge status={lead.status} />
              {lead.handoffRequested && (
                <Badge variant="destructive" className="animate-pulse flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider">
                  <AlertTriangle className="h-3 w-3" /> Quer falar com você
                </Badge>
              )}
              {estaPausada && pausadaAte && (
                <Badge variant="outline" className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800" data-testid="badge-pausada">
                  <PauseCircle className="h-3 w-3" /> Júlia pausada até{" "}
                  {pausadaAte.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 font-mono">
              <Phone className="h-3 w-3" /> {lead.phone}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {estaPausada && (
            <Button variant="outline" size="sm" onClick={handleRetomar} disabled={updateLeadMutation.isPending} data-testid="btn-retomar-julia">
              Devolver para a Júlia
            </Button>
          )}
          {lead.handoffRequested && (
            <Button variant="outline" size="sm" onClick={handleResolveHandoff} disabled={updateLeadMutation.isPending} data-testid="btn-resolve-handoff">
              Já falei com ele
            </Button>
          )}
          <Select value={lead.status} onValueChange={handleStatusChange} disabled={updateLeadMutation.isPending}>
            <SelectTrigger className="w-[130px] h-9 font-mono text-xs uppercase" data-testid="select-edit-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hot">Quente</SelectItem>
              <SelectItem value="warm">Morno</SelectItem>
              <SelectItem value="cold">Frio</SelectItem>
              <SelectItem value="closed">Cliente</SelectItem>
              <SelectItem value="lost">Perdido</SelectItem>
            </SelectContent>
          </Select>

          <ConfirmarExclusao
            titulo={`Apagar ${lead.name || lead.phone}?`}
            descricao="Apaga o dentista, todas as mensagens trocadas com ele e os follow-ups agendados. Não dá para desfazer."
            aoConfirmar={handleApagar}
          >
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-destructive"
              disabled={apagando}
              data-testid="btn-apagar-lead"
              title="Apagar este dentista"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </ConfirmarExclusao>
        </div>
      </div>

      {/* Visual Pipeline */}
      <div className="mb-6 px-2 shrink-0 hidden sm:block">
        <div className="flex justify-between relative before:absolute before:top-1/2 before:-translate-y-1/2 before:w-full before:h-1 before:bg-muted before:z-0 before:rounded-full">
          {STAGES.map((stage, idx) => {
            const isActive = idx === currentStageIndex;
            const isPast = idx < currentStageIndex;
            return (
              <div 
                key={stage} 
                className="relative z-10 flex flex-col items-center gap-2 cursor-pointer group"
                onClick={() => handleStageChange(stage)}
                data-testid={`pipeline-stage-${stage}`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  isActive ? "bg-primary border-primary ring-4 ring-primary/20" : 
                  isPast ? "bg-primary border-primary" : "bg-background border-muted-foreground/30"
                }`}>
                  {isPast && <div className="w-2 h-2 bg-background rounded-full" />}
                </div>
                <span className={`text-[10px] font-mono uppercase tracking-wider transition-colors ${
                  isActive ? "text-primary font-bold" :
                  isPast ? "text-foreground font-medium" : "text-muted-foreground"
                }`}>
                  {rotuloEtapa(stage)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 overflow-hidden min-h-0 px-2">
        {/* Left Column: Lead Info */}
        <div className="col-span-1 flex flex-col gap-6 overflow-y-auto pr-2 pb-6 custom-scrollbar">
          
          <div className="bg-card border border-border rounded-lg shadow-sm p-5 space-y-4">
            <h3 className="font-mono text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2 mb-4 border-b border-border/50 pb-2">
              <User className="h-4 w-4" /> Ficha do dentista
            </h3>
            
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Dor identificada</label>
                <Textarea 
                  value={painPoints}
                  onChange={(e) => setPainPoints(e.target.value)}
                  placeholder="Ex.: perde paciente que chama fora do horário..."
                  className="min-h-[80px] text-sm resize-none bg-muted/20"
                  data-testid="input-pain-points"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Objeção</label>
                <Input 
                  value={mainObjection}
                  onChange={(e) => setMainObjection(e.target.value)}
                  placeholder="Ex.: achou caro, quer falar com o sócio..."
                  className="text-sm bg-muted/20"
                  data-testid="input-objection"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Anotações internas</label>
                <Textarea 
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anote aqui o que for útil sobre este dentista..."
                  className="min-h-[120px] text-sm resize-none bg-muted/20"
                  data-testid="input-notes"
                />
              </div>
              <Button onClick={handleSaveNotes} disabled={updateLeadMutation.isPending} className="w-full font-mono text-xs" data-testid="btn-save-notes">
                <Save className="h-4 w-4 mr-2" /> Salvar ficha
              </Button>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg shadow-sm p-5 flex flex-col h-[300px]">
            <h3 className="font-mono text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2 mb-4 border-b border-border/50 pb-2 shrink-0">
              <Calendar className="h-4 w-4" /> Follow-ups agendados
            </h3>
            
            <div className="flex-1 overflow-y-auto space-y-3 pr-2">
              {followupsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : followups && followups.length > 0 ? (
                followups.map(f => (
                  <div key={f.id} className="flex flex-col gap-1 p-3 border border-border/50 rounded-md bg-muted/10 text-sm" data-testid={`followup-${f.id}`}>
                    <div className="flex justify-between items-center">
                      <span className="font-mono font-medium text-xs uppercase tracking-wider">{f.touchNumber}º toque</span>
                      <Badge variant="outline" className={`text-[9px] uppercase font-mono ${f.status === 'sent' ? 'bg-green-100 text-green-700 dark:bg-green-900/30' : f.status === 'cancelled' ? 'bg-slate-100 text-slate-500' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30'}`}>
                        {rotuloFollowUp(f.status)}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground text-xs mt-1">
                      Para: {new Date(f.scheduledAt).toLocaleString('pt-BR')}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center text-muted-foreground text-sm py-6 border border-dashed rounded-md h-full flex items-center justify-center">
                  Nenhum follow-up agendado
                </div>
              )}
            </div>
          </div>

          {/* Conferência da primeira mensagem — não envia nada */}
          <PreviaAbordagem leadId={id} />
        </div>

        {/* Right Column: Messages */}
        <div className="col-span-2 bg-card border border-border rounded-lg shadow-sm flex flex-col overflow-hidden relative">
          <div className="p-4 border-b border-border/80 bg-muted/30 flex items-center gap-2 shrink-0 z-10">
            <MessageCircle className="h-4 w-4 text-primary" />
            <h3 className="font-mono text-sm font-semibold uppercase tracking-wider">Histórico da conversa</h3>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#f8f9fa] dark:bg-[#0f1219]">
            {msgsLoading ? (
              <div className="space-y-4">
                <div className="flex justify-start"><Skeleton className="h-16 w-64 rounded-2xl rounded-tl-sm" /></div>
                <div className="flex justify-end"><Skeleton className="h-16 w-64 rounded-2xl rounded-tr-sm bg-primary/20" /></div>
                <div className="flex justify-start"><Skeleton className="h-20 w-72 rounded-2xl rounded-tl-sm" /></div>
              </div>
            ) : messages && messages.length > 0 ? (
              <div className="flex flex-col gap-3">
                {messages.map((msg, i) => {
                  const isInbound = msg.direction === 'inbound';
                  return (
                    <div key={msg.id} className={`flex w-full ${isInbound ? "justify-start" : "justify-end"}`} data-testid={`msg-${msg.id}`}>
                      <div className={`max-w-[80%] flex gap-2 ${isInbound ? "flex-row" : "flex-row-reverse"}`}>
                        <div className="shrink-0 mt-1">
                          {isInbound ? (
                            <div className="w-6 h-6 rounded-full bg-slate-300 dark:bg-slate-700 flex items-center justify-center text-xs font-bold font-mono text-slate-600 dark:text-slate-300">
                              {lead.name ? lead.name.charAt(0).toUpperCase() : "D"}
                            </div>
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                              <Bot size={14} />
                            </div>
                          )}
                        </div>
                        <div className={`flex flex-col ${isInbound ? "items-start" : "items-end"}`}>
                          <div className={`px-4 py-2.5 text-[15px] shadow-sm leading-relaxed ${
                            isInbound 
                              ? "bg-card border border-border text-foreground rounded-2xl rounded-tl-sm" 
                              : "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm"
                          }`}>
                            {msg.content}
                          </div>
                          <span className="text-[10px] text-muted-foreground/60 font-mono mt-1 px-1">
                            {new Date(msg.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-70">
                <Bot className="h-12 w-12 mb-4 opacity-20" />
                <p>Nenhuma mensagem ainda.</p>
                <p className="text-xs">Quando houver conversa, ela aparece aqui.</p>
              </div>
            )}
          </div>
          
          {/* Read-only indicator */}
          <div className="p-3 border-t border-border bg-muted/20 text-center text-xs font-mono text-muted-foreground shrink-0">
            Conversa conduzida pela Júlia
          </div>
        </div>
      </div>
    </div>
  );
}