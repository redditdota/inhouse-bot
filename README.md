# Dota 2 Inhouse Bot
Creates an inhouse queue and sets up private match for Dota 2

## Road Map
* balance players in the lobby
* prioritize players with larger mmr and lower mmr to play together
* match players with no mmr linked together
* remind people to link their mmr, otherwise they wont be able to play
* close the queue once the time has concluded
* take into account the amount of time someone has been queuing

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
