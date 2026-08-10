/**
 * ÁUDIOS DE DEMONSTRAÇÃO — a Júlia mostra em vez de contar.
 *
 * Três gravações curtas da secretária do CaptaClin atendendo um paciente.
 * São a prova mais forte que ela tem: o CaptaClin não tem depoimento nem caso
 * de cliente, mas tem o produto funcionando, e o dentista pode OUVIR.
 *
 * Gerados UMA vez pelo `scripts/gerar-demos.mjs` e versionados no repositório.
 * Nada é sintetizado em tempo de execução: custo zero por conversa, o áudio é
 * sempre idêntico ao que foi aprovado, e continua funcionando se a Cartesia
 * cair.
 *
 * A Júlia pede um áudio terminando a resposta com [DEMO:nome]. O marcador é
 * removido do texto antes de entregar — o dentista nunca vê isso.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

/** Os três áudios existentes. A ordem não importa; o nome é o do arquivo. */
export const DEMOS = ["vou_pensar", "quanto_custa", "fora_do_horario"] as const;
export type Demo = (typeof DEMOS)[number];

/**
 * O texto de cada gravação, aprovado pelo Dr. Sarinho na Rodada 27.
 *
 * Mora aqui, e não dentro do script de geração, porque é a única fonte da
 * verdade: quem for regravar usa exatamente este texto, e quem for ler o
 * código descobre o que tem dentro de cada MP3 sem precisar ouvir os três.
 */
export const ROTEIROS: Record<Demo, string> = {
  vou_pensar:
    "Imagina, sem problema nenhum! Decisão de tratamento é pra pensar com calma mesmo. Só uma coisinha: a avaliação não te compromete com nada, viu? Você vem, o doutor examina, te explica certinho o que precisa e quanto fica. Aí sim você decide, já com tudo na mão. Quer que eu separe um horário pra essa semana?",
  quanto_custa:
    "Boa pergunta! Olha, o valor muda bastante de caso pra caso — depende do que você precisa, e isso só dá pra saber olhando de perto. Por isso a gente começa pela avaliação: o doutor examina, te mostra o que tem, e você já sai sabendo o valor exato, sem surpresa depois. Me diz uma coisa: manhã ou tarde funciona melhor pra você?",
  fora_do_horario:
    "Oi! Vi sua mensagem agora. Poxa, dor de dente à noite é o pior, né? Olha, a clínica abre às oito, mas eu já vou deixar você encaixado no primeiro horário da manhã pra você não esperar. Enquanto isso me conta: é uma dor que lateja sozinha, ou dói mais quando você morde?",
};

/**
 * Teto por lead. Dois áudios diferentes impressionam; o terceiro vira spam, e
 * repetir o mesmo destrói o efeito de uma vez.
 */
export const LIMITE_DEMOS = 2;

const AQUI = path.dirname(fileURLToPath(import.meta.url));

/**
 * Onde os MP3 moram. No deploy, o `build.mjs` copia a pasta para dentro do
 * dist, ao lado do bundle — por isso o caminho é relativo a este módulo e não
 * ao diretório de trabalho, que muda conforme quem sobe o processo.
 * `DEMOS_DIR` existe para o teste apontar para outro lugar.
 */
export function pastaDemos(): string {
  return process.env.DEMOS_DIR ?? path.resolve(AQUI, "assets/demos");
}

export function ehDemoValida(nome: string): nome is Demo {
  return (DEMOS as readonly string[]).includes(nome);
}

/**
 * Separa o marcador do texto. Devolve o texto SEM nenhum [DEMO:...] e o nome
 * da demo pedida, ou null se não pediu nenhuma ou pediu uma que não existe.
 *
 * O marcador some do texto nos dois casos: um [DEMO:qualquer] inventado pelo
 * modelo não pode vazar para a tela do dentista.
 */
export function extrairDemo(reply: string): { texto: string; demo: Demo | null } {
  const marcador = reply.match(/\[DEMO:(\w+)\]/);
  const pedida = marcador?.[1] ?? null;
  return {
    texto: reply.replace(/\[DEMO:\w+\]/g, "").trim(),
    demo: pedida && ehDemoValida(pedida) ? pedida : null,
  };
}

/** Lê a lista de demos já enviadas para um lead (coluna `demosEnviadas`). */
export function jaEnviadas(valor: string | null | undefined): string[] {
  if (!valor) return [];
  return valor
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
}

/** Junta a nova demo à lista, sem duplicar. */
export function registrar(valor: string | null | undefined, nome: Demo): string {
  const lista = jaEnviadas(valor);
  if (!lista.includes(nome)) lista.push(nome);
  return lista.join(",");
}

/**
 * Pode mandar esta demo para este lead? Não se ele já ouviu essa, nem se já
 * ouviu o limite. Quem chama deve logar o motivo — uma demo silenciosamente
 * engolida é difícil de investigar depois.
 */
export function podeEnviar(
  nome: Demo,
  valor: string | null | undefined,
): { pode: boolean; motivo?: string } {
  const lista = jaEnviadas(valor);
  if (lista.includes(nome)) return { pode: false, motivo: "demo repetida" };
  if (lista.length >= LIMITE_DEMOS) return { pode: false, motivo: "limite por lead atingido" };
  return { pode: true };
}

/**
 * Carrega o MP3. Devolve null se o arquivo não existir — a demo é bônus, e a
 * conversa não pode parar por causa dela.
 */
export async function lerDemo(nome: Demo): Promise<Buffer | null> {
  try {
    return await readFile(path.join(pastaDemos(), `${nome}.mp3`));
  } catch {
    return null;
  }
}
