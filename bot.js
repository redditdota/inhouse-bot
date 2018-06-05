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

Array.prototype.sum=function(){
  let sum = 0;
  for(let i=0; i<this.length; i++){
   sum+=this[i];
  }
  return sum;
}

//
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
      if(!row){
      }
      else{
        let now = (new Date).getTime();
        let endTime = now + row.duration;

        //find the message
        let channel = client.channels.get(row.channelID);
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
                  else if(now > row.endTime){
                    //leave message in channel saying that the queue is now closed
                    //set isFinished in the database to 1
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
      console.log("has_mmr length: " + Object.keys(users.has_mmr).length);
      if(Object.keys(users.has_mmr).length >= lobbySize){
        let lobby = [];

        //populate a lobby
        let playersNeeded = lobbySize;
        for(let i in users.has_mmr){
          if(playersNeeded <= 0){
            break;
          }
          else{
            lobby.push(users.has_mmr[i]);
            playersNeeded -= 1;
          }
        }

        //todo: balance teams


        //send each user a message and remove their reaction
        for(let i in lobby){
          lobby[i].user.send({embed :{
            color : color,
            title : "Inhouse",
            description : "Join Team: Dire"
          }});
          reaction.remove(lobby[i].user);
        }
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

//when a message is recieved
client.on("message", message => {
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

    //help command
    else if(args[0] == prefix + "help"){
      if(args.length == 1){
        message.reply({ embed : {
          color : color,
          title : "Inhouse Bot - Help",
          description :
            "For more help on a command use: "+prefix + "help commandName\n\n"+
            "**inhouse** - creating an inhouse (ADMIN ONLY)\n"+
            "**link** - linking MMR\n"+
            "**mmr** - check MMR\n"+
            "**about** - about this bot"
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
      }
    }
  }
});

function test(message){
  let sample = [
    4000,
    6500,
    3800,
    4100,
    4500,
    4800,
    2000,
    5000,
    2100,
    4350
  ];

  let playersPerTeam = 5;
  let teamA = sample.subarray(0,playersPerTeam);
  let teamB = sample.subarray(playersPerTeam, playersPerTeam);

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
          a, b, (teamB[b]-teamA[a]) + (teamB[b]-teamA[a])
        ]);
      }
    }

    let closestDiff = teamA.sum() - teamB.sum();
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

  message.channel.send(
    "players: [" + sample.toString() +
    "]\nAvg Diff: " + Math.abs(avgA-avgB) + "\nA: " + avgA + "\nB: " + avgB
  );

  let teams = {
    a : teamA,
    b : teamB
  }

  return teams;
}


function teamAvgMMR(team){
  let sum = 0;
  for(let i=0; i<team.length; i++){
    sum += team[i];
  }
  return parseInt(sum/team.length);
}

client.on('error', error => {
  console.log("CLIENT ERROR");
  console.log(error);
});

client.on('disconnect', event => {
  console.log("DISCONNECTED");
});

client.login(config.token);
