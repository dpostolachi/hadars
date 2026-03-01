export const parseCookies = (cookieString: string): Record<string, string> => {
    const cookies: Record<string, string> = {};
    if (!cookieString) {
        return cookies;
    }
    const pairs = cookieString.split(';');
    for (const pair of pairs) {
        const index = pair.indexOf('=');
        if (index > -1) {
            const key = pair.slice(0, index).trim();
            const value = pair.slice(index + 1).trim();
            cookies[key] = decodeURIComponent(value);
        }
    }
    return cookies;
};