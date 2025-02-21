import { ActionRowBuilder, APIEmbed, ButtonBuilder, ButtonInteraction, ButtonStyle, CommandInteraction,  
         Message, TextChannel, ThreadChannel } from "discord.js";

import { chainCraftGameDescriptionOptionName } from "./commands/chaincraft-commands.js";
import { init } from "./chaincraft-design-agent.js";
import { getState, setState, removeState } from "./chaincraft_state_cache.js";
import { createThreadInChannel, sendToThread, createPost, pinataSDK } from "./util.js";


const designChannelId = process.env.CHAINCRAFT_DESIGN_CHANNEL_ID;
const designShareChannelId = process.env.CHAINCRAFT_DESIGN_SHARE_CHANNEL_ID;
const pinataUrl = process.env.CHAINCRAFT_PINATA_GATEWAY_URL;

let agentApi: { 
    submit: Function
    generateImage: Function 
} | undefined;

const approveButton = new ButtonBuilder()
        .setCustomId('chaincraft_approve_design')
        .setLabel('Approve')
        .setStyle(ButtonStyle.Primary)

const shareButton = new ButtonBuilder()
        .setCustomId('chaincraft_share_design')
        .setLabel('Share')
        .setStyle(ButtonStyle.Secondary)

const generateTokenButton = new ButtonBuilder()
        .setCustomId('chaincraft_generate_design')
        .setLabel('Generate Token')
        .setStyle(ButtonStyle.Secondary)

const buttonActionRow = new ActionRowBuilder<ButtonBuilder>()
       .addComponents(approveButton, shareButton, generateTokenButton); 

export async function isMessageInChaincraftDesignActiveThread(message: Message) {
    // Check if the message is sent in a thread
    if (!message.channel.isThread()) {
        return false;
    }

    // Ensure the thread is within the specific design channel
    if (message.channel.parentId !== designChannelId) {
        return false;
    }

    try {
        // Retrieve the state for the thread
        const state = await getState(message.channel.id);
        // Check if the state exists and the thread has not been approved
        return state !== null && !state.approved && Object.keys(state).length > 0;
    } catch (error) {
        console.error(`Error checking thread state: ${error}`);
        return false;
    }
}

// Start generation of a game design based on a given prompt
export async function startChaincraftDesign(interaction: CommandInteraction) {
    let thread: ThreadChannel | undefined;
    try {
        if (interaction.guildId !== process.env.CHAINCRAFT_GUILD_ID) {
            await interaction.reply("This command can only be used in the Chaincraft guild.");
            return;
        }

        if (!interaction.channel || !(interaction.channel instanceof TextChannel)){
            await interaction.reply("This command can only be used in a text channel.");
            return;
        }

        await interaction.deferReply();
 
        // The discord.js typings omit the functions on options for some reason, but the guide instructs us to use them
        // https://discordjs.guide/slash-commands/parsing-options.html#command-options
        const gameDescription = (interaction.options as any).getString(chainCraftGameDescriptionOptionName)

        const {
            gameTitle,
            gameSpecification,
            aiQuestions,
            updatedState
        } = await _invokeChaincraftAgent(gameDescription);

        console.log(`Game Title: ${gameTitle}, Game Specification: ${gameSpecification}, AI Questions: ${aiQuestions}`);
        // Kickoff the image generation as well
        const image_url_promise = _invokeGenerateImage(gameSpecification)
    
        const threadMessageText = `**${gameDescription}** - ${interaction.user.toString()}`;
        
        thread = await createThreadInChannel(
            interaction.client, 
            designChannelId as string,
            gameDescription!.substring(0, 100), 
	        true
        );

        if (!thread) {
            throw new Error("Thread could not be created.");
        }
        thread = thread as ThreadChannel<boolean>;
        await thread.join();
        const threadMessage = await thread.send(threadMessageText);
        setState(thread.id, updatedState);
        image_url_promise.then((imageUrl: string) => {
            _updateMessageWithImage(threadMessage, imageUrl);

            // Update the state with the image URL
            setState(thread!.id, JSON.stringify({ ...JSON.parse(updatedState), imageUrl }));
        });

        await _updateThread(gameTitle, gameSpecification, aiQuestions, thread)

        // Send confirmation message with thread link
        interaction.editReply(`${threadMessage}. Private thread created. [Click here to jump to the thread.](<${thread.url}>)")`); 
    } catch (e) {
        console.log(`Error in startChaincraftDesign: ${e} thread: ${thread}`);
        if (thread) {
            thread.send("Sorry, there was an error starting the Chaincraft design. Please try again later.");
            thread.delete();
        } else {
            await interaction.editReply("Sorry, there was an error starting the Chaincraft design. Please try again later.");
        }
    }
}

export async function continueChaincraftDesign(message: Message) {
    try {
        const threadId = message.channel.id;

        let userInput = message.content;
        let state = await getState(threadId);

        // Check to see if conversation is ongoing or ended (approved=true)
        if (!state || state.approved) {
            removeState(threadId);
            await message.reply("The game design has been approved and the conversation has ended.");
            return;
        }

        // Send an initial reply to indicate processing
        const processingMessage = await message.reply("Processing your request...");

        const {
            gameTitle,
            gameSpecification,
            aiQuestions,
            updatedState
        } = await _invokeChaincraftAgent(userInput, state);

        setState(threadId, updatedState);

        // Delete the processing message
        await processingMessage.delete();
        _updateThread(gameTitle, gameSpecification, aiQuestions, message.channel as ThreadChannel<boolean>);
    } catch (e) {
        console.log(`Error continuing chaincraft conversation: ${e}`);
        await message.reply("Sorry, there was an error continuing the Chaincraft design. Please try again later.");
    }
}

export async function approveChaincraftDesign(interaction: ButtonInteraction) {
    removeState(interaction.channelId);
    await interaction.reply({
        content: "Approved!",
        ephemeral: true
    })
    await interaction.channel?.send("The game design has been approved and the conversation has ended.")
}

export async function shareChaincraftDesign(interaction: ButtonInteraction) {
    try {
        if (!interaction.channel) {
            await interaction.reply({
                content: "This interaction can only occur in a thread.",
            })
            return;
        }
    
        // Get the state for the thread
        const state = await getState(interaction.channelId);
        if (!state) {
            await interaction.reply({
                content: "There is no game design to share.",
                ephemeral: true
            });
            return;
        }
        const { 
            game_title: gameTitle,
            game_specification: gameSpecification,
            imageUrl 
        } = state;

        const postMessage = `**Game Title:** ${gameTitle}\n\n**Game Design Specification:** \n${gameSpecification}`
        let imageEmbed: APIEmbed | undefined = imageUrl ? { image: { url: imageUrl } } : undefined;
     
        // Has the game design already been shared?
        const channel = interaction.channel as ThreadChannel;
        let postId = await _getStoredPostId(channel);
        let post;
        try {
            post = postId && await interaction.client.channels.fetch(postId);
        } catch (error) {
            // Do nothing if the post is not found
        }
        if (!postId || !post) {
            const post = await createPost(
                interaction.client, 
                designShareChannelId as string, 
                gameTitle, 
                postMessage,
                imageEmbed
            )
            _storePostId(interaction, channel, post);
        } else {
            // Fetch the post channel by ID
            sendToThread(post as ThreadChannel, gameSpecification);
            await interaction.reply({
                content: "The game design has been shared.",
                ephemeral: true
            });
        }
    } catch (error) {
        console.error("Error sharing game design:", error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: "There was an error sharing the game design. Please try again later.",
                ephemeral: true
            }); 
        }   
    }
}

export async function uploadChaincraftDesign(interaction: ButtonInteraction) {
    try {
        const channel = interaction.client.channels.cache.get(interaction.channelId);
        
        if (!channel?.isTextBased()) {
            return interaction.reply({ content: 'This command only works in text channels', ephemeral: true });
        }
        
        const messages = await channel.messages.fetch({ limit: 1 });
        const message = messages.find(m => !m.author.bot); // should not be a bot message

        let jsonData;
        try {
            jsonData = JSON.parse(message!.content);
        } catch (parseError) {
            console.error('JSON parsing error:', parseError);
            return interaction.reply({ content: 'Invalid JSON format in message', ephemeral: true });
        }

        // Initialize Pinata client (adjust based on your SDK setup)
        const pinata = await pinataSDK();

        const upload = await pinata.upload.json(jsonData).addMetadata({ name: interaction.user.id });
        //console.log(upload);
        
        await interaction.reply({ 
            content: `JSON uploaded to Pinata! You can view it at: ${pinataUrl}/${upload.IpfsHash}`, 
            ephemeral: true 
        });
        
    } catch (error) {
        console.error('Error uploading to Pinata:', error);
        await interaction.reply({ 
            content: 'Failed to upload data to Pinata', 
            ephemeral: true 
        }).catch(console.error);
    }
}

async function _getStoredPostId(thread: ThreadChannel) {
    // Get the pinned message from the thread
    const pinnedMessages = (await thread.messages.fetchPinned()).filter((m:Message) => m.author.bot);

    // If there are no pinned messages, return
    if (pinnedMessages.size === 0) {
        return;
    }

    const postMessage = pinnedMessages.first();
    const match = postMessage?.content.match(/https:\/\/discord\.com\/channels\/\d+\/(\d+)(?:\/(\d+))?/);
    if (!match) {
        console.error("Did not find a post link in the pinned message.", postMessage);
    }
    return match ? match[1] : undefined;
}

async function _storePostId(interaction: ButtonInteraction, designThread: ThreadChannel, post: ThreadChannel) {
    // Defer the response to avoid leaving the interaction hanging
    if (!interaction.deferred) {
        await interaction.deferReply();
    }
    // Add a pinned message to the thread with a link to the post
    const messageContent = `Shared in ${post.url}`;
    const pinnedMessages = await designThread.messages.fetchPinned();
    const existingPostMessage = pinnedMessages.find(m => m.content.includes("Shared in") && m.author.bot);

    if (existingPostMessage) {
        // If an existing pinned message is found, edit it
        await existingPostMessage.edit(messageContent);
        // No need to pin again if it's already pinned
    } else {
        // If no existing message is found, create a new one and pin it
        const sentMessage = await designThread.send(messageContent);
        await sentMessage.pin();
    }

    // Ensure the interaction is replied to, to avoid leaving the interaction hanging
    if (!interaction.replied) {
        await interaction.followUp({
            content: "The updated game design has been shared.",
            ephemeral: true
        });
    }  
}

async function _updateThread(gameTitle: string,  gameSpecification: string, aiQuestions: string, 
                            thread: ThreadChannel<boolean>) {
    let outputMessage = `**Game Title:** ${gameTitle}\n\n**Game Design Specification:** \n${gameSpecification}\n\n**AI Questions:**\n${aiQuestions}`;

    try {
        const response = await sendToThread(thread, outputMessage, {
            components: [buttonActionRow]
        });
        return response;
    } catch (e) {
        console.error(`Error sending chunks: ${e}`);
    }
}

// Adds the image to the first message in the thread
async function _updateMessageWithImage(message: Message, image_url: string) {
    try {
        // Create the embed with the image
        const embed = {
            image: {
                url: image_url
            }
        };

        // Edit the message with the image
        await message.edit({ content: message.content, embeds: [embed]});
    } catch (e) {
        console.error(`Error sending image: ${e}`);
    }
}

async function _invokeChaincraftAgent(userInput: string, current_state: any = {},  approved: boolean = false) {
    try {
        if (!agentApi) {
            agentApi = await init();
        }
        return await agentApi.submit(userInput, approved, current_state);
    } catch (error) {
        throw new Error(`Error initializing chaincraft design agent: ${error}`);  
    }
}

async function _invokeGenerateImage(input_design: string) {
    try {
        if (!agentApi) {
            agentApi = await init();
        }
        return await agentApi.generateImage(input_design);
    } catch (error) {
        throw new Error(`Error initializing chaincraft design agent: ${error}`);  
    }
}

