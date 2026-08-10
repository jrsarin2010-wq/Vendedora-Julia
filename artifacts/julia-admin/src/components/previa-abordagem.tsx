import { useState } from "react";
import { Eye, Loader2, ShieldAlert, ShieldCheck, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { verPreviaDeAbordagem, type PreviaDeAbordagem } from "@/lib/import-api";

/**
 * MODO DE CONFERÊNCIA.
 *
 * Mostra a mensagem que a Júlia mandaria para este dentista, sem mandar.
 * Serve para conferir o texto ANTES de ligar a prospecção — e, quando ela
 * estiver ligada, para entender por que um lead específico ainda não recebeu.
 */
export function PreviaAbordagem({ leadId }: { leadId: number }) {
  const [carregando, setCarregando] = useState(false);
  const [previa, setPrevia] = useState<PreviaDeAbordagem | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function conferir() {
    setCarregando(true);
    setErro(null);
    try {
      setPrevia(await verPreviaDeAbordagem(leadId));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gerar a prévia");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm p-4 sm:p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <MessageSquare size={16} className="text-primary" />
            Primeira mensagem (conferência)
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Mostra o que a Júlia mandaria para este dentista. Não envia nada.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={conferir}
          disabled={carregando}
          data-testid="btn-previa-abordagem"
        >
          {carregando ? (
            <>
              <Loader2 size={14} className="mr-2 animate-spin" />
              Gerando...
            </>
          ) : (
            <>
              <Eye size={14} className="mr-2" />
              {previa ? "Gerar outra" : "Ver mensagem"}
            </>
          )}
        </Button>
      </div>

      {erro && (
        <div className="border border-destructive/40 bg-destructive/10 rounded-md p-3 text-sm text-destructive">
          {erro}
        </div>
      )}

      {previa && (
        <div className="space-y-4">
          {previa.mensagem ? (
            <div className="rounded-lg bg-[#dcf8c6] dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 p-4">
              <p className="text-sm whitespace-pre-wrap text-slate-900 dark:text-slate-100">
                {previa.mensagem}
              </p>
            </div>
          ) : (
            <div className="border border-dashed border-border rounded-md p-4 text-sm text-muted-foreground">
              {previa.erroAoGerar ?? "O modelo não devolveu texto."}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div
              className={`rounded-md border p-3 ${
                previa.elegivel
                  ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800"
                  : "border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800"
              }`}
            >
              <div className="flex items-center gap-2 font-semibold">
                {previa.elegivel ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                Este lead
              </div>
              <p className="mt-1 text-muted-foreground">
                {previa.elegivel
                  ? "Está na fila e pode ser abordado."
                  : previa.motivoInelegivel}
              </p>
            </div>

            <div
              className={`rounded-md border p-3 ${
                previa.ritmo.pode
                  ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800"
                  : "border-slate-300 bg-slate-50 dark:bg-slate-800/40 dark:border-slate-700"
              }`}
            >
              <div className="flex items-center gap-2 font-semibold">
                {previa.ritmo.pode ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                Ritmo agora
              </div>
              <p className="mt-1 text-muted-foreground">
                {previa.ritmo.pode
                  ? "A janela está aberta e o limite não estourou."
                  : previa.ritmo.motivo}
              </p>
            </div>
          </div>

          <div className="text-xs text-muted-foreground border-t border-border pt-3 space-y-1">
            <div>
              Agora em São Paulo: <strong>{previa.agoraEmSaoPaulo}</strong> · enviadas na
              última hora: <strong>{previa.contadores.naUltimaHora}</strong> de{" "}
              {previa.config.porHora} · hoje: <strong>{previa.contadores.hoje}</strong> de{" "}
              {previa.config.porDia}
            </div>
            <div>
              Janela {previa.config.horaInicio}h–{previa.config.horaFim}h
              {previa.config.soDiasUteis ? ", só dias úteis" : ", todos os dias"} · intervalo
              mínimo {previa.config.intervaloMinimoSegundos}s
            </div>
            <div className={previa.config.habilitado ? "text-amber-600 font-semibold" : ""}>
              Prospecção ativa:{" "}
              <strong>{previa.config.habilitado ? "LIGADA" : "desligada"}</strong>
              {previa.config.habilitado ? " — mensagens estão saindo." : " — nada sai."}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
