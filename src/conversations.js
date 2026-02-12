const { v4: uuidv4 } = require('uuid');

// In-memory conversation store
// Each conversation: { messages: [{role, content}, ...], created_at, last_activity }
const conversations = {};

/**
 * Create a new conversation and return its ID
 */
function createConversation() {
  const id = uuidv4();
  conversations[id] = {
    messages: [],
    created_at: new Date().toISOString(),
    last_activity: new Date().toISOString(),
  };
  return id;
}

/**
 * Get or create a conversation.
 * If conversationId is provided and exists, return it.
 * Otherwise, create a new one.
 */
function getOrCreateConversation(conversationId) {
  if (conversationId && conversations[conversationId]) {
    return conversationId;
  }
  return createConversation();
}

/**
 * Add a message to a conversation
 */
function addMessage(conversationId, role, content) {
  if (!conversations[conversationId]) return;
  conversations[conversationId].messages.push({ role, content });
  conversations[conversationId].last_activity = new Date().toISOString();
}

/**
 * Get all messages for a conversation (to pass to chat())
 */
function getMessages(conversationId) {
  if (!conversations[conversationId]) return [];
  return conversations[conversationId].messages;
}

module.exports = {
  createConversation,
  getOrCreateConversation,
  addMessage,
  getMessages,
};
