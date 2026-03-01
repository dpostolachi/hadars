import type { ServerContext } from './serve';
import type { HadarsOptions, HadarsRequest } from "../types/ninety";

type UpgradeHandle = (req: HadarsRequest, ctx: ServerContext) => boolean;

export const upgradeHandler = (options: HadarsOptions): UpgradeHandle | null => {
    const { wsPath = '/ws' } = options;

    if (options.websocket) {
        return (req: HadarsRequest, ctx: ServerContext) => {
            if (req.pathname === wsPath) {
                return ctx.upgrade(req);
            }
            return false;
        };
    }

    return null;
};
