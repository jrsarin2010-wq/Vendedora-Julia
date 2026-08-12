import { useState } from "react";
import { useListLeads, getListLeadsQueryKey, ListLeadsStatus, ListLeadsFunnelStage } from "@workspace/api-client-react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Search, Filter, AlertTriangle, Trash2, Loader2, Eraser } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apagarLead, apagarImportadosPendentes } from "@/lib/import-api";
import { rotuloStatus, rotuloEtapa, rotuloPlano, rotuloAtencao, rotuloAtencaoCurto, rotuloFaixa, faixaDaTemperatura, type Faixa } from "@/lib/rotulos";
import { ConfirmarExclusao } from "@/components/confirmar-exclusao";
import { listarAtencao } from "@/lib/atencao-api";

// Simple debounce hook for local use
function useDebounceLocal<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  import("react").then(({ useEffect }) => {
    useEffect(() => {
      const handler = setTimeout(() => {
        setDebouncedValue(value);
      }, delay);
      return () => clearTimeout(handler);
    }, [value, delay]);
  });
  return debouncedValue;
}

export function StatusBadge({ status }: { status: string }) {
  let colorClass = "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700";

  if (status === 'hot') colorClass = "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800";
  else if (status === 'warm') colorClass = "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800";
  else if (status === 'cold') colorClass = "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800";
  else if (status === 'closed') colorClass = "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800";
  else if (status === 'lost') colorClass = "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700";

  return (
    <Badge variant="outline" className={`font-mono text-[10px] uppercase tracking-wider ${colorClass}`} data-testid={`status-badge-${status}`}>
      {rotuloStatus(status)}
    </Badge>
  );
}

/**
 * TEMPERATURA (Rodada 41). Para quem ainda está no funil, a leitura útil não é
 * o status — é a faixa da pontuação de sinais. Cliente e Perdido continuam com
 * o selo de status, porque para eles temperatura não significa nada.
 */
export function TemperaturaBadge({ temperatura }: { temperatura: number }) {
  const faixa = faixaDaTemperatura(temperatura);

  const cores: Record<Faixa, string> = {
    fervendo: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
    quente: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800",
    morno: "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800",
    frio: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  };

  return (
    <Badge variant="outline" className={`font-mono text-[10px] uppercase tracking-wider ${cores[faixa]}`} data-testid={`temperatura-badge-${faixa}`}>
      {rotuloFaixa(faixa)}
    </Badge>
  );
}

export default function Leads() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounceLocal(search, 300);
  // Filtro de temperatura: as quatro faixas são filtradas no cliente (o campo
  // não está no contrato OpenAPI); Cliente e Perdido continuam sendo filtro de
  // status no servidor, porque status eles ainda têm.
  const [tempFilter, setTempFilter] = useState<Faixa | ListLeadsStatus | "all">("all");
  const [stageFilter, setStageFilter] = useState<ListLeadsFunnelStage | "all">("all");
  const [soAtencao, setSoAtencao] = useState(false);
  const [apagandoId, setApagandoId] = useState<number | null>(null);
  const [faxinando, setFaxinando] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const queryParams: any = {};
  if (debouncedSearch) queryParams.search = debouncedSearch;
  if (tempFilter === "closed" || tempFilter === "lost") queryParams.status = tempFilter;
  if (stageFilter !== "all") queryParams.funnelStage = stageFilter;

  const { data, isLoading } = useListLeads(queryParams, {
    query: { queryKey: getListLeadsQueryKey(queryParams) }
  });

  // CENTRAL DE VIGIA. O `Lead` do contrato OpenAPI não tem o campo `atencao`,
  // então a marcação vem desta consulta — a mesma que alimenta a seção do
  // Painel — e é cruzada por id. Menos acoplamento do que regerar o cliente só
  // para carregar um selo.
  const { data: atencao } = useQuery({
    queryKey: ["atencao"],
    queryFn: listarAtencao,
    refetchInterval: 60_000,
  });
  const motivoPorLead = new Map(
    (atencao?.itens ?? []).map((i) => [i.id, i.motivo] as const),
  );

  const ehFaixa = (v: string): v is Faixa =>
    ["frio", "morno", "quente", "fervendo"].includes(v);

  const leadsVisiveis = (data?.leads ?? []).filter((lead) => {
    if (soAtencao && !motivoPorLead.has(lead.id)) return false;
    if (tempFilter !== "all" && ehFaixa(tempFilter)) {
      // O `Lead` do contrato não conhece `temperatura`; o servidor manda a
      // linha inteira do banco, então o campo existe em tempo de execução.
      const temperatura = (lead as { temperatura?: number }).temperatura ?? 0;
      if (lead.status === "closed" || lead.status === "lost") return false;
      if (faixaDaTemperatura(temperatura) !== tempFilter) return false;
    }
    return true;
  });

  function recarregar() {
    queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey(queryParams) });
  }

  async function confirmarExclusao(id: number, nome: string) {
    setApagandoId(id);
    try {
      await apagarLead(id);
      toast({ title: "Dentista apagado", description: `${nome} saiu da lista, junto com as mensagens dele.` });
      recarregar();
    } catch (e) {
      toast({
        title: "Não deu para apagar",
        description: e instanceof Error ? e.message : "Tente de novo.",
        variant: "destructive",
      });
    } finally {
      setApagandoId(null);
    }
  }

  async function confirmarFaxina() {
    setFaxinando(true);
    try {
      const { apagados } = await apagarImportadosPendentes();
      toast({
        title: apagados > 0 ? "Faxina concluída" : "Nada para apagar",
        description:
          apagados > 0
            ? `${apagados} dentista(s) importado(s) e ainda não abordado(s) foram apagados.`
            : "Nenhum importado aguardando abordagem.",
      });
      recarregar();
    } catch (e) {
      toast({
        title: "Não deu para apagar",
        description: e instanceof Error ? e.message : "Tente de novo.",
        variant: "destructive",
      });
    } finally {
      setFaxinando(false);
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-7xl mx-auto pb-10 flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-mono">Dentistas</h1>
          <p className="text-sm text-muted-foreground mt-1">Acompanhe e gerencie os dentistas em conversa.</p>
        </div>
        <ConfirmarExclusao
          titulo="Apagar os importados ainda não abordados?"
          descricao="Apaga todos os dentistas que vieram por importação e que AINDA NÃO receberam a primeira mensagem. Quem já conversou com a Júlia, quem chegou sozinho pelo WhatsApp e quem já foi abordado não são tocados. Não dá para desfazer."
          textoConfirmar="Apagar os de teste"
          aoConfirmar={confirmarFaxina}
        >
          <Button variant="outline" size="sm" disabled={faxinando} data-testid="btn-faxina-importados">
            {faxinando ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Eraser size={14} className="mr-2" />}
            Limpar importados de teste
          </Button>
        </ConfirmarExclusao>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-sm flex flex-col flex-1 overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-border bg-muted/20 flex flex-col sm:flex-row gap-4 items-center justify-between shrink-0">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Buscar por nome ou telefone..."
              className="pl-9 bg-background h-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-leads-search"
            />
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Select value={tempFilter} onValueChange={(v: any) => setTempFilter(v)}>
              <SelectTrigger className="w-full sm:w-[150px] h-9 bg-background" data-testid="select-status-filter">
                <SelectValue placeholder="Temperatura" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as temperaturas</SelectItem>
                <SelectItem value="fervendo">Fervendo</SelectItem>
                <SelectItem value="quente">Quente</SelectItem>
                <SelectItem value="morno">Morno</SelectItem>
                <SelectItem value="frio">Frio</SelectItem>
                <SelectItem value="closed">Cliente</SelectItem>
                <SelectItem value="lost">Perdido</SelectItem>
              </SelectContent>
            </Select>

            <Select value={stageFilter} onValueChange={(v: any) => setStageFilter(v)}>
              <SelectTrigger className="w-full sm:w-[160px] h-9 bg-background" data-testid="select-stage-filter">
                <SelectValue placeholder="Etapa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as etapas</SelectItem>
                <SelectItem value="new">Novo</SelectItem>
                <SelectItem value="contacted">Contatado</SelectItem>
                <SelectItem value="qualified">Qualificado</SelectItem>
                <SelectItem value="interested">Interessado</SelectItem>
                <SelectItem value="objection">Objeção</SelectItem>
                <SelectItem value="closing">Fechamento</SelectItem>
                <SelectItem value="closed">Fechado</SelectItem>
                <SelectItem value="lost">Perdido</SelectItem>
              </SelectContent>
            </Select>

            {/* Filtro da central de vigia. É um botão de liga/desliga porque a
                pergunta que ele responde é sim/não: "quem precisa de mim?" */}
            <Button
              variant={soAtencao ? "default" : "outline"}
              size="sm"
              className="h-9 shrink-0"
              onClick={() => setSoAtencao((v) => !v)}
              data-testid="btn-filtro-atencao"
            >
              <AlertTriangle size={14} className="mr-1.5" />
              Precisam de atenção
              {atencao?.total ? ` (${atencao.total})` : ""}
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader className="bg-muted/50 sticky top-0 z-10 backdrop-blur-md">
              <TableRow>
                <TableHead className="font-mono text-xs uppercase tracking-wider w-[250px]">Contato</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider">Etapa</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider">Temperatura</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider">Plano de interesse</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-right">Último contato</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-40" /><Skeleton className="h-3 w-24 mt-2" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24 ml-auto" /></TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                ))
              ) : leadsVisiveis.length > 0 ? (
                leadsVisiveis.map((lead) => (
                  <TableRow key={lead.id} className="group hover:bg-muted/30 cursor-pointer transition-colors" data-testid={`lead-row-${lead.id}`}>
                    <TableCell>
                      <Link href={`/leads/${lead.id}`} className="block">
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">{lead.name || "Dentista sem nome"}</span>
                              {/* Marcado pela central: o selo diz o motivo. Quando
                                  não há marcação, o triângulo do handoff continua
                                  valendo — ele é o registro histórico de que o
                                  dentista já pediu uma pessoa algum dia. */}
                              {motivoPorLead.has(lead.id) ? (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] border-red-500/50 text-red-600 dark:text-red-400"
                                  title={rotuloAtencao(motivoPorLead.get(lead.id))}
                                  data-testid={`selo-atencao-${lead.id}`}
                                >
                                  {rotuloAtencaoCurto(motivoPorLead.get(lead.id))}
                                </Badge>
                              ) : (
                                lead.handoffRequested && (
                                  <span title="Já pediu para falar com uma pessoa">
                                    <AlertTriangle className="h-3 w-3 text-destructive" />
                                  </span>
                                )
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground font-mono">{lead.phone}</span>
                          </div>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/leads/${lead.id}`} className="block">
                        <span className="text-sm">{rotuloEtapa(lead.funnelStage)}</span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/leads/${lead.id}`} className="block">
                        {lead.status === "closed" || lead.status === "lost" ? (
                          <StatusBadge status={lead.status} />
                        ) : (
                          <TemperaturaBadge temperatura={(lead as { temperatura?: number }).temperatura ?? 0} />
                        )}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/leads/${lead.id}`} className="block">
                        <span className="text-sm text-muted-foreground">{rotuloPlano(lead.planInterest)}</span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/leads/${lead.id}`} className="block">
                        <div className="flex items-center justify-end gap-2 text-muted-foreground text-xs font-mono">
                          {lead.lastMessageAt ? new Date(lead.lastMessageAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <ConfirmarExclusao
                        titulo={`Apagar ${lead.name || lead.phone}?`}
                        descricao="Apaga o dentista, todas as mensagens trocadas com ele e os follow-ups agendados. Não dá para desfazer."
                        aoConfirmar={() => confirmarExclusao(lead.id, lead.name || lead.phone)}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          disabled={apagandoId === lead.id}
                          data-testid={`btn-apagar-lead-${lead.id}`}
                          title="Apagar"
                        >
                          {apagandoId === lead.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </ConfirmarExclusao>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-64 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <Filter className="h-10 w-10 mb-3 text-muted-foreground/30" />
                      <p className="text-lg font-medium text-foreground">
                        {soAtencao ? "Ninguém precisa de você agora" : "Nenhum dentista encontrado"}
                      </p>
                      <p className="text-sm">
                        {soAtencao
                          ? "Desligue o filtro para ver a lista completa."
                          : "Tente mudar os filtros ou a busca."}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Simple Pagination Footer Placeholder */}
        <div className="p-3 border-t border-border bg-muted/20 flex items-center justify-between shrink-0 text-xs text-muted-foreground">
          <div>
            {soAtencao
              ? `Mostrando ${leadsVisiveis.length} que precisam de você`
              : `Mostrando ${leadsVisiveis.length} de ${data?.total || 0} dentistas`}
          </div>
        </div>
      </div>
    </div>
  );
}
