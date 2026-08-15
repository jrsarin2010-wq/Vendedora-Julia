import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Filter,
  MapPin,
  Radar,
  Search,
  Star,
  BadgeCheck,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { rotuloProspeccao, PROSPECCAO_PT } from "@/lib/rotulos";
import {
  obterStatusDaVarredura,
  definirVarreduraAtiva,
  obterStatusDaVerificacao,
  definirVerificacaoAtiva,
  listarProspects,
  obterResumoDeProspects,
  type StatusDaVarredura,
  type StatusDaVerificacao,
  type StatusProspeccao,
  type ClinicaProspect,
} from "@/lib/varredura-api";

const CHAVE_STATUS = ["varredura-status"] as const;
const CHAVE_VERIFICACAO = ["verificacao-status"] as const;
const CHAVE_RESUMO = ["prospects-resumo"] as const;

/** Quantas clínicas por página. */
const POR_PAGINA = 50;

/** As 27 UFs das capitais da Onda 1, para o filtro não virar campo livre. */
const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS",
  "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC",
  "SE", "SP", "TO",
];

const dinheiro = (v: number) =>
  `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Selo do estado da prospecção, no molde do StatusBadge da lista de dentistas.
 * As cores contam a história do funil: cinza é fim de linha sem culpa de
 * ninguém, vermelho é descarte, verde é o que virou lead.
 */
export function StatusProspeccaoBadge({ status }: { status: string }) {
  const cores: Record<string, string> = {
    novo: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
    apto: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800",
    na_fila:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
    promovido:
      "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
    ja_existente:
      "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
    sem_telefone:
      "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700",
    telefone_invalido:
      "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700",
    sem_whatsapp:
      "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700",
    descartado:
      "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
  };

  return (
    <Badge
      variant="outline"
      className={`font-mono text-[10px] uppercase tracking-wider ${cores[status] ?? cores.novo}`}
      data-testid={`status-prospeccao-${status}`}
    >
      {rotuloProspeccao(status)}
    </Badge>
  );
}

/** Bloco 1 — o controle da varredura. */
function ControleDaVarredura() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, isError } = useQuery({
    queryKey: CHAVE_STATUS,
    queryFn: obterStatusDaVarredura,
    // A tela acompanha a varredura andando: uma rodada leva ~60s do disparo à
    // ingestão, então meio minuto é o passo que mostra movimento sem pesar.
    refetchInterval: 30_000,
  });

  const alternar = useMutation({
    mutationFn: definirVarreduraAtiva,
    onSuccess: (novo: StatusDaVarredura) => {
      // O POST devolve o status inteiro: escrevemos direto no cache em vez de
      // reconsultar, para o botão não piscar no estado antigo.
      queryClient.setQueryData(CHAVE_STATUS, novo);
      toast({
        title: novo.ativa ? "Varredura ligada" : "Varredura desligada",
        description: novo.ativa
          ? "O worker volta a disparar no próximo ciclo (até 1 minuto)."
          : "Nenhuma rodada nova será disparada. O que já está em voo termina.",
      });
    },
    onError: (e: unknown) => {
      toast({
        title: "Não deu para mudar",
        description: e instanceof Error ? e.message : "Tente de novo.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Não consegui carregar o estado da varredura.
        </CardContent>
      </Card>
    );
  }

  const percentual =
    data.tetoUsd > 0 ? Math.min(100, (data.gastoMesUsd / data.tetoUsd) * 100) : 0;
  const orcamentoApertado = percentual >= 80;
  // O botão só faz sentido com o interruptor geral ligado, e nunca durante uma
  // pausa por erro: religar sem consertar a causa só repete o erro.
  const botaoTravado =
    !data.interruptorGeral || data.pausadaPorErro || alternar.isPending;

  return (
    <Card data-testid="card-controle-varredura">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold font-mono flex items-center gap-2">
          <Radar size={18} className="text-primary" />
          Varredura do Google Maps
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Faixas de aviso: dizem por que o botão não obedece, em vez de
            deixar o usuário clicando num controle morto. */}
        {!data.interruptorGeral && (
          <div
            className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
            data-testid="aviso-interruptor-geral"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium text-foreground">
                O interruptor geral está desligado.
              </p>
              <p className="text-muted-foreground">
                A variável <code className="font-mono">APIFY_SWEEP_ENABLED</code> precisa
                estar como <code className="font-mono">true</code> no Railway. Enquanto
                não estiver, este botão não faz nada.
              </p>
            </div>
          </div>
        )}

        {data.pausadaPorErro && (
          <div
            className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
            data-testid="aviso-pausada"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" />
            <div>
              <p className="font-medium text-foreground">
                Varredura pausada por um problema nosso.
              </p>
              <p className="text-muted-foreground">
                {data.motivoPausa ?? "Sem detalhe."}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                A fila não foi penalizada. Conserte a causa (normalmente a chave do
                Apify) — o reinício do serviço retoma sozinho.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted/20 p-3">
          <div>
            <p className="text-sm font-medium">
              {data.ativa ? "Ligada" : "Desligada"}
            </p>
            <p className="text-xs text-muted-foreground">
              {data.ativa
                ? "O worker dispara uma rodada por ciclo, respeitando as travas."
                : "Nada é disparado enquanto estiver assim."}
            </p>
          </div>
          <Switch
            checked={data.ativa}
            disabled={botaoTravado}
            onCheckedChange={(v) => alternar.mutate(v)}
            data-testid="switch-varredura-ativa"
          />
        </div>

        {/* Orçamento */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">Orçamento do mês</span>
            <span className="font-mono" data-testid="texto-orcamento">
              {dinheiro(data.gastoMesUsd)}{" "}
              <span className="text-muted-foreground">de {dinheiro(data.tetoUsd)}</span>
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all ${
                orcamentoApertado ? "bg-destructive" : "bg-primary"
              }`}
              style={{ width: `${percentual}%` }}
              data-testid="barra-orcamento"
            />
          </div>
        </div>

        {/* Fila e cota, em números */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Numero rotulo="Pendentes" valor={data.fila.pendente} testId="fila-pendente" />
          <Numero rotulo="Concluídas" valor={data.fila.concluida} testId="fila-concluida" />
          <Numero
            rotulo="Falharam"
            valor={data.fila.falhou}
            testId="fila-falhou"
            alerta={data.fila.falhou > 0}
          />
          <Numero
            rotulo="Rodadas em 24h"
            valor={`${data.rodadasHoje} / ${data.tetoDiario}`}
            testId="cota-diaria"
          />
        </div>

        {data.ultimaVarredura && (
          <p className="text-xs text-muted-foreground" data-testid="ultima-varredura">
            Última: {data.ultimaVarredura.termo} em {data.ultimaVarredura.cidade}/
            {data.ultimaVarredura.uf}
            {data.ultimaVarredura.concluidaEm
              ? ` — ${new Date(data.ultimaVarredura.concluidaEm).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : ""}
          </p>
        )}

        {/* A verificação mora no MESMO card de propósito: as duas coisas são o
            mesmo trabalho visto em dois momentos — a varredura traz a clínica,
            a verificação diz se dá para falar com ela. Separar em dois cards
            faria parecer que uma anda sem a outra. */}
        <SecaoDeVerificacao />
      </CardContent>
    </Card>
  );
}

/**
 * Etapa 3A — o segundo interruptor.
 *
 * Consulta própria, e não um campo a mais no status da varredura: são dois
 * workers independentes, e um erro ao ler o estado de um não pode apagar a
 * tela do outro.
 */
function SecaoDeVerificacao() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, isError } = useQuery({
    queryKey: CHAVE_VERIFICACAO,
    queryFn: obterStatusDaVerificacao,
    refetchInterval: 30_000,
  });

  const alternar = useMutation({
    mutationFn: definirVerificacaoAtiva,
    onSuccess: (novo: StatusDaVerificacao) => {
      queryClient.setQueryData(CHAVE_VERIFICACAO, novo);
      toast({
        title: novo.ativa ? "Verificação ligada" : "Verificação desligada",
        description: novo.ativa
          ? `Até ${novo.tamanhoDoLote} clínicas por lote, com 15 minutos entre um lote e outro.`
          : "Nenhuma consulta nova à Evolution. As clínicas ficam esperando em 'novo'.",
      });
    },
    onError: (e: unknown) => {
      toast({
        title: "Não deu para mudar",
        description: e instanceof Error ? e.message : "Tente de novo.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-4 border-t border-border pt-5" data-testid="secao-verificacao">
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} className="text-primary" />
        <h3 className="text-sm font-semibold font-mono">Verificação de WhatsApp</h3>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : isError || !data ? (
        <p className="text-sm text-muted-foreground">
          Não consegui carregar o estado da verificação.
        </p>
      ) : (
        <>
          {!data.interruptorGeral && (
            <div
              className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
              data-testid="aviso-verificacao-interruptor"
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
              <div>
                <p className="font-medium text-foreground">
                  O interruptor geral está desligado.
                </p>
                <p className="text-muted-foreground">
                  A variável <code className="font-mono">VERIFICACAO_ENABLED</code> precisa
                  estar como <code className="font-mono">true</code> no Railway. Enquanto
                  não estiver, este botão não faz nada.
                </p>
              </div>
            </div>
          )}

          {data.pausadaPorErro && (
            <div
              className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
              data-testid="aviso-verificacao-pausada"
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-foreground">
                  Verificação pausada: a Evolution não respondeu.
                </p>
                <p className="text-muted-foreground">{data.motivoPausa ?? "Sem detalhe."}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Nenhuma clínica foi descartada — todas voltam para a fila. Confira a
                  instância (é a mesma que fala com os dentistas); o reinício do serviço
                  retoma sozinho.
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted/20 p-3">
            <div>
              <p className="text-sm font-medium">{data.ativa ? "Ligada" : "Desligada"}</p>
              <p className="text-xs text-muted-foreground">
                {data.ativa
                  ? "Descobre sozinha quem tem WhatsApp e deixa a clínica em 'apto'."
                  : "As clínicas captadas ficam esperando em 'novo'."}
              </p>
            </div>
            <Switch
              checked={data.ativa}
              disabled={!data.interruptorGeral || data.pausadaPorErro || alternar.isPending}
              onCheckedChange={(v) => alternar.mutate(v)}
              data-testid="switch-verificacao-ativa"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Numero rotulo="A verificar" valor={data.aVerificar} testId="verificacao-a-verificar" />
            <Numero
              rotulo="Verificados em 24h"
              valor={`${data.verificadosNa24h} / ${data.tetoDiario}`}
              testId="verificacao-cota"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Verificar é só uma consulta. Promover a clínica a dentista na lista continua
            sendo feito à mão.
          </p>
        </>
      )}
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  testId,
  alerta = false,
}: {
  rotulo: string;
  valor: number | string;
  testId: string;
  alerta?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{rotulo}</p>
      <p
        className={`font-mono text-lg font-bold ${alerta ? "text-destructive" : "text-foreground"}`}
        data-testid={testId}
      >
        {valor}
      </p>
    </div>
  );
}

/** Bloco 2 — a concentração por bairro. */
function ConcentracaoPorBairro() {
  const { data, isLoading, isError } = useQuery({
    queryKey: CHAVE_RESUMO,
    queryFn: obterResumoDeProspects,
    refetchInterval: 60_000,
  });

  return (
    <Card data-testid="card-bairros">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold font-mono flex items-center gap-2">
          <MapPin size={18} className="text-primary" />
          Concentração por bairro
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : isError || !data ? (
          <p className="text-sm text-muted-foreground">
            Não consegui carregar o resumo.
          </p>
        ) : data.porBairro.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma clínica captada ainda.
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              O Maps ancora a busca num ponto e varre o entorno. Bairro repetido
              demais significa que a cidade não foi coberta — é o sinal de que a
              próxima onda precisa buscar por bairro.
            </p>
            <div className="space-y-1.5">
              {data.porBairro.slice(0, 10).map((b) => {
                const proporcao = data.total > 0 ? (b.total / data.total) * 100 : 0;
                return (
                  <div
                    key={b.bairro}
                    className="flex items-center gap-3"
                    data-testid={`bairro-${b.bairro}`}
                  >
                    <span className="w-40 shrink-0 truncate text-sm">{b.bairro}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/70"
                        style={{ width: `${proporcao}%` }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right font-mono text-xs text-muted-foreground">
                      {b.total} ({Math.round(proporcao)}%)
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-4 border-t border-border pt-3 text-xs text-muted-foreground">
              <span data-testid="resumo-total">
                <strong className="font-mono text-foreground">{data.total}</strong> captadas
              </span>
              <span data-testid="resumo-com-telefone">
                <strong className="font-mono text-foreground">{data.comTelefone}</strong> com
                telefone
              </span>
              <span data-testid="resumo-com-whatsapp">
                <strong className="font-mono text-foreground">
                  {data.comWhatsapp === null ? "—" : data.comWhatsapp}
                </strong>{" "}
                com WhatsApp
                {data.comWhatsapp === null && " (ninguém verificado ainda)"}
              </span>
              <span data-testid="resumo-sem-whatsapp">
                <strong className="font-mono text-foreground">
                  {data.semWhatsapp === null ? "—" : data.semWhatsapp}
                </strong>{" "}
                sem WhatsApp
              </span>
              <span data-testid="resumo-telefone-invalido">
                <strong className="font-mono text-foreground">{data.telefoneInvalido}</strong>{" "}
                com telefone inválido
              </span>
            </div>

            {/*
              A TAXA DE APROVEITAMENTO — o número que decide se vale gastar o
              crédito que sobrou do Apify.

              A base é quem TINHA telefone, e não o total captado: clínica sem
              telefone no Maps é buraco do dado do Google, não da verificação, e
              misturar os dois faria a varredura parecer pior do que é.
            */}
            {data.comWhatsapp !== null && data.comTelefone > 0 && (
              <p className="mt-3 text-xs text-muted-foreground" data-testid="taxa-aproveitamento">
                Aproveitamento:{" "}
                <strong className="font-mono text-foreground">
                  {Math.round((data.comWhatsapp / data.comTelefone) * 100)}%
                </strong>{" "}
                dos telefones captados têm WhatsApp.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Bloco 3 — a tabela de clínicas. */
function TabelaDeClinicas() {
  const [busca, setBusca] = useState("");
  const buscaAtrasada = useDebounce(busca, 300);
  const [status, setStatus] = useState<StatusProspeccao | "all">("all");
  const [uf, setUf] = useState<string>("all");
  const [pagina, setPagina] = useState(0);

  // Mudar filtro tem de voltar para a primeira página: sem isto, filtrar na
  // página 3 mostra "nenhuma clínica" quando o resultado tem duas páginas.
  function comReset<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setPagina(0);
    };
  }

  const filtros = {
    status: status === "all" ? null : status,
    uf: uf === "all" ? null : uf,
    busca: buscaAtrasada || null,
    limite: POR_PAGINA,
    offset: pagina * POR_PAGINA,
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ["prospects", filtros],
    queryFn: () => listarProspects(filtros),
  });

  const itens: ClinicaProspect[] = data?.itens ?? [];
  const total = data?.total ?? 0;
  const primeiro = total === 0 ? 0 : pagina * POR_PAGINA + 1;
  const ultimo = Math.min((pagina + 1) * POR_PAGINA, total);
  const temProxima = (pagina + 1) * POR_PAGINA < total;

  return (
    /*
     * Altura PRÓPRIA, não `flex-1`.
     *
     *   min-h → o piso que garante que ela nunca some, aconteça o que
     *           acontecer acima dela. É o conserto do bug.
     *   max-h → mantém a rolagem DENTRO da tabela, que é o que faz o cabeçalho
     *           `sticky` servir para alguma coisa. Sem teto, o card cresceria
     *           até caber as 50 linhas e o sticky não grudaria em nada.
     *
     * Em janela baixa o `min-h` vence o `max-h` (é assim que o CSS resolve o
     * conflito), a tabela fica nos 32rem e a página rola. Nunca zero.
     */
    <div className="flex max-h-[calc(100vh-12rem)] min-h-[32rem] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex shrink-0 flex-col items-center justify-between gap-4 border-b border-border bg-muted/20 p-4 sm:flex-row">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Buscar pelo nome da clínica..."
            className="h-9 bg-background pl-9"
            value={busca}
            onChange={(e) => comReset(setBusca)(e.target.value)}
            data-testid="input-prospects-busca"
          />
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Select
            value={status}
            onValueChange={comReset((v: string) => setStatus(v as StatusProspeccao | "all"))}
          >
            <SelectTrigger
              className="h-9 w-full bg-background sm:w-[180px]"
              data-testid="select-status-prospeccao"
            >
              <SelectValue placeholder="Situação" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as situações</SelectItem>
              {Object.entries(PROSPECCAO_PT).map(([valor, rotulo]) => (
                <SelectItem key={valor} value={valor}>
                  {rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={uf} onValueChange={comReset(setUf)}>
            <SelectTrigger
              className="h-9 w-full bg-background sm:w-[110px]"
              data-testid="select-uf-prospeccao"
            >
              <SelectValue placeholder="UF" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as UFs</SelectItem>
              {UFS.map((sigla) => (
                <SelectItem key={sigla} value={sigla}>
                  {sigla}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur-md">
            <TableRow>
              <TableHead className="w-[260px] font-mono text-xs uppercase tracking-wider">
                Clínica
              </TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Bairro</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Cidade/UF</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Telefone</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Nota</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">
                Perfil no Google
              </TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-5 w-44" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-28" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-32" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-20" />
                  </TableCell>
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={7} className="h-64 text-center">
                  <div className="flex flex-col items-center justify-center text-muted-foreground">
                    <AlertTriangle className="mb-3 h-10 w-10 text-destructive/40" />
                    <p className="text-lg font-medium text-foreground">
                      Não consegui carregar as clínicas
                    </p>
                    <p className="text-sm">Recarregue a página em alguns instantes.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : itens.length > 0 ? (
              itens.map((c) => (
                <TableRow
                  key={c.id}
                  className="transition-colors hover:bg-muted/30"
                  data-testid={`prospect-row-${c.id}`}
                >
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{c.nome}</span>
                      {c.categoria && (
                        <span className="text-xs text-muted-foreground">{c.categoria}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{c.bairro || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {c.cidade ? `${c.cidade}${c.uf ? `/${c.uf}` : ""}` : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {c.telefoneWhatsapp || c.telefoneRaw || (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {c.nota ? (
                      <span className="flex items-center gap-1 text-sm">
                        <Star size={12} className="fill-amber-400 text-amber-400" />
                        <span className="font-mono">{Number(c.nota).toFixed(1)}</span>
                        <span className="text-xs text-muted-foreground">
                          ({c.totalAvaliacoes ?? 0})
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {/* Ficha NÃO assumida é sinal de qualificação: ninguém cuida
                        da presença digital dessa clínica. Por isso ganha
                        destaque em vez de virar detalhe técnico. */}
                    {c.perfilReivindicado === false ? (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/50 text-[10px] text-emerald-700 dark:text-emerald-400"
                        title="Ninguém assumiu a ficha desta clínica no Google"
                        data-testid={`perfil-livre-${c.id}`}
                      >
                        Ficha livre
                      </Badge>
                    ) : c.perfilReivindicado === true ? (
                      <span
                        className="flex items-center gap-1 text-xs text-muted-foreground"
                        title="A ficha do Google já foi assumida"
                      >
                        <BadgeCheck size={13} />
                        Assumida
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground" title="O ator não informou">
                        —
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusProspeccaoBadge status={c.statusProspeccao} />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="h-64 text-center">
                  <div className="flex flex-col items-center justify-center text-muted-foreground">
                    <Filter className="mb-3 h-10 w-10 text-muted-foreground/30" />
                    <p className="text-lg font-medium text-foreground">
                      Nenhuma clínica encontrada
                    </p>
                    <p className="text-sm">
                      Tente mudar os filtros, ou ligue a varredura para captar as
                      primeiras.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        <div data-testid="prospects-contagem">
          {total === 0 ? "Nenhuma clínica" : `Mostrando ${primeiro}–${ultimo} de ${total}`}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            disabled={pagina === 0 || isLoading}
            onClick={() => setPagina((p) => Math.max(0, p - 1))}
            data-testid="btn-pagina-anterior"
          >
            Anterior
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            disabled={!temProxima || isLoading}
            onClick={() => setPagina((p) => p + 1)}
            data-testid="btn-pagina-proxima"
          >
            Próxima
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Prospeccao() {
  return (
    /*
     * SEM altura fixa aqui, de propósito.
     *
     * A versão anterior era `flex h-[calc(100vh-8rem)] flex-col` com os dois
     * cards em `shrink-0`. Numa tela que é SÓ tabela (a lista de dentistas)
     * isso funciona, porque o único irmão é um cabeçalho de uma linha e sempre
     * sobra espaço. Aqui, com dois cards em cima, a sobra chegava a zero — e
     * como a raiz da tabela tem `overflow-hidden`, o mínimo automático do
     * flexbox deixa de valer e ela COLAPSAVA para 0px: sem linhas, sem
     * skeleton, sem estado vazio. Some inteira, sem erro nenhum.
     *
     * Agora a página cresce com o conteúdo e quem rola é o <main> do layout,
     * que já tem overflow-auto. A tabela ganha altura própria (ver
     * TabelaDeClinicas) em vez de disputar o que sobrou.
     */
    <div className="animate-in fade-in mx-auto flex max-w-7xl flex-col gap-6 pb-10 duration-300">
      <div>
        <h1 className="font-mono text-2xl font-bold tracking-tight text-foreground">
          Prospecção
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A varredura do Google Maps e as clínicas captadas, antes de virarem
          dentistas na lista.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ControleDaVarredura />
        <ConcentracaoPorBairro />
      </div>

      <TabelaDeClinicas />
    </div>
  );
}
