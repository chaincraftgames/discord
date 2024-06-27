import { Client, SpaceStatus } from "@gradio/client";

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
    console.log("Connecting to Chaincraft Design Agent - ", spaceId)
    const app = await Client.connect(spaceId, { 
        hf_token: hfToken,
	    space_status: (space_status: SpaceStatus) => 
                console.log("Chaincraft Design Agent status updated: ", space_status), 
        // This is an undocumented option that is apparently required if we have more outputs than inputs
        with_null_state: true,
    })
    if (app) {
        console.log("Connected to Chaincraft Design Agent")
    }
    
    async function submit(
        userInput: string,
        approved=false,
        current_state={},
    ) {
        // Submit a prompt to the Hugging Face server
        const job = app.submit("/submit_design_ui_input", {
            user_message: userInput,
            approved,
            current_state: JSON.stringify(current_state),
        });
    
        let results;
    
        // Timeout promise
        const timeoutPromise = new Promise((_, reject) => {
            const timeout = 10000; // 10 seconds timeout
            setTimeout(() => reject(new Error("Timeout waiting for response from the design agent.")), timeout);
        });
    
        // Function to process job events
        const processJob = async () => {
            for await (const event of job) {
                if (event.type === "data") {
                    return event.data; // Resolve with data
                }
            }
            throw new Error("No data received from the design agent."); // In case the loop exits without data
        };
    
        // Race the job processing and timeout
        results = await Promise.race([processJob(), timeoutPromise]);
    
        const [gameTitle, gameSpecification, aiQuestions, updatedState] = results;
    
        return {
            gameTitle,
            gameSpecification,
            aiQuestions,
            updatedState,
        };
    }

    return {
        submit
    }
}


