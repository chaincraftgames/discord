import { Events, Interaction, Message, ThreadChannel } from "discord.js";
import { isMessageInChaincraftDesignActiveThread, continueChaincraftDesign,
         approveChaincraftDesign
 } from '../chaincraft-design.js'
import { removeState } from "../chaincraft_state_cache.js";
 
const ChaincraftOnMessage = {
    name: Events.MessageCreate,
    execute: async (message: Message) => { 
        if (
            !message.author.bot && 
            await isMessageInChaincraftDesignActiveThread(message)
        ) {
            await continueChaincraftDesign(message)
        }
    }
}

const ChaincraftOnThreadDelete = {
    name: Events.ThreadDelete,
    execute: async (thread: ThreadChannel) => {
        removeState(thread.id);
    }
}

const ChaincraftOnApprove = {
    name: Events.InteractionCreate,
    execute: async (interaction: Interaction) => {
        if (interaction.isButton() && interaction.customId === 'approve') {
            await approveChaincraftDesign(interaction)
        }
    }
}

export { 
    ChaincraftOnMessage, 
    ChaincraftOnApprove,
    ChaincraftOnThreadDelete
 }