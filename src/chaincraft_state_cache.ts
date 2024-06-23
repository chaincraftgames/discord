import { promises as fs } from 'fs';

// Hold state for active threads in local json files.  
// This is a simple way to persist state between messages.
// May want to consider a more robust solution in the future. (e.g. a Redis cache or a database)

export async function getState(threadId: string) {
    const stateJson = `${threadId}.json`;
    try {
        const data = await fs.readFile(stateJson, 'utf8');
        return JSON.parse(data);
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            // If the file doesn't exist, return an empty state
            return {};
        } else {
            throw error;
        }
    }
}

export async function setState(threadId: string, state: any) {
    const stateJsonFile = `${threadId}.json`;
    const data = typeof state === 'string' ? state : JSON.stringify(state, null, 2);
    await fs.writeFile(stateJsonFile, data, 'utf8');
}

export async function removeState(threadId: string) {
    // Remove the state file
    const stateJson = `${threadId}.json`;
    try {
        await fs.unlink(stateJson);
    } catch (error: any) {
        if (error.code !== 'ENOENT') {
            // ENOENT means file does not exist, which is fine for us
            throw error;
        }
    }
}