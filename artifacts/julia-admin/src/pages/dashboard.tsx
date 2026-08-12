import { useGetDashboardStats, getGetDashboardStatsQueryKey, useGetFunnelStats, getGetFunnelStatsQueryKey, useGetRecentActivity, getGetRecentActivityQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, UserCheck, UserX, Target, AlertTriangle, Clock, ArrowRight, MessageCircle, Check, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rotuloEtapa } from "@/lib/rotulos";
import { listarAtencao, resolverAtencao, type ItemDeAtencao } from "@/lib/atencao-api";
import { listarDuvidasDoSite } from "@/lib/duvidas-api";
import { listarTemperatura, listarReativacao } from "@/lib/temperatura-api";
import { FAIXA_PT, type Faixa } from "@/lib/rotulos";
import { Flame, History } from "lucide-react";
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

      <TemperaturaDoFunil />

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

      <EmReativacao />

      <LandingNaoResponde />
    </div>
  );
}

/**
 * EM REATIVAÇÃO (Rodada 41) — quem está na fila longa (+30/+60/+90 dias).
 *
 * Leitura de acompanhamento, não de ação: estes leads esquentaram, não
 * fecharam, e a Júlia vai voltar a falar com eles sozinha. A lista existe para
 * o vazio não ser confundido com "ninguém sobrou" — dentista que some do funil
 * era exatamente o buraco desta rodada.
 */
function EmReativacao() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["reativacao"],
    queryFn: listarReativacao,
    refetchInterval: 60_000,
  });

  if (isLoading) return <Skeleton className="h-24 w-full rounded-md" />;
  if (isError) {
    return (
      <p className="text-sm text-muted-foreground">
        Não consegui carregar a fila de reativação.
      </p>
    );
  }

  const itens = data?.itens ?? [];

  return (
    <Card className="shadow-sm border-border" data-testid="em-reativacao">
      <CardHeader className="border-b border-border/50 pb-4">
        <CardTitle className="text-base font-semibold font-mono flex items-center gap-2">
          <History size={16} className="text-primary" />
          Em reativação
          {itens.length > 0 && <Badge variant="secondary" className="ml-1">{itens.length}</Badge>}
        </CardTitle>
        <p className="text-xs text-muted-foreground pt-1">
          Esquentaram, não fecharam, e a Júlia volta a procurá-los em +30, +60 e
          +90 dias — com saída fácil em cada toque.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {itens.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">
            Ninguém na fila longa agora.
          </div>
        ) : (
          <div className="divide-y divide-border/50 max-h-[300px] overflow-y-auto">
            {itens.map((item) => (
              <Link
                key={item.id}
                href={`/leads/${item.id}`}
                className="flex items-center justify-between gap-3 p-4 hover:bg-muted/50 transition-colors"
                data-testid={`reativacao-item-${item.id}`}
              >
                <span className="text-sm font-medium truncate">
                  {item.name || item.phone}
                </span>
                <span className="text-xs text-muted-foreground font-mono shrink-0">
                  toque {item.proximoToque} em{" "}
                  {new Date(item.agendadoPara).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "short",
                  })}
                </span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * O QUE A LANDING NÃO RESPONDE (Rodada 35).
 *
 * Cada linha é um dentista que leu a página inteira e mesmo assim precisou
 * perguntar. Não é métrica de venda: é a lista de consertos da landing, em
 * ordem de quanto cada buraco custa.
 *
 * Fica no fim do painel de propósito — é leitura de planejamento, não coisa
 * para agir hoje (isso é a central de vigia, lá em cima).
 */
function LandingNaoResponde() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["duvidas-do-site"],
    queryFn: listarDuvidasDoSite,
  });

  if (isLoading) return <Skeleton className="h-40 w-full rounded-md" />;

  // Erro aqui não vira alarme vermelho: é uma leitura de apoio, e a tela toda
  // continua útil sem ela.
  if (isError) {
    return (
      <p className="text-sm text-muted-foreground">
        Não consegui carregar as dúvidas de quem veio da landing.
      </p>
    );
  }

  const assuntos = data?.assuntos ?? [];
  const maior = Math.max(...assuntos.map((a) => a.total), 1);

  return (
    <Card className="shadow-sm border-border" data-testid="duvidas-do-site">
      <CardHeader className="border-b border-border/50 pb-4">
        <CardTitle className="text-base font-semibold font-mono flex items-center gap-2">
          <HelpCircle size={16} className="text-primary" />
          O que a landing não responde
        </CardTitle>
        <p className="text-xs text-muted-foreground pt-1">
          O que fez o dentista clicar no botão do site. Cada linha é uma melhoria
          concreta na página.
        </p>
      </CardHeader>
      <CardContent className="p-6">
        {assuntos.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm border border-dashed rounded-md">
            Ninguém veio da landing com dúvida ainda.
          </div>
        ) : (
          <div className="space-y-3">
            {assuntos.map((item) => (
              <div
                key={item.assunto}
                className="flex items-center gap-4"
                data-testid={`duvida-${item.assunto}`}
              >
                <div className="w-48 text-sm text-muted-foreground shrink-0 truncate text-right first-letter:uppercase">
                  {item.assunto}
                </div>
                <div className="flex-1 h-6 bg-muted rounded-sm overflow-hidden">
                  <div
                    className="h-full bg-primary/70 transition-all duration-1000 ease-out"
                    style={{ width: `${Math.max((item.total / maior) * 100, 2)}%` }}
                  />
                </div>
                <div className="w-10 text-sm font-bold font-mono text-right shrink-0">
                  {item.total}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * TEMPERATURA DO FUNIL (Rodada 41) — quantos leads em cada faixa.
 *
 * É a leitura mais útil do funil que existe: quantos estão só olhando (frio),
 * avaliando (morno), decidindo (quente) e com múltiplos sinais de compra
 * (fervendo). Cliente e Perdido não entram na conta.
 */
function TemperaturaDoFunil() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["temperatura"],
    queryFn: listarTemperatura,
    refetchInterval: 60_000,
  });

  if (isLoading) return <Skeleton className="h-24 w-full rounded-md" />;
  if (isError) {
    return (
      <p className="text-sm text-muted-foreground">
        Não consegui carregar a temperatura do funil.
      </p>
    );
  }

  const faixas: { faixa: Faixa; cor: string }[] = [
    { faixa: "fervendo", cor: "text-red-500" },
    { faixa: "quente", cor: "text-orange-500" },
    { faixa: "morno", cor: "text-yellow-500" },
    { faixa: "frio", cor: "text-blue-500" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4" data-testid="temperatura-funil">
      {faixas.map(({ faixa, cor }) => (
        <Card key={faixa} className="shadow-sm border-border" data-testid={`temperatura-${faixa}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between pb-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {FAIXA_PT[faixa]}
              </p>
              <Flame className={`h-4 w-4 ${cor}`} />
            </div>
            <div className="text-2xl font-bold font-mono tracking-tight">
              {data?.[faixa] ?? 0}
            </div>
          </CardContent>
        </Card>
      ))}
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