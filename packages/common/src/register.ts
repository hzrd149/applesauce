// Import models that should register with the event store
import "./models/blossom.js";
import "./models/mutes.js";
import "./models/reactions.js";
import "./models/comments.js";
import "./models/thread.js";

// Import blueprints that should register with the event factory
import "./blueprints/comment.js";
import "./blueprints/delete.js";
import "./blueprints/note.js";
import "./blueprints/reaction.js";
import "./blueprints/share.js";
import "./blueprints/poll.js";
