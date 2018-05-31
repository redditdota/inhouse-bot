# Dota 2 Inhouse Bot
Creates an inhouse queue and sets up private match for Dota 2

## Road Map
* match players with other similar skill players
* match players with no mmr linked together
* option to ignore mmr with matchmaking
* close the queue once the time has concluded

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
