import { Events, Interaction, Message, ThreadChannel } from "discord.js";
import { isMessageInChaincraftDesignActiveThread, continueChaincraftDesign,
         approveChaincraftDesign, shareChaincraftDesign
 } from '../chaincraft-design.js'
import { removeState } from "../chaincraft_state_cache.js";
 
const ChaincraftOnMessage = {
    name: Events.MessageCreate,
    execute: async (message: Message) => { 
        try {
            if (
                !message.author.bot && 
                await isMessageInChaincraftDesignActiveThread(message)
            ) {
                await continueChaincraftDesign(message)
            }
        } catch (error) {
          console.error("Unhandled error in ChaincraftOnMessage: ", error);    
        }
    }
}

const ChaincraftOnThreadDelete = {
    name: Events.ThreadDelete,
    execute: async (thread: ThreadChannel) => {
        try {
            removeState(thread.id);
        
        } catch (error) {
            console.error("Unhandled error in ChaincraftOnThreadDelete: ", error);
        }    
    }
}

const ChaincraftOnApprove = {
    name: Events.InteractionCreate,
    execute: async (interaction: Interaction) => {
        try {
            if (interaction.isButton() && interaction.customId === 'chaincraft_approve_design') {
                await approveChaincraftDesign(interaction)
            }
        } catch (error) {
            console.error("Unhandled error in ChaincraftOnApprove: ", error);    
        }
    }
}

const ChaincraftOnShare = {
    name: Events.InteractionCreate,
    execute: async (interaction: Interaction) => {
        try {
            if (interaction.isButton() && interaction.customId === 'chaincraft_share_design') {
                await shareChaincraftDesign(interaction)
            }
        } catch (error) {
            console.error("Unhandled error in ChaincraftOnShare: ", error);    
        }
    }
}

export { 
    ChaincraftOnMessage, 
    ChaincraftOnApprove,
    ChaincraftOnShare,
    ChaincraftOnThreadDelete
 }