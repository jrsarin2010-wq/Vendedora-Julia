/**
 * A ficha do lead e os templates de follow-up — as partes da persona que são
 * determinísticas e, portanto, testáveis sem chamar o modelo.
 */
import { ok, secao, fim } from "./assert";
import { FOLLOW_UP_TEMPLATES, buildLeadBriefing } from "../src/julia-persona";
import { detectarTratamento, saudacao } from "../src/lib/tratamento";

const ficha = (name: string | null) =>
  buildLeadBriefing({
    name,
    funnelStage: "qualified",
    painPoints: null,
    mainObjection: null,
    planInterest: null,
    daysSinceLastMessage: 2,
    isReturning: true,
    totalMessages: 8,
  });

secao("Dr./Dra. determinístico na ficha do lead");
ok('"Michele" → Dra.', ficha("Michele").includes("trate como: Dra. Michele"));
ok('"Carlos" → Dr.', ficha("Carlos").includes("trate como: Dr. Carlos"));
ok('"Raquel" → Dra.', ficha("Raquel").includes("trate como: Dra. Raquel"));
ok('"Alex" → ambíguo', ficha("Alex").includes("nome ambíguo"));
ok('"Yuri" → ambíguo', ficha("Yuri").includes("nome ambíguo"));
ok('"raquel silva" → só o primeiro nome, capitalizado', ficha("raquel silva").includes("trate como: Dra. Raquel"));
ok("sem nome → manda perguntar", ficha(null).includes("ainda não sei"));
ok('nunca escreve "Dr(a)."', !ficha("Alex").includes("Dr(a)"));

secao("tratamento.ts — unidade");
ok("Michele é feminino apesar de não terminar em -a", detectarTratamento("Michele") === "dra");
ok("Elias é masculino apesar de terminar em -s", detectarTratamento("Elias") === "dr");
ok("Andrea é ambíguo", detectarTratamento("Andrea") === "neutro");
ok("saudação com Dr.", saudacao("carlos") === "Dr. Carlos, ");
ok("saudação ambígua usa só o nome", saudacao("alex") === "Alex, ");
ok("sem nome, sem vocativo", saudacao(null) === "");

secao("follow-ups — usam a dor quando existe");
const DOR = "perde paciente que chama fora do horário.";
for (const t of [1, 2, 3, 4] as const) {
  const com = FOLLOW_UP_TEMPLATES[t]("Marina", DOR);
  const sem = FOLLOW_UP_TEMPLATES[t]("Marina", null);
  ok(`toque ${t}: usa a dor quando existe`, com.includes("perde paciente que chama fora do horário"), com);
  ok(`toque ${t}: cai no texto genérico quando não existe`, !sem.includes("perde paciente"));
  ok(`toque ${t}: sem pontuação duplicada`, !com.includes("..") && !com.includes(" ,"), com);
  ok(`toque ${t}: mantém o link (com dor)`, com.includes("https://www.captaclin.com.br"));
  ok(`toque ${t}: mantém o link (sem dor)`, sem.includes("https://www.captaclin.com.br"));
  ok(`toque ${t}: trata como Dra. Marina`, com.startsWith("Dra. Marina, "));
}
ok(
  "dor só com espaços conta como sem dor",
  FOLLOW_UP_TEMPLATES[3]("Marina", "   ") === FOLLOW_UP_TEMPLATES[3]("Marina", null),
);
ok(
  "toque 4 isola a dor entre travessões (não quebra a regência)",
  FOLLOW_UP_TEMPLATES[4]("Marina", DOR).includes("— perde paciente que chama fora do horário —"),
);

fim();
