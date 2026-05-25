import { getClient, sendTwitterError } from '../../../_lib/twitter.js';

const HARD_CAP = 2000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  const listId = String(req.query.listId || '').trim();
  if (!/^\d{1,25}$/.test(listId)) {
    res.status(400).json({ ok: false, error: 'invalid list id' });
    return;
  }

  let client;
  try { client = getClient(); }
  catch (e) {
    res.status(503).json({ ok: false, error: e.message });
    return;
  }

  try {
    const paginator = await client.v2.listMembers(listId, {
      max_results: 100,
      'user.fields': ['username', 'name', 'description', 'public_metrics'],
    });
    const members = [];
    for await (const u of paginator) {
      members.push({
        id: u.id,
        username: u.username,
        name: u.name,
        bio: u.description || null,
        followers: u.public_metrics?.followers_count ?? null,
      });
      if (members.length >= HARD_CAP) break;
    }
    res.status(200).json({ ok: true, list_id: listId, count: members.length, members });
  } catch (err) {
    sendTwitterError(res, err);
  }
}
