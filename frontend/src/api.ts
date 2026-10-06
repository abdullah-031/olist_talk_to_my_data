export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const timeout = AbortSignal.timeout(180000);
  const response = await fetch(path, {
    ...init,
    signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    // A shared-login session can expire mid-visit; App listens and shows the sign-in form.
    if (response.status === 401) window.dispatchEvent(new Event('session-expired'));
    throw new Error(body.error || `The request failed (${response.status}). Please try again.`);
  }
  return body as T;
}
