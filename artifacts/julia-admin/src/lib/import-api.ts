/**
 * Importação de leads: leitura do texto colado / CSV e chamada da API.
 *
 * Escrito à mão pelo mesmo motivo do auth-api: esta rota não faz parte do
 * contrato OpenAPI dos dados, então fica fora dos hooks gerados.
 */

export interface LeadParaImportar {
  name: string | null;
  phone: string;
  clinicName: string | null;
  instagram: string | null;
  city: string | null;
}

export interface ResumoImportacao {
  importados: number;
  duplicados: number;
  invalidos: number;
  ignoradosPorOptOut: number;
}

/** Cabeçalhos aceitos para cada campo, em português e inglês. */
const SINONIMOS: Record<keyof LeadParaImportar, string[]> = {
  name: ["name", "nome", "dentista", "responsavel", "responsável", "contato"],
  phone: ["phone", "telefone", "celular", "whatsapp", "fone", "numero", "número"],
  clinicName: ["clinicname", "clinica", "clínica", "nomeclinica", "nome da clinica", "nome da clínica", "empresa"],
  instagram: ["instagram", "insta", "perfil", "arroba"],
  city: ["city", "cidade", "municipio", "município", "local"],
};

function normalizarCabecalho(valor: string): string {
  // NFD separa a letra do acento, e \p{M} apaga as marcas — assim "clínica"
  // e "clinica" viram a mesma coisa na hora de casar o cabeçalho.
  return valor
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Descobre o separador olhando a primeira linha: vírgula, ponto-e-vírgula ou tab. */
function detectarSeparador(linha: string): string {
  const candidatos = [";", ",", "\t"];
  let melhor = ";";
  let maisColunas = 0;
  for (const sep of candidatos) {
    const n = linha.split(sep).length;
    if (n > maisColunas) {
      maisColunas = n;
      melhor = sep;
    }
  }
  return melhor;
}

/** Quebra uma linha de CSV respeitando aspas: `a;"b;c";d` → [a, "b;c", d]. */
function quebrarLinha(linha: string, sep: string): string[] {
  const campos: string[] = [];
  let atual = "";
  let dentroDeAspas = false;

  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      // Aspas duplicadas dentro de aspas representam uma aspa literal.
      if (dentroDeAspas && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else {
        dentroDeAspas = !dentroDeAspas;
      }
      continue;
    }
    if (c === sep && !dentroDeAspas) {
      campos.push(atual);
      atual = "";
      continue;
    }
    atual += c;
  }
  campos.push(atual);
  return campos.map((c) => c.trim());
}

/**
 * Lê o texto colado (CSV com cabeçalho, ou uma linha por dentista) e devolve
 * os leads mais os problemas encontrados, para mostrar na prévia.
 *
 * Sem cabeçalho reconhecível, assume que a primeira coluna é o telefone —
 * cobre o caso de colar só uma lista de números.
 */
export function lerTextoDeImportacao(texto: string): {
  leads: LeadParaImportar[];
  problemas: string[];
} {
  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const problemas: string[] = [];
  if (linhas.length === 0) return { leads: [], problemas };

  const sep = detectarSeparador(linhas[0]);
  const primeira = quebrarLinha(linhas[0], sep).map(normalizarCabecalho);

  // O cabeçalho é reconhecido se pelo menos uma coluna casa com um sinônimo.
  const colunas: Partial<Record<keyof LeadParaImportar, number>> = {};
  for (const [campo, nomes] of Object.entries(SINONIMOS)) {
    const idx = primeira.findIndex((h) => nomes.includes(h));
    if (idx >= 0) colunas[campo as keyof LeadParaImportar] = idx;
  }
  const temCabecalho = Object.keys(colunas).length > 0;

  if (!temCabecalho) {
    problemas.push(
      "Não achei um cabeçalho (nome, telefone, clínica...). Vou tratar a primeira coluna como telefone.",
    );
    colunas.phone = 0;
  } else if (colunas.phone === undefined) {
    problemas.push(
      "O cabeçalho não tem uma coluna de telefone. Renomeie a coluna para 'telefone' ou 'phone'.",
    );
    return { leads: [], problemas };
  }

  const corpo = temCabecalho ? linhas.slice(1) : linhas;
  const leads: LeadParaImportar[] = [];

  corpo.forEach((linha, i) => {
    const campos = quebrarLinha(linha, sep);
    const pegar = (campo: keyof LeadParaImportar): string | null => {
      const idx = colunas[campo];
      if (idx === undefined) return null;
      const v = campos[idx]?.trim();
      return v ? v : null;
    };

    const phone = pegar("phone");
    if (!phone) {
      problemas.push(`Linha ${i + (temCabecalho ? 2 : 1)}: sem telefone, será ignorada.`);
      return;
    }

    leads.push({
      phone,
      name: pegar("name"),
      clinicName: pegar("clinicName"),
      instagram: pegar("instagram"),
      city: pegar("city"),
    });
  });

  return { leads, problemas };
}

/** Manda os leads para a API. Lança com a mensagem do servidor se falhar. */
export async function importarLeads(
  leads: LeadParaImportar[],
): Promise<ResumoImportacao> {
  const res = await fetch("/api/leads/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ leads }),
  });

  if (!res.ok) {
    let mensagem = `Falha na importação (HTTP ${res.status})`;
    try {
      const corpo = (await res.json()) as { error?: string };
      if (corpo?.error) mensagem = corpo.error;
    } catch {
      // resposta sem JSON — fica a mensagem genérica
    }
    throw new Error(mensagem);
  }

  return (await res.json()) as ResumoImportacao;
}
