// Load the environment variables from the .env file
import 'dotenv/config.js';

import { Client, Collection, Events, GatewayIntentBits, type Message } from 'discord.js';

import type { ICommand } from './commands/command.js';
import { ChaincraftCommand } from './commands/chaincraft-commands.js';

const token = process.env.CHAINCRAFT_DISCORD_BOT_TOKEN;

// Listen for unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const commands = new Collection<string, ICommand>();

// Create a new client instance
const client = new Client({ intents: [
	GatewayIntentBits.Guilds,
	GatewayIntentBits.GuildMessages,
	GatewayIntentBits.DirectMessages,
	GatewayIntentBits.MessageContent
] });

// When the client is ready, run this code (only once).
// The distinction between `client: Client<boolean>` and `readyClient: Client<true>` is important for TypeScript developers.
// It makes some properties non-nullable.
client.once(Events.ClientReady, readyClient => {
	console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

// Log in to Discord with your client's token
client.login(token);

commands.set(ChaincraftCommand.data.name, ChaincraftCommand);

client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isChatInputCommand()) return;

	const command = commands.get(interaction.commandName);

	if (!command) {
		console.error(`No command matching ${interaction.commandName} was found.`);
		return;
	}

	try {
		await command.execute(interaction);
	} catch (error) {
		console.error(error);
		if (interaction.replied || interaction.deferred) {
			await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
		} else {
			await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
		}
	}
});

// Register events
const eventsModule = await import('./events/chaincraft-events.js');

interface Event {
    name: string;
    execute: (...args: any[]) => Promise<void>;
}

Object.values(eventsModule).forEach((event: Event) => {
	client.on(event.name as string, async (...args) => event.execute(...args));
});
