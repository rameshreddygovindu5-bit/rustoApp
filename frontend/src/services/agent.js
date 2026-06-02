/**
 * Agent API client.
 *
 * Uses fetch + ReadableStream rather than EventSource because EventSource
 * doesn't support custom headers (we need Authorization: Bearer ...).
 *
 * Usage:
 *   const ctrl = new AbortController()
 *   await streamChat({
 *     message: "show me overdue checkouts",
 *     conversationId: 5,
 *     onEvent: ev => console.log(ev),
 *     signal: ctrl.signal,
 *   })
 */
const BASE = "/api/agent";

function getToken() {
  return localStorage.getItem("lms_token");
}

async function jsonFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const tok = getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  if (opts.body && typeof opts.body !== "string") {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.body);
  }
  const r = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (r.status === 401) {
    localStorage.removeItem("lms_token");
    localStorage.removeItem("lms_user");
    window.location.href = "/login";
    return null;
  }
  if (!r.ok) {
    let detail;
    try { detail = (await r.json()).detail; } catch {}
    throw new Error(detail || `Error ${r.status}`);
  }
  return r.json();
}

/**
 * Stream a chat reply.
 * Returns the final `meta` object (including the conversation_id).
 */
export async function streamChat({ message, conversationId, title,
                                    onEvent, signal }) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "text/event-stream",
  };
  const tok = getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;

  const resp = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message,
      conversation_id: conversationId || null,
      title: title || null,
    }),
    signal,
  });
  if (!resp.ok) {
    let detail;
    try { detail = (await resp.json()).detail; } catch {}
    throw new Error(detail || `HTTP ${resp.status}`);
  }
  return processStream(resp, onEvent);
}

export async function streamConfirm({ conversationId, toolUseId, approve = true,
                                       onEvent, signal }) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "text/event-stream",
  };
  const tok = getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;

  const resp = await fetch(`${BASE}/confirm`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      conversation_id: conversationId,
      tool_use_id: toolUseId,
      approve,
    }),
    signal,
  });
  if (!resp.ok) {
    let detail;
    try { detail = (await resp.json()).detail; } catch {}
    throw new Error(detail || `HTTP ${resp.status}`);
  }
  // If approve=false the server returns JSON, not SSE
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return resp.json();
  }
  return processStream(resp, onEvent);
}

async function processStream(resp, onEvent) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastMeta = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE: split by double-newline; each chunk is `data: {...}`
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      if (!raw) continue;
      const line = raw.startsWith("data:") ? raw.slice(5).trim() : raw;
      if (!line) continue;
      let evt;
      try { evt = JSON.parse(line); }
      catch { continue; }
      if (evt.event === "meta") lastMeta = evt.data;
      onEvent && onEvent(evt);
    }
  }
  return lastMeta;
}

export const agentAPI = {
  status:           ()       => jsonFetch(`/status`),
  listTools:        ()       => jsonFetch(`/tools`),
  listConvos:       (limit=30) => jsonFetch(`/conversations?limit=${limit}`),
  getConvo:         id       => jsonFetch(`/conversations/${id}`),
  deleteConvo:      id       => jsonFetch(`/conversations/${id}`, { method: "DELETE" }),
  quick:            (action, params={}) =>
                                 jsonFetch(`/quick/${action}`, { method: "POST",
                                                                  body: { params } }),
};
