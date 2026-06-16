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
import { ArrowLeft, User, Phone, Save, AlertTriangle, MessageCircle, Calendar, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "./leads";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

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
        <h2 className="text-2xl font-bold mb-4 font-mono">Lead not found</h2>
        <Link href="/leads">
          <Button variant="outline"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Leads</Button>
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
                {lead.name || "Unknown"}
              </h1>
              <StatusBadge status={lead.status} />
              {lead.handoffRequested && (
                <Badge variant="destructive" className="animate-pulse flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider">
                  <AlertTriangle className="h-3 w-3" /> Handoff Req
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 font-mono">
              <Phone className="h-3 w-3" /> {lead.phone}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {lead.handoffRequested && (
            <Button variant="outline" size="sm" onClick={handleResolveHandoff} disabled={updateLeadMutation.isPending} data-testid="btn-resolve-handoff">
              Resolve Handoff
            </Button>
          )}
          <Select value={lead.status} onValueChange={handleStatusChange} disabled={updateLeadMutation.isPending}>
            <SelectTrigger className="w-[130px] h-9 font-mono text-xs uppercase" data-testid="select-edit-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hot">HOT</SelectItem>
              <SelectItem value="warm">WARM</SelectItem>
              <SelectItem value="cold">COLD</SelectItem>
              <SelectItem value="closed">CLOSED</SelectItem>
              <SelectItem value="lost">LOST</SelectItem>
            </SelectContent>
          </Select>
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
                  {stage}
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
              <User className="h-4 w-4" /> Profile Data
            </h3>
            
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pain Points</label>
                <Textarea 
                  value={painPoints}
                  onChange={(e) => setPainPoints(e.target.value)}
                  placeholder="E.g., Low patient flow, high no-show rate..."
                  className="min-h-[80px] text-sm resize-none bg-muted/20"
                  data-testid="input-pain-points"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Main Objection</label>
                <Input 
                  value={mainObjection}
                  onChange={(e) => setMainObjection(e.target.value)}
                  placeholder="E.g., Price, too complex..."
                  className="text-sm bg-muted/20"
                  data-testid="input-objection"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Internal Notes</label>
                <Textarea 
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add notes about this lead..."
                  className="min-h-[120px] text-sm resize-none bg-muted/20"
                  data-testid="input-notes"
                />
              </div>
              <Button onClick={handleSaveNotes} disabled={updateLeadMutation.isPending} className="w-full font-mono text-xs" data-testid="btn-save-notes">
                <Save className="h-4 w-4 mr-2" /> Save Profile Details
              </Button>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg shadow-sm p-5 flex flex-col h-[300px]">
            <h3 className="font-mono text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2 mb-4 border-b border-border/50 pb-2 shrink-0">
              <Calendar className="h-4 w-4" /> Follow-up Schedule
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
                      <span className="font-mono font-medium text-xs uppercase tracking-wider">Touch #{f.touchNumber}</span>
                      <Badge variant="outline" className={`text-[9px] uppercase font-mono ${f.status === 'sent' ? 'bg-green-100 text-green-700 dark:bg-green-900/30' : f.status === 'cancelled' ? 'bg-slate-100 text-slate-500' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30'}`}>
                        {f.status}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground text-xs mt-1">
                      Scheduled: {new Date(f.scheduledAt).toLocaleString()}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center text-muted-foreground text-sm py-6 border border-dashed rounded-md h-full flex items-center justify-center">
                  No scheduled follow-ups
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Messages */}
        <div className="col-span-2 bg-card border border-border rounded-lg shadow-sm flex flex-col overflow-hidden relative">
          <div className="p-4 border-b border-border/80 bg-muted/30 flex items-center gap-2 shrink-0 z-10">
            <MessageCircle className="h-4 w-4 text-primary" />
            <h3 className="font-mono text-sm font-semibold uppercase tracking-wider">Conversation History</h3>
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
                <p>No messages yet.</p>
                <p className="text-xs">Júlia will initiate contact soon.</p>
              </div>
            )}
          </div>
          
          {/* Read-only indicator */}
          <div className="p-3 border-t border-border bg-muted/20 text-center text-xs font-mono text-muted-foreground shrink-0">
            Conversation managed by Júlia AI Agent
          </div>
        </div>
      </div>
    </div>
  );
}