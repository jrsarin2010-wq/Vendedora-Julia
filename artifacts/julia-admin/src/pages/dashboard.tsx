import { useGetDashboardStats, getGetDashboardStatsQueryKey, useGetFunnelStats, getGetFunnelStatsQueryKey, useGetRecentActivity, getGetRecentActivityQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, UserCheck, UserX, Target, AlertTriangle, Clock, ArrowRight, MessageCircle, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rotuloEtapa } from "@/lib/rotulos";
import { listarAtencao, resolverAtencao, type ItemDeAtencao } from "@/lib/atencao-api";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats({
    query: { queryKey: getGetDashboardStatsQueryKey() }
  });
  
  const { data: funnel, isLoading: funnelLoading } = useGetFunnelStats({
    query: { queryKey: getGetFunnelStatsQueryKey() }
  });

  const { data: activity, isLoading: activityLoading } = useGetRecentActivity(
    { limit: 10 },
    { query: { queryKey: getGetRecentActivityQueryKey({ limit: 10 }) } }
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-7xl mx-auto pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-mono">Painel</h1>
          <p className="text-sm text-muted-foreground mt-1">Como está o trabalho da Júlia agora.</p>
        </div>
      </div>

      <PrecisamDeVoce />

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title="Total de dentistas" 
          value={stats?.totalLeads} 
          isLoading={statsLoading} 
          icon={Users} 
          description="Desde o começo" 
          testId="stat-total-leads"
        />
        <StatCard 
          title="Dentistas quentes" 
          value={stats?.hotLeads} 
          isLoading={statsLoading} 
          icon={Target} 
          description="Perto de fechar" 
          highlight="text-orange-500"
          testId="stat-hot-leads"
        />
        <StatCard 
          title="Taxa de conversão" 
          value={stats ? `${stats.conversionRate.toFixed(1)}%` : undefined} 
          isLoading={statsLoading} 
          icon={UserCheck} 
          description="Clientes sobre o total" 
          highlight="text-green-500"
          testId="stat-conversion"
        />
        <StatCard 
          title="Esperando você" 
          value={stats?.handoffsPending} 
          isLoading={statsLoading} 
          icon={AlertTriangle} 
          description="Pediram falar com uma pessoa" 
          highlight={stats?.handoffsPending ? "text-red-500" : "text-muted-foreground"}
          testId="stat-handoffs"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Funnel Chart */}
        <Card className="lg:col-span-2 shadow-sm border-border">
          <CardHeader className="border-b border-border/50 pb-4">
            <CardTitle className="text-base font-semibold font-mono flex items-center gap-2">
              <ArrowRight size={16} className="text-primary" />
              Etapas do funil
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {funnelLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map(i => (
                  <Skeleton key={i} className="h-10 w-full rounded-sm" />
                ))}
              </div>
            ) : funnel && funnel.length > 0 ? (
              <div className="space-y-4">
                {funnel.map((stage, idx) => {
                  const maxCount = Math.max(...funnel.map(f => f.count), 1);
                  const percentage = Math.max((stage.count / maxCount) * 100, 2);
                  return (
                    <div key={rotuloEtapa(stage.stage)} className="flex items-center gap-4" data-testid={`funnel-stage-${rotuloEtapa(stage.stage)}`}>
                      <div className="w-24 text-sm font-medium text-muted-foreground shrink-0 text-right">
                        {rotuloEtapa(stage.stage)}
                      </div>
                      <div className="flex-1 h-8 bg-muted rounded-sm overflow-hidden relative group">
                        <div 
                          className="h-full bg-primary transition-all duration-1000 ease-out group-hover:bg-primary/90" 
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <div className="w-12 text-sm font-bold font-mono text-right shrink-0">
                        {stage.count}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-10 text-center text-muted-foreground text-sm border border-dashed rounded-md">
                Ainda não há dados do funil
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="shadow-sm border-border">
          <CardHeader className="border-b border-border/50 pb-4">
            <CardTitle className="text-base font-semibold font-mono flex items-center gap-2">
              <Clock size={16} className="text-primary" />
              Atividade recente
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {activityLoading ? (
              <div className="p-4 space-y-4">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : activity && activity.length > 0 ? (
              <div className="divide-y divide-border/50 max-h-[400px] overflow-y-auto">
                {activity.map((item, i) => (
                  <Link 
                    key={`${item.leadId}-${i}`} 
                    href={`/leads/${item.leadId}`}
                    className="block hover:bg-muted/50 p-4 transition-colors"
                    data-testid={`activity-item-${item.leadId}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                        <UserCheck size={14} />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium leading-tight">
                          {item.leadName || item.phone}
                        </p>
                        {/* O `event` da API é "Estágio: qualified" — metade em
                            inglês e redundante com a etapa ao lado. Mostramos
                            só a etapa traduzida. */}
                        <p className="text-xs text-muted-foreground">
                          Etapa: {rotuloEtapa(item.funnelStage)}
                        </p>
                        <p className="text-[10px] text-muted-foreground/70 font-mono">
                          {new Date(item.timestamp).toLocaleString('pt-BR')}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="p-10 text-center text-muted-foreground text-sm">
                Nenhuma atividade recente
              </div>
            )}
            <div className="p-3 border-t border-border/50 text-center">
              <Link href="/leads" className="text-xs text-primary hover:underline font-medium uppercase tracking-wider" data-testid="link-view-all-leads">
                Ver todos os dentistas
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Chave única da consulta da central, para invalidar de qualquer tela. */
export const CHAVE_ATENCAO = ["atencao"] as const;

/**
 * CENTRAL DE VIGIA — a seção do topo.
 *
 * Fica ANTES dos números de propósito: número é para acompanhar, isto é para
 * agir hoje. O telefone é um link wa.me porque ele responde pelo WhatsApp, não
 * aqui dentro.
 *
 * Quando está vazia, mostra uma linha discreta em vez de desaparecer. O vazio
 * também é informação: "nada precisa de você" é diferente de "a seção não
 * carregou".
 */
function PrecisamDeVoce() {
  const { data, isLoading, isError } = useQuery({
    queryKey: CHAVE_ATENCAO,
    queryFn: listarAtencao,
    // A vigia do servidor roda a cada 5 min; 60s aqui deixa o painel aberto
    // acompanhar sem virar polling agressivo.
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <Skeleton className="h-24 w-full rounded-md" />;
  }

  if (isError) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="p-4 text-sm text-destructive">
          Não consegui carregar os avisos. Atualize a página.
        </CardContent>
      </Card>
    );
  }

  const itens = data?.itens ?? [];

  if (itens.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground flex items-center gap-2"
        data-testid="atencao-vazio"
      >
        <Check size={14} className="text-green-500" />
        Nada precisa de você agora.
      </p>
    );
  }

  return (
    <Card className="shadow-sm border-red-500/40" data-testid="atencao-lista">
      <CardHeader className="border-b border-border/50 pb-4">
        <CardTitle className="text-base font-semibold font-mono flex items-center gap-2">
          <AlertTriangle size={16} className="text-red-500" />
          Precisam de você
          <Badge variant="secondary" className="ml-1">{itens.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 divide-y divide-border/50">
        {itens.map((item) => (
          <LinhaDeAtencao key={item.id} item={item} />
        ))}
      </CardContent>
    </Card>
  );
}

function LinhaDeAtencao({ item }: { item: ItemDeAtencao }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const resolver = useMutation({
    mutationFn: () => resolverAtencao(item.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CHAVE_ATENCAO });
      toast({ title: "Resolvido", description: "Saiu da lista." });
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-4 flex flex-col sm:flex-row sm:items-start gap-3" data-testid={`atencao-item-${item.id}`}>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/leads/${item.id}`} className="text-sm font-medium hover:underline">
            {item.name || item.phone}
          </Link>
          <Badge variant="outline" className="text-[10px]">{item.motivoTexto}</Badge>
        </div>
        {item.detalhe && (
          <p className="text-xs text-muted-foreground italic break-words">“{item.detalhe}”</p>
        )}
        {item.painPoints && (
          <p className="text-xs text-muted-foreground">Dor: {item.painPoints}</p>
        )}
        {item.desde && (
          <p className="text-[10px] text-muted-foreground/70 font-mono">
            desde {new Date(item.desde).toLocaleString("pt-BR")}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button asChild size="sm" variant="default">
          <a href={item.whatsapp} target="_blank" rel="noreferrer">
            <MessageCircle size={14} className="mr-1.5" />
            Responder
          </a>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => resolver.mutate()}
          disabled={resolver.isPending}
          data-testid={`atencao-resolver-${item.id}`}
        >
          Já cuidei disso
        </Button>
      </div>
    </div>
  );
}

function StatCard({
  title, 
  value, 
  isLoading, 
  icon: Icon, 
  description,
  highlight,
  testId
}: { 
  title: string; 
  value?: string | number | null; 
  isLoading: boolean; 
  icon: any; 
  description?: string;
  highlight?: string;
  testId?: string;
}) {
  return (
    <Card className="shadow-sm border-border" data-testid={testId}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between space-y-0 pb-2">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
          <Icon className={`h-4 w-4 ${highlight || 'text-muted-foreground'}`} />
        </div>
        <div className="flex flex-col gap-1">
          {isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <div className="text-3xl font-bold font-mono tracking-tight">{value !== undefined && value !== null ? value : '-'}</div>
          )}
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}