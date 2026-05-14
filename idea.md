# What is this project?

This project will contain a few tools to help playing DnD. It will be hosted on a server with the domain `0x1763.dev` pointing to it.
The bot must have a discord integration. An admin user will write commands to the bot where the bot will react to.
For now it is mostly hosting minigames. The bot will create a new game based on the admins input and then generate a link to the game.
The link will be sent to all DnD players where they can play the game together.

---

# Games

## Number Wordle

This game is a wordle clone yet there is 3 modes. `Numbers`, `Letters` and `Mixed`. For `Numbers` only numbers can be input. For `Letters` only letters can be input.
For `Mixed` both can be input. The game also has a custom number of tries for each game created.

### Game creation

The admin will text the bot `/game create wordle [secret] [tries]`. Based on the secret the type will be automatically set. The bot should answer with a link the admin
can send to the users. The users can then play the game.

### Notes

Search the web for a opensource version of wordle and modify it instead of writing it yourself. Use the design taste skill to make the web page look awesome.
Also search the web for the discord bot API instead of guessing how it might work. Pls use `bun` as a backend and delegate coding tasks to `opencode`.
