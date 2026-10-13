// Thin REST client. Every write carries an X-Actor header so the activity feed
// can say who changed what.
const ACTOR_KEY = 'shopline.actor';

export function getActor() {
  return localStorage.getItem(ACTOR_KEY) || '';
}

export function setActor(name) {
  if (name) localStorage.setItem(ACTOR_KEY, name);
  else localStorage.removeItem(ACTOR_KEY);
}

async function request(method, path, body) {
  const headers = { 'X-Actor': encodeURIComponent(getActor() || 'Operator') };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  state: () => request('GET', '/api/state'),
  create: (collection, item) => request('POST', `/api/${collection}`, item),
  update: (collection, id, patch) => request('PATCH', `/api/${collection}/${id}`, patch),
  remove: (collection, id) => request('DELETE', `/api/${collection}/${id}`),
  settings: (patch) => request('PATCH', '/api/settings', patch),
  importAll: (data) => request('POST', '/api/import', data),
  clear: () => request('POST', '/api/clear'),
};
