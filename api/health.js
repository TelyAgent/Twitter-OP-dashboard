import { hasToken } from './_lib/twitter.js';

export default async function handler(req, res) {
  res.status(200).json({
    ok: true,
    hasToken: hasToken(),
    time: new Date().toISOString(),
  });
}
