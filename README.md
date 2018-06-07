# Dota 2 Inhouse Bot
Creates an inhouse queue and sets up private match for Dota 2

## Road Map
* categorize players if the queue is bigger than 2 lobbies
  * prioritize players with larger mmr and lower mmr to play together
* add extra info
* move const info to config file

## Future Iterations
* take into account the amount of time someone has been queuing
* ignore mmr
* different lobby sizes for custom games
* give roles to users in a match
  * admin can message all players in a match and tell them to remake
* invite players to match using steamkit
* get results of match

## Features
* Opens a queue
* Links MMR via OpenDota or set by Admins
* Disables players to join unless they have MMR linked
* Players get a notification when their match starts
* Moderators and Casters get notifications when any match starts
* Managing of caster and moderator roles

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
You will also need to set some roles:
* admins
  * the type of users who can use all the bot commands
* inhouse-bot
  * permissions: manage roles and emojis, send and read messages
* inhouse-moderator
  * These users will get notification when the match starts with all the info on MMR and when to create a lobby
* inhouse-caster
  * These users will get a notification when a match starts with the match avg MMR
