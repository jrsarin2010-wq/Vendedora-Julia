/**
 * Stub do logger. O pino de verdade carrega workers e usa `__dirname`, que não
 * existe no bundle ESM do teste. Aqui o log só é guardado, para uma asserção
 * poder olhar se quiser.
 */
export const linhas = [];

function registrar(nivel) {
  return (a, b) => {
    linhas.push({ nivel, msg: String(typeof a === "string" ? a : (b ?? "")) });
  };
}

export const logger = {
  info: registrar("info"),
  warn: registrar("warn"),
  error: registrar("error"),
  debug: registrar("debug"),
  fatal: registrar("fatal"),
  trace: registrar("trace"),
  child: () => logger,
};

export default logger;
