// Small helpers shared by the api/** Vercel serverless functions.

function respond(res, result) {
  if (result.body === null) {
    res.status(result.status).end();
    return;
  }
  res.status(result.status).json(result.body);
}

function handleError(res, error) {
  const status = error.statusCode || 500;
  if (status === 500) console.error(error);
  res.status(status).json({ error: error.message });
}

module.exports = { respond, handleError };
