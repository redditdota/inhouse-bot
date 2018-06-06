# Dota 2 Inhouse Bot
Creates an inhouse queue and sets up private match for Dota 2

## Road Map
* send admins a DM when a match starts
  * with extra info about MMR
* categorize players if the queue is bigger than 2 lobbies
  * prioritize players with larger mmr and lower mmr to play together
* close the queue once the time has concluded

## Future Iterations
* take into account the amount of time someone has been queuing
* ignore mmr
* different lobby sizes for custom games
* give roles to users in a match
  * admin can message all players in a match and tell them to remake
* invite players to match using steamkit
* get results of match

## Setup
You will need NodeJS and to install the following npm modules:
* npm i discord.js
* npm i request
* npm i sqlite

You will also need to create a file called config.json with the following content:
```json
{
  "token":"myAppTokenHere"
}
```
