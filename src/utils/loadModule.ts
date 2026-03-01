export const loadModule = <T>(path: string): T => {
    return import(path) as unknown as T;
    // throw new Error('loadModule should be transformed by loader')
}