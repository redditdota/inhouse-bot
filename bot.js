const Discord = require("discord.js");
const client = new Discord.Client();
const config = require("./config.json");
const request = require('request');
const sql = require("sqlite");



sql.open("./db.sqlite");
const prefix = "++";
const botName = "inhouse bot"
const color = parseInt("FFA200", 16); //converts hexadecimal to decimal
const reactEmote = "👌";
const msPerMin = 60000;
const adminRoles = ["Moderators", "Discord Mods"];

//if a user has these roles they will get a notification when a match start
//moderators will get more info
const moderatorRoleName = "inhouse-moderator";
const casterRoleName = "inhouse-caster";
const moderatorChannelID = "454116595271335941";

const inhouseID = "rdota2";

//true if there is an inhouse queue open
var hasInhouseOpen = false;
var observeInterval;

Array.prototype.subarray=function(start,size){
   if(!size){ size=0;}
   let arr = [];
   for(let i = start; i<this.length && i<start+size; i++){
     arr.push(this[i]);
   }
   return arr;
}

//inhouse commands
function inhouse(message, args){
  if(args.length == 2){
    if(args[1] == "clear"){
      sql.run("DELETE FROM inhouse").catch(console.error);
      return;
    }
  }
  if(args.length <= 5){
    message.reply("missing arguments. Use " + prefix + "help for argument help");
  }
  else{
    let lobbySize = parseInt(args[1]);
    let duration = parseInt(args[2]);
    let initalDelay = parseInt(args[3]);
    args.splice(0,4);
    let title = args.join(" ");

    if(isNaN(lobbySize) || isNaN(duration) || isNaN(initalDelay)){
      message.reply("one of the required arguments is not an integer");
    }

    //send inital message
    message.channel.send({embed: {
      color : color,
      title : title,
      description :
        "React with " + reactEmote + " to queue for a match!\n\n" +
        "**Lobby size**: " + lobbySize + "\n" +
        "**Starts at**: " + new Date((new Date).getTime() + (initalDelay * msPerMin)).toLocaleString() + "\n" +
        "**Duration**: " + duration + "mins",
      timestamp :  new Date((new Date).getTime() + ((initalDelay + duration) * msPerMin)),
      footer: {
        text : "Ends"
      },
    }}).then((msg) => {
      //add reaction
      msg.react(reactEmote).catch(console.error);

      //using epoch times for database
      let startTime = (new Date).getTime() + (initalDelay * msPerMin);
      let durationInMs = duration * msPerMin;

      //add to database
      sql.run("CREATE TABLE IF NOT EXISTS inhouse (msgID TEXT, channelID TEXT, lobbySize INTEGER, startTime INTEGER, duration INTEGER, title TEXT, isFinished INTEGER)").then(() => {
        sql.run("INSERT INTO inhouse (msgID, channelID, lobbySize, startTime, duration, title, isFinished) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [msg.id, msg.channel.id, lobbySize, startTime, duration, title, 0]).then(() =>{
            hasInhouseOpen = true;
            observeQueue();
          }).catch(console.error);
      }).catch(console.error);

    }).catch(console.error);
  }
}

//creates an interval which checks the inhouse reactions
function observeQueue(){
  if(observeInterval !== undefined){
    return;
  }

  let checkTime = 1000; //repeat time of the interval (milliseconds)
  observeInterval = client.setInterval(function(){
    sql.get("SELECT * FROM inhouse WHERE isFinished=0").then(row =>{
      if(row){
        let now = (new Date).getTime();
        let endTime = row.startTime + (row.duration * msPerMin);
        let channel = client.channels.get(row.channelID);

        //end of queue
        if(now > endTime){
          //set isFinished in the database to 1
          sql.run("UPDATE inhouse SET isFinished=1 WHERE msgID='"+row.msgID+"' AND channelID='"+row.channelID+"'").then(()=>{
            console.log("INHOUSE ENDED");
            //leave message in channel saying that the queue is now closed
            channel.send({ embed : {
              color : color,
              title : row.title + " is now over!",
              description : "You can no longer queue for this inhouse\n\nThanks to everyone who competed! 😄\n",
              timestamp : new Date(),
              footer : {
                text : "Ended at"
              }
            }});
          }).catch(console.error);
        }

        //find the message
        channel.fetchMessage(row.msgID).then(message => {
          message.reactions.forEach(function(reaction, key, map){
            //fetch the users with the matching emote
            if(reaction["_emoji"].name == reactEmote){
              if(reaction.count >= row.lobbySize + 1){ //+1 because the bot always has a reaction
                reaction.fetchUsers().then(users =>{
                  let usersInQueue = [];

                  //filter out the bots
                  users.forEach(function(user, userID, map){
                    if(!user.bot){
                      usersInQueue.push(user);
                    }
                  });

                  //if the queue is not over try to create a match
                  if(now <= endTime && now >= row.startTime){
                    createMatch(reaction, usersInQueue, row.lobbySize, row.title);
                  }
                });
              }
            }
          });
        }).catch(console.error);
      }
    });
  }, checkTime);
}


//random integer between min and max (both inclusive)
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/*
  - find the mmr of each player who is in the queue
  - pick out 10 users for a new lobby
  - balance the teams
  - send each user a DM with info on the teams and lobby to join
  - remove their reaction
*/
function createMatch(reaction, usersInQueue, lobbySize, title){
  //not enough players
  if(usersInQueue.length < lobbySize){
    return;
  }

  //find players with the closest skill level
  if(usersInQueue.length >= lobbySize){
    //query all users mmr and add them to a json object
    sql.all("SELECT * FROM accounts").then(rows=>{
      //id of all the users and their mmr
      let users = {
        has_mmr : {}, //userid:mmr
        no_mmr : [] //userid,userid,userid
      };
      let found = false;
      //find the mmr for each player in the queue
      for(let i=0; i<usersInQueue.length; i++){
        found = false;
        for(let r in rows){
          if(!found && rows[r].userID == usersInQueue[i].id){
            users.has_mmr[usersInQueue[i].id] = {
              mmr : rows[r].mmr,
              user :usersInQueue[i]
            };
        //    console.log("added user: [" + usersInQueue[i].id + "] = " + rows[r].mmr);
            found = true;
            break;
          }
        }
        if(!found){
        //  console.log("user mmr not found: " + usersInQueue[i].id);
          users.no_mmr.push(usersInQueue[i].id);
        }
      }

      //make sure we have 10 or more users with mmr linked
      if(Object.keys(users.has_mmr).length >= lobbySize){
        let lobby = [];

        //populate a lobby
        let playersNeeded = lobbySize;

        //if less than 15 players, just add players based on the reaction queue
        let prioritizeMMRLimit = lobbySize + lobbySize/2;
        let userCountWithMMR = Object.keys(users.has_mmr).length;
        if(userCountWithMMR < prioritizeMMRLimit){
          for(let i in users.has_mmr){
            if(playersNeeded <= 0){
              break;
            }
            else{
              lobby.push(users.has_mmr[i]);
              playersNeeded -= 1;
            }
          }
        }
        //pick the players with the highest mmr
        else if(userCountWithMMR >= prioritizeMMRLimit){
          //order players by mmr, make the lobby the top 10 mmr players
          let ordered = [];
          for(let u in users.has_mmr){
            let index = 0;
            let flag = true;
            do{
              if(ordered.length <= index || users.has_mmr[u].mmr > ordered[index].mmr){
                ordered.splice(index, 0, users.has_mmr[u]);
                flag = false;
              }
              else{
                index++;
              }
            }while(index < ordered.length && flag);
          }

          lobby = ordered.splice(0, lobbySize);
        }


        let playersPerTeam = lobbySize*0.5;
        if(!Number.isInteger(playersPerTeam)){
          playersPerTeam = parseInt(playersPerTeam)+1;
        }
        let lobbyTeams = balanceLobby(lobby, playersPerTeam);

        let teamNames = {
          a : "Radiant",
          b : "Dire"
        }

        let teamTable = "";
        let teamTableAdmin = "";
        let hasCaptain = false;

        //find the match index
        sql.run("CREATE TABLE IF NOT EXISTS matches (inhouseID TEXT, matchNum TEXT, time INTEGER, avgMMR INTEGER)").then(() => {
          sql.all("SELECT * FROM matches WHERE inhouseID='"+inhouseID+"'").then(rows =>{
            //match index is autoincrement
            let matchIndex = 1;
            if(rows){
              matchIndex = rows.length + 1;
            }

            let lobbyName = inhouseID + "-" + matchIndex;
            let lobbyPassword = "d" + randomInt(10,99);


            //create string for teams
            for(let i in lobbyTeams){
              lobbyTeams[i] = getSortedTeamByMMR(lobbyTeams[i]); //sort each team by mmr
              teamTable += "**" + teamNames[i] + "**\n----------------\n";
              teamTableAdmin += teamNames[i] + "\n----------------\n";
              hasCaptain = false;

              for(let j in lobbyTeams[i]){
                if(lobbyTeams[i][j].user !== undefined){
                  let captainStr = "";
                  if(!hasCaptain){
                    captainStr = " [Captain]";
                    hasCaptain = true;
                  }
                  teamTable += lobbyTeams[i][j].user.username + captainStr + "\n";
                  teamTableAdmin += lobbyTeams[i][j].mmr + " : " + lobbyTeams[i][j].user.username + captainStr + "\n";
                }
              }
              teamTable += "\n\n";
              teamTableAdmin += "\n";
            }

            //notify admins of the new match
            let adminRole =  reaction.message.guild.roles.find("name",  moderatorRoleName);
            let moderators = reaction.message.guild.roles.get(adminRole.id).members;

            let teamAVGs = {};
            for(let i in lobbyTeams){
              teamAVGs[i] = teamAvgMMR(lobbyTeams[i]);
              if(isNaN(parseInt(teamAVGs[i]))){
                teamAVGs[i] = 0;
              }
            }
            let avgMatchMMR = (teamAVGs["a"] + teamAVGs["b"])/2;
            let diffInMMR = Math.abs(teamAVGs["a"] - teamAVGs["b"]);

            //MODERATOR MSG
            //send messages to mod channel
            let modChannel = client.channels.get(moderatorChannelID);

            modChannel.send({ embed: {
              color : color,
              title : "Match Started",
              description:
                  "**Create Lobby**:\n" +
                  "Name: " + lobbyName + "\nPassword: " + lobbyPassword + "\n\n" +
                  "**AVG Match MMR**: " + avgMatchMMR + "\n\n" +
                  teamNames["a"] + " AVG MMR: " + teamAVGs["a"] + "\n" +
                  teamNames["b"] + " AVG MMR: " + teamAVGs["b"] + "\n" +
                  "Diff AVG MMR: " + diffInMMR + "\n" +
                  "Match Index : " + matchIndex,
                timestamp : new Date(),
                footer : {
                  text : "Created at"
                }
            }});

            modChannel.send({ embed: {
              color : color,
              title : "Teams",
              description:
                  teamTableAdmin,
                timestamp : new Date(),
                footer : {
                  text : "Created at"
                }
            }});

            modChannel.send("-------------");

            //CASTER MSG
            //notify all casters on the match
            let casterRole =  reaction.message.guild.roles.find("name",  casterRoleName);
            let casters = reaction.message.guild.roles.get(casterRole.id).members;
            casters.forEach(function(caster, key, map){
              caster.send({ embed : {
                color : color,
                title : "Caster Notification",
                description :
                  "Match Started!\nAVG MMR: " + avgMatchMMR + "\n\n" +
                  "**Lobby**\nName: " + lobbyName + "\nPassword: " + lobbyPassword + "\n\n" +
                  "**Note**: if the lobby doesn't exist yet please wait until the admin creates it",
                timestamp : new Date(),
                footer : {
                  text : "Created at"
                }
              }});
            });

            //send each player a message and remove their reaction
            //PLAYER MSG
            let teamCount = 0;
            for(let i in lobbyTeams){
              for(let j in lobbyTeams[i]){
                if(lobbyTeams[i][j].user){
                  lobbyTeams[i][j].user.send({embed :{
                    color : color,
                    title : "Match Starting - Inhouse",
                    description : "Your Team: **" + teamNames[i] + "**\n"+
                      "\n**Join Lobby**:\n" +
                      "Name: " + lobbyName + "\nPassword: " + lobbyPassword +
                      "\n\n**Note:** if the lobby doesn't exist yet, please wait for the admin to create it" +
                      "\n\n"+ teamTable + "\n\n"+
                      "Good luck have fun 😁"
                  }});
                  reaction.remove(lobbyTeams[i][j].user);
                }
              }
            }

            //add match to database
            sql.run(
              "INSERT INTO matches (inhouseID, matchNum, time, avgMMR) VALUES (?, ?, ?, ?)",
              [inhouseID, matchIndex, (new Date).getTime(), avgMatchMMR]
            ).catch(console.error);

            console.log("MATCH CREATED: " + avgMatchMMR + " AVG MMR");
          }).catch(console.error);
        }).catch(console.error);
      }
      //for now ignore users with no mmr linked
      else{
        console.log("not enough players for a lobby with their mmr linked");
      }

    }).catch(console.error);
  }
}

function linkAccount(message, steam32ID){
  if(!(!isNaN(parseInt(steam32ID)) && steam32ID.length < 10 && steam32ID.length > 6)){
    message.reply("invalid steam32ID!\n"+
      "You can find you id if you go to your opendota profile and the id is the numbers at the end of the url\n\n"+
      "e.g. opendota.com/players/12345678 , id = 12345678");
    return;
  }

  //find estimated mmr using opendota api
  let url = "https://api.opendota.com/api/players/" + steam32ID;
  request(url, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      let info = JSON.parse(body);
      //profile not found
      if(info.profile === undefined || info.profile.profileurl == null){
        message.reply("No OpenDota account was found with that steam32ID");
      }
      else if(info.mmr_estimate !== undefined){
        let mmr = parseInt(info.mmr_estimate.estimate);
        //if estimated mmr is not an integer
        if(isNaN(mmr)){
          message.reply("No estimated MMR was found for this OpenDota account");
        }
        else{
          addAccount(message, message.author.id, steam32ID, mmr);
        }
      }
      else{
        message.reply("No estimated MMR was found for this OpenDota account");
      }
    }
    else{
      console.log("request error");
    }
  });
}

/*
adds a users mmr to account table

account table:
userID: discord user id (PRIMARY KEY)
steam32ID
mmr : match making rating
submitTime : epoch time of the time the mmr was last submitted
*/
function addAccount(message, userID, steam32ID, mmr){
  sql.run("REPLACE INTO accounts (userID, steam32ID, mmr, submitTime) VALUES (?, ?, ?, ?)",
    [userID, steam32ID, mmr, (new Date).getTime()]).then(()=>{
      message.channel.send("Success! <@"+userID+">'s MMR has be linked");
  }).catch(()=>{
    sql.run("CREATE TABLE IF NOT EXISTS accounts (userID TEXT PRIMARY KEY, steam32ID TEXT, mmr INTEGER, submitTime INTEGER)").then(() => {
      sql.run("INSERT INTO accounts (userID, steam32ID, mmr, submitTime) VALUES (?, ?, ?, ?)",
        [userID, steam32ID, mmr, (new Date).getTime()]).then(() =>{
          message.channel.send("Success! <@"+userID+">'s MMR has be linked");
        });
    });
  });
}

//query a users mmr
function checkMMR(message, userID){
  sql.get("SELECT * FROM accounts WHERE userID='"+userID+"'").then(row=>{
    if(row){
      message.author.send("MMR: " + row.mmr);
    }
  }).catch(console.error);
}

//returns true if the user has an admin role
function isAdmin(message){
  for(let i in adminRoles){
    if(message.member.roles.find("name", adminRoles[i])){
      return true;
    }
  }
  return false;
}

//add or remove the moderator role on a user
function manageModerators(message, args){
  //validate command, must be admin and have usersID as the 2nd arg
  if(isAdmin(message)){
    if(args[2] !== undefined && args[2].match(/\<@[0-9]+\>/)){
      let role = message.guild.roles.find("name", moderatorRoleName);
      let member = message.mentions.members.first();
      if(args[1] == "add"){
        member.addRole(role).catch(console.error);
        message.reply("you added " + args[2] + " as a new inhouse moderator");
      }
      else if(args[1] == "remove"){
        member.removeRole(role).catch(console.error);
        message.reply("you removed " + args[1] + " as a inhouse moderator");
      }
    }
  }
}

//add or remove caster role
//casters will get notified when a match starts
function manageCasters(message, args){
  let role = message.guild.roles.find("name", casterRoleName);

  if(args[1] === undefined){
    return;
  }
  //remove all casters
  if(args[1] == "clear"){
    let casters = message.guild.roles.get(role.id).members;
    casters.forEach(function(caster, key, map){
      caster.removeRole(role).catch(console.error);
    });
    message.reply("you removed all the casters");
  }
  else if(args[1] == "list"){
    let casters = message.guild.roles.get(role.id).members;
    let casterStr = "";

    let count = 0;
    casters.forEach(function(caster, key, map){
      count += 1;
      casterStr += count + ": " + caster.user.username + "\n";
    });
    message.channel.send({ embed : {
      color : color,
      title : "Casters ("+count+")",
      description : casterStr
    }});
  }
  else if(args[2] !== undefined){

    let member = message.mentions.members.first();
    if(member === undefined || member == null){
      return;
    }

    if(args[1] == "add"){
      member.addRole(role).catch(console.error);
      message.reply("you added " + args[2] + " as a caster");
    }
    if(args[1] == "remove"){
      member.removeRole(role).catch(console.error);
      message.reply("you removed " + args[2] + " as a caster");
    }
  }
}

//remove the caster role from the user of the msg
function removeCasterSelf(message){
  let role = message.guild.roles.find("name", casterRoleName);
  message.member.removeRole(role).catch(console.error);
  message.reply("you are now removed as a caster");
}

//when the bot enters the ready state
client.on("ready", () => {
  console.log(botName + " ready!");

  sql.get("SELECT * FROM inhouse WHERE isFinished=0").then(row => {
    if(row){
      hasInhouseOpen = true;
      observeQueue();
    }
  }).catch(console.error);
});

function setup(){
  client.user.setUsername("🏆 Inhouse 🏆");
  client.user.setPresence({ game: {
      name: prefix + "help",
      type : "LISTENING"
    },
    status: "online",
    afk: false
  });
}

//when a message is recieved
client.on("message", message => {
  setup();

  //command
  if(message.content.startsWith(prefix)){
    console.log("COMMAND: " + message.content);
    let args = message.content.split(" ");

    //check if bot is alive
    if(message.content == prefix + "ping"){
      message.reply("pong");
    }

    else if(args[0] == prefix + "test"){
      test(message);
    }

    else if(args[0] == prefix + "mod"){
      if(args.length != 3){
        return;
      }
      if(args[1] == "add" || args[1] == "remove"){
        manageModerators(message, args);
      }
    }

    else if(args[0] == prefix + "unsub"){
      removeCasterSelf(message);
    }

    else if(args[0] == prefix + "about"){
      message.channel.send({ embed :{
        color : color,
        title : "Inhouse Bot",
        description : "Dota 2 Inhouse Bot",
        fields : [
          {
            name : "Source",
            value : "https://github.com/redditdota/inhouse-bot"
          }
        ]
      }});
    }

    //inhouse command
    else if(args[0] == prefix + "inhouse"){
      if(!isAdmin(message)){
        message.reply("You need to be an admin to use this command");
      }
      else{
        inhouse(message, args);
      }
    }

    else if(args[0] == prefix + "caster"){
      let admin = isAdmin(message);
      if(!admin){
        message.reply("You need to be an admin to use this command");
      }
      else if(admin && args.length > 1){
        manageCasters(message, args);
      }
    }

    //link mmr with opendota or set by an admin
    else if(message.content.startsWith(prefix + "link")){
      //++link @user mmr
      if(args.length == 3){
        if(!isAdmin(message)){
          message.reply("Sorry you need to be an admin to use that command.\n"+
            "If you need to set your mmr contact an admin");
          return;
        }
        //validation
        if(args[1].match(/\<@[0-9]+\>/g)){
          let userID = args[1].substr(2,args[1].length-3);
          let mmr = parseInt(args[2]);
          if(isNaN(mmr)){
            message.reply("Error: MMR must be an whole number");
          }
          else{
            addAccount(message, userID, "", mmr);
          }
        }
      }
      //++link steam32ID
      else if(args.length == 2){
        linkAccount(message, args[1]);
      }
    }

    else if(message.content.startsWith(prefix + "mmr")){
      if(args.length == 2){
        if(!isAdmin(message)){
          message.reply("You need to be an admin to use this command");
        }
        else if(args[1].match(/\<@[0-9]+\>/g)){
          let userID = args[1].substr(2,args[1].length-3);
          checkMMR(message, userID);
        }
      }
      else if(args.length == 1){
        checkMMR(message, message.author.id);
      }
    }

    else if(message.content.startsWith(prefix + "lobby") && isAdmin(message)){
      message.reply({ embed :{
        color : color,
        title : "Lobby Settings",
        description :
          "```Server:           EU = Luxembuorg, NA = US East\n" +
          "Game Mode:           Captains Mode\n" +
          "Visibility:          Public\n" +
          "Cheats:              Disabled\n" +
          "Selection Priority:  Coin Flip\n" +
          "Penalty:             None\n" +
          "Spectators:          Enabled\n" +
          "DotaTV Delay:        2 mins\n" +
          "Pausing:             limited\n" +
          "Series:              False\n" +
          "Bots:                Disabled```"
      }});
    }

    else if(args[0] == prefix + "faq"){
      message.reply({ embed : {
        color : color,
        title : "Frequently Asked Questions",
        description :
          "**How do I link my MMR?**\n" +
          "use the " + prefix + "link command if you already have an OpenDota account. "+
          "However if you don't have an account, ping an inhouse moderator with a screenshot of your mmr and/or medal. They will link your mmr manually\n\n"+
          "**How to Join a Dota lobby?**\n" +
          "Click 'Play Dota' > View Lobbies > Search for the lobby > Join Lobby > Enter password\n\n"+
          "**I can't join my match**\n" +
          "Please wait for an inhouse moderator to create the server. However the lobby might have had a remake if you didn't join in time\n\n" +
          "**A player isn't joining**\n" +
          "Wait for 5-7mins for all players to join, if you are waiting longer leave the lobby and join the queue again with a " + reactEmote +"reaction\n\n" +
          "**What is the Game Mode?**\n" +
          "5v5 Captains Mode\n\n" +
          "**Can we play on a different server?**\n"+
          "Both captains must agree on changing the default server for your region\n(NA = US East, EU = Luxembuorg)\n\n"+
          "**Can I become a caster?**\n"+
          "Yes! DM or ping one of the inhouse moderators and they can add you as a caster"
      }});
    }

    else if(message.content.startsWith(prefix + "mail")){
      let msg = message.content;
      let commandLen = (prefix + "mail").length;
      msg = msg.substr(commandLen, msg.length - commandLen);
      let modChannel = client.channels.get(moderatorChannelID);
      modChannel.send({ embed : {
        color : color,
        title : "💌 Mod Mail 💌",
        description : message.author.username + " said:\n" + msg.trim()
      }});
    }

    //help command
    else if(args[0] == prefix + "help"){
      if(args.length == 1){
        message.reply({ embed : {
          color : color,
          title : "Inhouse Bot - Help",
          description :
            "For more help on a command use: "+prefix + "help commandName\n\n"+

            "**link** - linking MMR\n"+
            "**mmr** - check MMR\n"+
            "**faq** - frequently asked questions\n"+
            "**unsub** - removes yourself as a caster\n" +
            "**about** - about this bot\n"+
            "**ping** - check if bot is alive\n" +
            "**mail** - send the inhouse moderators a message\n"+
            "\nAdmin Only\n--------------------\n"+
            "**inhouse** - creating an inhouse\n"+
            "**mod** - add/remove a user as an inhouse moderator\n"+
            "**caster** - manage the caster roles\n"+
            "**lobby** - view settings for a Dota lobby"
        }});
      }

      if(args.length == 2){
        let helpCommand = args[1];

        if(helpCommand == "inhouse"){
          message.reply({ embed : {
            color : color,
            title : "Command Help - " + helpCommand + " (ADMIN ONLY)",
            description :
              prefix + "**inhouse lobbySize duration initalDelay title**\n\n" +
              "**Example**: \n**" + prefix + "inhouse 10 120 5 r/Dota2 Inhouse!**\n\n"+
              "The example above will open an inhouse queue and wait for 5 mins before the first matches start and "+
              "players will be able to join the queue upto 120 mins after the first matches start\n"+
              "----------\n"+
              "**" + prefix + "inhouse clear**\n"+
              "this will clear all the existing inhouse queues\n"+
              "**Note**: All number values are in minutes and must be integers"
            }
          });
        }
        else if(helpCommand == "link"){
          message.reply({ embed : {
            color: color,
            title : "Command Help - " + helpCommand,
            description :
              "**" + prefix + "link steam32ID** - link your MMR using OpenDota\n"+
              "**" + prefix + "link @user mmr** - (ADMIN ONLY)\n"
          }});
        }
        else if(helpCommand == "mmr"){
          message.reply({ embed : {
            color : color,
            title : "Command Help - " + helpCommand,
            description :
            "**" + prefix + "mmr** - gets your mmr\n"+
            "**" + prefix + "mmr @user** - gets the users mmr (ADMIN ONLY)\n"
            }
          });
        }

        else if(helpCommand == "caster"){
          message.reply({ embed : {
            color : color,
            title : "Command Help - " + helpCommand,
            description :
            "Manage the caster roles. Casters will get notified when a match starts. If you want to add/remove yourself then mention yourself as @user\n\n"+
            "**" + prefix + "caster add @user** - add user as a caster\n"+
            "**" + prefix + "caster remove @user** - remove user as a caster\n"+
            "**" + prefix + "caster clear** - remove the caster role from all users\n"+
            "**" + prefix + "caster list** - list all the casters"
            }
          });
        }

        else if(helpCommand == "mod"){
          message.reply({ embed : {
            color : color,
            title : "Command Help - " + helpCommand,
            description :
            "You can add or remove a user as an inhouse moderator. If you want to add/remove yourself then mention yourself as @user\n\n"+
            "**" + prefix + "mod add @user** - add user as a moderator\n"+
            "**" + prefix + "mod remove @user** - remove user as a moderator\n"
            }
          });
        }

        else if(helpCommand == "mail"){
          message.reply({ embed : {
            color : color,
            title : "Command Help - " + helpCommand,
            description :
            "Please ONLY use this for issues about the inhouse, example:\n\n"+
            "**" + prefix + "mail I'm an unsatisfied punk**"
            }
          });
        }
      }
    }
  }
});

function balanceLobby(players, playersPerTeam){
  let teamA = players.subarray(0,playersPerTeam);
  let teamB = players.subarray(playersPerTeam, playersPerTeam);

  //approximation solution
  //swap a player on each team so we get a closer matching subset sum
  //num of comparisions per repeat: (playersPerTeam^2)
  let balanced = false;
  let repeats = 5;
  for(let y=0; y < repeats && !balanced; y++){
    //fill a maxtrix with the difference a swap will make to the
    //difference in the subset sum
    let matrix = []; //a index, b index, diff change if swapped
    for(let a=0; a<teamA.length; a++){
      for(let b=0; b<teamB.length; b++){
        matrix.push([
          a, b, (teamB[b].mmr - teamA[a].mmr) + (teamB[b].mmr - teamA[a].mmr)
        ]);
      }
    }

    let closestDiff = teamSumMMR(teamA) - teamSumMMR(teamB);
    let closestIndex = -1;
    for(let i=0; i<matrix.length; i++){
      //subset sum difference if the swap is made
      let nextDiff = matrix[i][2] + closestDiff;
      //if the next difference is smaller
      if(Math.abs(nextDiff) < Math.abs(closestDiff)){
        closestDiff = nextDiff;
        closestIndex = i;
        if(nextDiff == 0){
          balanced = true;
          break;
        }
      }
    }

    //swap
    if(closestIndex > -1){
      let aIndex = matrix[closestIndex][0];
      let bIndex = matrix[closestIndex][1];
      let temp = teamA[aIndex];
      teamA[aIndex] = teamB[bIndex];
      teamB[bIndex] = temp;
    }
    //no more swaps can be made
    else{
      balanced = true;
    }
  }


  let avgA = teamAvgMMR(teamA);
  let avgB = teamAvgMMR(teamB);

  let teams = {
    a : teamA,
    b : teamB
  }

  return teams;
}

function teamSumMMR(team){
  let sum = 0;
  for(let i=0; i<team.length; i++){
    sum += team[i];
  }
  return sum;
}


function teamAvgMMR(team){
  let sum = 0;
  for(let i=0; i<team.length; i++){
    sum += team[i].mmr;
  }
  return parseInt(sum/team.length);
}

function getSortedTeamByMMR(team){
  let swapped;
    do {
      swapped = false;
      for (let i=0; i < team.length-1; i++) {
          if (team[i].mmr < team[i+1].mmr) {
              let temp = team[i];
              team[i] = team[i+1];
              team[i+1] = temp;
              swapped = true;
          }
      }
  } while (swapped);

  return team;
}

function test(message){
  let sample = [
    {mmr: 2500},
    {mmr: 2000},
    {mmr: 3000},
    {mmr: 1000}
  ];
  console.log(getSortedTeamByMMR(sample));
}

client.on('error', error => {
  console.log("CLIENT ERROR");
  console.log(error);
});

client.on('disconnect', event => {
  console.log("DISCONNECTED");
});

client.on('messageReactionAdd', (reaction, user) => {
  //check if message is a inhouse message
  if(user.bot) return;
  let msgID = reaction.message.id;
  let channelID = reaction.message.channel.id;
  sql.get("SELECT * FROM inhouse WHERE msgID='"+msgID+"' AND channelID='"+channelID+"'").then(row => {
    if(row){
      //check if the user has linked their mmr
      sql.get("SELECT * FROM accounts WHERE userID='"+user.id+"'").then(row => {
        //if not mmr is linked, remove the reaction and notify the user
        if(!row){
          reaction.remove(user);
          user.send("<@" + user.id + "> You cannot participate until you link your mmr. "+
            "You can link your mmr using "+ prefix + "link\n"+
            "if you need help use "+prefix + "help link");
        }
      }).catch(console.error);
    }
  }).catch(console.error);
});



client.login(config.token);
