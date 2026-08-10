import { useRef, useState } from "react";
import { Upload, ClipboardPaste, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  lerTextoDeImportacao,
  importarLeads,
  type LeadParaImportar,
  type ResumoImportacao,
} from "@/lib/import-api";

const EXEMPLO = `nome;telefone;clinica;instagram;cidade
Carlos;85999998888;Clínica Sorriso;@clinicasorriso;Fortaleza
Marina;(85) 98888-7777;Odonto Vida;@odontovida;Fortaleza`;

export default function Import() {
  const [texto, setTexto] = useState("");
  const [leads, setLeads] = useState<LeadParaImportar[]>([]);
  const [problemas, setProblemas] = useState<string[]>([]);
  const [analisado, setAnalisado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resumo, setResumo] = useState<ResumoImportacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const inputArquivo = useRef<HTMLInputElement>(null);

  function analisar(conteudo: string) {
    const { leads: lidos, problemas: probs } = lerTextoDeImportacao(conteudo);
    setLeads(lidos);
    setProblemas(probs);
    setAnalisado(true);
    setResumo(null);
    setErro(null);
  }

  function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    const leitor = new FileReader();
    leitor.onload = () => {
      const conteudo = String(leitor.result ?? "");
      setTexto(conteudo);
      analisar(conteudo);
    };
    leitor.readAsText(arquivo, "utf-8");
    // Permite escolher o mesmo arquivo de novo depois de corrigi-lo.
    e.target.value = "";
  }

  async function confirmar() {
    setEnviando(true);
    setErro(null);
    try {
      setResumo(await importarLeads(leads));
      setLeads([]);
      setAnalisado(false);
      setTexto("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha na importação");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-5xl mx-auto pb-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground font-mono">
          Importar leads
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cole a lista ou suba um CSV. Os dentistas entram como{" "}
          <strong>aguardando abordagem</strong> — nenhuma mensagem é enviada agora.
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <ClipboardPaste size={16} className="text-primary" />
            Colar lista
          </h2>
          <div className="flex gap-2">
            <input
              ref={inputArquivo}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={aoEscolherArquivo}
              data-testid="input-arquivo-csv"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => inputArquivo.current?.click()}
              data-testid="btn-subir-csv"
            >
              <Upload size={14} className="mr-2" />
              Subir CSV
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setTexto(EXEMPLO);
                analisar(EXEMPLO);
              }}
              data-testid="btn-exemplo"
            >
              Ver exemplo
            </Button>
          </div>
        </div>

        <Textarea
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setAnalisado(false);
            setResumo(null);
          }}
          placeholder={EXEMPLO}
          rows={10}
          className="font-mono text-xs"
          data-testid="textarea-leads"
        />

        <p className="text-xs text-muted-foreground">
          Primeira linha é o cabeçalho. Aceita vírgula, ponto-e-vírgula ou tabulação.
          Só o telefone é obrigatório; os nomes de coluna podem estar em português.
        </p>

        <Button
          onClick={() => analisar(texto)}
          disabled={!texto.trim()}
          data-testid="btn-analisar"
        >
          Conferir antes de importar
        </Button>
      </div>

      {problemas.length > 0 && (
        <div className="border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-amber-800 dark:text-amber-300">
            <AlertTriangle size={16} />
            Avisos ({problemas.length})
          </h3>
          <ul className="mt-2 space-y-1 text-xs text-amber-800 dark:text-amber-300 list-disc pl-5">
            {problemas.slice(0, 20).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
            {problemas.length > 20 && <li>...e mais {problemas.length - 20}.</li>}
          </ul>
        </div>
      )}

      {analisado && leads.length > 0 && (
        <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold">
                Prévia — {leads.length} dentista{leads.length > 1 ? "s" : ""}
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Telefone repetido, já cadastrado ou de quem pediu para não receber
                mensagens é descartado no servidor. O resumo aparece depois.
              </p>
            </div>
            <Button onClick={confirmar} disabled={enviando} data-testid="btn-confirmar-importacao">
              {enviando ? (
                <>
                  <Loader2 size={14} className="mr-2 animate-spin" />
                  Importando...
                </>
              ) : (
                `Importar ${leads.length}`
              )}
            </Button>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Clínica</TableHead>
                  <TableHead>Instagram</TableHead>
                  <TableHead>Cidade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.slice(0, 50).map((l, i) => (
                  <TableRow key={i} data-testid={`linha-previa-${i}`}>
                    <TableCell>{l.name ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{l.phone}</TableCell>
                    <TableCell>{l.clinicName ?? "—"}</TableCell>
                    <TableCell>{l.instagram ?? "—"}</TableCell>
                    <TableCell>{l.city ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {leads.length > 50 && (
            <div className="p-3 text-xs text-muted-foreground border-t border-border">
              Mostrando os 50 primeiros. Todos os {leads.length} serão enviados.
            </div>
          )}
        </div>
      )}

      {analisado && leads.length === 0 && (
        <div className="border border-dashed border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
          Não consegui ler nenhum dentista desse texto.
        </div>
      )}

      {erro && (
        <div className="border border-destructive/40 bg-destructive/10 rounded-lg p-4 text-sm text-destructive">
          {erro}
        </div>
      )}

      {resumo && (
        <div className="bg-card border border-border rounded-lg shadow-sm p-6">
          <h2 className="text-sm font-semibold flex items-center gap-2 mb-4">
            <CheckCircle2 size={16} className="text-green-600" />
            Importação concluída
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { rotulo: "Importados", valor: resumo.importados, cor: "text-green-600" },
              { rotulo: "Já existiam", valor: resumo.duplicados, cor: "text-muted-foreground" },
              { rotulo: "Telefone inválido", valor: resumo.invalidos, cor: "text-amber-600" },
              { rotulo: "Pediram para parar", valor: resumo.ignoradosPorOptOut, cor: "text-slate-500" },
            ].map((c) => (
              <div key={c.rotulo} className="border border-border rounded-md p-3">
                <div className={`text-2xl font-bold font-mono ${c.cor}`}>{c.valor}</div>
                <div className="text-xs text-muted-foreground mt-1">{c.rotulo}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Quem já tinha cadastro não foi alterado, e quem pediu para não receber
            mensagens continua fora — mesmo aparecendo na planilha.
          </p>
        </div>
      )}
    </div>
  );
}
