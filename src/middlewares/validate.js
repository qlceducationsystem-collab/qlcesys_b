export const validate = (schema, source = 'body') => (req, _res, next) => {
  try {
    req[source === 'query' ? 'validQuery' : 'body'] = schema.parse(req[source]);
    next();
  } catch (err) {
    next(err);
  }
};
