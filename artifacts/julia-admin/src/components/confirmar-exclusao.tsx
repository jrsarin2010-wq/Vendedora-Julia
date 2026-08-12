import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * Confirmação antes de apagar.
 *
 * Envolve o botão que dispara a ação: nada acontece no clique, só depois da
 * confirmação. Apagar lead é irreversível e leva junto o histórico da
 * conversa, então não pode existir caminho de um clique só.
 */
export function ConfirmarExclusao({
  titulo,
  descricao,
  textoConfirmar = "Apagar",
  aoConfirmar,
  children,
}: {
  titulo: string;
  descricao: string;
  textoConfirmar?: string;
  aoConfirmar: () => void | Promise<void>;
  children: ReactNode;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          {/* pre-line: a descrição da exclusão total lista item por item o que
              vai sumir, e a lista só cumpre o papel se quebrar linha. */}
          <AlertDialogDescription className="whitespace-pre-line">
            {descricao}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="btn-cancelar-exclusao">Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => void aoConfirmar()}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="btn-confirmar-exclusao"
          >
            {textoConfirmar}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
