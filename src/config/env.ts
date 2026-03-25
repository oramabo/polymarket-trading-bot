import "dotenv/config";

export const POLYMARKET_PRIVATE_KEY = reteriveDotEnv("POLYMARKET_PRIVATE_KEY");
export const PROXY_WALLET_ADDRESS = reteriveDotEnv("PROXY_WALLET_ADDRESS");

function reteriveDotEnv(key: string): string {
    const env = process.env[key];
    if (!env) {
        console.error(`WARNING: ${key} is not set. Trading will not work.`);
        return "";
    }
    return env;
}