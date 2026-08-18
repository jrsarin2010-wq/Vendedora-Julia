import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Filter,
  MapPin,
  Radar,
  Search,
  Smartphone,
  Phone,
  Star,
  BadgeCheck,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  promoverProspects,
  MAXIMO_POR_PROMOCAO,
  type StatusDaVarredura,
  type StatusDaVerificacao,
  type StatusProspeccao,
  type ClinicaProspect,
  type TipoDeLinha,
  type ResultadoDaPromocao,
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

/**
 * O FILTRO RÁPIDO — os dois únicos recortes que decidem o dia.
 *
 * "A trabalhar" é quem ainda pode virar dentista. "Já resolvidas" é histórico:
 * a clínica não sai da tabela, só sai da fila de trabalho. Sem essa separação
 * a lista fica IGUAL antes e depois do trabalho feito, e a única forma de
 * saber quem falta é ler linha por linha.
 *
 * Só "A trabalhar" é escrita à mão; "Já resolvidas" é TODO O RESTO, calculado
 * a partir dela. Duas listas fechadas deixariam um status fora das duas — e
 * uma clínica invisível nos dois filtros é pior que uma no grupo errado. Foi
 * o que aconteceria com `na_fila`, que é o instante entre "apta" e
 * "promovida" e não estava em nenhuma das duas listas pensadas.
 */
const A_TRABALHAR: StatusProspeccao[] = ["novo", "apto", "sem_telefone"];

type Grupo = "a_trabalhar" | "resolvidas";

const GRUPOS: Record<Grupo, { rotulo: string; statuses: StatusProspeccao[] }> = {
  a_trabalhar: { rotulo: "A trabalhar", statuses: A_TRABALHAR },
  resolvidas: {
    rotulo: "Já resolvidas",
    statuses: (Object.keys(PROSPECCAO_PT) as StatusProspeccao[]).filter(
      (s) => !A_TRABALHAR.includes(s),
    ),
  },
};

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
              {/*
                QUANTO DA LISTA JÁ VIROU DENTISTA — o único número aqui que
                mede trabalho FEITO, e não o que o Maps entregou.

                É `promovido` puro, sem somar `ja_existente`: a que já era lead
                nunca foi promovida por ninguém, entrou na base por outro
                caminho. Somar as duas inflaria justamente o número que serve
                para saber quanto ainda falta.
              */}
              <span data-testid="resumo-promovidas">
                <strong className="font-mono text-foreground">{data.porStatus.promovido}</strong>{" "}
                já promovidas
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

            {/*
              A TAXA DO TELEFONE FIXO — a única razão pela qual esta linha
              existe é decidir, com dado, se um dia vale barrar fixo antes da
              verificação. Hoje ele passa, e por medição: a 123 Odonto entrou
              com fixo e voltou apta.

              O DENOMINADOR fica na frase inteiro, não escondido atrás da
              porcentagem: "20% dos fixos têm WhatsApp" não diz nada se foram 5
              fixos, e diz tudo se foram 300. Enquanto ninguém foi verificado,
              a frase diz quantos ESPERAM — 0% ali leria como "conferimos e
              nenhum tem", que é o mesmo engano do "0 com WhatsApp".
            */}
            {data.fixos.total > 0 && (
              <p className="mt-1 text-xs text-muted-foreground" data-testid="taxa-fixos">
                Telefone fixo:{" "}
                {data.fixos.verificados === 0 ? (
                  <>
                    <strong className="font-mono text-foreground">{data.fixos.total}</strong>{" "}
                    captados, nenhum verificado ainda.
                  </>
                ) : (
                  <>
                    <strong className="font-mono text-foreground">
                      {data.fixos.comWhatsapp} de {data.fixos.verificados}
                    </strong>{" "}
                    verificados têm WhatsApp (
                    {Math.round((data.fixos.comWhatsapp / data.fixos.verificados) * 100)}%)
                    {data.fixos.total > data.fixos.verificados &&
                      `, ${data.fixos.total - data.fixos.verificados} na fila`}
                    .
                  </>
                )}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Uma frase com o que aconteceu, para o toast. Contagem zerada não entra: um
 * "0 sem WhatsApp" no meio da linha só rouba a atenção do número que importa.
 */
function contarPromocao(r: ResultadoDaPromocao): string {
  const partes: string[] = [];
  if (r.promovidos.length) partes.push(`${r.promovidos.length} viraram dentista`);
  if (r.jaExistentes.length) partes.push(`${r.jaExistentes.length} já eram lead`);
  if (r.semWhatsapp.length) partes.push(`${r.semWhatsapp.length} sem WhatsApp`);
  if (r.adiados.length)
    partes.push(`${r.adiados.length} adiadas (a Evolution não respondeu — voltam depois)`);
  return partes.length > 0 ? `${partes.join(", ")}.` : "Nada mudou.";
}

/**
 * FIXO OU CELULAR, na própria linha.
 *
 * Muita clínica do Maps só publica o fixo, e sem isto a coluna do telefone era
 * uma fileira de dígitos onde nada distinguia um do outro.
 *
 * O FIXO é que ganha cor. É o caso notável — o que faz olhar duas vezes antes
 * de promover — enquanto celular é o esperado e não precisa disputar atenção.
 * Pintar os dois seria a mesma fileira de antes, só que colorida.
 *
 * Quem decide o tipo é o servidor (`tipoDeLinha`): a tela só desenha, e por
 * isso a etiqueta nunca discorda da taxa do resumo. "indefinido" não vira
 * etiqueta nenhuma.
 */
function EtiquetaDeLinha({ tipo }: { tipo: TipoDeLinha }) {
  if (tipo === "indefinido") return null;
  const fixo = tipo === "fixo";
  const Icone = fixo ? Phone : Smartphone;
  return (
    <span
      className={`flex items-center gap-1 text-[10px] uppercase tracking-wider ${
        fixo ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"
      }`}
      title={
        fixo
          ? "Telefone fixo (8 dígitos depois do DDD). Não é impedimento: fixo com WhatsApp Business é comum."
          : "Celular (9 dígitos depois do DDD)"
      }
      data-testid={`tipo-de-linha-${tipo}`}
    >
      <Icone size={10} />
      {fixo ? "fixo" : "celular"}
    </span>
  );
}

/** Bloco 3 — a tabela de clínicas. */
function TabelaDeClinicas() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [busca, setBusca] = useState("");
  const buscaAtrasada = useDebounce(busca, 300);
  const [grupo, setGrupo] = useState<Grupo>("a_trabalhar");
  /*
   * Nasce em "Apta", e não em "todas".
   *
   * Esta tela existe para ESCOLHER quem promover. Abrir em "todas" é abrir na
   * lista inteira — as promovidas de ontem no meio das aptas de hoje — e o
   * primeiro gesto de todo dia vira filtrar de novo a mesma coisa.
   */
  const [status, setStatus] = useState<StatusProspeccao | "all">("apto");
  const [uf, setUf] = useState<string>("all");
  const [pagina, setPagina] = useState(0);
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [confirmando, setConfirmando] = useState(false);

  // Mudar filtro tem de voltar para a primeira página: sem isto, filtrar na
  // página 3 mostra "nenhuma clínica" quando o resultado tem duas páginas.
  function comReset<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setPagina(0);
    };
  }

  /*
   * O grupo é o recorte; o select escolhe DENTRO dele. Por isso "todas" aqui
   * nunca quer dizer a tabela inteira — quer dizer os status daquele grupo.
   */
  const statusFiltrado = status === "all" ? GRUPOS[grupo].statuses : status;

  /*
   * Trocar de grupo devolve a situação para "todas".
   *
   * Não é higiene: "Apta" não existe em "Já resolvidas". Manter a escolha
   * anterior abriria o grupo novo sem uma linha sequer, e tela vazia por
   * filtro cruzado se parece com banco vazio.
   */
  function trocarGrupo(g: Grupo) {
    setGrupo(g);
    setStatus("all");
    setPagina(0);
  }

  const filtros = {
    status: statusFiltrado,
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

  /*
   * A PROMOÇÃO (Etapa 3C) só aparece no filtro "Apta".
   *
   * Não é enfeite: promover é a única ação desta tela que cria dentista de
   * verdade, e o servidor recusa a lista inteira se qualquer clínica não
   * estiver `apto`. Oferecer a caixinha em "Todas as situações" seria convidar
   * a montar uma seleção que vai voltar recusada por inteiro.
   */
  const promovendo = status === "apto";

  // Mesma consulta da concentração por bairro — o react-query dedupe pela
  // chave, então não é uma segunda ida ao servidor. É de lá que vem o estado da
  // Júlia, que muda o SIGNIFICADO do botão logo abaixo.
  //
  // Desde a Etapa 4 esse estado é COMBINADO (a env do Railway e o botão da
  // abordagem, no Painel). O servidor já entrega combinado; esta tela não
  // recompõe nada, para não existir uma segunda opinião sobre a mesma coisa.
  const { data: resumo } = useQuery({
    queryKey: CHAVE_RESUMO,
    queryFn: obterResumoDeProspects,
    refetchInterval: 60_000,
  });
  const juliaLigada = resumo?.juliaLigada === true;

  // Filtro ou página que muda invalida a seleção: os ids marcados saem da tela,
  // e promover às cegas o que não está mais visível é exatamente o que o
  // diálogo com os nomes existe para impedir.
  useEffect(() => {
    setSelecionadas(new Set());
  }, [grupo, status, uf, buscaAtrasada, pagina]);

  const escolhidas = itens.filter((c) => selecionadas.has(c.id));
  const paginaInteiraMarcada = itens.length > 0 && escolhidas.length === itens.length;

  function alternar(id: number) {
    setSelecionadas((antes) => {
      const proximo = new Set(antes);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  const promocao = useMutation({
    mutationFn: (ids: number[]) => promoverProspects(ids, "aplicar"),
    onSuccess: (r: ResultadoDaPromocao) => {
      setSelecionadas(new Set());
      setConfirmando(false);
      toast({
        title:
          r.promovidos.length > 0
            ? `${r.promovidos.length} clínica(s) promovida(s)`
            : "Nenhuma clínica virou dentista",
        description: `${contarPromocao(r)}${
          r.promovidos.length > 0 && juliaLigada
            ? " A Júlia vai abordar quem entrou, respeitando o ritmo."
            : ""
        }`,
      });
      // As duas: a lista (as promovidas saem do filtro "Apta") e o resumo (os
      // contadores por status mudaram).
      void queryClient.invalidateQueries({ queryKey: ["prospects"] });
      void queryClient.invalidateQueries({ queryKey: CHAVE_RESUMO });
    },
    onError: (e: unknown) => {
      setConfirmando(false);
      toast({
        title: "Não deu para promover",
        description: e instanceof Error ? e.message : "Tente de novo.",
        variant: "destructive",
      });
    },
  });

  const colunas = promovendo ? 8 : 7;

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
      {/*
        O FILTRO RÁPIDO, acima de tudo o resto.
        Fica em cima da busca de propósito: é ele que diz QUAL lista está sendo
        olhada, e os outros dois filtros só refinam dentro dela.
      */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-muted/30 px-4 py-2"
        data-testid="filtro-rapido"
      >
        {(Object.keys(GRUPOS) as Grupo[]).map((g) => (
          <Button
            key={g}
            size="sm"
            variant={grupo === g ? "default" : "ghost"}
            className="h-8"
            onClick={() => trocarGrupo(g)}
            data-testid={`filtro-grupo-${g}`}
          >
            {GRUPOS[g].rotulo}
          </Button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          Promovida não some da tabela — sai da fila de trabalho.
        </span>
      </div>

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
              {/*
                "Todas desta lista", e não "todas as situações": o que este
                item abre é o grupo escolhido acima, nunca a tabela inteira.
              */}
              <SelectItem value="all">Todas desta lista</SelectItem>
              {GRUPOS[grupo].statuses.map((valor) => (
                <SelectItem key={valor} value={valor}>
                  {PROSPECCAO_PT[valor]}
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

      {/*
        A FAIXA DA PROMOÇÃO.
        O botão e o estado da Júlia moram lado a lado de propósito: promover com
        ela desligada cria o dentista e mais nada; com ela ligada, põe o dentista
        na fila e a mensagem sai. É o mesmo clique com duas consequências
        completamente diferentes, e isso não pode ficar implícito.
      */}
      {promovendo && (
        <div
          className="flex shrink-0 flex-col gap-3 border-b border-border bg-muted/10 p-4 sm:flex-row sm:items-center sm:justify-between"
          data-testid="barra-promocao"
        >
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              className="h-9"
              disabled={
                escolhidas.length === 0 ||
                escolhidas.length > MAXIMO_POR_PROMOCAO ||
                promocao.isPending
              }
              onClick={() => setConfirmando(true)}
              data-testid="btn-promover"
            >
              <UserPlus size={15} className="mr-2" />
              Promover selecionadas
              {escolhidas.length > 0 ? ` (${escolhidas.length})` : ""}
            </Button>
            {escolhidas.length > MAXIMO_POR_PROMOCAO && (
              <span className="text-xs text-destructive" data-testid="aviso-teto-promocao">
                Máximo de {MAXIMO_POR_PROMOCAO} por vez.
              </span>
            )}
          </div>

          <div
            className={`flex items-start gap-2 rounded-md border p-2.5 text-xs sm:max-w-md ${
              juliaLigada
                ? "border-emerald-500/40 bg-emerald-500/10"
                : "border-amber-500/40 bg-amber-500/10"
            }`}
            data-testid={juliaLigada ? "aviso-julia-ligada" : "aviso-julia-desligada"}
          >
            <AlertTriangle
              size={14}
              className={`mt-0.5 shrink-0 ${
                juliaLigada ? "text-emerald-600" : "text-amber-600"
              }`}
            />
            <p className="text-muted-foreground">
              {juliaLigada ? (
                <>
                  <strong className="text-foreground">A Júlia está ligada.</strong> Estas
                  clínicas entram na fila de abordagem.
                </>
              ) : (
                <>
                  <strong className="text-foreground">A Júlia está desligada.</strong>{" "}
                  Promover cria o dentista, mas nenhuma mensagem sai. Para ligar, use
                  o interruptor no topo do Painel.
                </>
              )}
            </p>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur-md">
            <TableRow>
              {promovendo && (
                <TableHead className="w-[44px]">
                  <Checkbox
                    checked={paginaInteiraMarcada}
                    disabled={itens.length === 0}
                    onCheckedChange={(v) =>
                      setSelecionadas(v === true ? new Set(itens.map((c) => c.id)) : new Set())
                    }
                    aria-label="Selecionar todas as clínicas desta página"
                    data-testid="check-todas-da-pagina"
                  />
                </TableHead>
              )}
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
                  {promovendo && (
                    <TableCell>
                      <Skeleton className="h-4 w-4" />
                    </TableCell>
                  )}
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
                <TableCell colSpan={colunas} className="h-64 text-center">
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
                  {promovendo && (
                    <TableCell>
                      <Checkbox
                        checked={selecionadas.has(c.id)}
                        onCheckedChange={() => alternar(c.id)}
                        aria-label={`Selecionar ${c.nome}`}
                        data-testid={`check-prospect-${c.id}`}
                      />
                    </TableCell>
                  )}
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
                    {c.telefoneWhatsapp || c.telefoneRaw ? (
                      <div className="flex flex-col gap-0.5">
                        <span>{c.telefoneWhatsapp || c.telefoneRaw}</span>
                        <EtiquetaDeLinha tipo={c.tipoDeLinha} />
                      </div>
                    ) : (
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
                <TableCell colSpan={colunas} className="h-64 text-center">
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

      {/*
        O diálogo lista os NOMES, não a contagem.
        A abertura fria da Júlia é escrita pelo modelo a cada lead — não existe
        template para revisar antes, e a única forma de ver o que ela escreve é
        ela escrever, para dentista de verdade. Ler "3 clínicas" não é conferir
        nada; ler os nomes é.
      */}
      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Promover {escolhidas.length} clínica(s) a dentista?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {juliaLigada
                    ? "A Júlia está LIGADA: estas clínicas entram na fila e vão receber a primeira mensagem dela."
                    : "A Júlia está desligada: elas viram dentistas na lista, e nenhuma mensagem sai enquanto continuar assim."}
                </p>
                <ul
                  className="max-h-56 space-y-1 overflow-auto rounded-md border border-border bg-muted/20 p-3 text-sm"
                  data-testid="lista-confirmacao-promocao"
                >
                  {escolhidas.map((c) => (
                    <li key={c.id} className="flex justify-between gap-3">
                      <span className="truncate text-foreground">{c.nome}</span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {c.cidade ?? "—"}
                        {c.uf ? `/${c.uf}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-cancelar-promocao">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={promocao.isPending}
              onClick={(evento) => {
                // O AlertDialogAction fecha sozinho ao clicar. Aqui o
                // fechamento é da mutação (sucesso ou erro), para o resultado
                // ter onde aparecer em vez de o diálogo sumir na hora.
                evento.preventDefault();
                promocao.mutate(escolhidas.map((c) => c.id));
              }}
              data-testid="btn-confirmar-promocao"
            >
              {promocao.isPending ? "Promovendo..." : "Promover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
