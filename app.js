var accessToken = getHashValue("access_token");
var myId = null;
var alreadySubscribedToEvent = false;
var exponentialBackoff = 0;
function addListEntry(txt, id) {
  let ul = document.getElementById("chat");
  let li = document.createElement("li");
  let textNode = document.createElement("span");
  textNode.innerText = txt;
  textNode.setAttribute("id", id);
  li.appendChild(textNode);
  ul.appendChild(li);
  window.scrollTo(0, document.body.scrollHeight); // Scroll to bottom of page
}
function getHashValue(key) {
  matches = location.hash.match(new RegExp(key + "=([^&]*)"));
  return matches ? matches[1] : null;
}
async function connect() {
  connectImpl(accessToken, [document.getElementById("channel").value]);
}
async function connectImpl(token, channels) {
  channels = channels.map((channel) => channel.toLowerCase());
  let usersQueryString = "?";
  for (let i = 0; i < channels.length; i++) {
    if (i == 0) {
      usersQueryString += `login=${channels[i]}`;
    } else {
      usersQueryString += `&login=${channels[i]}`;
    }
  }
  await fetch("https://api.twitch.tv/helix/users", {
    method: "GET",
    headers: {
      "Client-ID": "2igqjwktgfbdo1ct62h273rmv79qap",
      Authorization: `Bearer ${accessToken}`,
    },
  })
    .then(async (res) => {
      let resJson = await res.json();
      if (res.status) {
        var statusBox = document.getElementById("statusBox");
        if (res.status >= 200 && res.status < 300) {
          statusBox.innerText = `Token valid`;
          statusBox.classList = "green";
          myId = resJson.data[0].id;
        } else {
          statusBox.innerText = `${resJson.status}  - ${resJson.message}`;
          statusBox.classList = "red";
        }
      }
      return resJson;
    })
    .catch((err) => {
      var statusBox = document.getElementById("statusBox");
      statusBox.innerText = `Error connecting to Twitch Chat: ${err}`;
      statusBox.classList = "red";
      return {
        data: [],
      };
    });
  let users = await fetch(
    `https://api.twitch.tv/helix/users${usersQueryString}`,
    {
      method: "GET",
      headers: {
        "Client-ID": "2igqjwktgfbdo1ct62h273rmv79qap",
        Authorization: `Bearer ${accessToken}`,
      },
    },
  )
    .then((res) => res.json())
    .catch((err) => {
      var statusBox = document.getElementById("statusBox");
      statusBox.innerText = `Error connecting to Twitch Chat: ${err}`;
      statusBox.classList = "red";
      return {
        data: [],
      };
    });
  let keepaliveTimeoutSeconds = {
    start: 0,
    end: 0,
    interval: 0,
  };
  let keepaliveTimeoutInterval = setInterval(() => {
    if (keepaliveTimeoutSeconds.start > 0 && keepaliveTimeoutSeconds.end > 0) {
      if (keepaliveTimeoutSeconds.end - keepaliveTimeoutSeconds.start > 10) {
        connectImpl(token, channels);
        clearInterval(keepaliveTimeoutInterval);
      }
    }
  }, 1000);
  let client = new WebSocket("wss://eventsub.wss.twitch.tv/ws");
  let onopen = (event) => {
    console.log("EventSub connection established!");
    exponentialBackoff = 0;
  };
  let onmessage = async (event) => {
    let data = JSON.parse(event.data);
    if (data.metadata?.message_type == "session_welcome") {
      console.log(`session_welcome: ${JSON.stringify(data)}`);
      if (alreadySubscribedToEvent) return;
      let id = data.payload.session.id;
      keepaliveTimeoutSeconds.interval =
        data.payload.session.keepalive_timeout_seconds;
      for (let user of users.data) {
        // https://dev.twitch.tv/docs/api/reference/#create-eventsub-subscription
        let subscription = await fetch(
          "https://api.twitch.tv/helix/eventsub/subscriptions",
          {
            method: "POST",
            headers: {
              "Client-ID": "2igqjwktgfbdo1ct62h273rmv79qap",
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              type: "channel.chat.message",
              version: "1",
              condition: {
                broadcaster_user_id: user.id,
                user_id: myId,
              },
              transport: {
                method: "websocket",
                session_id: id,
              },
            }),
          },
        ).then((res) => res.json());
        console.log(subscription);
      }
      alreadySubscribedToEvent = true;
    } else if (data.metadata?.message_type == "session_keepalive") {
      console.log(`session_keepalive: ${JSON.stringify(data)}`);
    } else if (data.metadata?.message_type == "session_reconnect") {
      console.log(`session_reconnect: ${JSON.stringify(data)}`);
      console.log(`Reconnecting to ${data.payload.session.reconnect_url}`);
      client = new WebSocket(data.payload.session.reconnect_url);
      client.onopen = onopen;
      client.onmessage = onmessage;
      client.onclose = onclose;
      client.onerror = onerror;
    } else if (data.payload?.subscription?.type == "channel.chat.message") {
      console.log(`channel.chat.message: ${JSON.stringify(data)}`);
      let messageText = data.payload.event.message.text;
      let broadcasterId = data.payload.event.broadcaster_user_id;
      if (messageText.toLowerCase() === "!antifollowerping") {
        fetch("https://api.twitch.tv/helix/chat/messages", {
          method: "POST",
          headers: {
            "Client-ID": "2igqjwktgfbdo1ct62h273rmv79qap",
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            broadcaster_id: broadcasterId,
            sender_id: myId,
            message: "antifollowerpong",
            reply_parent_message_id: data.payload.event.message_id,
          }),
        })
          .then(async (res) => {
            if (res.status) {
              let resJson = await res.json();
              if (res.status >= 200 && res.status < 300) {
                response = `Deleted Message by ${chatterUserDisplayName}: ${messageText}`;
                if (resJson.data[0].is_sent) {
                  console.log(
                    `Successfully sent antifollowerpong to channel ${data.payload.event.broadcaster_user_login}`,
                  );
                } else {
                  console.log(
                    `Failed to send antifollowerpong to channel ${data.payload.event.broadcaster_user_login} due to: ${resJson.data[0].drop_reason?.code} - ${resJson.data[0].drop_reason?.message}`,
                  );
                }
              } else {
                response = `${res.status} - ${res.statusText}: ${JSON.stringify(await res.json())}`;
              }
            } else {
              response = `Twitch didn't return a response status for sending a message`;
            }
          })
          .catch((err) => {
            response = `Couldn't send Message due to: ${err}`;
          });
      }
      let badges = data.payload.event.badges.map((badge) => badge.set_id);
      let chatterUserDisplayName = data.payload.event.chatter_user_name;
      let response;
      if (
        badges.includes("broadcaster") ||
        badges.includes("moderator") ||
        badges.includes("subscriber") ||
        badges.includes("vip")
      ) {
        response = `Bypassed by Badges of ${chatterUserDisplayName}: ${messageText}`;
      } else {
        if (
          messageText.match(
            /(?:(?:All|Everything|Only) for your (?:stream|channel).*(?:primes|viewers|follow| ?(?:\w*\. ?\w*|\*\*\*))|.*(?:(?:channel|viewers|views|f[o0]ll[o0]wers|primes|chat b[o0]ts|[o0]r|subprime|follows|primesubs|bits) ?,? ?)+ on \w+ *(?:\.|dot) *(?:\w|-|(?:\.|dot) ?)+|(?:Upgrade|Improver?|.*[o0]ffer pr[o0]m[o0]ti[o0]n [o0]f|Bewerben Sie|Promote) *(?:Ihren |your )?(?:(?:Kanal|channel|stream|viewers|views|f[o0]ll[o0]wers|primes|chat b[o0]ts|and|[o0]r) ?,? ?)+|Zuschauer für nur|hier ist (?:eine?)? ?Promo|streamhub world)/gi,
          )
        ) {
          fetch(
            `https://api.twitch.tv/helix/moderation/chat?broadcaster_id=${broadcasterId}&moderator_id=${myId}&message_id=${data.payload.event.message_id}`,
            {
              method: "DELETE",
              headers: {
                "Client-ID": "2igqjwktgfbdo1ct62h273rmv79qap",
                Authorization: `Bearer ${token}`,
              },
            },
          )
            .then(async (res) => {
              if (res.status) {
                if (res.status >= 200 && res.status < 300) {
                  response = `Deleted Message by ${chatterUserDisplayName}: ${messageText}`;
                } else {
                  response = `${res.status} - ${res.statusText}: ${JSON.stringify(await res.json())}`;
                }
              } else {
                response = `Twitch didn't return a response status for deleting a message`;
              }
            })
            .catch((err) => {
              response = `Couldn't delete Message due to: ${err}`;
            });
        } else {
          response = `Not Bypassed by Badges of ${chatterUserDisplayName}: ${messageText}`;
        }
      }
      console.log(response);
      addListEntry(response, data.payload.event.message_id);
    } else {
      console.log(`EventSub Data: ${JSON.stringify(data)}`);
    }
    keepaliveTimeoutSeconds.start = Date.now() / 1000;
    keepaliveTimeoutSeconds.end =
      keepaliveTimeoutSeconds.start + keepaliveTimeoutSeconds.interval;
  };
  let onclose = (event) => {
    console.log(
      `EventSub connection closed! (Code: ${event.code}; Reason: ${event.reason})`,
    );
    if (!event.wasClean) {
      console.log(
        `Connection didn't close in a clean manner! Maybe just the connection was lost! Trying to reconnect... (exponential backoff: ${exponentialBackoff})`,
      );
      alreadySubscribedToEvent = false;
      if (exponentialBackoff == 0) {
        connectImpl(token, channels);
        exponentialBackoff = 100;
      } else {
        setTimeout(() => {
          connectImpl(token, channels);
        }, exponentialBackoff);
      }
      exponentialBackoff *= 2;
    }
  };
  let onerror = (event) => {
    console.log(`EventSub connection errored!`);
  };
  client.onopen = onopen;
  client.onmessage = onmessage;
  client.onclose = onclose;
  client.onerror = onerror;
}
if (window.accessToken) {
  document.getElementById("authorizeBtn").style.display = "none";
} else {
  document.getElementById("botForm").style.display = "none";
}
