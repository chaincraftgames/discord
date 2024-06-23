import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChannelType, CommandInteraction, 
         Message, TextChannel, ThreadAutoArchiveDuration, ThreadChannel } from "discord.js";

import { chainCraftGameDescriptionOptionName } from "./commands/chaincraft-commands.js";
import { init } from "./chaincraft-design-agent.js";
import { getState, setState, removeState } from "./chaincraft_state_cache.js";
import { createThreadInChannel, sendToThread } from "./util.js";
import { create } from "domain";

const designChannelId = process.env.CHAINCRAFT_DESIGN_CHANNEL_ID;

let submitToAgent: Function | undefined;

const approveButton = new ButtonBuilder()
        .setCustomId('approve')
        .setLabel('Approve')
        .setStyle(ButtonStyle.Primary)

const buttonActionRow = new ActionRowBuilder<ButtonBuilder>()
       .addComponents(approveButton); 

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
        return state !== null && !state.approved;
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
            gameSpecification,
            aiQuestions,
            updatedState
        } = await _invokeChaincraftAgent(gameDescription);
    
        const threadMessage = `**${gameDescription}** - ${interaction.user.toString()}`
        
        thread = await createThreadInChannel(
            interaction.client, 
            designChannelId as string,
            gameDescription!.substring(0, 100), 
            ThreadAutoArchiveDuration.OneHour,
	        true
        );

        if (!thread) {
            throw new Error("Thread could not be created.");
        }
        thread = thread as ThreadChannel<boolean>;
        await thread.join();
        thread.send(threadMessage);

        setState(thread.id, updatedState);

        await _updateThread(gameSpecification, aiQuestions, thread)

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
            gameSpecification,
            aiQuestions,
            updatedState
        } = await _invokeChaincraftAgent(userInput, state);

        setState(threadId, updatedState);

        // Delete the processing message
        await processingMessage.delete();
        _updateThread(gameSpecification, aiQuestions, message.channel as ThreadChannel<boolean>);
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

async function _updateThread(gameSpecification: string, aiQuestions: string, 
                            thread: ThreadChannel<boolean>) {
    let outputMessage = `\nGame Design Specification: \n${gameSpecification}\n\nAI Questions:\n${aiQuestions}`;

    try {
        const response = await sendToThread(thread, outputMessage, {
            components: [buttonActionRow]
        });
        return response;
    } catch (e) {
        console.error(`Error sending chunks: ${e}`);
    }
}

async function _invokeChaincraftAgent(userInput: string, current_state: any = {},  approved: boolean = false) {
    try {
        if (!submitToAgent) {
            const agent = await init();
            submitToAgent = agent.submit as Function;
        }
        return await submitToAgent(userInput, approved, current_state);
    } catch (error) {
        throw new Error(`Error initializing chaincraft design agent: ${error}`);  
    }
}