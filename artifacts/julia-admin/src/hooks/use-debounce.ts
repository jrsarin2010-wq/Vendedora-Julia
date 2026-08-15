import { useEffect, useState } from "react";

/**
 * Atrasa o valor: só devolve o novo depois de `atrasoMs` sem mudança.
 *
 * Existe separado, e correto, por um motivo: a lista de dentistas tem um
 * `useDebounceLocal` que chama `useEffect` DENTRO de um `import("react").then(...)`.
 * A promessa resolve depois do render, então o efeito nunca é registrado e o
 * valor "atrasado" é sempre o atual — ou seja, aquele hook não atrasa nada, e
 * cada tecla digitada vira uma consulta.
 *
 * Aqui o `useEffect` é importado no topo, como manda o React. Consertar o de
 * leads.tsx é outra rodada; propagar o defeito não era opção.
 */
export function useDebounce<T>(valor: T, atrasoMs = 300): T {
  const [atrasado, setAtrasado] = useState(valor);

  useEffect(() => {
    const id = setTimeout(() => setAtrasado(valor), atrasoMs);
    return () => clearTimeout(id);
  }, [valor, atrasoMs]);

  return atrasado;
}
