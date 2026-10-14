// Permite usar handlers async sin try/catch repetido.
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
