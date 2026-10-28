import { createHash } from 'node:crypto';

/** Resolved secrets are process-local only. Never serialize this object. */
export interface RuntimeConfig { variables: Record<string, string>; secrets: Record<string, string>; required: string[] }
export interface ConfigSummary { variables: string[]; secrets: string[]; digest: string }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const configName = (v: unknown): v is string => typeof v === 'string' && v.length <= 256 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(v);
export function validateRuntimeConfig(config: RuntimeConfig): void {
    if (!object(config) || !object(config.variables) || !object(config.secrets) || !Array.isArray(config.required)) throw new Error('Invalid runtime configuration');
    for (const [name, value] of [...Object.entries(config.variables), ...Object.entries(config.secrets)]) {
        if (!configName(name)) throw new Error('Invalid runtime configuration name (expected identifier, at most 256 characters)');
        if (typeof value !== 'string' || value.length > 256) throw new Error(`Runtime configuration ${name} must be a string of at most 256 characters`);
        if (Object.hasOwn(config.variables, name) && Object.hasOwn(config.secrets, name)) throw new Error(`Runtime configuration ${name} is both a variable and a secret`);
    }
    for (const name of config.required) {
        if (!configName(name)) throw new Error('Invalid required runtime configuration name');
        if (!Object.hasOwn(config.variables, name) && !Object.hasOwn(config.secrets, name)) throw new Error(`Required runtime configuration ${name} is missing`);
    }
}
export function resolveRuntimeConfig(input: unknown, overrides: string[] = [], env: Record<string, string | undefined> = process.env): RuntimeConfig {
    if (!object(input) || Object.keys(input).some(k => !['variables', 'secrets', 'required'].includes(k)) || input.variables !== undefined && !object(input.variables) || input.secrets !== undefined && !object(input.secrets) || input.required !== undefined && !Array.isArray(input.required)) throw new Error('Invalid runtime configuration JSON schema');
    const variables = Object.assign(Object.create(null), input.variables ?? {}), secrets = Object.create(null);
    for (const override of overrides) {
        const at = override.indexOf('=');
        if (at < 1) throw new Error('Use --var NAME=VALUE');
        const name = override.slice(0, at);
        if (!configName(name)) throw new Error('Invalid --var name');
        variables[name] = override.slice(at + 1);
    }
    for (const [name, reference] of Object.entries(input.secrets ?? {})) {
        if (!configName(name)) throw new Error('Invalid secret configuration name');
        if (!object(reference) || Object.keys(reference).length !== 1 || !configName(reference.env)) throw new Error(`Secret ${name} needs only an env reference`);
        if (env[reference.env] === undefined) throw new Error(`Secret ${name} is missing from the process environment`);
        secrets[name] = env[reference.env];
    }
    const config = { variables, secrets, required: input.required ?? [] } as RuntimeConfig;
    validateRuntimeConfig(config);
    return config;
}
export function summarizeConfig(config: RuntimeConfig): ConfigSummary {
    validateRuntimeConfig(config);
    const variables = Object.keys(config.variables).sort(), secrets = Object.keys(config.secrets).sort();
    const digest = createHash('sha256').update(JSON.stringify({ variables: variables.map(n => [n, config.variables[n]]), secrets })).digest('hex');
    return { variables, secrets, digest };
}
