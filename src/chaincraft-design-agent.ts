import { Client as BaseClient, SpaceStatus } from "@gradio/client";

const MAX_RETRIES = 2;
const RETRY_DELAY = 5000;
const { CHAINCRAFT_HF_ACCESS_TOKEN: hfToken,
        CHAINCRAFT_HF_SPACE: spaceId,
 } = process.env; 

export interface IChaincraftResponse {
    gameTitle: string,
    gameSpecification: string, 
    aiQuestions: string, 
    updatedState: any,
}

export async function init() {
    // Connect to the Hugging Face server
    let app = await connectWithRetry();

    async function processJobWithTimeout(job: any, timeout: number = 20000) {
        let jobCompleted = false; // Flag to track job completion
        let timeoutId: NodeJS.Timeout | undefined; 
        let timeout_count = 0;
        let results: any;

        const processJob = async (job: any) => {
            for await (const event of job) {
                if (event.type === "data") {
                    jobCompleted = true; // Set job completion flag
                    clearTimeout(timeoutId); // Clear the timeout
                    return event.data; // Resolve with data
                }
            }
            throw new Error("No data received from the design agent."); // In case the loop exits without data
        };

        while (!jobCompleted && timeout_count <= MAX_RETRIES) {
            const timeoutPromise = new Promise<void>((resolve, reject) => {
                timeoutId = setTimeout(async () => {
                    if (jobCompleted) {
                        return; // If job has completed, do nothing
                    }
    
                    if (timeout_count < MAX_RETRIES) {
                        // If we timed out, we may not be connected to the server.  Try to reconnect.
                        console.log("Timeout waiting for response from the design agent.  Reconnecting...");
                        try {
                            app = await connectWithRetry();
                            timeout_count += 1;
                            resolve();
                        } catch (error) {
                            console.error("Error reconnecting to the design agent: ", error);
                            reject(new Error("Error reconnecting to the design agent"));
                        }
                    } else {
                        reject(new Error("Timeout waiting for response from the design agent."));
                    }
                }, timeout);
            });

            // Race the job processing and timeout
            results = await Promise.race([processJob(job), timeoutPromise]);
        } 

        if (!jobCompleted) {
            throw new Error("Timeout waiting for response from the design agent.");
        }

        return results;
    }
    
    async function submit(
        userInput: string,
        approved=false,
        current_state={}
    ) { 
        // Submit a prompt to the Hugging Face server
        const job = app.submit("/submit_design_ui_input", {
            user_message: userInput,
            approved,
            current_state: JSON.stringify(current_state),

            // // Due to a bug in gradio client, we need to pass values for parameters for all the endpoints
            // game_design_specification: "fake_input_game_design",
            // x: "fake_input_x"
        });
        const results = await processJobWithTimeout(job);
        
        const [gameTitle, gameSpecification, aiQuestions, updatedState] = results;

        // If the game specification is empty, throw an error
        if (!gameSpecification) {
            throw new Error("No game specification returned from the design agent.");
        }
    
        return {
            gameTitle,
            gameSpecification,
            aiQuestions,
            updatedState,
        };
    }

    async function generateImage(
        game_design_specification: string
    ) {
        console.log("Generating image for game design specification: ", game_design_specification);
        // Submit a prompt to the Hugging Face server
        const job = app.submit("/generate_image", {
            game_design_specification,

            // // Due to a bug in gradio client, we need to pass values for parameters for all the endpoints
            // user_message: "",
            // approved: "",
            // current_state: "",
            // x: ""
        });
        const results = await processJobWithTimeout(job, 30000);
        const [_, image_url] = results;
        
        return image_url;
        // return ""
    }

    return {
        submit,
        generateImage
    }
}

class Client extends BaseClient {
    
    static async connect(spaceId: string | undefined, options: any) {
        return BaseClient.connect(spaceId, options);
    }

    constructor(
        app_reference: string,
		options: any = { events: ["data"] }
    ) {
        super(app_reference, options);
        this.handle_space_success = this.handle_space_success.bind(this);
    }

    async handle_space_success(status: SpaceStatus) {
        return super.handle_space_success(status);
    }
}

async function connectWithRetry(maxRetries: number = MAX_RETRIES, retryDelay: number = RETRY_DELAY) {
    let retries = 0;
    while (retries <= maxRetries) {
        try {
            console.log(`Attempt ${retries + 1} to connect to Chaincraft Design Agent`);
            const app = await connect();
            console.log("Successfully connected to Chaincraft Design Agent");
            return app; // Successfully connected
        } catch (error) {
            console.error("Error connecting to the design agent: ", error);
            retries++;
            if (retries > maxRetries) {
                throw new Error("Failed to connect to the design agent after retries.");
            }
            // Wait for retryDelay milliseconds before the next retry
            await delay(retryDelay);
        }
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function connect() {
    console.log("Connecting to Chaincraft Design Agent - ", spaceId)
    const app = await Client.connect(spaceId, { 
        hf_token: hfToken,
	    status_callback: (space_status: SpaceStatus) => 
                console.log("Chaincraft Design Agent status updated: ", space_status), 
        // This is an undocumented option that is apparently required if we have more outputs than inputs
        with_null_state: true,
    })
    if (app) {
        console.log("Connected to Chaincraft Design Agent")
    }

    return app;
}


