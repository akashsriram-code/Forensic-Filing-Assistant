/**
 * fetch() that gives up after `timeoutMs` with a readable error, instead of hanging until the platform kills it.
 * Works in the browser and on the server.
 */
export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    try {
        return await fetch(input, { ...init, signal });
    } catch (error) {
        if (error instanceof DOMException && error.name === 'TimeoutError') {
            throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s. The data service may be busy - please retry.`);
        }
        throw error;
    }
}
