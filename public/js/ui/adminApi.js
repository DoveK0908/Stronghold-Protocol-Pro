// Owner-only management transport. The key and CSRF capability never enter preferences, URLs or logs.
export function createAdminClient(fetcher = (...args) => fetch(...args)) {
  let csrf = '';
  const request = async (query = '', body) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetcher(`/api/admin${query}`, {
        method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: body ? { 'content-type': 'application/json', ...(csrf ? { 'X-SP-CSRF': csrf } : {}) } : {},
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        if (response.status === 401 || response.status === 403) csrf = '';
        throw Object.assign(new Error(data?.error || 'INTERNAL'), { code: data?.error || 'INTERNAL' });
      }
      return data;
    } finally { clearTimeout(timeout); }
  };
  return {
    async login(key) { const data = await request('', { action: 'login', key }); csrf = data.csrf || ''; return data; },
    read(resource, { offset = 0, q = '' } = {}) {
      return request(`?${new URLSearchParams({ resource, offset: String(offset), limit: '50', q })}`);
    },
    write(action, items) { return request('', { action, confirm: 'CONFIRM', items }); },
    async logout() { try { return await request('', { action: 'logout' }); } finally { csrf = ''; } },
  };
}
