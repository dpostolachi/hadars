import type { HadarsRequest } from "../types/hadars";
import { parseCookies } from "./cookies";

export const parseRequest = (request: Request): HadarsRequest => {
    const url = new URL(request.url);
    const cookies = request.headers.get('Cookie') || '';
    const cookieRecord: Record<string, string> = parseCookies(cookies);
    return Object.assign(request, { pathname: url.pathname, search: url.search, location: url.pathname + url.search, cookies: cookieRecord });
};